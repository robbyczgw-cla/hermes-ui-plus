//! Hermes UI desktop shell (macOS first, Linux alpha). The UI is the static Expo web build bundled into the app
//! (frontendDist = ../dist-web), served from tauri://localhost. This side only adds what a browser tab
//! cannot do: global shortcut, menu bar + tray + dock menu, native notifications (with approval actions),
//! window state, vibrancy / unified title bar, Touch ID lock, login item, files dropped on the dock icon.
//!
//! Shell -> web: `window` CustomEvent "hermes-desktop"; `detail` is a command string ("new-chat", "find", …) or an
//! object `{cmd, …}` ("open-recent", "open-chat", "context-action", "chrome", "pending"), handled in
//! app/src/desktop/. Anything that must survive a cold start (notification responses, files opened via the
//! dock) is queued and fetched with `desktop_take_pending`.
//! Web -> shell: the `desktop_*` commands below. `window.__HERMES_DESKTOP__` (init script) carries the static
//! config (platform, title bar inset, stored desktop prefs) so the first render is already right.

mod menus;
mod prefs;

#[cfg(target_os = "macos")]
mod mac;

use std::{
    collections::{HashMap, HashSet},
    fs::{self, File, OpenOptions},
    io::Write,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex, OnceLock,
    },
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    webview::NewWindowResponse,
    AppHandle, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_notification::NotificationExt;

use menus::{MenuState, MenuStore, RecentChat};
use prefs::{DesktopPrefs, LockState, PrefsStore};

const MAIN: &str = "main";
const LOG_MAX_BYTES: u64 = 1024 * 1024;
/// files dropped on the dock icon are read into the web app: keep that bounded
const MAX_OPEN_FILE_BYTES: u64 = 64 * 1024 * 1024;

/// traffic lights (overlay title bar): inset of the close button, so they sit vertically centred in the
/// app's 54 px header rows; the web side moves its first header item right of them (`titlebarInset`)
#[cfg(target_os = "macos")]
const TL_X: f64 = 18.0;
#[cfg(target_os = "macos")]
const TL_Y: f64 = 25.0;

static APP: OnceLock<AppHandle> = OnceLock::new();
static FULLSCREEN: AtomicBool = AtomicBool::new(false);

/// Forwards console.error/warn, uncaught errors, unhandled rejections and CSP violations of the main
/// frame to the app log dir (macOS ~/Library/Logs/<bundle id>/, Linux ~/.local/share/<bundle id>/logs/)
/// as console.log (release builds have no inspector).
const CONSOLE_FORWARD_JS: &str = r#"
(function () {
  if (window.__hermesDesktopLog) return;
  window.__hermesDesktopLog = true;
  function fmt(a) {
    if (a instanceof Error) return a.stack || String(a);
    if (typeof a === 'string') return a;
    try { return JSON.stringify(a); } catch (e) { return String(a); }
  }
  function send(level, args) {
    try {
      var msg = Array.prototype.map.call(args, fmt).join(' ').slice(0, 4000);
      var t = window.__TAURI_INTERNALS__;
      if (t && t.invoke) t.invoke('desktop_log', { level: level, msg: msg }).catch(function () {});
    } catch (e) {}
  }
  ['error', 'warn'].forEach(function (l) {
    var orig = console[l];
    console[l] = function () { send(l, arguments); return orig.apply(console, arguments); };
  });
  addEventListener('error', function (e) { send('uncaught', [(e.message || 'error') + ' @ ' + (e.filename || '') + ':' + (e.lineno || 0)]); });
  addEventListener('unhandledrejection', function (e) { send('rejection', [e.reason]); });
  addEventListener('securitypolicyviolation', function (e) { send('csp', [e.violatedDirective + ' blocked ' + e.blockedURI]); });
  addEventListener('DOMContentLoaded', function () {
    send('info', ['loaded ' + location.href + ' origin=' + location.origin]);
    // render probe (counts only, never page text)
    setTimeout(function () {
      var root = document.getElementById('root');
      send('info', ['render: ' + document.getElementsByTagName('*').length + ' elements, #root children ' + (root ? root.childElementCount : -1) + ', textareas ' + document.getElementsByTagName('textarea').length + ', title=' + document.title]);
    }, 5000);
  });
})();
"#;

