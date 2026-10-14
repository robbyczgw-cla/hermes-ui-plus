// Prevents an additional console window on Windows in release; no effect on macOS.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    hermes_desktop_lib::run()
}
