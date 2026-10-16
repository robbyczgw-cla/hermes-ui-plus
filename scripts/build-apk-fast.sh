#!/usr/bin/env bash
# Fast Android TEST APK for JS-only changes (docs/BUILD.md "Fast test APKs").
#
# Usage: [FLAVOR=hermes|personal] [ABIS=x86_64] scripts/build-apk-fast.sh [--host mac|<ssh host> [--fetch] [--smoke]] [release]
# Output: dist/<name>-release-<gitsha>[-<abi>][-debugsigned]-fast.apk and dist/latest-…-fast.apk (symlink), or, when
#         the fast path does not apply, whatever scripts/build-apk.sh release builds (it runs instead).
#
# Every full debug-signed release build (scripts/build-apk.sh) stores its APK as the "base" of its native fingerprint
# (scripts/lib/apk-fast.mjs: native modules, config plugins, app config, dependencies, build scripts, flavor, ABIs,
# EXPO_PUBLIC_*). This script computes the fingerprint of the current app/ and, when a base exists, builds only the JS
# the way Gradle does (expo export:embed + hermesc -O, byte-identical output), swaps assets/index.android.bundle and
# assets/app.config in a copy of the base (scripts/lib/apk_swap.py), then zipalign + apksigner with the base's debug
# key. It falls back to the full build when there is no fingerprint, no base, or the JS assets (images / fonts in res/)
# differ from the base's. The result passes the same guards as a full build: flavor mark, flavor guard on the output,
# release gate (scan-artifact). It keeps the base's versionCode; Settings → About shows the new commit.
#
# Lane (docs/BUILD.md "Second Android lane"): HUI_ANDROID_LANE=auto is the default here (a fast build is always a test build): when the
# build Mac is idle (scripts/lib/lane-choose.sh) the whole fast build runs THERE on the Mac's own base APK (registered by its full
# builds; the same steps with macOS tools, hermesc osx-bin) and falls back to a full build there when no base fits; the APK stays on the
# Mac unless --fetch / the automatic choice brings it back (gated here), --smoke runs the suite on the Mac. Otherwise it runs here with
# the bases of this host and, when it must build in full, builds here. HUI_ANDROID_LANE=local never uses the Mac, =mac insists on it.
#
# Never for release / store builds: refuses HERMES_KEYSTORE and BUNDLE=1 (use scripts/build-apk.sh).
#   HUI_FAST=0        always build in full          HUI_FAST_ONLY=1   fail (exit 4) instead of building in full
#   HUI_FAST_BASES    base cache [~/builds/apk-bases]  FAST_MEM_MAX [4G]  FAST_MIN_AVAIL_GB [4]
#   (MEM_MAX / MEM_HIGH / MIN_AVAIL_GB etc. go to scripts/build-apk.sh when it builds in full)
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib/flavor.sh
. "$ROOT/scripts/lib/flavor.sh"
# shellcheck source=lib/heavy.sh
. "$ROOT/scripts/lib/heavy.sh"
# shellcheck source=lib/hostmem.sh
. "$ROOT/scripts/lib/hostmem.sh"
# shellcheck source=lib/signing.sh
. "$ROOT/scripts/lib/signing.sh"
# shellcheck source=lib/apk-guards.sh
. "$ROOT/scripts/lib/apk-guards.sh"
# shellcheck source=lib/apkfast.sh
. "$ROOT/scripts/lib/apkfast.sh"

# --------------------------------------------------------------------------------------------
# INNER MODE: runs inside a memory-capped systemd scope.
# --------------------------------------------------------------------------------------------
if [ "${HUI_FAST_INNER:-}" = prepare ]; then
  cd "$FAST_DIR/app"
  LOCK_HASH="$(cat package-lock.json patches/*.patch 2>/dev/null | sha256_stdin | cut -d' ' -f1)"
  if [ -d node_modules ] && [ ! -L node_modules ] && [ "$LOCK_HASH" = "$(cat node_modules/.lock-hash 2>/dev/null)" ]; then
    echo "node_modules up to date"
  else
    echo "npm ci (package-lock / patches changed)"
    npm ci --no-audit --no-fund >/dev/null
    echo "$LOCK_HASH" > node_modules/.lock-hash
  fi
  fast_key "$FAST_DIR/app" "$ABIS" > "$FAST_DIR/key" || rm -f "$FAST_DIR/key"
  exit 0