struct ConsoleLog(Mutex<Option<File>>);

impl ConsoleLog {
    fn open(dir: Option<PathBuf>) -> Self {
        let file = dir.and_then(|d| {
            fs::create_dir_all(&d).ok()?;
            let p = d.join("console.log");
            if fs::metadata(&p).map(|m| m.len() > LOG_MAX_BYTES).unwrap_or(false) {
                let _ = fs::rename(&p, d.join("console.1.log"));
            }
            OpenOptions::new().create(true).append(true).open(p).ok()
        });
        ConsoleLog(Mutex::new(file))
    }

    fn write(&self, level: &str, msg: &str) {
        if let Ok(mut g) = self.0.lock() {
            if let Some(f) = g.as_mut() {
                let ts = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
                let _ = writeln!(f, "{ts} [{}] {}", clip(level, 16), clip(msg, 4000).replace('\n', "\n    "));
            }
        }
    }
}

fn clip(s: &str, max: usize) -> String {
    s.chars().take(max).collect()
}

fn log(app: &AppHandle, level: &str, msg: &str) {
    if let Some(l) = app.try_state::<ConsoleLog>() {
        l.write(level, msg);
    }
}

// ------------------------------------------------------------------ shell -> web

fn emit_web(app: &AppHandle, detail: &Value) {
    if let Some(w) = app.get_webview_window(MAIN) {
        // serde_json output is a valid JS expression
        let _ = w.eval(format!("window.dispatchEvent(new CustomEvent('hermes-desktop',{{detail:{detail}}}))"));
    }
}

fn dispatch(app: &AppHandle, cmd: &str) {
    emit_web(app, &json!(cmd));
}

/// notification responses + files opened via the dock: queued, the web app takes them (`desktop_take_pending`)
/// when it runs – also after a cold start caused by the click / the drop
#[derive(Default)]
struct Pending {
    files: Vec<Value>,
    responses: Vec<Value>,
}
struct PendingStore(Mutex<Pending>);

/// paths the user handed to the app (dock drop / "Open With"): the only files `desktop_read_file` reads
struct OpenedFiles(Mutex<HashSet<PathBuf>>);

fn push_pending(app: &AppHandle, f: impl FnOnce(&mut Pending)) {
    if let Some(s) = app.try_state::<PendingStore>() {
        if let Ok(mut p) = s.0.lock() {
            f(&mut p);
        }
    }
    emit_web(app, &json!({ "cmd": "pending" }));
}

fn show_main(app: &AppHandle) -> Option<WebviewWindow> {
    #[cfg(target_os = "macos")]
    let _ = app.show();
    let w = app.get_webview_window(MAIN)?;
    let _ = w.unminimize();
    let _ = w.show();
    let _ = w.set_focus();
    Some(w)
}

fn new_chat(app: &AppHandle) {
    if show_main(app).is_some() {
        dispatch(app, "new-chat");
    }
}

/// ⌥Space: bring Hermes to the front with a fresh chat and the composer focused; pressed again while
/// Hermes is the key window, it hides the app (focus returns to the previous app, like Spotlight).
fn quick_toggle(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(MAIN) {
        let front = w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false) && !w.is_minimized().unwrap_or(false);
        if front {
            #[cfg(target_os = "macos")]
            let _ = app.hide();
            #[cfg(not(target_os = "macos"))]
            let _ = w.hide();
            return;
        }
    }
    new_chat(app);
}

