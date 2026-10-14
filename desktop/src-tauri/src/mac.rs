//! macOS-native pieces Tauri does not cover, via objc2 (one section per feature below).
//!
//! Everything that touches AppKit takes a `MainThreadMarker`; `on_main` gets one from any thread.

use std::{
    cell::RefCell,
    sync::{mpsc, Mutex, OnceLock},
    time::Duration,
};

use block2::RcBlock;
use objc2::{
    define_class, msg_send,
    rc::Retained,
    runtime::{AnyClass, AnyObject, Bool, Imp, NSObject, NSObjectProtocol, ProtocolObject, Sel},
    sel, AllocAnyThread, MainThreadMarker, MainThreadOnly,
};
use objc2_app_kit::{
    NSApplication, NSBezierPath, NSColor, NSColorSpace, NSImage, NSMenu, NSMenuItem, NSSharingServicePicker, NSWindow,
    NSWindowButton,
};
use objc2_foundation::{NSArray, NSBundle, NSDictionary, NSError, NSPoint, NSRect, NSRectEdge, NSSet, NSSize, NSString, NSUserDefaults};
use objc2_local_authentication::{LAContext, LAPolicy};
use objc2_service_management::{SMAppService, SMAppServiceStatus};
use objc2_user_notifications::{
    UNAuthorizationOptions, UNMutableNotificationContent, UNNotification, UNNotificationAction, UNNotificationActionOptions,
    UNNotificationCategory, UNNotificationCategoryOptions, UNNotificationContent, UNNotificationPresentationOptions,
    UNNotificationRequest, UNNotificationResponse, UNNotificationSound, UNUserNotificationCenter, UNUserNotificationCenterDelegate,
};

/// run `f` on the main thread (directly when already there) and wait for its result
pub fn on_main<R: Send + 'static>(app: &tauri::AppHandle, f: impl FnOnce(MainThreadMarker) -> R + Send + 'static) -> Option<R> {
    if let Some(mtm) = MainThreadMarker::new() {
        return Some(f(mtm));
    }
    let (tx, rx) = mpsc::channel();
    app.run_on_main_thread(move || {
        if let Some(mtm) = MainThreadMarker::new() {
            let _ = tx.send(f(mtm));
        }
    })
    .ok()?;
    rx.recv_timeout(Duration::from_secs(5)).ok()
}

/// the NSWindow behind a Tauri window (main thread only)
pub fn ns_window<'a>(w: &tauri::WebviewWindow, _mtm: MainThreadMarker) -> Option<&'a NSWindow> {
    let ptr = w.ns_window().ok()?;
    if ptr.is_null() {
        return None;
    }
    Some(unsafe { &*(ptr as *const NSWindow) })
}

// ------------------------------------------------------------------ appearance

/// the user's accent color (System Settings → Appearance) as `#rrggbb` (sRGB)
pub fn accent_hex() -> Option<String> {
    let c = NSColor::controlAccentColor().colorUsingColorSpace(&NSColorSpace::sRGBColorSpace())?;
    let to = |v: f64| (v.clamp(0.0, 1.0) * 255.0).round() as u8;
    Some(format!("#{:02x}{:02x}{:02x}", to(c.redComponent()), to(c.greenComponent()), to(c.blueComponent())))
}

/// Geometry of the traffic lights as AppKit draws them now: (right edge, vertical centre from the window top).
/// `x` = the configured inset of the close button (the buttons may not have been moved yet at startup).
pub fn traffic_lights(win: &NSWindow, x: f64) -> Option<(f64, f64)> {
    let close = win.standardWindowButton(NSWindowButton::CloseButton)?;
    let zoom = win.standardWindowButton(NSWindowButton::ZoomButton)?;
    let cf = close.frame();
    let zf = zoom.frame();
    let right = x + (zf.origin.x - cf.origin.x) + zf.size.width;
    let in_win = unsafe { close.superview() }.map(|s| s.convertRect_toView(cf, None)).unwrap_or(cf);
    let center_y = win.frame().size.height - (in_win.origin.y + in_win.size.height / 2.0);
    Some((right, center_y))
}

/// title bar double-click like a native title bar: System Settings → Desktop & Dock → "Double-click a window's
/// title bar to" (zoom / minimise / nothing)
pub fn titlebar_double_click(win: &NSWindow) {
    let action = NSUserDefaults::standardUserDefaults()
        .stringForKey(&NSString::from_str("AppleActionOnDoubleClick"))
        .map(|s| s.to_string());
    match action.as_deref() {
        Some("Minimize") => win.miniaturize(None),
        Some("None") => {}
        _ => win.zoom(None),
    }
}

// ------------------------------------------------------------------ dock: menu + "turn running" dot

