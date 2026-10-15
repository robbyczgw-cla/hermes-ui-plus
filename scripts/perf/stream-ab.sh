#!/bin/bash
# Streaming fluidity A/B on an Android emulator against scripts/perf/stream-mock.mjs (never a real Hermes).
#   node scripts/perf/stream-mock.mjs &                          # on the emulator's host: the app reaches it as 10.0.2.2
#   scripts/perf/stream-ab.sh OUTDIR b42=old.apk b47=new.apk     # ITERATIONS=3, the builds alternate
#   scripts/perf/gfx-summary.py OUTDIR
# Per build and iteration: clean install, pair with a token link, then three measured streams of the mock's long
# answer: s1 in a new chat, s2 in the same chat (history), s3 after a chat switch (new chat + short turn, back
# through the drawer). Each: `dumpsys gfxinfo reset` with the Send tap, full gfxinfo once the stream has ended
# (STREAM_S), framestats, and the count of Reanimated "synchronouslyUpdateUIProps failed" warnings in logcat.
# One emulator ($ANDROID_SERIAL, default emulator-5554), English UI; the soft keyboard is hidden before each Send.
set -u
export ANDROID_SERIAL=${ANDROID_SERIAL:-emulator-5554}
HERE=$(cd "$(dirname "$0")" && pwd)
OUT=${1:?usage: stream-ab.sh OUTDIR NAME=APK...}
shift
[ $# -gt 0 ] || { echo "usage: stream-ab.sh OUTDIR NAME=APK..." >&2; exit 2; }
PKG=${PKG:-xyz.hermesui.app}
LINK="hermesuiplus://pair?u=${MOCK_URL:-http%3A%2F%2F10.0.2.2%3A8790%2Fv1}&t=nca_perf_test_token_0000000000&n=Perf"
STREAM_S=${STREAM_S:-52}
ui() { python3 "$HERE/ui.py" "$@"; }

iteration() ( # NAME APK ITERATION – a subshell: `fail` ends only this iteration
  B=$1 APK=$2 I=$3
  O=$OUT/$B-$I
  rm -rf "$O" && mkdir -p "$O"
  log() { echo "$(date +%T) [$B-$I] $*"; }
  fail() { log "FAIL $*"; ui list > "$O/fail-ui.txt"; exit 1; }
  type_text() {
    local ok=
    for _ in 1 2 3; do
      ui tap '^Type a message$' >/dev/null || fail field
      for _ in 1 2 3 4 5 6; do sleep 0.5; adb shell dumpsys input_method | grep -q 'mInputShown=true' && ok=1 && break; done
      [ -n "$ok" ] && break
    done
    [ -n "$ok" ] || fail keyboard
    sleep 0.5
    adb shell input text "$1"
    ui has "^${1//%s/ }\$" 5 >/dev/null || fail typed-text
    # BACK hides the keyboard (the list follows the stream) – only while it is shown, or BACK leaves the app
    adb shell dumpsys input_method | grep -q 'mInputShown=true' && adb shell input keyevent 4
    sleep 1.5
    adb shell dumpsys activity activities | grep -q "topResumedActivity=.*$PKG" || fail app-not-on-top
  }
  measure() { # NAME TEXT
    type_text "$2"
    read -r X Y < <(ui xy '^Send$' 5)
    [ -n "${Y:-}" ] || fail send-button
    adb logcat -c
    adb shell "input tap $X $Y; dumpsys gfxinfo $PKG reset >/dev/null; date +%s.%N" > "$O/$1.t0"
    sleep "$STREAM_S"
    adb shell "date +%s.%N; dumpsys gfxinfo $PKG" > "$O/$1.gfx"
    adb shell dumpsys gfxinfo "$PKG" framestats > "$O/$1.framestats"
    adb logcat -d | grep -c 'synchronouslyUpdateUIProps failed' > "$O/$1.warn"
    log "$1 done, warnings $(cat "$O/$1.warn")"
    sleep 3
  }

  adb uninstall "$PKG" >/dev/null 2>&1
  adb install "$APK" | tail -1
  adb shell pm grant "$PKG" android.permission.POST_NOTIFICATIONS
  adb shell am start -a android.intent.action.VIEW -d "\"$LINK\"" >/dev/null
  ui has 'Hermes UI\+ Bridge: active' 30 >/dev/null || fail pair-probe
  ui tap '^Connect$' >/dev/null || fail connect
  ui tap '^Got it, continue$' 15 >/dev/null || fail consent
  sleep 3
  measure s1 'perf%sstream%sone'
  measure s2 'perf%sstream%stwo'
  ui tap '^New chat$' >/dev/null || fail newchat
  sleep 2
  type_text 'hi%sthere'
  ui tap '^Send$' 5 >/dev/null || fail send-hi
  sleep 6
  ui tap '^Chats$' >/dev/null || fail drawer
  sleep 2
  ui tap 'perf stream' 5 >/dev/null || fail open-chat
  sleep 3
  measure s3 'perf%sstream%sthree'
  adb logcat -d -b crash > "$O/crash.txt"
  log "iteration done"
)

adb logcat -G 16M >/dev/null
for i in $(seq 1 "${ITERATIONS:-3}"); do
  for spec in "$@"; do
    echo "$(date +%T) load $(cut -d' ' -f1-3 /proc/loadavg)"
    iteration "${spec%%=*}" "${spec#*=}" "$i"
  done
done