/// menu bar, tray, context menu (`ctx:<token>:<action>`)
fn on_menu(app: &AppHandle, id: &str) {
    match id {
        "new-chat" => new_chat(app),
        "show" => {
            show_main(app);
        }
        "reload" => {
            // a reload while locked would start a page that has to ask for the lock state first: not needed
            if is_locked(app) {
                return;
            }
            if let Some(w) = app.get_webview_window(MAIN) {
                let _ = w.eval("location.reload()");
            }
        }
        "quit" => app.exit(0),
        "settings" | "find" | "search" | "toggle-sidebar" | "stop" | "copy-last" | "focus-composer" | "prev-chat" | "next-chat" => {
            show_main(app);
            dispatch(app, id);
        }
        _ => {
            if let Some(i) = id.strip_prefix("recent:").and_then(|n| n.parse::<usize>().ok()) {
                if is_locked(app) {
                    return;
                }
                show_main(app);
                emit_web(app, &json!({ "cmd": "open-recent", "index": i }));
            } else if let Some(rest) = id.strip_prefix("ctx:") {
                if let Some((token, action)) = rest.split_once(':') {
                    emit_web(app, &json!({ "cmd": "context-action", "token": token, "action": action }));
                }
            }
        }
    }
}

fn is_locked(app: &AppHandle) -> bool {
    app.try_state::<LockState>().map(|l| l.locked()).unwrap_or(false)
}

/// dock menu (mac.rs): tag 0 = new chat, n = n-th recent chat
#[allow(dead_code)] // called from the objc dock menu target (macOS only)
pub(crate) fn on_dock_item(tag: i64) {
    let Some(app) = APP.get() else { return };
    if tag > 0 && is_locked(app) {
        return;
    }
    if tag <= 0 {
        new_chat(app);
        return;
    }
    let id = app
        .try_state::<MenuStore>()
        .and_then(|s| s.0.lock().ok().and_then(|st| st.recent.get(tag as usize - 1).map(|c| c.id.clone())));
    if let Some(id) = id {
        show_main(app);
        emit_web(app, &json!({ "cmd": "open-chat", "id": id }));
    }
}

/// click on a notification (opens the window) or one of its action buttons (no window)
#[allow(dead_code)] // called from the objc notification delegate (macOS only)
pub(crate) fn on_notification_response(id: &str, action: &str, data: Option<String>) {
    let Some(app) = APP.get() else { return };
    #[cfg(target_os = "macos")]
    let open = action == mac::ACTION_OPEN;
    #[cfg(not(target_os = "macos"))]
    let open = true;
    if action.ends_with("DismissActionIdentifier") {
        return;
    }
    let data: Value = data.and_then(|d| serde_json::from_str(&d).ok()).unwrap_or(Value::Null);
    let action = if open { "open" } else { action };
    log(app, "info", &format!("notification response: {action}"));
    if open {
        show_main(app);
    }
    let entry = json!({ "id": id, "action": action, "data": data });
    push_pending(app, |p| p.responses.push(entry));
}

// ------------------------------------------------------------------ commands

#[tauri::command]
fn desktop_log(log: tauri::State<'_, ConsoleLog>, level: String, msg: String) {
    log.write(&level, &msg);
}

/// Native notification. `data` (JSON) comes back on click / action; `tag` = notification id (same tag
/// replaces, `desktop_notify_remove`); `kind: "approval"` adds the "allow once" / "deny" buttons (macOS).
#[tauri::command]
fn desktop_notify(
    app: AppHandle,
    title: String,
    body: String,
    data: Option<String>,
    tag: Option<String>,
    kind: Option<String>,
) -> Result<(), String> {
    let title = clip(&title, 200);
    let body = clip(&body, 1000);
    #[cfg(target_os = "macos")]
    {
        let id = tag.clone().map(|t| clip(&t, 200)).unwrap_or_else(|| {
            let n = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
            format!("hui-{n}")
        });
        let data = data.as_deref().map(|d| clip(d, 4000));
        if mac::notify(&id, &title, &body, data.as_deref(), kind.as_deref() == Some("approval")) {
            return Ok(());
        }
    }
    let _ = (&data, &tag, &kind);
    app.notification().builder().title(title).body(body).show().map_err(|e| e.to_string())
}