fi
if [ "${HUI_FAST_INNER:-}" = bundle ]; then
  # exactly the commands of the React Native Gradle plugin (BundleHermesCTask) and expo-constants' app.config task
  cd "$FAST_DIR/app"
  export CI=1 EXPO_NO_TELEMETRY=1 NODE_OPTIONS="--max-old-space-size=2048"
  OUT_DIR="$FAST_DIR/out"; rm -rf "$OUT_DIR"; mkdir -p "$OUT_DIR/res" "$OUT_DIR/js" "$OUT_DIR/cfg"
  ENTRY="$(node -e "require('expo/scripts/resolveAppEntry')" "$PWD" android absolute)"
  CLI="$(node --print "require.resolve('@expo/cli', { paths: [require.resolve('expo/package.json')] })")"
  HERMESC="$(dirname "$(node --print "require.resolve('hermes-compiler/package.json', { paths: [require.resolve('react-native/package.json')] })")")/hermesc/$([ "$(uname -s)" = Darwin ] && echo osx-bin || echo linux64-bin)/hermesc"
  T=$SECONDS
  # no --reset-cache (Gradle's only difference): this transform cache belongs to the fast path of this flavor alone
  # and is keyed on EXPO_PUBLIC_* (metro.config.js); the flavor mark is checked on the result anyway
  node "$CLI" export:embed --platform android --dev false --entry-file "$ENTRY" \
    --bundle-output "$OUT_DIR/js/index.android.bundle" --assets-dest "$OUT_DIR/res" \
    --sourcemap-output "$OUT_DIR/js/index.android.bundle.packager.map" --minify false > "$OUT_DIR/metro.log" 2>&1 \
    || { tail -30 "$OUT_DIR/metro.log"; exit 1; }
  echo "metro: $((SECONDS-T)) s"; T=$SECONDS
  "$HERMESC" -w -emit-binary -max-diagnostic-width=80 -out "$OUT_DIR/js/index.android.bundle.hbc" \
    "$OUT_DIR/js/index.android.bundle" -O -output-source-map
  echo "hermesc: $((SECONDS-T)) s"
  node "$(dirname "$(node --print "require.resolve('expo-constants/package.json')")")/scripts/getAppConfig.js" \
    "$PWD" "$OUT_DIR/cfg" 2>/dev/null
  [ -s "$OUT_DIR/cfg/app.config" ] || { echo "app.config not generated"; exit 1; }
  exit 0
fi

# --------------------------------------------------------------------------------------------
# OUTER MODE
# --------------------------------------------------------------------------------------------
BUILD_HOST="${HUI_BUILD_HOST:-}"; LANE_FETCH=0; LANE_SMOKE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --host) BUILD_HOST="${2:?--host needs a host (mac or an ssh host)}"; shift 2 ;;
    --fetch) LANE_FETCH=1; shift ;;
    --smoke) LANE_SMOKE=1; shift ;;
    *) break ;;
  esac
done
VARIANT="${1:-release}"
[ "$VARIANT" = release ] || { echo "usage: $0 [--host mac|<ssh host> [--fetch] [--smoke]] [release]  (test APKs only; debug builds load JS from Metro)" >&2; exit 2; }
if [ -n "${HERMES_KEYSTORE:-}" ] || [ "${BUNDLE:-0}" = 1 ]; then
  echo "release / store builds never use the fast path: run scripts/build-apk.sh (HERMES_KEYSTORE or BUNDLE=1 is set)" >&2
  exit 2
fi
flavor_init
export ALLOW_DEBUG_SIGNED=1   # test APKs only: the hermes flavor gets the -debugsigned name, like a full test build
signing_preflight release || exit 1
[ "$SIGNING_MODE" != release-key ] || { echo "fast path refuses release-key signing" >&2; exit 2; }
HOST_OS="$(uname -s)"
# Lane: the whole fast build runs on the Mac when it is idle (auto is the default for the fast path; local / mac force a lane)
if [ -z "$BUILD_HOST" ]; then
  # shellcheck source=lib/android-remote.sh
  . "$ROOT/scripts/lib/android-remote.sh"
  # shellcheck source=lib/lane-choose.sh
  . "$ROOT/scripts/lib/lane-choose.sh"
  lane_resolve_build auto "$LANE_SMOKE" 1 || exit 2
  if [ "$LANE_CHOICE" = mac ]; then
    BUILD_HOST=mac
    [ "$LANE_SMOKE" = 1 ] || LANE_FETCH=1   # nobody else would use an APK left on the Mac
  fi
