# Hermes desktop (macOS, Linux alpha; Tauri v2)

> **Availability (0.1):** download from [GitHub Releases](https://github.com/robbyczgw-cla/hermes-ui-plus/releases). The
> macOS app (`hermes-ui-plus-<version>-macos-arm64.dmg`, Apple Silicon, macOS 13+) is Developer ID signed and notarized; the
> Linux AppImage / .deb (x86_64) is an alpha. To build them yourself, use the scripts below (docs/BUILD.md). Notifications
> come from the running app; there is no push to a Mac or PC that is off or has quit the app (Web Push belongs to the web app).

A thin native shell around the static Expo web build. The UI is the same code as the PWA
(`app/`), bundled into the app (`frontendDist = ../dist-web`), not loaded from a server.

Build, publish (dist/share/desktop/), optionally install on a Mac:

```sh
scripts/build-desktop-mac.sh              # web bundle on the build machine (memory-capped) -> Mac build -> download page
INSTALL=1 scripts/build-desktop-mac.sh    # ... and install into ~/Applications on the Mac + launch
SKIP_WEB=1 KEEP_CACHE=1 scripts/build-desktop-mac.sh   # fast rebuild of the shell only
```

Linux (x86_64 AppImage + .deb, alpha) on a Linux build host (`LINUX_HOST`), published to `dist/share/desktop-linux/`
(personal) or `dist/share/desktop-linux-plus/` (hermes), see [Linux](#linux-alpha):

```sh
FLAVOR=hermes scripts/build-desktop-linux.sh     # web bundle here -> AppImage + .deb on $LINUX_HOST -> download page
SKIP_WEB=1 KEEP_CACHE=1 scripts/build-desktop-linux.sh
```

## Layout

| path | |
| --- | --- |
| `src-tauri/src/lib.rs` | window, commands (`desktop_*`), ⌥Space, notifications, console log, link handling |
| `src-tauri/src/menus.rs` | menu bar, menu bar icon (tray); labels from the web app's i18n |
| `src-tauri/src/mac.rs` | objc2: accent color, traffic lights, dock menu + "running" dot, UserNotifications with actions, Touch ID, login item, share picker |
| `src-tauri/src/prefs.rs` | desktop prefs the shell needs before the web app runs (menu bar only, app lock) |
| `src-tauri/tauri.conf.json` | official name/bundle id `HUI+` / `xyz.hermesui.desktop` (app name = `displayName` of `app/brand/identity.json`: `HUI+.app`, window title, menus) (personal builds override both, see `scripts/build-desktop-mac.sh`; the Linux script also sets `mainBinaryName`), CSP, signing, `bundle.linux` |
| `src-tauri/Info.plist` | merged into the app's Info.plist (microphone / camera usage strings) |
| `src-tauri/capabilities/default.json` | `core:default` for the main window only |
| `src-tauri/icons/` | `app-icon-source.png` (official icon on a macOS squircle, `scripts/brand-icons.mjs`) -> `icon.icns` etc. via `tauri icon`; `tray-template.png` (menu bar template image) |
| `../app/src/desktop/` | web side: `bridge.ts` (detection via `window.__TAURI_INTERNALS__`, commands, events), `DesktopHost.tsx` (mounted in the root layout) and one module per feature (look, menus/keys, dock, notifications, files, lock, settings) |

## Behaviour

- Main window 1100×760 (min 380×560), size/position/maximized remembered (window-state plugin). Title bar and
  appearance: see "macOS" below.
- **⌥Space** (global): brings Hermes to the front, starts a new chat, focuses the composer. Pressed again
  while Hermes is the key window, the app hides (focus goes back to the previous app). This replaces a
  separate mini window on purpose: a second webview would run a second copy of the app on the same
  storage (concurrent writers to conversations/settings).
- Menu bar icon: New Chat, Show Window, Quit Hermes. Closing the window (⌘W / red button) only hides it;
  ⌘Q quits.
- Notifications: WKWebView on `tauri://` has neither the Notification API nor service workers, so the web
  app calls the `desktop_notify` command for "answer ready", inbox and approval notices (macOS:
  UserNotifications, see below; elsewhere the notification plugin). macOS asks for permission on the first one.
- Drag & drop: Tauri's native drop handler is disabled, HTML5 drag/drop events reach the page.
- Links to other origins (`window.open`, navigation) open in the default browser; the webview only ever
  shows `tauri://localhost`.
- Console errors/warnings, uncaught errors, unhandled rejections and CSP violations of the main frame are
  appended to `~/Library/Logs/<bundle id>/console.log` (rotated at 1 MB).

## macOS

What the Mac app adds on top of the web UI. Everything is behind the Tauri detection (`isDesktopApp()` /
`isDesktopMac()`), the PWA and the Android/iOS apps do not change. Menu labels, notification buttons and the
lock screen follow the app language (de/en/es, namespace `desktop` in `app/src/i18n/ns/`).

**Look**
- Unified title bar: `titleBarStyle: Overlay`, hidden title, traffic lights at (18, 25) so they sit in the 54 px
  header rows. The first header item moves right of them (`useTitlebarInset()`: sidebar title, chat header with
  the sidebar hidden, narrow-window header, settings, onboarding; the drawer gets a 40 px top gap). The exact
  right edge comes from the real buttons (`desktop_info`, also logged to `console.log` as "traffic lights: …");
  in full screen the inset is 0. The top 52 px drag the window (and double-click zooms / minimises as set in
  System Settings) wherever there is no control.
- Translucent sidebar: the window is transparent with the `Sidebar` material (vibrancy, `macOSPrivateApi`);
  the web app paints everything except the sidebar. Only for the neutral theme families (Standard, Graphite) –
  tinted themes keep their opaque sidebar. The material follows the app's light/dark choice
  (`desktop_set_theme`), "Reduce transparency" makes it opaque.
- System appearance is followed live (WKWebView `prefers-color-scheme`); accent "macOS" (Settings → Darstellung →
  Akzentfarbe, Mac app only) uses the system accent color, re-read when the window gets focus. SF Pro via
  `system-ui`; buttons show the arrow cursor like native controls.

**Menus and keys** (menu bar: Hermes / Ablage / Bearbeiten / Darstellung / Chat / Fenster)

| key | | key | |
| --- | --- | --- | --- |
| ⌘N, ⇧⌘O | new chat | ⌘, | settings |
| ⌘F | find in the open chat | ⌘K | search chats (palette) |
| ⌘B, ⌃⌘S | sidebar | ⌘1–9 | n-th chat of the sidebar (also listed in the Chat menu) |
| ⌥⌘↑ / ⌥⌘↓ | previous / next chat | ⌘. | stop the running answer |
| ⇧⌘C | copy the last answer | ⌘L | focus the message field |
| Esc | close sheets / dialogs | ⌥Space | Hermes from anywhere (global) |

"The sidebar" is what the drawer lists, in its order (`app/src/conversations/drawerFilter.ts`: kinds of this build,
Settings → Chat → "Chats"); the Chat menu, the dock menu, ⌘1–9 and ⌥⌘↑/↓ never show or open a chat the
drawer hides.

Menu accelerators and the page's own key handler (`app/src/desktop/keys.ts`) may both see a press; the bridge
acts once per press. Right-click on an answer opens a native menu (Copy, Copy as Markdown, Retry, Read Aloud,
Share…, Continue in New Chat – the same availability as the in-app "⋯" menu); with text selected the system menu
(Look Up, Translate, …) stays. Share uses the macOS share picker.

**Dock and notifications**
- Dock badge = chats with an unread answer; a small accent dot on the icon while an answer is being written.
- Dock menu (right-click): New Chat and the 5 most recent chats. While the app lock is on, the dock menu and the
  "Chat" menu list no chats (⌘1–9 do nothing); they come back after unlocking.
- Notifications go through UserNotifications. A click brings the window up and opens the chat (answer ready,
  inbox, approval). Approval requests that arrive while the window is not in front carry **Erlauben (einmal)**
  (needs an unlocked Mac) and **Ablehnen**: the app answers through the regular approval endpoint
  (`POST /v1/runs/{runId}/approval`) without showing the window; the bridge then reports `approval_resolved` like
  for any device. A failed answer (expired, offline) posts a notification that opens the chat. Approvals arrive via
  the UI bridge's live inbox, which the Mac app keeps open while the window is closed.

**Comfort** (Settings → Mac-App)
- Open at login (ServiceManagement login item; if macOS wants a confirmation the row links to System Settings →
  Login Items).
- Menu bar only: no dock icon (`ActivationPolicy::Accessory`), applied at launch before the window shows.
- Lock with Touch ID (default off): at launch and after 1/5/15/60 min in the background (or launch only) an opaque
  cover hides the app until Touch ID / Apple Watch / the login password succeeds (LocalAuthentication). Switching
  it on or off asks too. Notification actions and opened files wait until unlocked. The shell holds the lock
  state: every page load starts covered and asks it (`desktop_lock_state`, unreadable = locked), View → Reload / ⌘R
  do nothing while locked and the prefs cannot change then. It is a privacy screen for the UI, not encryption of
  the stored chats.
- Files: drop them on the window or on the dock icon ("Open With" works too, rank Alternate) → attachments of
  the open chat; ⌘V with an image or copied files attaches them (rich text from Word/Pages still pastes as text).
  Attachments keep their bytes in IndexedDB (`hui-att:` uris, `app/src/attachments/webBlobs.ts`), so thumbnails,
  opening and upload retries still work after a reload or restart.
  Nothing gets in through the app lock: drops and pastes on the locked window are refused, dock drops wait for the
  unlock, and files still being read / prepared when the lock engages are discarded (never uploaded).
- Prefs the shell needs early live in `~/Library/Application Support/<bundle id>/desktop-prefs.json`.

**Checking it on a Mac**: the shell's behaviour (traffic lights, vibrancy, dock, notification buttons, Touch ID,
drops) only shows on a screen. `~/Library/Logs/<bundle id>/console.log` records the traffic light geometry
("traffic lights: right …, centre y …" – the header rows are 54 px, centre 27; adjust `TL_Y` in `lib.rs` if it is
off), notification responses and opened files. The web side can be exercised in a browser by defining
`window.__TAURI_INTERNALS__` (a recording `invoke`) and `window.__HERMES_DESKTOP__` before the bundle loads.

## Origin (CORS)

The app is served from **`tauri://localhost`** on macOS (`http://tauri.localhost` is the Windows/Android
form). A UI-Bridge or server that checks `Origin` must allow `tauri://localhost`
(e.g. in `BRIDGE_CORS_ORIGINS`).

## Content Security Policy

Set in `tauri.conf.json` (`app.security.csp`):

| directive | sources | why |
| --- | --- | --- |
| `default-src` | `'self'` | |
| `script-src` | `'self' 'unsafe-inline' 'unsafe-eval'` + 4 CDNs | hui-html widgets render in `srcdoc` iframes, and **srcdoc frames inherit the parent's CSP** (both policies apply). Their inline scripts / library `eval` and the CDN scripts must therefore pass the outer policy too. The frames keep their own stricter CSP (`app/src/sandbox/shell.ts`) and run in `sandbox="allow-scripts"` (opaque origin, no IPC). |
| `style-src` | `'self' 'unsafe-inline'` + CDNs | React Native Web inline styles, widget styles |
| `font-src` | `'self' data:` + CDNs | |
| `img-src`, `media-src` | `'self' data: blob: https:` | image trust policy lives in the app (`app/src/images/trust.ts`: trusted hosts load, unknown hosts tap-to-load), so any https image may be needed; no plain http |
| `connect-src` | `'self' ipc: http://ipc.localhost https:` | Tauri IPC + any https server the user configures (tailnet bridge `https://hermes-host.example.ts.net:8790`, OpenAI-compatible providers, …). Plain `http://` servers are not allowed. |
| `worker-src` | `'self' blob:` | widget workers |
| `frame-src` | `'self' blob: data:` | srcdoc frames need no entry |
| `object-src` / `form-action` | `'none'` | |
| `base-uri` | `'self'` | |

CDNs (`app/src/sandbox/shell.ts` `CDN_ORIGINS`): `https://cdn.jsdelivr.net`, `https://unpkg.com`,
`https://cdnjs.cloudflare.com`, `https://esm.sh`.

`dangerousDisableAssetCspModification: ["script-src", "style-src"]`: Tauri would otherwise add hashes /
nonces to these directives, and as soon as a hash or nonce is present browsers ignore `'unsafe-inline'`,
which breaks the inline scripts inside the widget frames. Tauri's own IPC scripts are injected as
WKUserScripts and are not affected by the page CSP.

## App name (0.1.1 rename)

Since 0.1.1 the official app is `HUI+.app` (0.1: `Hermes UI+.app`); the bundle id `xyz.hermesui.desktop` is unchanged,
so settings, window state, logs (`~/Library/Logs/xyz.hermesui.desktop/`) and the Touch ID lock carry over – none of
them keys off the app name. The login item is an `SMAppService.mainAppService` registration of the bundle, not of a
name; if Settings → Mac app shows "Launch at login" off after the update, switch it on again. Dragging
`HUI+.app` from the dmg does not replace an old `Hermes UI+.app` in Programme / Applications: delete that one. The
release asset keeps its name (`hermes-ui-plus-<version>-macos-arm64.dmg`); Tauri's own dmg name (`HUI+_<ver>_aarch64.dmg`)
never leaves the build. On Linux the launcher shows HUI+; binary `hermes-ui-plus` and .deb package `hermes-ui` stay.

## Signing / Gatekeeper

With the Developer ID material configured (`scripts/build-desktop-mac.sh`, docs/BUILD.md) the app is signed with
hardened runtime and notarized; it starts directly. `Entitlements.plist` grants the microphone (dictation) and
the camera – under hardened runtime WKWebView gets neither without them. UserNotifications, Touch ID and the login
item need no entitlement.

Without that material (or `MAC_SIGN=0`) the app is **ad-hoc signed** (`signingIdentity: "-"`, not notarized).
Downloaded copies carry the quarantine flag, so the first launch is blocked:

1. Open HUI+ (personal builds: Hermes), dismiss the warning.
2. System Settings → Privacy & Security → at the bottom "HUI+ was blocked …" → **Open Anyway**, confirm.

Or in Terminal: `xattr -dr com.apple.quarantine /Applications/HUI+.app`. A copy built and installed on
the same Mac by the script (`INSTALL=1`) has no quarantine flag and starts directly.

## Linux (alpha)

Same shell and web bundle; built by `scripts/build-desktop-linux.sh` (docs/BUILD.md "Linux desktop") with
`tauri build --bundles appimage,deb` for x86_64.

| | |
| --- | --- |
| build host | by default a docker container on an `ubuntu:22.04` image (`scripts/docker/desktop-linux-build.Dockerfile`: WebKitGTK 4.1 / librsvg / appindicator dev packages, node 22, pinned Rust), memory-capped (8 GB, no swap, 6 cargo jobs); fallback `LINUX_BUILD_IMAGE=host`: rustup/cargo, node + npm and the same dev packages on the host in a systemd user scope |
| outputs | `hermes-ui-plus_<ver>_x86_64.AppImage` / `hermes-ui-plus_<ver>_amd64.deb` (hermes; personal: `hermes_…`), binary `/usr/bin/hermes-ui-plus` (personal `hermes`) |
| AppImage | self-contained (GTK, WebKitGTK, appindicator bundled, ~90 MB); needs **FUSE 2** (`libfuse2` / `libfuse2t64`), otherwise `./<file>.AppImage --appimage-extract-and-run`. Built in the Ubuntu 22.04 container: needs glibc >= 2.35, i.e. runs on Ubuntu 22.04+ / Debian 12+ (and newer); a `LINUX_BUILD_IMAGE=host` build needs the build host's glibc |
| .deb | `sudo apt install ./<file>.deb`; depends on `libwebkit2gtk-4.1-0`, `libgtk-3-0`, `libayatana-appindicator3-1` |
| origin | `tauri://localhost` like macOS (CORS, see below) |
| data | `~/.local/share/<bundle id>/` (webview storage, `logs/console.log`), `~/.config/<bundle id>/` (window state) |

Differences to macOS:

- The app menu is a GTK menu bar in the window (macOS-only items such as Services / Hide are dropped by muda).
- Tray: the coloured app icon (the macOS template image would be invisible on dark panels). It needs a
  StatusNotifier / AppIndicator host in the panel (GNOME only with the AppIndicator extension); without one there is
  no tray icon and closing the window only hides it: start the app again or use Alt+Space to bring it back.
- **Alt+Space** is registered via X11 (`global-hotkey`); on Wayland sessions, or when the window manager already
  owns Alt+Space (window menu in GNOME / Xfce / KDE), registration fails and is logged to `console.log`; the app
  runs normally without it.
- External links open with `xdg-open`.
- Not signed; no auto-update.