#[tauri::command]
fn desktop_notify_remove(tag: String) {
    #[cfg(target_os = "macos")]
    mac::remove_notification(&tag);
    let _ = tag;
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopInfo {
    platform: &'static str,
    /// macOS accent color `#rrggbb`
    accent: Option<String>,
    /// left edge for the first header item (right of the traffic lights)
    titlebar_inset: f64,
    /// vertical centre of the traffic lights (diagnostics)
    traffic_light_center: f64,
    fullscreen: bool,
    /// "enabled" | "disabled" | "requiresApproval" | "unsupported"
    login_item: &'static str,
    /// Touch ID / password available for the app lock
    auth_available: bool,
    prefs: DesktopPrefs,
}

#[tauri::command]
fn desktop_info(app: AppHandle, prefs: tauri::State<'_, PrefsStore>) -> DesktopInfo {
    let fullscreen = app.get_webview_window(MAIN).and_then(|w| w.is_fullscreen().ok()).unwrap_or(false);
    FULLSCREEN.store(fullscreen, Ordering::Relaxed);
    #[cfg(target_os = "macos")]
    {
        let w = app.get_webview_window(MAIN);
        let geo = w.and_then(|w| mac::on_main(&app, move |mtm| mac::ns_window(&w, mtm).and_then(|nw| mac::traffic_lights(nw, TL_X))).flatten());
        let (right, center) = geo.unwrap_or((TL_X + 54.0, 0.0));
        let info = DesktopInfo {
            platform: "macos",
            accent: mac::accent_hex(),
            titlebar_inset: (right + 14.0).round(),
            traffic_light_center: center,
            fullscreen,
            login_item: mac::login_item_status(),
            auth_available: mac::auth_available(),
            prefs: prefs.get(),
        };
        log(&app, "info", &format!("traffic lights: right {right:.1}, centre y {center:.1} (header rows: 54 px, centre 27)"));
        info
    }
    #[cfg(not(target_os = "macos"))]
    DesktopInfo {
        platform: std::env::consts::OS,
        accent: None,
        titlebar_inset: 0.0,
        traffic_light_center: 0.0,
        fullscreen,
        login_item: "unsupported",
        auth_available: false,
        prefs: prefs.get(),
    }
}

/// window appearance (vibrancy material, title bar) follows the app's light/dark setting
#[tauri::command]
fn desktop_set_theme(window: WebviewWindow, mode: String) {
    let theme = match mode.as_str() {
        "dark" => Some(tauri::Theme::Dark),
        "light" => Some(tauri::Theme::Light),
        _ => None,
    };
    let _ = window.set_theme(theme);
}

/// menu labels (web i18n) + the recent chats for the "Chat" menu (⌘1–9) and the dock menu
#[tauri::command]
fn desktop_set_menu(app: AppHandle, store: tauri::State<'_, MenuStore>, labels: HashMap<String, String>, recent: Vec<RecentChat>) {
    let recent: Vec<RecentChat> = recent
        .into_iter()
        .take(menus::MAX_MENU_CHATS)
        .map(|c| RecentChat { id: clip(&c.id, 200), title: menus::clip(&c.title, 80) })
        .collect();
    let labels: HashMap<String, String> = labels.into_iter().take(200).collect();
    let labels_changed;
    {
        let Ok(mut st) = store.0.lock() else { return };
        if st.labels == labels && st.recent == recent {
            return;
        }
        labels_changed = st.labels != labels;
        st.labels = labels;
        st.recent = recent;
    }
    let a = app.clone();
    let _ = app.run_on_main_thread(move || rebuild_menus(&a, labels_changed));
}

/// menu bar + dock menu again (on the main thread), e.g. the recent chats disappear / return with the app lock
fn refresh_menus(app: &AppHandle) {
    let a = app.clone();
    let _ = app.run_on_main_thread(move || rebuild_menus(&a, false));
}

fn rebuild_menus(app: &AppHandle, labels_changed: bool) {
    let Some(store) = app.try_state::<MenuStore>() else { return };
    let Ok(st) = store.0.lock() else { return };
    let locked = is_locked(app);
    if let Err(e) = menus::build_menu_bar(app, &st, locked) {
        log(app, "warn", &format!("menu bar: {e}"));
    }
    let _ = menus::update_tray(app, &st);
    #[cfg(target_os = "macos")]
    if let Some(mtm) = objc2::MainThreadMarker::new() {
        let name = app.package_info().name.clone();
        let titles: Vec<String> =
            menus::listed_chats(&st, locked).iter().take(menus::MAX_DOCK_CHATS).map(|c| menus::clip(&c.title, 50)).collect();
        mac::set_dock_menu(mtm, &menus::label(&st.labels, "newChat", "New Chat", &name), &titles);
        if labels_changed {
            mac::set_approval_actions(
                &menus::label(&st.labels, "allowOnce", "Allow Once", &name),
                &menus::label(&st.labels, "deny", "Deny", &name),
            );
        }
    }
    let _ = labels_changed;
}

/// dock badge: number of unread answers; a small dot on the icon while an answer is being written
#[tauri::command]
fn desktop_set_badge(app: AppHandle, unread: u32, running: bool) {
    if let Some(w) = app.get_webview_window(MAIN) {
        let _ = w.set_badge_count(if unread > 0 { Some(i64::from(unread.min(999))) } else { None });
    }
    #[cfg(target_os = "macos")]
    {
        let a = app.clone();
        let _ = app.run_on_main_thread(move || {
            let _ = &a;
            if let Some(mtm) = objc2::MainThreadMarker::new() {
                mac::set_running_dot(mtm, running);
            }
        });
    }
    let _ = running;
}

#[derive(Deserialize)]
struct CtxItem {
    #[serde(default)]
    id: String,
    #[serde(default)]
    label: String,
    #[serde(default)]
    enabled: Option<bool>,
    #[serde(default)]
    separator: bool,
}

/// native context menu at the mouse position; the choice comes back as `{cmd:"context-action", token, action}`
#[tauri::command]
async fn desktop_context_menu(app: AppHandle, window: WebviewWindow, token: String, items: Vec<CtxItem>) -> Result<(), String> {
    let token: String = token.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').take(40).collect();
    let mut b = MenuBuilder::new(&app);
    for it in items.into_iter().take(30) {
        if it.separator {
            b = b.separator();
            continue;
        }
        let action: String = it.id.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').take(40).collect();
        let mi = MenuItemBuilder::with_id(format!("ctx:{token}:{action}"), menus::clip(&it.label, 80))
            .enabled(it.enabled.unwrap_or(true))
            .build(&app)
            .map_err(|e| e.to_string())?;
        b = b.item(&mi);
    }
    let menu = b.build().map_err(|e| e.to_string())?;
    window.popup_menu(&menu).map_err(|e| e.to_string())
}

/// system share picker for a text (macOS); false → the web app falls back to copying
#[tauri::command]
fn desktop_share(app: AppHandle, window: WebviewWindow, text: String) -> bool {
    #[cfg(target_os = "macos")]
    {
        let text = clip(&text, 100_000);
        return mac::on_main(&app, move |mtm| {
            if let Some(nw) = mac::ns_window(&window, mtm) {
                mac::share(mtm, nw, &text);
                true
            } else {
                false
            }
        })
        .unwrap_or(false);
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, window, text);
        false
    }
}

