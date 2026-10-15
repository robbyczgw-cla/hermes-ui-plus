//! Desktop-only preferences the shell itself needs before the web app runs (dock icon policy at launch, lock on
//! launch). Stored as JSON in the app config dir; the web app reads them from the init script
//! (`window.__HERMES_DESKTOP__.prefs`) and changes them with `desktop_set_prefs`.
//! "Launch at login" is not stored here: the login item registration (SMAppService) is the source of truth.

use std::{
    fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};

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

/// The app lock as the shell knows it. The source of truth for every page load: the web app's init script only has
/// the prefs of the moment the window was created, so a page that loads later (View → Reload, a WebContent crash)
/// asks `desktop_lock_state` before it shows anything. Locked from launch when the lock is on; only a successful
/// `desktop_unlock` opens it again.
pub struct LockState(AtomicBool);

impl LockState {
    pub fn new(prefs: &DesktopPrefs) -> Self {
        LockState(AtomicBool::new(prefs.lock_enabled))
    }

    pub fn locked(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }

    /// the web app engaged the lock (launch, time in the background); a no-op while the lock is off
    pub fn lock(&self, prefs: &DesktopPrefs) -> bool {
        if prefs.lock_enabled {
            self.0.store(true, Ordering::SeqCst);
        }
        self.locked()
    }

    /// Touch ID / password succeeded
    pub fn unlocked(&self) {
        self.0.store(false, Ordering::SeqCst);
    }

    /// prefs may only change while unlocked (switching the lock off must not open a locked app); switching it off
    /// leaves nothing locked
    pub fn check_prefs_change(&self, next: &DesktopPrefs) -> Result<(), String> {
        if self.locked() {
            return Err("locked".into());
        }
        if !next.lock_enabled {
            self.unlocked();
        }
        Ok(())
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

    #[test]
    fn lock_state_follows_the_prefs_and_only_opens_on_unlock() {
        let on = DesktopPrefs { lock_enabled: true, ..Default::default() };
        let off = DesktopPrefs::default();
        // launch: locked when the lock is on
        assert!(LockState::new(&on).locked());
        assert!(!LockState::new(&off).locked());
        // engaging it while the lock is off does nothing
        let s = LockState::new(&off);
        assert!(!s.lock(&off));
        // switched on during the session, then engaged: stays locked until unlocked
        assert!(s.check_prefs_change(&on).is_ok());
        assert!(s.lock(&on));
        assert!(s.locked());
        // prefs (switching the lock off included) cannot change while locked
        assert!(s.check_prefs_change(&off).is_err());
        assert!(s.locked());
        s.unlocked();
        assert!(!s.locked());
        assert!(s.check_prefs_change(&off).is_ok());
        assert!(!s.lock(&off));
    }
}