fi
if [ -n "$BUILD_HOST" ]; then
  # shellcheck source=lib/android-remote.sh
  . "$ROOT/scripts/lib/android-remote.sh"
  android_remote_build "$BUILD_HOST" "$VARIANT" "$LANE_FETCH" "$LANE_SMOKE" build-apk-fast.sh
  exit $?
fi
SIGN_SUFFIX=""; [ "$SIGNING_MODE" = debug-signed ] && SIGN_SUFFIX="-debugsigned"
export ABIS="${ABIS:-arm64-v8a}"
ABI_SUFFIX=""; [ "$ABIS" = arm64-v8a ] || ABI_SUFFIX="-$(tr ',' '+' <<<"$ABIS")"
if [ "$FLAVOR" = personal ]; then
  export ANDROID_HOME="${ANDROID_HOME:-$HOME/android/sdk}"
  FAST_DIR="${FAST_DIR:-$HOME/builds/hermes-ui-fast}"; APK_BASE=hermes-ui; LATEST="latest-release"
else
  export ANDROID_HOME="${ANDROID_HOME:-/var/tmp/hiui-android-sdk}"
  FAST_DIR="${FAST_DIR:-$([ "$(uname -s)" = Darwin ] && echo /private || true)/var/tmp/hiui-fast-hermes}";   # physical path on macOS: see BUILD_DIR in build-apk.sh
  APK_BASE="$BRAND_ARTIFACT"; LATEST="latest-hermes-release"
fi
if [ "$HOST_OS" = Darwin ]; then
  for _jh in /opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home /opt/homebrew/opt/openjdk@17 "$HOME/android/jdk-17"; do
    [ -x "$_jh/bin/java" ] && { JAVA_HOME="${JAVA_HOME:-$_jh}"; break; }
  done
fi
export JAVA_HOME="${JAVA_HOME:-$HOME/android/jdk-17}" FAST_DIR
BT="$ANDROID_HOME/build-tools/36.0.0"
FAST_MEM_MAX="${FAST_MEM_MAX:-4G}"; FAST_MIN_AVAIL_GB="${FAST_MIN_AVAIL_GB:-4}"
T0=$SECONDS
step() { echo; echo "=== [$((SECONDS-T0))s] $*"; }

full_build() {
  echo "fast path not applicable: $*"
  [ "${HUI_FAST_ONLY:-0}" = 1 ] && { echo "HUI_FAST_ONLY=1: not building in full"; exit 4; }
  echo "=> full build: scripts/build-apk.sh release (registers its APK as the base for the next fast build)"
  if [ "$HOST_OS" = Darwin ]; then
    ! command -v maclock_release >/dev/null 2>&1 || maclock_release   # build-apk.sh takes the Mac's lock itself (waits up to HUI_MAC_LOCK_WAIT)
  else
    exec 8>&-   # do not keep other fast builds waiting during the full build
    # build-apk.sh refuses at once while another build runs: wait for it here (up to 30 min)
    flock -w 1800 "$HOME/builds/.hermes-build.lock" true || true
  fi
  # the lane was decided at the start of this script: the full build runs on the same host
  HUI_ANDROID_LANE=local exec "$ROOT/scripts/build-apk.sh" release
}

[ "${HUI_FAST:-1}" = 0 ] && full_build "HUI_FAST=0"
for t in zipalign apksigner; do [ -x "$BT/$t" ] || { echo "$BT/$t missing (Android build-tools 36.0.0)"; exit 1; }; done
command -v python3 >/dev/null || { echo "python3 missing"; exit 1; }

mkdir -p "$HOME/builds" "$FAST_DIR" "$ROOT/dist"
if [ "$HOST_OS" = Darwin ]; then
  # the Mac's one heavy-job lock (shared with iOS / desktop builds, the Android build and the emulator)
  # shellcheck source=lib/maclock.sh
  . "$ROOT/scripts/lib/maclock.sh"
  maclock_acquire android-build "${HUI_MAC_LOCK_WAIT:-2700}" || exit 3
  trap 'maclock_release' EXIT
