//! Menu bar, menu bar icon (tray) and the dock menu. Labels come from the web app (its i18n, de/en/es) via
//! `desktop_set_menu`; until then the English macOS wording below is used. `{name}` = the app name.
//!
//! Item ids are handled in `lib.rs` (`on_menu`): plain commands go to the web app as `hermes-desktop` events.

use std::{collections::HashMap, sync::Mutex};

use serde::Deserialize;
use tauri::{
    image::Image,
    menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    tray::TrayIconBuilder,
    AppHandle,
};

/// one entry of the "Chat" menu (⌘1–9) and the dock menu
#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
pub struct RecentChat {
    pub id: String,
    pub title: String,
}

#[derive(Default)]
pub struct MenuState {
    pub labels: HashMap<String, String>,
    pub recent: Vec<RecentChat>,
}

pub struct MenuStore(pub Mutex<MenuState>);

/// at most this many chats in the "Chat" menu (⌘1–9) and in the dock menu
pub const MAX_MENU_CHATS: usize = 9;
#[cfg_attr(not(target_os = "macos"), allow(dead_code))] // the dock menu is macOS only
pub const MAX_DOCK_CHATS: usize = 5;

pub fn clip(s: &str, max: usize) -> String {
    let t: String = s.chars().filter(|c| !c.is_control()).take(max).collect();
    if s.chars().count() > max {
        format!("{t}…")
    } else {
        t
    }
}

/// translated label (web) or the default; `{name}` → app name
pub fn label(labels: &HashMap<String, String>, key: &str, default: &str, name: &str) -> String {
    labels
        .get(key)
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| clip(s, 80))
        .unwrap_or_else(|| default.to_string())
        .replace("{name}", name)
}

/// The chats the menus list: none while the app lock is on (titles are chat content; the dock menu and the "Chat"
/// menu are reachable without unlocking)
pub fn listed_chats(st: &MenuState, locked: bool) -> &[RecentChat] {
    if locked {
        &[]
    } else {
        &st.recent
    }
}

pub fn build_menu_bar(app: &AppHandle, st: &MenuState, locked: bool) -> tauri::Result<()> {
    let name = app.package_info().name.clone();
    let l = |k: &str, d: &str| label(&st.labels, k, d, &name);
    let item = |id: &str, text: String, accel: &str| {
        let b = MenuItemBuilder::with_id(id, text);
        if accel.is_empty() { b.build(app) } else { b.accelerator(accel).build(app) }
    };

    let app_menu = SubmenuBuilder::new(app, &name)
        .about_with_text(l("about", "About {name}"), None)
        .separator()
        .item(&item("settings", l("settings", "Settings…"), "CmdOrCtrl+Comma")?)
        .separator()
        .services_with_text(l("services", "Services"))
        .separator()
        .hide_with_text(l("hide", "Hide {name}"))
        .hide_others_with_text(l("hideOthers", "Hide Others"))
        .show_all_with_text(l("showAll", "Show All"))
        .separator()
        .quit_with_text(l("quit", "Quit {name}"))
        .build()?;
    let file = SubmenuBuilder::new(app, l("file", "File"))
        .item(&item("new-chat", l("newChat", "New Chat"), "CmdOrCtrl+N")?)
        .separator()
        .close_window_with_text(l("closeWindow", "Close Window"))
        .build()?;
    let edit = SubmenuBuilder::new(app, l("edit", "Edit"))
        .undo_with_text(l("undo", "Undo"))
        .redo_with_text(l("redo", "Redo"))
        .separator()
        .cut_with_text(l("cut", "Cut"))
        .copy_with_text(l("copy", "Copy"))
        .paste_with_text(l("paste", "Paste"))
        .select_all_with_text(l("selectAll", "Select All"))
        .separator()
        .item(&item("find", l("find", "Find…"), "CmdOrCtrl+F")?)
        .build()?;
    let view = SubmenuBuilder::new(app, l("view", "View"))
        .item(&item("toggle-sidebar", l("toggleSidebar", "Show/Hide Sidebar"), "Ctrl+CmdOrCtrl+S")?)
        .item(&item("search", l("search", "Search Chats…"), "CmdOrCtrl+K")?)
        .separator()
        .item(&item("reload", l("reload", "Reload"), "CmdOrCtrl+R")?)
        .separator()
        .fullscreen_with_text(l("fullscreen", "Enter Full Screen"))
        .build()?;
    let mut chat = SubmenuBuilder::new(app, l("chat", "Chat"))
        .item(&item("stop", l("stop", "Stop Answer"), "CmdOrCtrl+Period")?)
        .item(&item("copy-last", l("copyLast", "Copy Last Answer"), "Shift+CmdOrCtrl+C")?)
        .item(&item("focus-composer", l("focusComposer", "Write Message"), "CmdOrCtrl+L")?)
        .separator()
        .item(&item("prev-chat", l("prevChat", "Previous Chat"), "Alt+CmdOrCtrl+ArrowUp")?)
        .item(&item("next-chat", l("nextChat", "Next Chat"), "Alt+CmdOrCtrl+ArrowDown")?);
    let recent = listed_chats(st, locked);
    if !recent.is_empty() {
        chat = chat.separator();
        for (i, c) in recent.iter().take(MAX_MENU_CHATS).enumerate() {
            chat = chat.item(&item(&format!("recent:{i}"), clip(&c.title, 60), &format!("CmdOrCtrl+{}", i + 1))?);
        }
    }
    let chat = chat.build()?;
    let window = SubmenuBuilder::new(app, l("window", "Window"))
        .minimize_with_text(l("minimize", "Minimize"))
        .maximize_with_text(l("zoom", "Zoom"))
        .separator()
        .item(&item("show", name.clone(), "CmdOrCtrl+0")?)
        .separator()
        .bring_all_to_front_with_text(l("bringAllToFront", "Bring All to Front"))
        .build()?;
    let menu = MenuBuilder::new(app).items(&[&app_menu, &file, &edit, &view, &chat, &window]).build()?;
    app.set_menu(menu)?;
    // the window list of the "Window" menu (AppKit keeps it up to date)
    #[cfg(target_os = "macos")]
    let _ = window.set_as_windows_menu_for_nsapp();
    Ok(())
}

