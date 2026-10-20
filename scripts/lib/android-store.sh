# shellcheck shell=bash
# Where the hermes (public) Android builds keep the SDK, the Gradle cache and their build / fast dirs on this host.
# Neutral absolute paths outside $HOME: they end up in the .so files (lambda names, __FILE__), and a home path would carry the
# local user name (scripts/flavor-guard.mjs refuses that).
#   Linux                  /var/tmp/hiui-*        (unchanged)
#   macOS (the build Mac)  /Users/Shared/hiui-*   a reboot of the Mac empties /var/tmp: SDK, Gradle cache and node_modules
#                                                 were gone once and every lane build failed until the SDK was reinstalled
#   HUI_ANDROID_STORE      overrides the parent directory (ANDROID_HOME / GRADLE_USER_HOME / BUILD_DIR / FAST_DIR still win)
# On macOS the store is used by its physical path (`pwd -P`): @expo/fingerprint (the fast path's cache key) strips the project
# root from its autolinking paths only when they agree (docs/BUILD.md "Second Android lane").
# Runs on the Mac, so: bash 3.2 compatible.
#
#   android_store_init         sets ANDROID_STORE and STORE_SDK STORE_GRADLE STORE_BUILD STORE_FAST (the hermes defaults)
#   android_store_migrate      macOS, once, under the Mac's heavy-job lock: an SDK / Gradle cache that older scripts left in
#                              /var/tmp moves into the store (same volume: a rename, nothing is downloaded again) and a symlink
#                              stays behind, so a build from an older branch still finds it until the next reboot
#   android_store_compat       macOS: keeps the old /var/tmp paths pointing at the store for builds of older branches, also after a
#                              reboot empties /var/tmp: a standalone script (HUI_COMPAT_DIR [~/hui-lane]/compat-links.sh) that only
#                              creates missing symlinks (never deletes), run by the user's crontab (@reboot + every 10 min: cron runs
#                              without a GUI login, the repeat covers a /var/tmp cleanup after @reboot) and by a LaunchAgent
#                              (RunAtLoad + every 10 min, for GUI logins). Installed once (idempotent), run on every build.
#   android_sdk_require KIND   build | fast: fails with the exact sdkmanager command when packages of KIND are missing
ANDROID_SDK_PACKAGES_BUILD='platforms;android-36 build-tools;36.0.0 ndk;27.1.12297006 cmake;3.22.1'
ANDROID_SDK_PACKAGES_MAC_EMU='emulator system-images;android-35;google_apis;arm64-v8a'

android_store_init() {
  local s="${HUI_ANDROID_STORE:-}"
  if [ -z "$s" ]; then
    if [ "$(uname -s)" = Darwin ]; then s=/Users/Shared; else s=/var/tmp; fi
  fi
  if [ "$(uname -s)" = Darwin ] && [ -d "$s" ]; then s="$(cd "$s" && pwd -P)"; fi
  ANDROID_STORE="$s"
  STORE_SDK="$s/hiui-android-sdk"; STORE_GRADLE="$s/hiui-gradle"
  STORE_BUILD="$s/hiui-build-hermes"; STORE_FAST="$s/hiui-fast-hermes"
}

# _android_store_move OLD NEW: OLD a real directory, NEW missing -> rename + symlink back
_android_store_move() {
  local old="$1" new="$2"
  [ -d "$old" ] && [ ! -L "$old" ] && [ ! -e "$new" ] || return 0
  mkdir -p "$(dirname "$new")"
  if mv "$old" "$new" 2>/dev/null; then
    ln -s "$new" "$old" 2>/dev/null || true
    echo "android store: moved $old -> $new (one-time migration, a symlink stays at the old path)"
  else
    echo "android store: could not move $old to $new; leaving it where it is" >&2
  fi
}

android_store_migrate() {
  [ "$(uname -s)" = Darwin ] || return 0
  [ -n "${ANDROID_STORE:-}" ] || android_store_init
  local old="${HUI_ANDROID_OLD_STORE:-/private/var/tmp}"
  [ "$old" != "$ANDROID_STORE" ] || return 0
  # only the default locations: a caller's own ANDROID_HOME / GRADLE_USER_HOME is never moved
  [ "${ANDROID_HOME:-$STORE_SDK}" != "$STORE_SDK" ] || _android_store_move "$old/hiui-android-sdk" "$STORE_SDK"
  [ "${GRADLE_USER_HOME:-$STORE_GRADLE}" != "$STORE_GRADLE" ] || _android_store_move "$old/hiui-gradle" "$STORE_GRADLE"
  android_store_compat
  return 0
}