else
  exec 8>"$HOME/builds/.hermes-fast-$FLAVOR.lock"
  if ! flock -n 8; then echo "another fast build ($FLAVOR) runs, waiting up to 20 min"; flock -w 1200 8 || { echo "still busy, giving up"; exit 1; }; fi
fi

if [ -n "${HUI_BUILD_SHA:-}" ]; then
  SHA="$HUI_BUILD_SHA"   # remote lane: the host's copy has no .git, the label (incl. -dirty) comes from the caller
else
  SHA="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo nogit)"
  git -C "$ROOT" diff --quiet HEAD -- app 2>/dev/null || SHA="${SHA}-dirty"
fi
OUT="$ROOT/dist/$APK_BASE-release-$SHA$ABI_SUFFIX${HUI_APK_TAG:-}$SIGN_SUFFIX-fast.apk"

AVAIL_KB="$(host_avail_kb)"
[ "$AVAIL_KB" -ge $((FAST_MIN_AVAIL_GB*1024*1024)) ] || { echo "only $((AVAIL_KB/1024)) MB available (< $FAST_MIN_AVAIL_GB GB), refusing"; exit 1; }
if [ "$HOST_OS" = Darwin ]; then
  # no cgroups on macOS: Metro / hermesc run directly (Metro's heap is capped by NODE_OPTIONS in the inner modes)
  scope() { HUI_FAST_INNER="$1" nice -n 10 bash "$ROOT/scripts/build-apk-fast.sh"; }
else
  export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
  export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=/run/user/$(id -u)/bus}"
  systemd-run --user --scope -q -p MemoryMax=64M true 2>/dev/null \
    || { echo "systemd-run --user --scope not usable; refusing to run Metro without memory limits"; exit 1; }
  heavy_slice_init
  scope() { HUI_FAST_INNER="$1" systemd-run --user --scope -q "${HEAVY_SLICE[@]}" -p MemoryMax="$FAST_MEM_MAX" -p MemorySwapMax=0 \
    -p CPUQuota=400% nice -n 10 bash "$ROOT/scripts/build-apk-fast.sh"; }
fi
# the scope inherits this environment; Metro's transform cache lives in this fast dir (per flavor, never shared)
export TMPDIR="$FAST_DIR/tmp"; mkdir -p "$TMPDIR"; chmod 700 "$TMPDIR"

step "rsync app/ -> $FAST_DIR/app"
# same input as scripts/build-apk.sh (anchored excludes), node_modules stay
rsync -a --delete \
  --exclude node_modules --exclude /.expo/ --exclude /android/ --exclude /ios/ \
  --exclude /refs/ --exclude /dist/ --exclude '*.keystore' --exclude '*.jks' --exclude .env --exclude '.env.*' \
  "$ROOT/app/" "$FAST_DIR/app/"

step "node_modules + native fingerprint"
rm -f "$FAST_DIR/key"
scope prepare
# hermes: the resolved Expo config must be the official identity, no private files in the input (as build-apk.sh)
if [ "$FLAVOR" = hermes ]; then node "$ROOT/scripts/flavor-guard.mjs" --tree "$FAST_DIR/app"; fi
[ -s "$FAST_DIR/key" ] || full_build "no native fingerprint (@expo/fingerprint unavailable or failed)"
KEY="$(cat "$FAST_DIR/key")"
BASE_DIR="$(node "$ROOT/scripts/lib/apk-fast.mjs" lookup "$FAST_BASES" "$KEY")" \
  || full_build "no base APK for native fingerprint $KEY (first build, or native code / config / dependencies changed)"
BASE_NUMBER="$(node -p "require('$BASE_DIR/meta.json').buildNumber")"
BASE_BUNDLE_SHA="$(node -p "require('$BASE_DIR/meta.json').bundleSha")"
echo "base: $BASE_DIR (build $BASE_NUMBER)"
WORK="$FAST_DIR/work"; rm -rf "$WORK"; mkdir -p "$WORK"
cp "$BASE_DIR/base.apk" "$BASE_DIR/debug.keystore" "$BASE_DIR/assets.json" "$WORK/"   # a newer register may replace the dir
[ "$(unzip -p "$WORK/base.apk" assets/index.android.bundle | sha256_stdin | cut -d' ' -f1)" = "$BASE_BUNDLE_SHA" ] \
  || full_build "base APK does not hold the bundle its meta.json names"

