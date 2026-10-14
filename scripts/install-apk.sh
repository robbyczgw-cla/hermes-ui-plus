#!/usr/bin/env bash
# Install the newest release APK on an Android phone via adb (adb install -r).
#
# Usage: [FLAVOR=hermes|personal] scripts/install-apk.sh [-s SERIAL] [-c HOST:PORT] [APK]
#   APK   default: FLAVOR=hermes (default) dist/latest-hermes-release.apk, else newest dist/hermes-ui-plus-release-*.apk;
#         FLAVOR=personal dist/latest-release.apk, else newest dist/hermes-ui-release-*.apk
#         (both apps have different ids and can be installed side by side)
#   -s    adb serial (needed if more than one device is attached)
#   -c    run `adb connect HOST:PORT` first (wireless debugging, e.g. <phone>:37123)
#
# Phone over Tailscale (wireless debugging, no USB) - one-time pairing, see docs/BUILD.md:
#   1. Phone: Settings > Developer options > Wireless debugging > Pair device with pairing code
#   2. adb pair <phone>:<PAIR_PORT>        (enter the 6-digit code)
#   3. adb connect <phone>:<CONNECT_PORT>  (port shown on the Wireless debugging screen)
#   4. scripts/install-apk.sh
# `<phone>` is the phone's Tailscale name; use its 100.x IP if MagicDNS is off. If the phone is
# offline, `adb connect` fails - copy the APK over by other means instead (docs/BUILD.md).
# adb comes from ~/android/sdk/platform-tools (added to PATH below).
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/android/sdk}"
export PATH="$ANDROID_HOME/platform-tools:$PATH"
SERIAL=""; CONNECT=""; APK=""
while [ $# -gt 0 ]; do
  case "$1" in
    -s) SERIAL="$2"; shift 2;;
    -c) CONNECT="$2"; shift 2;;
    -h|--help) sed -n '2,19p' "$0"; exit 0;;
    *) APK="$1"; shift;;
  esac
done
if [ -z "$APK" ]; then
  case "${FLAVOR:-hermes}" in
    hermes) LATEST=latest-hermes-release.apk; BASE=hermes-ui-plus ;;
    personal) LATEST=latest-release.apk; BASE=hermes-ui ;;
    *) echo "FLAVOR must be hermes or personal" >&2; exit 2 ;;
  esac
  APK="$ROOT/dist/$LATEST"
  [ -f "$APK" ] || APK="$(ls -t "$ROOT"/dist/$BASE-release-*.apk 2>/dev/null | head -1 || true)"
fi
[ -f "$APK" ] || { echo "no release APK found (run scripts/build-apk.sh release, or pass a path)" >&2; exit 1; }
APK="$(readlink -f "$APK")"
echo "APK: $APK ($(du -h "$APK" | cut -f1))"

command -v adb >/dev/null || { echo "adb not found (expected in $ANDROID_HOME/platform-tools)" >&2; exit 1; }
if [ -n "$CONNECT" ]; then
  timeout 20 adb connect "$CONNECT" || { echo "cannot reach $CONNECT (phone offline / not on Tailscale?)" >&2; exit 1; }
fi
S=(); [ -n "$SERIAL" ] && S=(-s "$SERIAL")
n=$(adb devices | awk 'NR>1 && $2=="device"' | wc -l)
[ "$n" -ge 1 ] || { echo "no adb device attached (see header for wireless pairing; 'adb devices')" >&2; exit 1; }
[ "$n" -eq 1 ] || [ -n "$SERIAL" ] || { echo "multiple devices; pass -s SERIAL" >&2; adb devices >&2; exit 1; }
adb "${S[@]}" install -r "$APK"
echo "Installed. Launch: adb ${S[*]:-} shell monkey -p ai.hermes.ui -c android.intent.category.LAUNCHER 1"