#[tauri::command]
fn desktop_set_login_item(enabled: bool) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    return mac::set_login_item(enabled).map(String::from);
    #[cfg(not(target_os = "macos"))]
    {
        let _ = enabled;
        Err("unsupported".into())
    }
}

#[tauri::command]
fn desktop_open_login_items() {
    #[cfg(target_os = "macos")]
    mac::open_login_items_settings();
}

#[cfg(target_os = "macos")]
fn apply_activation_policy(app: &AppHandle, menu_bar_only: bool) {
    let policy = if menu_bar_only { tauri::ActivationPolicy::Accessory } else { tauri::ActivationPolicy::Regular };
    let _ = app.set_activation_policy(policy);
}

/// desktop prefs (menu bar only, app lock); "menu bar only" applies right away
#[tauri::command]
fn desktop_set_prefs(
    app: AppHandle,
    store: tauri::State<'_, PrefsStore>,
    lock: tauri::State<'_, LockState>,
    prefs: DesktopPrefs,
) -> Result<DesktopPrefs, String> {
    let before = store.get();
    lock.check_prefs_change(&prefs)?;
    store.set(prefs)?;
    let now = store.get();
    #[cfg(target_os = "macos")]
    if before.menu_bar_only != now.menu_bar_only {
        apply_activation_policy(&app, now.menu_bar_only);
        // switching the policy deactivates the app: keep the settings window in front
        show_main(&app);
    }
    let _ = (&app, &before);
    Ok(now)
}