step "JS bundle (export:embed + hermesc)"
HUI_BUILD_NUMBER="$BASE_NUMBER" HUI_BUILD_SOURCE="${SHA%-dirty}" scope bundle
node "$ROOT/scripts/lib/apk-fast.mjs" assets "$FAST_DIR/out/res" > "$WORK/assets.new.json"
cmp -s "$WORK/assets.json" "$WORK/assets.new.json" || {
  diff <(node -e 'for (const k of Object.keys(require(process.argv[1]))) console.log(k)' "$WORK/assets.json") \
       <(node -e 'for (const k of Object.keys(require(process.argv[1]))) console.log(k)' "$WORK/assets.new.json") | head -10 || true
  full_build "JS assets (images / fonts in res/) differ from the base"
}

step "swap bundle + app.config, zipalign, sign"
python3 "$ROOT/scripts/lib/apk_swap.py" swap "$WORK/base.apk" "$WORK/swapped.apk" \
  assets/index.android.bundle="$FAST_DIR/out/js/index.android.bundle.hbc" assets/app.config="$FAST_DIR/out/cfg/app.config"
"$BT/zipalign" -f -P 16 4 "$WORK/swapped.apk" "$WORK/aligned.apk"
# the base's own key (the Expo template's public debug keystore); v2 only, like Gradle's output for minSdk 24
PATH="$JAVA_HOME/bin:$PATH" "$BT/apksigner" sign --ks "$WORK/debug.keystore" --ks-pass pass:android \
  --ks-key-alias androiddebugkey --v1-signing-enabled false --v2-signing-enabled true --v3-signing-enabled false \
  --out "$WORK/fast.apk" "$WORK/aligned.apk"
"$BT/zipalign" -c -P 16 4 "$WORK/fast.apk"
export APKSIGNER="$BT/apksigner" PATH="$JAVA_HOME/bin:$PATH"
[ "$(signer_sha256 "$WORK/fast.apk")" = "$(signer_sha256 "$WORK/base.apk")" ] || { echo "signer differs from the base"; exit 1; }

step "guards (flavor mark, flavor guard, release gate)"
flavor_verify_artifact "$WORK/fast.apk" || { echo "fast APK is not FLAVOR=$FLAVOR JS (flavor mark)"; exit 1; }
# the base APK came from a build script that pins the dev server host; prove it for the APK that ships (a base from before the pin
# has a different native fingerprint, so it would not be used)
apk_check_dev_server_ip "$WORK/fast.apk" "$BT/aapt2" || { echo "fast APK carries a build-host address"; exit 1; }
if [ "$FLAVOR" = hermes ] && [ "${HUI_SKIP_RELEASE_GATE:-0}" = 1 ]; then
  # remote lane: this host has neither the private denylist nor the allow-list; the caller runs both on the fetched APK
  echo "NOTE: output guard + release gate skipped here (HUI_SKIP_RELEASE_GATE=1): the caller runs them on this APK"
elif [ "$FLAVOR" = hermes ]; then
  # both scan the whole APK (about 20 s each, one core each): run them side by side, both must pass
  GX="$(mktemp -d)"; (cd "$GX" && unzip -q "$WORK/fast.apk")
  flavor_guard_output "$GX" > "$WORK/guard.log" 2>&1 & GUARD_PID=$!
  gate_rc=0; release_gate "$WORK/fast.apk" || gate_rc=$?
  guard_rc=0; wait "$GUARD_PID" || guard_rc=$?
  cat "$WORK/guard.log"; rm -rf "$GX"
  [ "$guard_rc" = 0 ] || { echo "hermes APK contains private content"; exit 1; }
  [ "$gate_rc" = 0 ] || { echo "fast APK failed the release gate"; exit 1; }
fi
mv -f "$WORK/fast.apk" "$OUT"
ln -sf "$(basename "$OUT")" "$ROOT/dist/$LATEST$ABI_SUFFIX$SIGN_SUFFIX-fast.apk"
rm -rf "$WORK"
echo "APK: $OUT ($(du -h "$OUT" | cut -f1)), JS of ${SHA}, native base build $BASE_NUMBER"
echo "Fast build OK in $((SECONDS-T0))s"