define_class!(
    // target of the dock menu items (their tag says which one)
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "HermesDockMenuTarget"]
    struct DockTarget;

    unsafe impl NSObjectProtocol for DockTarget {}

    impl DockTarget {
        #[unsafe(method(dockItem:))]
        fn dock_item(&self, sender: &NSMenuItem) {
            crate::on_dock_item(sender.tag() as i64);
        }
    }
);

impl DockTarget {
    fn new(mtm: MainThreadMarker) -> Retained<Self> {
        let this = Self::alloc(mtm).set_ivars(());
        unsafe { msg_send![super(this), init] }
    }
}

thread_local! {
    static DOCK_MENU: RefCell<Option<(Retained<NSMenu>, Retained<DockTarget>)>> = const { RefCell::new(None) };
    static BASE_ICON: RefCell<Option<Retained<NSImage>>> = const { RefCell::new(None) };
}

unsafe extern "C-unwind" fn application_dock_menu(_this: *mut AnyObject, _sel: Sel, _sender: *mut AnyObject) -> *mut NSMenu {
    DOCK_MENU.with(|d| d.borrow().as_ref().map(|(m, _)| Retained::as_ptr(m) as *mut NSMenu).unwrap_or(std::ptr::null_mut()))
}

/// The app delegate belongs to tao and has no `applicationDockMenu:`; add it to its class (once).
pub fn install_dock_menu(mtm: MainThreadMarker) {
    let app = NSApplication::sharedApplication(mtm);
    let Some(delegate) = app.delegate() else { return };
    let obj: &AnyObject = unsafe { &*(Retained::as_ptr(&delegate) as *const AnyObject) };
    let cls: &AnyClass = obj.class();
    let sel = sel!(applicationDockMenu:);
    if cls.responds_to(sel) {
        return;
    }
    unsafe {
        let imp: Imp = std::mem::transmute::<unsafe extern "C-unwind" fn(*mut AnyObject, Sel, *mut AnyObject) -> *mut NSMenu, Imp>(
            application_dock_menu,
        );
        objc2::ffi::class_addMethod(cls as *const AnyClass as *mut AnyClass, sel, imp, c"@@:@".as_ptr());
    }
    // re-assign so AppKit re-reads which optional methods the delegate implements
    app.setDelegate(Some(&delegate));
}

/// dock menu: `new_chat` (tag 0), then the recent chats (tag 1…)
pub fn set_dock_menu(mtm: MainThreadMarker, new_chat: &str, chats: &[String]) {
    DOCK_MENU.with(|d| {
        let mut d = d.borrow_mut();
        let (menu, target) = d.get_or_insert_with(|| {
            let menu = NSMenu::initWithTitle(NSMenu::alloc(mtm), &NSString::from_str("Dock"));
            menu.setAutoenablesItems(false);
            (menu, DockTarget::new(mtm))
        });
        menu.removeAllItems();
        let target: &AnyObject = target;
        let add = |title: &str, tag: isize| {
            let it = unsafe {
                NSMenuItem::initWithTitle_action_keyEquivalent(
                    NSMenuItem::alloc(mtm),
                    &NSString::from_str(title),
                    Some(sel!(dockItem:)),
                    &NSString::from_str(""),
                )
            };
            unsafe { it.setTarget(Some(target)) };
            it.setTag(tag);
            it.setEnabled(true);
            menu.addItem(&it);
        };
        add(new_chat, 0);
        if !chats.is_empty() {
            menu.addItem(&NSMenuItem::separatorItem(mtm));
        }
        for (i, c) in chats.iter().enumerate() {
            add(c, i as isize + 1);
        }
    });
}

/// A small accent-coloured dot on the dock icon while an answer is being written (restores the bundle icon
/// when off). The unread count stays the regular dock badge.
#[allow(deprecated)] // lockFocus: the simplest way to draw into an NSImage, fine for a 1 KB icon composition
pub fn set_running_dot(mtm: MainThreadMarker, on: bool) {
    let app = NSApplication::sharedApplication(mtm);
    if !on {
        if BASE_ICON.with(|b| b.borrow().is_some()) {
            unsafe { app.setApplicationIconImage(None) };
        }
        return;
    }
    let base = BASE_ICON.with(|b| {
        let mut b = b.borrow_mut();
        if b.is_none() {
            *b = app.applicationIconImage();
        }
        b.clone()
    });
    let Some(base) = base else { return };
    let size = base.size();
    if size.width < 16.0 {
        return;
    }
    let img = NSImage::initWithSize(NSImage::alloc(), size);
    img.lockFocus();
    base.drawInRect(NSRect::new(NSPoint::new(0.0, 0.0), size));
    let d = size.width * 0.26;
    let m = size.width * 0.07;
    let ring = NSRect::new(NSPoint::new(size.width - d - m, m), NSSize::new(d, d));
    NSColor::whiteColor().set();
    NSBezierPath::bezierPathWithOvalInRect(ring).fill();
    let p = d * 0.16;
    let dot = NSRect::new(NSPoint::new(ring.origin.x + p, ring.origin.y + p), NSSize::new(d - 2.0 * p, d - 2.0 * p));
    NSColor::controlAccentColor().set();
    NSBezierPath::bezierPathWithOvalInRect(dot).fill();
    img.unlockFocus();
    unsafe { app.setApplicationIconImage(Some(&img)) };
}