/// Touch ID / Apple Watch / password (system dialog); true = unlocked (also the shell's lock state)
#[tauri::command]
async fn desktop_unlock(app: AppHandle, reason: String) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    let ok = {
        let reason = clip(&reason, 200);
        tauri::async_runtime::spawn_blocking(move || mac::authenticate(&reason)).await.map_err(|e| e.to_string())??
    };
    #[cfg(not(target_os = "macos"))]
    let ok = {
        let _ = reason;
        true
    };
    if ok {
        if let Some(l) = app.try_state::<LockState>() {
            l.unlocked();
        }
        refresh_menus(&app);
    }
    Ok(ok)
}

/// the web app engaged the lock (launch, time in the background); returns the resulting state
#[tauri::command]
fn desktop_lock(app: AppHandle, store: tauri::State<'_, PrefsStore>, lock: tauri::State<'_, LockState>) -> bool {
    let locked = lock.lock(&store.get());
    // the dock / "Chat" menus drop the chat titles while locked
    refresh_menus(&app);
    locked
}

/// read on every page load: the init script's prefs are those of the window's creation (fail closed on the web side)
#[tauri::command]
fn desktop_lock_state(store: tauri::State<'_, PrefsStore>, lock: tauri::State<'_, LockState>) -> Value {
    json!({ "enabled": store.get().lock_enabled, "locked": lock.locked() })
}

#[tauri::command]
fn desktop_titlebar_double_click(app: AppHandle, window: WebviewWindow) {
    #[cfg(target_os = "macos")]
    {
        mac::on_main(&app, move |mtm| {
            if let Some(nw) = mac::ns_window(&window, mtm) {
                mac::titlebar_double_click(nw);
            }
        });
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        let _ = window.maximize();
    }
}

#[tauri::command]
fn desktop_take_pending(store: tauri::State<'_, PendingStore>) -> Value {
    let Ok(mut p) = store.0.lock() else { return json!({ "files": [], "responses": [] }) };
    let files = std::mem::take(&mut p.files);
    let responses = std::mem::take(&mut p.responses);
    json!({ "files": files, "responses": responses })
}

