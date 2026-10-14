//! Desktop-only preferences the shell itself needs before the web app runs (dock icon policy at launch, lock on
//! launch). Stored as JSON in the app config dir; the web app reads them from the init script
//! (`window.__HERMES_DESKTOP__.prefs`) and changes them with `desktop_set_prefs`.
//! "Launch at login" is not stored here: the login item registration (SMAppService) is the source of truth.

use std::{fs, path::PathBuf, sync::Mutex};

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DesktopPrefs {
    /// no dock icon (ActivationPolicy::Accessory); Hermes lives in the menu bar
    pub menu_bar_only: bool,
    /// Touch ID / password before the window content shows (launch, after `lock_minutes` in the background)
    pub lock_enabled: bool,
    /// minutes in the background before the app locks again; 0 = only at launch
    pub lock_minutes: u32,
}

impl Default for DesktopPrefs {
    fn default() -> Self {
        Self { menu_bar_only: false, lock_enabled: false, lock_minutes: 5 }
    }
}

impl DesktopPrefs {
    /// clamp values coming from the web side
    pub fn sanitized(mut self) -> Self {
        self.lock_minutes = self.lock_minutes.min(24 * 60);
        self
    }
}

pub struct PrefsStore {
    path: Option<PathBuf>,
    cur: Mutex<DesktopPrefs>,
}

impl PrefsStore {
    pub fn load(dir: Option<PathBuf>) -> Self {
        let path = dir.map(|d| d.join("desktop-prefs.json"));
        let cur = path
            .as_ref()
            .and_then(|p| fs::read_to_string(p).ok())
            .and_then(|s| serde_json::from_str::<DesktopPrefs>(&s).ok())
            .map(DesktopPrefs::sanitized)
            .unwrap_or_default();
        PrefsStore { path, cur: Mutex::new(cur) }
    }

    pub fn get(&self) -> DesktopPrefs {
        self.cur.lock().map(|g| g.clone()).unwrap_or_default()
    }

    /// stores and persists (write to a temp file + rename, so a crash never leaves half a file)
    pub fn set(&self, p: DesktopPrefs) -> Result<(), String> {
        let p = p.sanitized();
        if let Ok(mut g) = self.cur.lock() {
            *g = p.clone();
        }
        let Some(path) = self.path.as_ref() else { return Ok(()) };
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let tmp = path.with_extension("json.tmp");
        let body = serde_json::to_string_pretty(&p).map_err(|e| e.to_string())?;
        fs::write(&tmp, body).map_err(|e| e.to_string())?;
        fs::rename(&tmp, path).map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tolerant_parse() {
        let p: DesktopPrefs = serde_json::from_str(r#"{"menuBarOnly":true}"#).unwrap();
        assert!(p.menu_bar_only);
        assert!(!p.lock_enabled);
        assert_eq!(p.lock_minutes, 5);
        let p = DesktopPrefs { lock_minutes: 99_999, ..Default::default() }.sanitized();
        assert_eq!(p.lock_minutes, 1440);
    }
}