// ------------------------------------------------------------------ share sheet

thread_local! {
    static SHARE_PICKER: RefCell<Option<Retained<NSSharingServicePicker>>> = const { RefCell::new(None) };
}

/// the system share picker (Messages, Mail, Notes, AirDrop, …) at the mouse position
pub fn share(_mtm: MainThreadMarker, win: &NSWindow, text: &str) {
    let Some(view) = win.contentView() else { return };
    let item = NSString::from_str(text);
    let any: &AnyObject = &item;
    let items = NSArray::<AnyObject>::from_slice(&[any]);
    let picker = unsafe { NSSharingServicePicker::initWithItems(NSSharingServicePicker::alloc(), &items) };
    let p = view.convertPoint_fromView(win.mouseLocationOutsideOfEventStream(), None);
    picker.showRelativeToRect_ofView_preferredEdge(NSRect::new(p, NSSize::new(1.0, 1.0)), &view, NSRectEdge::MinY);
    SHARE_PICKER.with(|s| *s.borrow_mut() = Some(picker));
}

// ------------------------------------------------------------------ Touch ID / password

pub fn auth_available() -> bool {
    let ctx = unsafe { LAContext::new() };
    unsafe { ctx.canEvaluatePolicy_error(LAPolicy::DeviceOwnerAuthentication) }.is_ok()
}

/// Touch ID, Apple Watch or the login password (system dialog). Blocks until answered: call off the main thread.
pub fn authenticate(reason: &str) -> Result<bool, String> {
    let ctx = unsafe { LAContext::new() };
    let (tx, rx) = mpsc::channel::<bool>();
    let tx = Mutex::new(Some(tx));
    let reply = RcBlock::new(move |ok: Bool, _err: *mut NSError| {
        if let Some(tx) = tx.lock().ok().and_then(|mut g| g.take()) {
            let _ = tx.send(ok.as_bool());
        }
    });
    unsafe { ctx.evaluatePolicy_localizedReason_reply(LAPolicy::DeviceOwnerAuthentication, &NSString::from_str(reason), &reply) };
    rx.recv_timeout(Duration::from_secs(600)).map_err(|e| e.to_string())
}

// ------------------------------------------------------------------ login item

pub fn login_item_status() -> &'static str {
    let s = unsafe { SMAppService::mainAppService().status() };
    if s == SMAppServiceStatus::Enabled {
        "enabled"
    } else if s == SMAppServiceStatus::RequiresApproval {
        "requiresApproval"
    } else {
        "disabled"
    }
}

pub fn set_login_item(enable: bool) -> Result<&'static str, String> {
    let svc = unsafe { SMAppService::mainAppService() };
    let r = if enable { unsafe { svc.registerAndReturnError() } } else { unsafe { svc.unregisterAndReturnError() } };
    if let Err(e) = r {
        // unregistering something that is not registered is fine
        if enable || login_item_status() == "enabled" {
            return Err(e.localizedDescription().to_string());
        }
    }
    Ok(login_item_status())
}

pub fn open_login_items_settings() {
    unsafe { SMAppService::openSystemSettingsLoginItems() };
}

// ------------------------------------------------------------------ notifications (UserNotifications)

pub const APPROVAL_CATEGORY: &str = "hui-approval";
pub const ACTION_ALLOW_ONCE: &str = "approve-once";
pub const ACTION_DENY: &str = "deny";
pub const ACTION_OPEN: &str = "com.apple.UNNotificationDefaultActionIdentifier";

/// UNUserNotificationCenter needs a real app bundle (crashes in a bare `cargo run` binary)
pub fn notifications_available() -> bool {
    static OK: OnceLock<bool> = OnceLock::new();
    *OK.get_or_init(|| {
        let b = NSBundle::mainBundle();
        b.bundleIdentifier().is_some() && b.bundlePath().to_string().ends_with(".app")
    })
}