/// contents of a file the user opened with the app (dock drop / Open With) – nothing else
#[tauri::command]
fn desktop_read_file(opened: tauri::State<'_, OpenedFiles>, path: String) -> Result<tauri::ipc::Response, String> {
    let p = PathBuf::from(&path);
    let allowed = opened.0.lock().map(|s| s.contains(&p)).unwrap_or(false);
    if !allowed {
        return Err("not an opened file".into());
    }
    let meta = fs::metadata(&p).map_err(|e| e.to_string())?;
    if !meta.is_file() || meta.len() > MAX_OPEN_FILE_BYTES {
        return Err("too large".into());
    }
    let bytes = fs::read(&p).map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// files dropped on the dock icon / opened with the app → attachments of the open chat
#[allow(dead_code)] // RunEvent::Opened is macOS / iOS only
fn on_opened(app: &AppHandle, urls: &[Url]) {
    let mut files = Vec::new();
    for u in urls {
        let Ok(p) = u.to_file_path() else { continue };
        let Ok(meta) = fs::metadata(&p) else { continue };
        if !meta.is_file() {
            continue;
        }
        let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        if let Some(s) = app.try_state::<OpenedFiles>() {
            if let Ok(mut set) = s.0.lock() {
                set.insert(p.clone());
            }
        }
        files.push(json!({ "path": p.to_string_lossy(), "name": name, "size": meta.len() }));
    }
    if files.is_empty() {
        return;
    }
    log(app, "info", &format!("opened {} file(s)", files.len()));
    show_main(app);
    push_pending(app, |p| p.files.extend(files));
}

// ------------------------------------------------------------------ window

/// Our own pages (tauri://localhost) and inline frames stay in the webview; everything else opens in
/// the default browser.
fn is_internal(url: &Url) -> bool {
    match url.scheme() {
        "tauri" | "about" | "data" | "blob" => true,
        "http" | "https" => matches!(url.host_str(), Some("tauri.localhost") | Some("ipc.localhost")),
        _ => false,
    }
}

fn open_external(url: &Url) {
    if matches!(url.scheme(), "http" | "https" | "mailto" | "tel") {
        #[cfg(target_os = "macos")]
        let _ = std::process::Command::new("/usr/bin/open").arg(url.as_str()).spawn();
        #[cfg(target_os = "linux")]
        let _ = std::process::Command::new("xdg-open").arg(url.as_str()).spawn();
    }
}

/// static config for the first render (`window.__HERMES_DESKTOP__`)
fn desktop_config_js(prefs: &DesktopPrefs) -> String {
    #[cfg(target_os = "macos")]
    let cfg = json!({
        "platform": "macos",
        "overlayTitlebar": true,
        "vibrancy": true,
        "titlebarInset": TL_X + 70.0,
        "prefs": prefs,
    });
    #[cfg(not(target_os = "macos"))]
    let cfg = json!({ "platform": std::env::consts::OS, "overlayTitlebar": false, "vibrancy": false, "titlebarInset": 0, "prefs": prefs });
    format!("window.__HERMES_DESKTOP__ = Object.freeze({cfg});")
}

fn build_main_window(app: &AppHandle, prefs: &DesktopPrefs) -> tauri::Result<WebviewWindow> {
    let b = WebviewWindowBuilder::new(app, MAIN, WebviewUrl::App("index.html".into()))
        .title("Hermes")
        .inner_size(1100.0, 760.0)
        .min_inner_size(380.0, 560.0)
        .center()
        // HTML5 drag & drop events go to the web app (Tauri's native file-drop handler would swallow them)
        .disable_drag_drop_handler()
        .initialization_script(desktop_config_js(prefs))
        .initialization_script(CONSOLE_FORWARD_JS)
        .on_navigation(|url| {
            if is_internal(url) {
                return true;
            }
            open_external(url);
            false
        })
        .on_new_window(|url, _features| {
            open_external(&url);
            NewWindowResponse::Deny
        });
    // unified title bar: content under the (transparent) title bar, traffic lights inside the sidebar's header
    // row; the window is transparent with the sidebar material behind it – the web app paints everything
    // except the sidebar (app/src/desktop/chrome.ts)
    #[cfg(target_os = "macos")]
    let b = b
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .traffic_light_position(tauri::LogicalPosition::new(TL_X, TL_Y))
        .transparent(true)
        .effects(tauri::utils::config::WindowEffectsConfig {
            effects: vec![tauri::window::Effect::Sidebar],
            state: Some(tauri::window::EffectState::FollowsWindowActiveState),
            radius: None,
            color: None,
            interactive: false,
        });
    b.build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(tauri_plugin_window_state::StateFlags::all() & !tauri_plugin_window_state::StateFlags::VISIBLE)
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            desktop_notify,
            desktop_notify_remove,
            desktop_log,
            desktop_info,
            desktop_set_theme,
            desktop_set_menu,
            desktop_set_badge,
            desktop_context_menu,
            desktop_share,
            desktop_set_login_item,
            desktop_open_login_items,
            desktop_set_prefs,
            desktop_unlock,
            desktop_lock,
            desktop_lock_state,
            desktop_titlebar_double_click,
            desktop_take_pending,
            desktop_read_file,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let _ = APP.set(handle.clone());
            app.manage(ConsoleLog::open(handle.path().app_log_dir().ok()));
            handle.state::<ConsoleLog>().write("info", &format!("start v{}", app.package_info().version));
            app.manage(PrefsStore::load(handle.path().app_config_dir().ok()));
            app.manage(MenuStore(Mutex::new(MenuState::default())));
            app.manage(PendingStore(Mutex::new(Pending::default())));
            app.manage(OpenedFiles(Mutex::new(HashSet::new())));
            let prefs = handle.state::<PrefsStore>().get();
            app.manage(LockState::new(&prefs));

            // "menu bar only": no dock icon from the start
            #[cfg(target_os = "macos")]
            if prefs.menu_bar_only {
                app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            }

            build_main_window(&handle, &prefs)?;
            {
                let st = MenuState::default();
                menus::build_menu_bar(&handle, &st, prefs.lock_enabled)?;
                menus::build_tray(&handle, &st)?;
            }
            #[cfg(target_os = "macos")]
            if let Some(mtm) = objc2::MainThreadMarker::new() {
                mac::install_dock_menu(mtm);
                mac::set_dock_menu(mtm, "New Chat", &[]);
                mac::init_notifications("Allow Once", "Deny");
            }
            // one handler for app menu, tray menu and context menus
            app.on_menu_event(|app, ev| on_menu(app, ev.id().as_ref()));

            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
                let quick = Shortcut::new(Some(Modifiers::ALT), Code::Space);
                handle.plugin(
                    tauri_plugin_global_shortcut::Builder::new()
                        .with_handler(move |app, sc, ev| {
                            if sc == &quick && ev.state() == ShortcutState::Pressed {
                                quick_toggle(app);
                            }
                        })
                        .build(),
                )?;
                if let Err(e) = handle.global_shortcut().register(quick) {
                    handle.state::<ConsoleLog>().write("warn", &format!("global shortcut Alt+Space not registered: {e}"));
                }
            }
            Ok(())
        })
        .on_window_event(|win, ev| {
            if win.label() != MAIN {
                return;
            }
            match ev {
                // closing the main window hides it: Hermes keeps running in the menu bar (⌥Space, tray, dock);
                // ⌘Q / tray "Quit" ends the app
                WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let _ = win.hide();
                }
                // full screen hides the traffic lights: the web header drops its left inset
                WindowEvent::Resized(_) => {
                    let fs = win.is_fullscreen().unwrap_or(false);
                    if FULLSCREEN.swap(fs, Ordering::Relaxed) != fs {
                        emit_web(win.app_handle(), &json!({ "cmd": "chrome", "fullscreen": fs }));
                    }
                }
                _ => {}
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building the Hermes desktop app");

    app.run(|handle, ev| {
        #[cfg(target_os = "macos")]
        match &ev {
            tauri::RunEvent::Reopen { .. } => {
                show_main(handle);
            }
            tauri::RunEvent::Opened { urls } => on_opened(handle, urls),
            _ => {}
        }
        let _ = (handle, &ev);
    });
}
