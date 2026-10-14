#!/usr/bin/env bash
# UI smoke test of the iOS simulator build on the Mac, after `scripts/build-ios.sh --simulator` (docs/BUILD.md "iOS").
# Reinstalls the .app from $REMOTE_DIR/sim/ (fresh state = onboarding), then runs a generated XCUITest
# (scripts/ios-sim/: tiny host app + SmokeUITests.swift, project made with the xcodeproj gem of CocoaPods) that walks
# welcome -> setup choices -> demo -> demo chat with a few prompts -> settings (iPad: landscape, shortcuts),
# taking screenshots (status bar overridden to 9:41 / full battery, usable as App Store screenshot drafts).
# Afterwards: app error/fault lines from the simulator log and new crash reports. Nothing is installed permanently;
# the test project and its DerivedData are removed at the end.
#
# Usage: scripts/ios-sim-smoke.sh
# Env:   SIM_DEVICE [device of the last --simulator build, else "iPhone 18 Pro"]  HUI_LANG [en] (en|de)
#        HUI_APPEARANCE [unchanged] (light|dark: set before the run; reboots the simulator, it stays in that mode)
#        REMOTE_DIR [/Users/Shared/hermes-ui-build]  MAC_HOST [build.env]
# Output: dist/ios-sim-smoke/<timestamp>/{NN-<step>.png, results.txt, app-errors.log, crashes.txt, xcodebuild-test.log}
#         Screenshots may show nothing private (demo mode), but check before copying them into docs/.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib/flavor.sh
. "$ROOT/scripts/lib/flavor.sh"
flavor_init >/dev/null
flavor_load_build_env
MAC_HOST="${MAC_HOST:?MAC_HOST is not set (env or \$HUI_PRIVATE_DIR/build.env)}"
REMOTE_DIR="${REMOTE_DIR:-/Users/Shared/hermes-ui-build}"
# interpolated into remote commands and an `rm -rf`: absolute, plain path segments only, never / itself
if ! [[ "$REMOTE_DIR" =~ ^(/[A-Za-z0-9._-]+)+$ ]] || [[ "$REMOTE_DIR/" == */../* || "$REMOTE_DIR/" == */./* ]]; then
  echo "REMOTE_DIR must be an absolute path on the Mac of [A-Za-z0-9._-] segments (got '$REMOTE_DIR')" >&2; exit 2
fi
printf -v Q_SMOKE '%q' "$REMOTE_DIR/smoke"
SSH=(ssh -o BatchMode=yes "$MAC_HOST")
TS="$(date +%Y%m%d-%H%M%S)"
OUT="$ROOT/dist/ios-sim-smoke/$TS"
mkdir -p "$OUT"

"${SSH[@]}" "rm -rf $Q_SMOKE && mkdir -p $Q_SMOKE/shots"
rsync -a "$ROOT/scripts/ios-sim/" "$MAC_HOST:$REMOTE_DIR/smoke/"

case "${HUI_APPEARANCE:-}" in ''|light|dark) ;; *) echo "HUI_APPEARANCE must be light or dark" >&2; exit 2 ;; esac
printf -v REMOTE_ENV '%q=%q ' REMOTE_DIR "$REMOTE_DIR" SIM_DEVICE "${SIM_DEVICE:-}" HUI_LANG "${HUI_LANG:-en}" HUI_APPEARANCE "${HUI_APPEARANCE:-}"
remote_rc=0
"${SSH[@]}" "${REMOTE_ENV}bash -s" <<'REMOTE' || remote_rc=$?
set -euo pipefail
export PATH="$HOME/.local/node/bin:$HOME/.local/ruby/bin:$HOME/.local/cocoapods/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export GEM_HOME="$HOME/.local/cocoapods" GEM_PATH="$HOME/.local/cocoapods" LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
B="$REMOTE_DIR"; S="$B/smoke"; SH="$S/shots"
trap 'rm -rf "$S/DD" "$S/Smoke.xcodeproj"' EXIT
APP="$(ls -d "$B"/sim/*.app 2>/dev/null | head -1 || true)"
[ -n "$APP" ] || { echo "no simulator app in $REMOTE_DIR/sim (run scripts/build-ios.sh --simulator first)"; exit 1; }
BID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Info.plist")"
EXE="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$APP/Info.plist")"
if [ -n "$SIM_DEVICE" ]; then
  UDID="$(xcrun simctl list devices available -j | node -e '
    const n = process.argv[1], d = JSON.parse(require("fs").readFileSync(0, "utf8")).devices;
    const all = Object.values(d).flat().filter((x) => x.name === n || x.udid === n);
    process.stdout.write((all.at(-1) || {}).udid || "");' "$SIM_DEVICE")"
else
  UDID="$(cat "$B/sim/udid" 2>/dev/null || true)"
fi
[ -n "$UDID" ] || { echo "simulator not found (SIM_DEVICE='$SIM_DEVICE')"; exit 1; }
echo "app $BID ($EXE) on simulator $UDID, language $HUI_LANG"
if [ -n "$HUI_APPEARANCE" ]; then
  # the iOS 27 simulator applies a changed appearance to apps only after a reboot
  xcrun simctl ui "$UDID" appearance "$HUI_APPEARANCE"
  xcrun simctl shutdown "$UDID" 2>/dev/null || true
  xcrun simctl boot "$UDID"
  echo "appearance: $HUI_APPEARANCE"
fi
xcrun simctl bootstatus "$UDID" -b >/dev/null
# store-style screenshots: clean status bar (9:41, full battery/signal); cleared at the end
trap 'rm -rf "$S/DD" "$S/Smoke.xcodeproj"; xcrun simctl status_bar "$UDID" clear 2>/dev/null || true' EXIT
xcrun simctl status_bar "$UDID" override --time 9:41 --dataNetwork wifi --wifiMode active --wifiBars 3 \
  --cellularMode active --cellularBars 4 --batteryState charged --batteryLevel 100 2>/dev/null || true
xcrun simctl terminate "$UDID" "$BID" 2>/dev/null || true
xcrun simctl uninstall "$UDID" "$BID" 2>/dev/null || true
xcrun simctl install "$UDID" "$APP"
ruby "$S/make-smoke-project.rb" "$S"
START="$(date '+%Y-%m-%d %H:%M:%S')"; touch "$S/.start"
TEST_RUNNER_HUI_BUNDLE_ID="$BID" TEST_RUNNER_HUI_SHOT_DIR="$SH" TEST_RUNNER_HUI_LANG="$HUI_LANG" \
  xcodebuild test -project "$S/Smoke.xcodeproj" -scheme SmokeUITests -destination "id=$UDID" \
  -derivedDataPath "$S/DD" COMPILER_INDEX_STORE_ENABLE=NO > "$SH/xcodebuild-test.log" 2>&1 && test_rc=0 || test_rc=$?
echo "$test_rc" > "$SH/xcodebuild-status"   # diagnostics below must not hide the test result
grep -E '\*\* TEST|error:|Test Case .*(passed|failed)' "$SH/xcodebuild-test.log" | sort -u | head -20 || true
# app log: errors/faults of the app process only (compact, capped)
xcrun simctl spawn "$UDID" log show --start "$START" --style compact \
  --predicate "process == \"$EXE\" AND (messageType == error OR messageType == fault)" 2>/dev/null | head -400 > "$SH/app-errors.log" || true
xcrun simctl spawn "$UDID" log show --start "$START" --style compact \
  --predicate "process == \"$EXE\" AND (eventMessage CONTAINS[c] \"exception\" OR eventMessage CONTAINS \"ReactNativeJS\" OR subsystem == \"com.facebook.react.log\")" 2>/dev/null \
  | grep -iE 'error|exception|warn' | head -200 > "$SH/app-js.log" || true
: > "$SH/crashes.txt"
find "$HOME/Library/Logs/DiagnosticReports" -newer "$S/.start" -name "$EXE*" 2>/dev/null | while read -r f; do
  echo "$f" >> "$SH/crashes.txt"; cp "$f" "$SH/"; done
echo "app errors/faults: $(wc -l < "$SH/app-errors.log" | tr -d ' ') lines, crash reports: $(wc -l < "$SH/crashes.txt" | tr -d ' ')"
REMOTE

rsync -a "$MAC_HOST:$REMOTE_DIR/smoke/shots/" "$OUT/" || echo "could not copy the results back"
"${SSH[@]}" "rm -rf $Q_SMOKE" || true
echo
cat "$OUT/results.txt" 2>/dev/null || echo "(no results.txt: the UI test did not run, see $OUT/xcodebuild-test.log)"
echo "output: $OUT"
test_rc="$(cat "$OUT/xcodebuild-status" 2>/dev/null || echo missing)"
fail=""
[ "$remote_rc" -eq 0 ] || fail="remote smoke script failed (exit $remote_rc)"
[ "$test_rc" = 0 ] || fail="${fail:+$fail; }xcodebuild test exit status $test_rc"
grep -q '^FAIL' "$OUT/results.txt" 2>/dev/null && fail="${fail:+$fail; }some checks FAILED"
grep -q '^OK   run complete$' "$OUT/results.txt" 2>/dev/null || fail="${fail:+$fail; }no completion record (test aborted or crashed)"
[ -z "$fail" ] || { echo "SMOKE: FAILED: $fail"; exit 1; }
echo "SMOKE: all checks OK"