android_store_compat() {
  [ "$(uname -s)" = Darwin ] || return 0
  [ -n "${ANDROID_STORE:-}" ] || android_store_init
  local old="${HUI_ANDROID_OLD_STORE:-/private/var/tmp}" dir="${HUI_COMPAT_DIR:-$HOME/hui-lane}" script cur tag=hui-compat-links
  local agent="${HUI_LAUNCH_AGENTS_DIR:-$HOME/Library/LaunchAgents}/xyz.hermesui.lane-compat-links.plist"
  [ "$old" != "$ANDROID_STORE" ] || return 0
  script="$dir/compat-links.sh"
  mkdir -p "$dir" || return 0
  cat > "$script.tmp" <<COMPAT
#!/bin/bash
# HUI+ Android lane (docs/BUILD.md "Second Android lane"): builds of older branches look for the SDK / Gradle cache in $old,
# which a reboot of the Mac empties. Recreates only the missing symlinks to $ANDROID_STORE; never deletes anything.
for n in hiui-android-sdk hiui-gradle; do
  if [ -d "$ANDROID_STORE/\$n" ] && [ ! -e "$old/\$n" ] && [ ! -L "$old/\$n" ]; then ln -s "$ANDROID_STORE/\$n" "$old/\$n"; fi
done
exit 0
COMPAT
  chmod 755 "$script.tmp" && mv -f "$script.tmp" "$script"
  bash "$script"   # right now, too
  [ ! -f "$dir/.compat-installed" ] || return 0
  # user crontab (keeps every existing line; one marker per line)
  cur="$(crontab -l 2>/dev/null || true)"
  if ! printf '%s\n' "$cur" | grep -q "# $tag\$"; then
    if { [ -z "$cur" ] || printf '%s\n' "$cur"; printf '@reboot /bin/bash %s # %s\n*/10 * * * * /bin/bash %s # %s\n' "$script" "$tag" "$script" "$tag"; } | crontab - 2>/dev/null; then
      echo "android store: crontab keeps $old/hiui-android-sdk -> $ANDROID_STORE (@reboot + every 10 min, $script)"
    else
      echo "android store: could not install the crontab entry (the LaunchAgent still covers GUI logins)" >&2
    fi
  fi
  if [ ! -f "$agent" ] && mkdir -p "$(dirname "$agent")" 2>/dev/null; then
    cat > "$agent" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>xyz.hermesui.lane-compat-links</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$script</string></array>
  <key>RunAtLoad</key><true/>
  <key>StartInterval</key><integer>600</integer>
</dict>
</plist>
PLIST
    launchctl bootstrap "gui/$(id -u)" "$agent" 2>/dev/null || true   # without a GUI session it loads at the next login
  fi
  touch "$dir/.compat-installed"
  return 0
}

# android_sdk_require KIND [SDK]   KIND: build (Gradle: platform, build-tools, NDK, CMake) | fast (build-tools only)
android_sdk_require() {
  local kind="$1" sdk="${2:-${ANDROID_HOME:-}}" missing="" p dir
  for p in $ANDROID_SDK_PACKAGES_BUILD; do
    [ "$kind" = fast ] && case "$p" in build-tools*) ;; *) continue ;; esac
    dir="$sdk/$(printf '%s' "$p" | tr ';' '/')"
    [ -d "$dir" ] || missing="$missing $p"
  done
  [ -n "$missing" ] || return 0
  local all="" q
  for q in cmdline-tools\;latest platform-tools $ANDROID_SDK_PACKAGES_BUILD; do all="$all \"$q\""; done
  [ "$(uname -s)" = Darwin ] && for q in $ANDROID_SDK_PACKAGES_MAC_EMU; do all="$all \"$q\""; done
  {
    echo "Android SDK incomplete at $sdk (missing:$missing)."
    echo "Install it once (user space, no sudo; docs/BUILD.md \"Second Android lane\" / \"Toolchain\"):"
    echo "  sdkmanager --sdk_root=$sdk$all"
    [ "$(uname -s)" = Darwin ] && echo "  (sdkmanager from Homebrew android-commandlinetools, JAVA_HOME = Homebrew openjdk@17; an SDK left in /var/tmp by older scripts is moved here by the next build)"
  } >&2
  return 1
}