define_class!(
    #[unsafe(super(NSObject))]
    #[name = "HermesNotificationDelegate"]
    struct NotificationDelegate;

    unsafe impl NSObjectProtocol for NotificationDelegate {}

    unsafe impl UNUserNotificationCenterDelegate for NotificationDelegate {
        // also show banners while Hermes is the active app (the web app only notifies when its window is not key)
        #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
        fn will_present(
            &self,
            _center: &UNUserNotificationCenter,
            _notification: &UNNotification,
            handler: &block2::DynBlock<dyn Fn(UNNotificationPresentationOptions)>,
        ) {
            handler.call((UNNotificationPresentationOptions::Banner
                | UNNotificationPresentationOptions::List
                | UNNotificationPresentationOptions::Sound,));
        }

        #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
        fn did_receive(&self, _center: &UNUserNotificationCenter, response: &UNNotificationResponse, handler: &block2::DynBlock<dyn Fn()>) {
            let action = response.actionIdentifier().to_string();
            let request = response.notification().request();
            let id = request.identifier().to_string();
            let data = user_info_data(&request.content());
            crate::on_notification_response(&id, &action, data);
            handler.call(());
        }
    }
);

impl NotificationDelegate {
    fn new() -> Retained<Self> {
        let this = Self::alloc().set_ivars(());
        unsafe { msg_send![super(this), init] }
    }
}

fn user_info_data(content: &UNNotificationContent) -> Option<String> {
    let info = content.userInfo();
    let key = NSString::from_str("data");
    let v = info.objectForKey(&key)?;
    v.downcast::<NSString>().ok().map(|s| s.to_string())
}

/// delegate (click / action responses, banners in the foreground) + the approval category; call once at startup
pub fn init_notifications(allow_once: &str, deny: &str) {
    if !notifications_available() {
        return;
    }
    let center = UNUserNotificationCenter::currentNotificationCenter();
    let delegate = NotificationDelegate::new();
    center.setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
    std::mem::forget(delegate); // `delegate` is a weak property: keep ours for the app's lifetime
    set_approval_actions(allow_once, deny);
}

/// "Erlauben (einmal)" (needs an unlocked Mac) / "Ablehnen" on approval notifications
pub fn set_approval_actions(allow_once: &str, deny: &str) {
    if !notifications_available() {
        return;
    }
    let center = UNUserNotificationCenter::currentNotificationCenter();
    let allow = UNNotificationAction::actionWithIdentifier_title_options(
        &NSString::from_str(ACTION_ALLOW_ONCE),
        &NSString::from_str(allow_once),
        UNNotificationActionOptions::AuthenticationRequired,
    );
    let deny = UNNotificationAction::actionWithIdentifier_title_options(
        &NSString::from_str(ACTION_DENY),
        &NSString::from_str(deny),
        UNNotificationActionOptions::Destructive,
    );
    let actions = NSArray::from_retained_slice(&[allow, deny]);
    let intents = NSArray::<NSString>::new();
    let category = UNNotificationCategory::categoryWithIdentifier_actions_intentIdentifiers_options(
        &NSString::from_str(APPROVAL_CATEGORY),
        &actions,
        &intents,
        UNNotificationCategoryOptions::empty(),
    );
    center.setNotificationCategories(&NSSet::from_retained_slice(&[category]));
}

/// Shows a notification (asks for permission on first use). `data` comes back with a click / action.
/// Returns false when UserNotifications is not usable here (the caller falls back to the notification plugin).
pub fn notify(id: &str, title: &str, body: &str, data: Option<&str>, approval: bool) -> bool {
    if !notifications_available() {
        return false;
    }
    let center = UNUserNotificationCenter::currentNotificationCenter();
    let content = UNMutableNotificationContent::new();
    content.setTitle(&NSString::from_str(title));
    content.setBody(&NSString::from_str(body));
    content.setSound(Some(&UNNotificationSound::defaultSound()));
    if approval {
        content.setCategoryIdentifier(&NSString::from_str(APPROVAL_CATEGORY));
    }
    if let Some(d) = data {
        let k = NSString::from_str("data");
        let v = NSString::from_str(d);
        let dict = NSDictionary::<NSString, NSString>::from_slices(&[&*k], &[&*v]);
        unsafe { content.setUserInfo(&Retained::cast_unchecked::<NSDictionary>(dict)) };
    }
    let request = UNNotificationRequest::requestWithIdentifier_content_trigger(&NSString::from_str(id), &content, None);
    let c2 = center.clone();
    let done = RcBlock::new(move |granted: Bool, _err: *mut NSError| {
        if granted.as_bool() {
            c2.addNotificationRequest_withCompletionHandler(&request, None);
        }
    });
    // no-op (immediate answer) once the user decided; the first time macOS asks
    center.requestAuthorizationWithOptions_completionHandler(
        UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound | UNAuthorizationOptions::Badge,
        &done,
    );
    true
}

/// remove a delivered notification (approval answered elsewhere)
pub fn remove_notification(id: &str) {
    if !notifications_available() {
        return;
    }
    let ids = NSArray::from_retained_slice(&[NSString::from_str(id)]);
    UNUserNotificationCenter::currentNotificationCenter().removeDeliveredNotificationsWithIdentifiers(&ids);
}