fn tray_menu(app: &AppHandle, st: &MenuState) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    let name = app.package_info().name.clone();
    let l = |k: &str, d: &str| label(&st.labels, k, d, &name);
    MenuBuilder::new(app)
        .text("new-chat", l("newChat", "New Chat"))
        .text("show", l("showWindow", "Show Window"))
        .separator()
        .text("quit", l("quit", "Quit {name}"))
        .build()
}

pub fn build_tray(app: &AppHandle, st: &MenuState) -> tauri::Result<()> {
    let menu = tray_menu(app, st)?;
    // macOS: monochrome template image (tinted by the menu bar); elsewhere the coloured app icon, a black
    // glyph would vanish on dark panels
    #[cfg(target_os = "macos")]
    let tray_icon = Image::from_bytes(include_bytes!("../icons/tray-template.png"))?;
    #[cfg(not(target_os = "macos"))]
    let tray_icon = Image::from_bytes(include_bytes!("../icons/32x32.png"))?;
    TrayIconBuilder::with_id("main")
        .icon(tray_icon)
        .icon_as_template(true)
        .tooltip(app.package_info().name.clone())
        .menu(&menu)
        .show_menu_on_left_click(true)
        .build(app)?;
    Ok(())
}

pub fn update_tray(app: &AppHandle, st: &MenuState) -> tauri::Result<()> {
    if let Some(tray) = app.tray_by_id("main") {
        tray.set_menu(Some(tray_menu(app, st)?))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_fall_back_and_fill_the_name() {
        let mut m = HashMap::new();
        m.insert("quit".to_string(), "{name} beenden".to_string());
        m.insert("hide".to_string(), "   ".to_string());
        assert_eq!(label(&m, "quit", "Quit {name}", "Hermes"), "Hermes beenden");
        assert_eq!(label(&m, "hide", "Hide {name}", "Hermes"), "Hide Hermes");
        assert_eq!(clip("a\u{7}bc", 2), "ab…");
    }

    #[test]
    fn no_chat_titles_while_locked() {
        let st = MenuState { labels: HashMap::new(), recent: vec![RecentChat { id: "c1".into(), title: "Alice's tax return".into() }] };
        assert_eq!(listed_chats(&st, false).len(), 1);
        assert!(listed_chats(&st, true).is_empty());
        // the stored list stays: unlocking shows it again
        assert_eq!(st.recent.len(), 1);
    }
}
