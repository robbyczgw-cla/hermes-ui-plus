#!/usr/bin/env bash
# Build the Hermes UI+ Android APK LOCALLY with hard memory/CPU limits.
#
# Usage: [FLAVOR=hermes|personal] [HUI_PRIVATE_DIR=…] scripts/build-apk.sh [debug|release]   (docs/BUILD.md "Flavors")
# Output: FLAVOR=hermes (default, official app xyz.hermesui.app, app/brand/identity.json):
#           dist/hermes-ui-plus-<variant>-<gitsha>.apk, dist/latest-hermes-<variant>.apk (symlink)
#         FLAVOR=personal (identity/icons/EXPO_PUBLIC_* from the private overlay):
#           dist/hermes-ui-<variant>-<gitsha>.apk, dist/latest-<variant>.apk (symlink)
#         dist/build-<variant>-<timestamp>.log
# A hermes build fails if its input or the APK contains anything from the private overlay (scripts/flavor-guard.mjs).
# Every build fails unless the APK/AAB's JS bundle carries the flavor mark of FLAVOR (scripts/verify-flavor-artifact.mjs,
# checked on Gradle's output before it is copied anywhere); Metro runs with the flavor's own TMPDIR (docs/BUILD.md).
#
# Safety model (see docs/BUILD.md): this machine also hosts interactive sessions and has NO swap,
# so every heavy step (npm ci, expo prebuild, Gradle, Metro, clang) runs inside ONE transient
# systemd user scope with MemoryMax / MemorySwapMax=0 / CPUQuota. Only one build runs at a time
# (flock) and the build refuses to start when MemAvailable is too low.
#
# macOS (the build Mac, docs/BUILD.md "Android lane on the Mac"): same script, no systemd. The single heavy-job lock
# of the Mac (scripts/lib/maclock.sh) replaces flock, a process-tree watchdog replaces the scope's MemoryMax (RSS of the
# build tree > MEM_MAX, or the host nearly out of memory: the tree is killed by pid), Gradle runs the Kotlin compiler
# in-process (no stray daemon outside the tree), thermal state (pmset -g therm) is sampled with the memory. Built for
# ABIS=arm64-v8a (test builds for the arm64 emulator); scripts/e2e/smoke.sh --host … runs the suite there. Run it from
# your machine with --host (see "Remote lane" below) or directly on the Mac.
#
# Remote lane: scripts/build-apk.sh --host mac|<ssh host> [debug|release]  (or HUI_BUILD_HOST / HUI_ANDROID_LANE=mac)
#   gets the exact commit to the Mac through git (a bundle of the missing commits, scripts/lib/lane-sync.sh), builds there
#   (HUI_SKIP_RELEASE_GATE=1) in a run directory of its own; the APK STAYS on the Mac
#   (~/hui-lane/runs/<run id>/dist/<name>-<variant>-<sha>-mac[-debugsigned].apk) and must name the synced commit.
#   --fetch copies it back and runs flavor guard + release gate (private denylist) HERE before it lands in dist/;
#   --smoke runs the E2E suite on the Mac against it and brings back only the report. The Mac never sees the private
#   overlay (hermes flavor only). The link to the Mac can be slow, hence no bulk transfers by default.
#
# Lane choice: HUI_ANDROID_LANE=mac|local|auto (auto = the Mac when it is idle, else build here + emulator on E2E_HOST; the choice
# and its reason are printed; test builds only, a release / store build is always built here), scripts/lib/lane-choose.sh.
#
# Env overrides (defaults in brackets):
#   ANDROID_HOME [~/android/sdk]   JAVA_HOME [~/android/jdk-17]   BUILD_DIR [~/builds/hermes-ui(-<flavor>)]
#                       hermes flavor: SDK, Gradle cache and BUILD_DIR under HUI_ANDROID_STORE [/var/tmp, macOS /Users/Shared]
#                       (scripts/lib/android-store.sh; the Mac moves an SDK left in /var/tmp there once)
#   MEM_MAX [8G]  MEM_HIGH [7G]  CPU_QUOTA [600%]  MIN_AVAIL_GB [10]
#   GRADLE_WORKERS [2]  GRADLE_XMX [3g]  KOTLIN_XMX [1g]  NINJA_JOBS [3]  ABIS [arm64-v8a]
#                       ABIS=x86_64 builds for the local emulator; any non-default ABIS gets an
#                       ABI suffix (dist/hermes-ui-<variant>-<sha>-x86_64.apk, dist/latest-<variant>-x86_64.apk)
#                       so the phone APK / latest-<variant>.apk are never overwritten
#   HUI_BUILD_SHA      commit label for the file name (default: git; set by the remote lane, the Mac copy has no .git)
#   HUI_LANE_STAMP     remote lane: the stamp of the run's sync; the copy of app/ must carry it (scripts/lib/lane-stamp.sh)
#   HUI_APK_TAG        suffix after the ABI suffix of the output name (remote lane: -mac)
#   HUI_SKIP_RELEASE_GATE=1  hermes: skip the scan-artifact gate here (the remote lane runs it on the fetched APK)
#   HUI_MAC_LOCK_WAIT [2700]  macOS: seconds to wait for the Mac's heavy-job lock; MIN_FREE_DISK_GB [6] macOS: refuse below
#   SKIP_NPM_CI=1       reuse node_modules in BUILD_DIR if package-lock.json is unchanged
#   HERMES_KEYSTORE / HERMES_KEY_ALIAS / HERMES_KEYSTORE_PASS (release)
#                       re-sign the release APK with the release keystore (docs/BUILD.md, docs/RELEASING.md).
#                       REQUIRED for FLAVOR=hermes release builds: without it the build refuses to start, because
#                       the APK would carry this machine's debug key (scripts/lib/signing.sh).
#   BUNDLE=1            release only: build an Android App Bundle (.aab, for Google Play) instead of the APK,
#                       re-signed with the release key via jarsigner (Play App Signing: upload key = release key).
#   HERMES_CERT_SHA256  expected signer fingerprint (hex, colons optional; default: $HUI_PRIVATE_DIR/build.env).
#                       When set, a hermes release whose final signer differs is removed and the build fails.
#   ALLOW_DEBUG_SIGNED=1  hermes release WITHOUT the release key, for local tests only: the output is named
#                       *-release-<sha>-debugsigned.apk (and latest-hermes-release-debugsigned.apk) so it can never
#                       be mistaken for a publishable APK
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
# shellcheck source=lib/android-store.sh
. "$ROOT/scripts/lib/android-store.sh"
# shellcheck source=lib/lane-stamp.sh
. "$ROOT/scripts/lib/lane-stamp.sh"
HOST_OS="$(uname -s)"
# macOS' case-insensitive APFS: the APK holds res/ files that differ only in case (res/-k.xml vs res/-K.xml), and unzip
# would stop at an overwrite prompt. -o overwrites, so the scan copy here lacks one of each pair; the remote lane
# (HUI_SKIP_RELEASE_GATE=1) skips that copy and the caller scans the fetched APK completely.
UNZIP_Q=-q; [ "$HOST_OS" = Darwin ] && UNZIP_Q=-qo
# --- host differences (Linux: /proc, GNU tools; macOS: vm_stat, BSD tools) ---
sed_inplace() { # sed_inplace SCRIPT FILE (extended regex)
  if [ "$HOST_OS" = Darwin ]; then sed -E "$1" "$2" > "$2.tmp" && mv "$2.tmp" "$2"; else sed -i -E "$1" "$2"; fi
}
if [ "${HERMES_BUILD_INNER:-0}" != 1 ]; then flavor_init; fi
if [ "${FLAVOR:-hermes}" = personal ]; then
  export ANDROID_HOME="${ANDROID_HOME:-$HOME/android/sdk}"
else
  # public builds: SDK/NDK + Gradle caches at neutral paths – their absolute paths end up in the .so files
  # (lambda names, __FILE__), and $HOME would leak the local user name (scripts/flavor-guard.mjs refuses that).
  # Linux /var/tmp/hiui-*, macOS /Users/Shared/hiui-* (a reboot empties the Mac's /var/tmp), scripts/lib/android-store.sh.
  # One-time setup (Linux): rsync -a --exclude emulator --exclude system-images ~/android/sdk/ /var/tmp/hiui-android-sdk/
  #                         rsync -a --exclude daemon ~/.gradle/ /var/tmp/hiui-gradle/
  android_store_init
  export ANDROID_HOME="${ANDROID_HOME:-$STORE_SDK}"
  export GRADLE_USER_HOME="${GRADLE_USER_HOME:-$STORE_GRADLE}"
fi
export ANDROID_SDK_ROOT="$ANDROID_HOME"
if [ "$HOST_OS" = Darwin ]; then
  # Homebrew openjdk@17 (user space): the real JAVA_HOME is inside the keg
  for _jh in /opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home /opt/homebrew/opt/openjdk@17 "$HOME/android/jdk-17"; do
    [ -x "$_jh/bin/java" ] && { JAVA_HOME="${JAVA_HOME:-$_jh}"; break; }
  done
fi
export JAVA_HOME="${JAVA_HOME:-$HOME/android/jdk-17}"
# hermes (public) builds live outside $HOME and map $HOME away in native debug strings, so no local
# user name / home path ends up in the APK's .so files (the release gate's leak-guard would refuse it).
if [ "${FLAVOR:-hermes}" = personal ]; then
  BUILD_DIR="${BUILD_DIR:-$HOME/builds/hermes-ui}"
else
  # macOS: a physical path (android_store_init resolves it; /var is a symlink to /private/var). @expo/fingerprint (the JS fast
  # path's cache key) strips the project root from the absolute paths of its autolinking output only when they agree, so the
  # physical path keeps the key independent of the directory (build dir here, fast dir in build-apk-fast.sh).
  BUILD_DIR="${BUILD_DIR:-$STORE_BUILD}"
  export CFLAGS="${CFLAGS:-} -ffile-prefix-map=$HOME=/src -ffile-prefix-map=$BUILD_DIR=/src/app"
  export CXXFLAGS="${CXXFLAGS:-} -ffile-prefix-map=$HOME=/src -ffile-prefix-map=$BUILD_DIR=/src/app"
fi
if [ "$HOST_OS" = Darwin ]; then
  # 16 GB fanless Mac that also runs the user's apps: smaller tree budget, 4 ninja jobs (4 performance cores)
  MEM_MAX="${MEM_MAX:-7G}"; MEM_HIGH="${MEM_HIGH:-6G}"; CPU_QUOTA="${CPU_QUOTA:-n/a}"
  MIN_AVAIL_GB="${MIN_AVAIL_GB:-5}"
  WORKERS="${GRADLE_WORKERS:-3}"; XMX="${GRADLE_XMX:-3g}"; KXMX="${KOTLIN_XMX:-1g}"
  NINJA_JOBS="${NINJA_JOBS:-4}"
else
  MEM_MAX="${MEM_MAX:-8G}"; MEM_HIGH="${MEM_HIGH:-7G}"; CPU_QUOTA="${CPU_QUOTA:-600%}"
  MIN_AVAIL_GB="${MIN_AVAIL_GB:-10}"
  WORKERS="${GRADLE_WORKERS:-2}"; XMX="${GRADLE_XMX:-3g}"; KXMX="${KOTLIN_XMX:-1g}"
  NINJA_JOBS="${NINJA_JOBS:-3}"
fi
ABIS_USER="${ABIS:-}"; ABIS="${ABIS:-arm64-v8a}"
CMAKE_VER="3.22.1"

# --------------------------------------------------------------------------------------------
# INNER MODE: runs inside the systemd scope. Not meant to be called directly.
# --------------------------------------------------------------------------------------------
if [ "${HERMES_BUILD_INNER:-0}" = 1 ]; then
  VARIANT="$1"; Variant="$(tr '[:lower:]' '[:upper:]' <<<"${VARIANT:0:1}")${VARIANT:1}"
  t() { echo "--- [$(date +%T)] $*"; }
  export PATH="$JAVA_HOME/bin:$PATH"
  export CI=1 EXPO_NO_TELEMETRY=1
  export NODE_OPTIONS="--max-old-space-size=2048"   # Metro / expo CLI heap cap
  export GRADLE_OPTS="-Xmx384m"                      # Gradle *client* JVM only
  cd "$BUILD_DIR/app"
  flavor_require_tmpdir   # Gradle's bundle task runs Metro: its transform cache must be this flavor's own
  # Always stop Gradle daemons, also on failure/interrupt.
  trap '[ -x "$BUILD_DIR/app/android/gradlew" ] && (cd "$BUILD_DIR/app/android" && ./gradlew --stop >/dev/null 2>&1) || true' EXIT

  t "npm ci"
  # the dependency patches (patches/, applied by the postinstall patch-package) are part of the installed state
  LOCK_HASH="$(cat package-lock.json patches/*.patch 2>/dev/null | sha256_stdin | cut -d' ' -f1)"
  if [ "${SKIP_NPM_CI:-0}" = 1 ] && [ -f node_modules/.lock-hash ] && [ "$LOCK_HASH" = "$(cat node_modules/.lock-hash)" ]; then
    echo "node_modules up to date (SKIP_NPM_CI=1)"
  else
    npm ci --no-audit --no-fund
    echo "$LOCK_HASH" > node_modules/.lock-hash
  fi

  # hermes: resolved Expo config must be the official identity, no private files in the build copy
  if [ "$FLAVOR" = hermes ]; then t "flavor guard (build input)"; node "$ROOT/scripts/flavor-guard.mjs" --tree "$BUILD_DIR/app"; fi

  # JS fast path (scripts/build-apk-fast.sh): the native fingerprint of exactly this input, taken before prebuild
  # rewrites package.json; the outer mode registers the finished APK under it
  if [ "$VARIANT" = release ] && [ "${HUI_FAST_REGISTER:-1}" = 1 ]; then
    t "native fingerprint (fast path)"
    fast_key "$BUILD_DIR/app" "$ABIS" > "$BUILD_DIR/fast-key" || { rm -f "$BUILD_DIR/fast-key"; echo "no native fingerprint"; }
  fi

  t "expo prebuild (android, --clean, flavor $FLAVOR)"
  npx expo prebuild --platform android --clean --no-install

  # Resource limits for the generated project. Drop any existing definitions first so ours win.
  GP=android/gradle.properties
  sed_inplace '/^(org\.gradle\.jvmargs|org\.gradle\.workers\.max|org\.gradle\.parallel|org\.gradle\.caching|org\.gradle\.daemon|kotlin\.daemon\.jvmargs|reactNativeArchitectures)=/d' "$GP"
  cat >> "$GP" <<EOP

# --- added by scripts/build-apk.sh (memory-safe local build) ---
org.gradle.jvmargs=-Xmx$XMX -XX:MaxMetaspaceSize=768m -XX:+UseParallelGC
org.gradle.workers.max=$WORKERS
org.gradle.parallel=true
org.gradle.caching=true
org.gradle.daemon=false
kotlin.daemon.jvmargs=-Xmx$KXMX
reactNativeArchitectures=$ABIS
EOP
  # React Native's Gradle plugin bakes the build host's first up IPv4 address into the app as react_native_dev_server_ip (the Docker
  # bridge on the Linux host, the tailnet address on the Mac). A fixed value keeps every machine address out of the APK on every host;
  # scripts/lib/apk-guards.sh proves it on the finished APK.
  echo "reactNativeDevServerIp=localhost" >> "$GP"
  echo "sdk.dir=$ANDROID_HOME" > android/local.properties

  if [ "$VARIANT" = release ]; then
    # The Expo template signs release builds with the debug keystore. Fail loudly if that changes.
    grep -q "signingConfigs.debug" android/app/build.gradle \
      || { echo "expected release buildType to use signingConfigs.debug; template changed - see docs/BUILD.md"; exit 1; }
  fi

  TASK=assemble; [ "${BUNDLE:-0}" = 1 ] && TASK=bundle
  t "gradlew $TASK$Variant (workers=$WORKERS, Xmx=$XMX, abis=$ABIS)"
  cd android
  chmod +x gradlew
  # macOS: no cgroup around the tree, so the Kotlin compiler runs in-process (a Kotlin daemon would outlive Gradle's children)
  EXTRA_GRADLE=""; [ "$HOST_OS" = Darwin ] && EXTRA_GRADLE="-Pkotlin.compiler.execution.strategy=in-process"
  # shellcheck disable=SC2086
  nice -n 10 ./gradlew --console=plain --no-daemon "$TASK$Variant" \
    -PreactNativeArchitectures="$ABIS" --max-workers="$WORKERS" $EXTRA_GRADLE

  if [ "$TASK" = bundle ]; then
    AAB="$(ls -1 app/build/outputs/bundle/$VARIANT/*.aab | head -1)"
    t "flavor mark ($FLAVOR)"; flavor_verify_artifact "$AAB"
    cp "$AAB" "$BUILD_DIR/latest-$VARIANT.aab"
    ls -l "$AAB"
    exit 0
  fi
  APK="$(ls -1 app/build/outputs/apk/$VARIANT/*.apk | head -1)"
  t "flavor mark ($FLAVOR)"; flavor_verify_artifact "$APK"
  cp "$APK" "$BUILD_DIR/latest-$VARIANT.apk"
  ls -l "$APK"
  exit 0
fi

# --------------------------------------------------------------------------------------------
# OUTER MODE: preflight, lock, sync, launch scope, monitor, collect.
# --------------------------------------------------------------------------------------------
BUILD_HOST="${HUI_BUILD_HOST:-}"
LANE_FETCH=0; LANE_SMOKE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --host) BUILD_HOST="${2:?--host needs a host (mac or an ssh host)}"; shift 2 ;;
    --fetch) LANE_FETCH=1; shift ;;   # remote lane: copy the APK here and gate it (default: it stays on the host)
    --smoke) LANE_SMOKE=1; shift ;;   # remote lane: run the E2E suite on the host afterwards
    *) break ;;
  esac
done
VARIANT="${1:-debug}"
case "$VARIANT" in debug|release) ;; *) echo "usage: $0 [--host mac|<ssh host> [--fetch] [--smoke]] [debug|release]" >&2; exit 2;; esac
# Lane selection (scripts/lib/lane-choose.sh, docs/BUILD.md): --host / HUI_BUILD_HOST win. HUI_ANDROID_LANE=mac builds on the Mac,
# local never does, auto (or --smoke without a lane) picks by the Mac's state. Only TEST builds (debug, or release with
# ALLOW_DEBUG_SIGNED=1) take part: a release / store build is always built here. A plain build without --smoke stays local
# unless the lane is auto/mac explicitly; auto without --smoke brings the APK back (--fetch) since nobody else would use it.
LOCAL_SMOKE=0
if [ -z "$BUILD_HOST" ]; then
  TEST_BUILD=0; { [ "$VARIANT" = debug ] || [ "${ALLOW_DEBUG_SIGNED:-0}" = 1 ]; } && TEST_BUILD=1
  # shellcheck source=lib/android-remote.sh
  . "$ROOT/scripts/lib/android-remote.sh"
  # shellcheck source=lib/lane-choose.sh
  . "$ROOT/scripts/lib/lane-choose.sh"
  lane_resolve_build "" "$LANE_SMOKE" "$TEST_BUILD" || exit 2
  if [ "$LANE_CHOICE" = mac ]; then
    BUILD_HOST=mac
    # an automatic choice without --smoke brings the APK back (nobody else would use it on the Mac)
    [ "$LANE_SMOKE" = 1 ] || [ "${HUI_ANDROID_LANE:-}" != auto ] || LANE_FETCH=1
  elif [ "$LANE_SMOKE" = 1 ]; then
    # build here for the Linux emulator host (x86_64) and run the suite there afterwards
    LOCAL_SMOKE=1; [ -n "$ABIS_USER" ] || ABIS=x86_64
  fi
fi
if [ -n "$BUILD_HOST" ]; then
  # shellcheck source=lib/android-remote.sh
  . "$ROOT/scripts/lib/android-remote.sh"
  android_remote_build "$BUILD_HOST" "$VARIANT" "$LANE_FETCH" "$LANE_SMOKE"
  exit $?
fi
[ -f "$ROOT/app/package.json" ] || { echo "app/package.json not found" >&2; exit 1; }
# hermes release: release key required (or ALLOW_DEBUG_SIGNED=1 for a clearly named local test APK)
signing_preflight "$VARIANT" || exit 1
BUNDLE="${BUNDLE:-0}"
if [ "$BUNDLE" = 1 ]; then
  [ "$VARIANT" = release ] || { echo "BUNDLE=1 needs the release variant"; exit 2; }
  [ "$SIGNING_MODE" = release-key ] || { echo "BUNDLE=1 needs the release key (HERMES_KEYSTORE): Play only accepts the upload key"; exit 2; }
fi
SIGN_SUFFIX=""; [ "$SIGNING_MODE" = debug-signed ] && SIGN_SUFFIX="-debugsigned"

mkdir -p "$ROOT/dist" "$BUILD_DIR"
if [ -n "${HUI_BUILD_SHA:-}" ]; then
  SHA="$HUI_BUILD_SHA"   # remote lane: the Mac copy has no .git, the label (incl. -dirty) comes from the caller
else
  SHA="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo nogit)"
  git -C "$ROOT" diff --quiet HEAD -- app 2>/dev/null || SHA="${SHA}-dirty"
fi
TS="$(date +%Y%m%d-%H%M%S)"
LOG="$ROOT/dist/build-$VARIANT-$TS.log"
ABI_SUFFIX=""; [ "$ABIS" = arm64-v8a ] || ABI_SUFFIX="-$(tr ',' '+' <<<"$ABIS")"
ABI_SUFFIX="$ABI_SUFFIX${HUI_APK_TAG:-}"
if [ "$FLAVOR" = personal ]; then APK_BASE=hermes-ui; LATEST="latest-$VARIANT"; else APK_BASE="$BRAND_ARTIFACT"; LATEST="latest-hermes-$VARIANT"; fi
OUT="$ROOT/dist/$APK_BASE-$VARIANT-$SHA$ABI_SUFFIX$SIGN_SUFFIX.apk"

exec > >(tee -a "$LOG") 2>&1
trap 'echo "BUILD FAILED (line $LINENO). Log: $LOG" >&2' ERR
T0=$SECONDS
step() { echo; echo "=== [$((SECONDS-T0))s] $*"; }

# One build at a time (held for the whole run via fd 9). The lock dir must exist: BUILD_DIR may be outside ~/builds.
mkdir -p "$HOME/builds"
if [ "$HOST_OS" = Darwin ]; then
  # the Mac's one heavy-job lock (also taken by build-ios.sh / build-desktop-mac.sh / the emulator): no overlap with them
  # shellcheck source=lib/maclock.sh
  . "$ROOT/scripts/lib/maclock.sh"
  maclock_acquire android-build "${HUI_MAC_LOCK_WAIT:-2700}" || exit 3
  trap 'maclock_release' EXIT
  # under the lock: no other Android build / emulator uses the SDK while it moves
  [ "$FLAVOR" = personal ] || android_store_migrate
else
  exec 9>"$HOME/builds/.hermes-build.lock"
  flock -n 9 || { echo "another build is running (lock $HOME/builds/.hermes-build.lock)"; exit 1; }
fi

# Build number: a local counter that grows with every build (under the lock, so builds never share a number). It is
# the Android versionCode (installs over every older build) and shows in Settings → About as "<version> · Build <n>".
# HUI_BUILD_NUMBER=<n> pins it (the counter then continues from n); HUI_BUILD_SOURCE = commit shown next to it.
COUNTER="${HUI_BUILD_COUNTER:-$HOME/builds/.hermes-build-number}"
if [ -z "${HUI_BUILD_NUMBER:-}" ]; then
  LAST="$(cat "$COUNTER" 2>/dev/null || echo 1)"; case "$LAST" in ''|*[!0-9]*) LAST=1;; esac
  HUI_BUILD_NUMBER=$((10#$LAST + 1))   # 10#: decimal, a stored "010" must not read as octal
fi
case "$HUI_BUILD_NUMBER" in ''|*[!0-9]*) echo "HUI_BUILD_NUMBER must be a number"; exit 1;; esac
HUI_BUILD_NUMBER=$((10#$HUI_BUILD_NUMBER))
# same range as app.config.ts (Android versionCode limit)
[ "$HUI_BUILD_NUMBER" -gt 0 ] && [ "$HUI_BUILD_NUMBER" -lt 2100000000 ] || { echo "HUI_BUILD_NUMBER out of range"; exit 1; }
echo "$HUI_BUILD_NUMBER" > "$COUNTER"
HUI_BUILD_SOURCE="${HUI_BUILD_SOURCE:-${SHA%-dirty}}"
export HUI_BUILD_NUMBER HUI_BUILD_SOURCE
echo "Build number: $HUI_BUILD_NUMBER (source $HUI_BUILD_SOURCE)"

step "Preflight"
[ -x "$JAVA_HOME/bin/java" ] || { echo "JDK not found at $JAVA_HOME (see docs/BUILD.md)"; exit 1; }
android_sdk_require build "$ANDROID_HOME" || exit 1
"$JAVA_HOME/bin/java" -version 2>&1 | head -1
node -v
AVAIL_KB="$(host_avail_kb)"
echo "MemAvailable: $((AVAIL_KB/1024)) MB (need >= $((MIN_AVAIL_GB*1024)) MB)"
if [ "$AVAIL_KB" -lt $((MIN_AVAIL_GB*1024*1024)) ]; then
  echo "REFUSING TO BUILD: not enough free memory. Close things or lower MIN_AVAIL_GB deliberately."
  exit 1
fi
if [ "$HOST_OS" = Darwin ]; then
  # disk is the tight resource on the Mac: SDK + Gradle + build tree need several GB
  FREE_GB="$(df -k "$(dirname "$BUILD_DIR")" | awk 'NR==2 { printf "%d", $4 / 1048576 }')"
  echo "disk free: ${FREE_GB} GB (need >= ${MIN_FREE_DISK_GB:-6} GB)"
  [ "$FREE_GB" -ge "${MIN_FREE_DISK_GB:-6}" ] || { echo "REFUSING TO BUILD: not enough free disk on this Mac"; exit 1; }
else
  export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
  export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=/run/user/$(id -u)/bus}"
  systemd-run --user --scope -q -p MemoryMax=64M true 2>/dev/null \
    || { echo "systemd-run --user --scope not usable; refusing to build without memory limits"; exit 1; }
  heavy_slice_init   # shared aggregate cap with web builds / checks (scripts/lib/heavy.sh)
fi

# Ninja has no env var for parallelism and AGP launches it with the default (= all cores, up to 3
# ninjas at once). Wrap the SDK's ninja so it defaults to -j$NINJA_JOBS. Idempotent; sdkmanager
# updates of cmake;$CMAKE_VER undo it and this step re-applies it.
NINJA="$ANDROID_HOME/cmake/$CMAKE_VER/bin/ninja"
if [ -f "$NINJA" ] && ! head -c 2 "$NINJA" | grep -q '#!'; then
  mv "$NINJA" "$NINJA.real"
  printf '#!/usr/bin/env bash\nexec "$(dirname "$0")/ninja.real" -j "${NINJA_JOBS:-3}" "$@"\n' > "$NINJA"
  chmod +x "$NINJA"
  echo "installed ninja -j wrapper"
fi
export NINJA_JOBS

step "rsync app/ -> $BUILD_DIR/app"
mkdir -p "$BUILD_DIR/app"
# Excludes are ANCHORED (/android/, /ios/ …): an unanchored `--exclude android` also dropped
# modules/stream-keepalive/android, so release APKs silently shipped without the keep-alive service.
rsync -a --delete \
  --exclude node_modules --exclude /.expo/ --exclude /android/ --exclude /ios/ \
  --exclude /refs/ --exclude /dist/ --exclude '*.keystore' --exclude '*.jks' --exclude .env --exclude '.env.*' \
  "$ROOT/app/" "$BUILD_DIR/app/"
rm -f "$BUILD_DIR/latest-$VARIANT.apk" "$BUILD_DIR/latest-$VARIANT.aab" "$BUILD_DIR/fast-key"
# remote lane: the copy must be this run's sync; the APK then names the commit of the copy (Settings -> About, checked by the caller)
lane_stamp_check "$BUILD_DIR/app" || exit 1
[ -z "$LANE_STAMP_SOURCE" ] || HUI_BUILD_SOURCE="$LANE_STAMP_SOURCE"

# macOS: no systemd, no cgroup. The build runs as a child of this shell; a watchdog sums the RSS of its process tree every
# 5 s, writes [mem] / [therm] lines (pmset -g therm: CPU_Speed_Limit < 100 = thermal throttling) and kills the tree by
# pid when it exceeds MEM_MAX or the host is nearly out of memory (the Mac also runs the user's apps).
run_mac_inner() { # sets rc, PEAK_MB, MIN_SPEED_LIMIT
  step "Build on macOS (process-tree watchdog: MEM_MAX=$MEM_MAX, host floor ${HUI_MAC_MIN_AVAIL_MB:-1024} MB, workers=$WORKERS, Xmx=$XMX)"
  PEAKFILE="$(mktemp)"; echo 0 > "$PEAKFILE"; THERMFILE="$PEAKFILE.therm"; echo 100 > "$THERMFILE"
  local max_kb; max_kb="$(mem_kb "$MEM_MAX")"
  rc=0
  HERMES_BUILD_INNER=1 SKIP_NPM_CI="${SKIP_NPM_CI:-0}" NINJA_JOBS="$NINJA_JOBS" BUILD_DIR="$BUILD_DIR" JAVA_HOME="$JAVA_HOME" \
    ANDROID_HOME="$ANDROID_HOME" GRADLE_WORKERS="$WORKERS" GRADLE_XMX="$XMX" KOTLIN_XMX="$KXMX" ABIS="$ABIS" BUNDLE="$BUNDLE" \
    HUI_BUILD_NUMBER="$HUI_BUILD_NUMBER" HUI_BUILD_SOURCE="$HUI_BUILD_SOURCE" \
    bash "$ROOT/scripts/build-apk.sh" "$VARIANT" &
  INNER=$!
  trap 'echo "interrupted: stopping the build tree" >&2; kill_tree "$INNER"; exit 143' INT TERM HUP
  ( peak=0; low=0; n=0; tl=100
    while kill -0 "$INNER" 2>/dev/null; do
      set -- $(tree_rss "$INNER"); cur=$1
      [ "$cur" -gt "$peak" ] && peak=$cur
      echo "$peak" > "$PEAKFILE"
      avail_mb=$(( $(host_avail_kb) / 1024 ))
      if [ $(( n % 12 )) = 0 ]; then
        sp="$(pmset -g therm 2>/dev/null | awk '/CPU_Speed_Limit/ { print $NF }')"; sp="${sp:-100}"
        [ "$sp" -lt "$tl" ] 2>/dev/null && { tl=$sp; echo "$tl" > "$THERMFILE"; }
        echo "[mem] tree=$((cur/1024))MB peak=$((peak/1024))MB hostAvail=${avail_mb}MB [therm] speedLimit=$sp swap=$(sysctl -n vm.swapusage 2>/dev/null | awk '{ print $6 }')"
      fi
      if [ "$cur" -gt "$max_kb" ]; then
        echo "[watchdog] build tree $((cur/1024)) MB > MEM_MAX $MEM_MAX: killing the tree" >&2; touch "$PEAKFILE.killed"; kill_tree "$INNER"; break
      fi
      if [ "$avail_mb" -lt "${HUI_MAC_MIN_AVAIL_MB:-1024}" ]; then low=$((low + 1)); else low=0; fi
      if [ "$low" -ge 2 ]; then
        echo "[watchdog] host has only ${avail_mb} MB available: killing the build tree to keep the Mac usable" >&2; touch "$PEAKFILE.killed"; kill_tree "$INNER"; break
      fi
      n=$((n + 1)); sleep 5
    done ) &
  SAMPLER=$!
  wait "$INNER" || rc=$?
  kill "$SAMPLER" 2>/dev/null || true
  [ -f "$PEAKFILE.killed" ] && [ "$rc" = 0 ] && rc=137
  PEAK_MB=$(( $(cat "$PEAKFILE") / 1024 )); MIN_SPEED_LIMIT="$(cat "$THERMFILE")"
  rm -f "$PEAKFILE" "$PEAKFILE.killed" "$THERMFILE"
  ( cd "$BUILD_DIR/app/android" 2>/dev/null && ./gradlew --stop >/dev/null 2>&1 ) || true
  echo "Thermal: lowest CPU_Speed_Limit during the build: ${MIN_SPEED_LIMIT} (100 = never throttled)"
}

if [ "$HOST_OS" = Darwin ]; then
  run_mac_inner
  trap 'maclock_release' EXIT
else
  UNIT="hermes-build-$TS"
  step "Build in systemd scope $UNIT (MemoryMax=$MEM_MAX MemoryHigh=$MEM_HIGH MemorySwapMax=0 CPUQuota=$CPU_QUOTA)"

  # Memory sampler: every 15s log scope memory + host MemAvailable, remember the peak.
  PEAKFILE="$(mktemp)"; echo 0 > "$PEAKFILE"
  ( exec 9>&-   # the sampler (and its sleep) must not inherit the build lock fd: it outlived the build by up to 15 s
    peak=0
    num() { case "$1" in ''|*[!0-9]*) echo 0;; *) [ "${#1}" -lt 15 ] && echo "$1" || echo 0;; esac; }
    while :; do
      cur="$(num "$(systemctl --user show "$UNIT.scope" -p MemoryCurrent --value 2>/dev/null)")"
      pk="$(num "$(systemctl --user show "$UNIT.scope" -p MemoryPeak --value 2>/dev/null)")"
      [ "$cur" -gt "$peak" ] && peak="$cur"
      [ "$pk" -gt "$peak" ] && peak="$pk"
      echo "$peak" > "$PEAKFILE"
      echo "[mem] scope=$((cur/1048576))MB peak=$((peak/1048576))MB hostAvail=$(awk '/^MemAvailable:/{print int($2/1024)}' /proc/meminfo)MB"
      sleep 15
    done
  ) &
  SAMPLER=$!
  cleanup() { kill "$SAMPLER" 2>/dev/null || true; systemctl --user stop "$UNIT.scope" 2>/dev/null || true; }
  trap cleanup EXIT

  rc=0
  HERMES_BUILD_INNER=1 SKIP_NPM_CI="${SKIP_NPM_CI:-0}" \
  systemd-run --user --scope --quiet --unit="$UNIT" "${HEAVY_SLICE[@]}" \
    -p MemoryMax="$MEM_MAX" -p MemoryHigh="$MEM_HIGH" -p MemorySwapMax=0 -p CPUQuota="$CPU_QUOTA" \
    --setenv=HERMES_BUILD_INNER=1 --setenv=SKIP_NPM_CI="${SKIP_NPM_CI:-0}" \
    --setenv=NINJA_JOBS="$NINJA_JOBS" --setenv=BUILD_DIR="$BUILD_DIR" \
    --setenv=JAVA_HOME="$JAVA_HOME" --setenv=ANDROID_HOME="$ANDROID_HOME" ${GRADLE_USER_HOME:+--setenv=GRADLE_USER_HOME="$GRADLE_USER_HOME"} \
    --setenv=GRADLE_WORKERS="$WORKERS" --setenv=GRADLE_XMX="$XMX" --setenv=KOTLIN_XMX="$KXMX" \
    --setenv=ABIS="$ABIS" --setenv=BUNDLE="$BUNDLE" \
    --setenv=HUI_BUILD_NUMBER="$HUI_BUILD_NUMBER" --setenv=HUI_BUILD_SOURCE="$HUI_BUILD_SOURCE" \
    bash "$ROOT/scripts/build-apk.sh" "$VARIANT" || rc=$?

  sleep 1
  kill "$SAMPLER" 2>/dev/null || true
  PEAK_MB=$(( $(cat "$PEAKFILE") / 1048576 )); rm -f "$PEAKFILE"
  systemctl --user stop "$UNIT.scope" 2>/dev/null || true   # kill stray Kotlin/Gradle daemons
  trap - EXIT
fi
echo "Peak $([ "$HOST_OS" = Darwin ] && echo build-tree || echo scope) memory: ${PEAK_MB} MB (limit $MEM_MAX)"
if [ "$rc" -ne 0 ]; then
  [ "$rc" = 137 ] && echo "Exit 137: process was SIGKILLed - likely OOM-killed by MemoryMax. Lower GRADLE_WORKERS/GRADLE_XMX."
  echo "BUILD FAILED (exit $rc). Log: $LOG"
  exit "$rc"
fi

# App Bundle (BUNDLE=1): same guards as the APK, then the debug signature is replaced by the release key (jarsigner;
# Play App Signing treats it as the upload key) and the single signer is pinned to HERMES_CERT_SHA256.
collect_bundle() {
  step "Collecting App Bundle"
  local src="$BUILD_DIR/latest-$VARIANT.aab" final="${OUT%.apk}.aab" out gx got signers
  # every step works on a temporary file; the final name only ever holds a verified, release-signed bundle
  out="${final%.aab}.partial.aab"; rm -f "$out"   # keeps the .aab extension for scan-artifact
  [ -f "$src" ] || { echo "AAB missing: $src"; return 1; }
  flavor_verify_artifact "$src" || { echo "AAB is not FLAVOR=$FLAVOR JS (flavor mark) – not collected"; return 1; }
  cp "$src" "$out"
  gx="$(mktemp -d)"; (cd "$gx" && unzip $UNZIP_Q "$out")
  if [ "$FLAVOR" = hermes ]; then
    flavor_guard_output "$gx" || { rm -rf "$gx"; rm -f "$out"; echo "hermes AAB contains private content – removed"; return 1; }
  fi
  if [ "$(tr -d '[:space:]' <<<"${EXPO_PUBLIC_BG_SERVICE:-}")" != 0 ]; then
    # the bundle manifest is protobuf, but its strings are stored verbatim
    grep -aq 'ai.hermes.streamkeepalive.StreamKeepAliveService' "$gx/base/manifest/AndroidManifest.xml" \
      && grep -aq 'android.permission.FOREGROUND_SERVICE_DATA_SYNC' "$gx/base/manifest/AndroidManifest.xml" \
      && [ "$(cat "$gx"/base/dex/classes*.dex | grep -ac 'ai/hermes/streamkeepalive/StreamKeepAliveModule' || true)" -gt 0 ] \
      || { rm -rf "$gx"; rm -f "$out"; echo "AAB lacks the stream-keepalive service – removed"; return 1; }
    echo "keep-alive service present (manifest + dex)"
  fi
  rm -rf "$gx"
  : "${HERMES_KEYSTORE_PASS:?set HERMES_KEYSTORE_PASS}"; export HERMES_KEYSTORE_PASS
  echo "Re-signing the bundle with $HERMES_KEYSTORE (alias ${HERMES_KEY_ALIAS:-hermes})"
  # drop the template's debug signature (JAR signature files directly under META-INF/), keep everything else
  python3 - "$out" <<'PY'
import re, shutil, sys, zipfile
src = sys.argv[1]; tmp = src + '.unsigned'
sig = re.compile(r'^META-INF/(MANIFEST\.MF|[^/]+\.(SF|RSA|EC|DSA))$')
with zipfile.ZipFile(src) as zi, zipfile.ZipFile(tmp, 'w') as zo:
    for info in zi.infolist():
        if not sig.match(info.filename):
            zo.writestr(info, zi.read(info.filename))
shutil.move(tmp, src)
PY
  PATH="$JAVA_HOME/bin:$PATH" jarsigner -keystore "$HERMES_KEYSTORE" -storepass:env HERMES_KEYSTORE_PASS \
    -keypass:env HERMES_KEYSTORE_PASS "$out" "${HERMES_KEY_ALIAS:-hermes}" >/dev/null   # env:, never on the command line (ps)
  # no -strict: a self-signed upload key always warns about its chain
  PATH="$JAVA_HOME/bin:$PATH" jarsigner -verify "$out" | grep -q '^jar verified' \
    || { rm -f "$out"; echo "AAB signature does not verify – removed"; return 1; }
  signers="$(PATH="$JAVA_HOME/bin:$PATH" keytool -printcert -jarfile "$out" | grep -c '^Signer #' || true)"
  got="$(PATH="$JAVA_HOME/bin:$PATH" keytool -printcert -jarfile "$out" | grep -m1 -E '^[[:space:]]*SHA256:' | sed -E 's/.*SHA256:[[:space:]]*//')"
  got="$(normalize_sha256 "$got")"
  echo "bundle signer SHA-256: $got (signers: $signers)"
  [ "$signers" = 1 ] || { rm -f "$out"; echo "AAB must have exactly one signer – removed"; return 1; }
  if [ -n "${HERMES_CERT_SHA256:-}" ] && [ "$got" != "$HERMES_CERT_SHA256" ]; then
    rm -f "$out"; echo "SIGNER MISMATCH: expected HERMES_CERT_SHA256 – removed"; return 1
  fi
  if [ "$FLAVOR" = hermes ]; then
    step "Release gate (scripts/scan-artifact.sh)"
    release_gate "$out" || { rm -f "$out"; echo "hermes AAB failed the release gate – removed"; return 1; }
  fi
  mv -f "$out" "$final"
  ln -sf "$(basename "$final")" "$ROOT/dist/$LATEST.aab"
  echo "AAB: $final ($(du -h "$final" | cut -f1)), build number $HUI_BUILD_NUMBER"
  echo "Build OK in $((SECONDS-T0))s, peak memory ${PEAK_MB} MB  (log: $LOG)"
}

if [ "$BUNDLE" = 1 ]; then collect_bundle; exit $?; fi

step "Collecting APK"
APK_SRC="$BUILD_DIR/latest-$VARIANT.apk"
[ -f "$APK_SRC" ] || { echo "APK missing: $APK_SRC"; exit 1; }
flavor_verify_artifact "$APK_SRC" || { echo "APK is not FLAVOR=$FLAVOR JS (flavor mark) – not collected"; exit 1; }
cp "$APK_SRC" "$OUT"
if [ "$FLAVOR" = hermes ] && [ "${HUI_SKIP_RELEASE_GATE:-0}" = 1 ]; then
  # remote lane: this host has neither the private denylist nor the allow-list of known false positives (third-party
  # libraries carry e-mail addresses), so the output guard runs on the fetched APK at the caller instead
  echo "NOTE: output guard skipped here (HUI_SKIP_RELEASE_GATE=1): the caller runs flavor-guard --output on this APK"
elif [ "$FLAVOR" = hermes ]; then
  GX="$(mktemp -d)"; (cd "$GX" && unzip $UNZIP_Q "$OUT")
  flavor_guard_output "$GX" || { rm -rf "$GX"; rm -f "$OUT"; echo "hermes APK contains private content – removed"; exit 1; }
  rm -rf "$GX"
fi
# Local native modules must be in the APK: the keep-alive foreground service (modules/stream-keepalive) unless the
# store switch EXPO_PUBLIC_BG_SERVICE=0 removed it on purpose (app/plugins/withBgService.js).
step "Verify native modules (stream-keepalive)"
AAPT2="$ANDROID_HOME/build-tools/36.0.0/aapt2"
[ -x "$AAPT2" ] || { rm -f "$OUT"; echo "aapt2 missing at $AAPT2: cannot verify the APK manifest"; exit 1; }
apk_check_dev_server_ip "$OUT" "$AAPT2" || { rm -f "$OUT"; echo "APK carries a build-host address – removed"; exit 1; }
MANIFEST_DUMP="$("$AAPT2" dump xmltree --file AndroidManifest.xml "$OUT")" || { rm -f "$OUT"; echo "cannot read the APK manifest"; exit 1; }
HAS_SVC=0; grep -q 'ai.hermes.streamkeepalive.StreamKeepAliveService' <<<"$MANIFEST_DUMP" && HAS_SVC=1
HAS_PERM=0; grep -q 'android.permission.FOREGROUND_SERVICE_DATA_SYNC' <<<"$MANIFEST_DUMP" && HAS_PERM=1
if [ "$(tr -d '[:space:]' <<<"${EXPO_PUBLIC_BG_SERVICE:-}")" = 0 ]; then
  [ "$HAS_SVC$HAS_PERM" = 00 ] || { rm -f "$OUT"; echo "EXPO_PUBLIC_BG_SERVICE=0 but the APK still declares the keep-alive service/permission"; exit 1; }
  echo "keep-alive service removed (EXPO_PUBLIC_BG_SERVICE=0)"
else
  [ "$HAS_SVC$HAS_PERM" = 11 ] || { rm -f "$OUT"; echo "APK lacks the stream-keepalive service (service=$HAS_SVC permission=$HAS_PERM): local module not linked – removed"; exit 1; }
  # grep -c (not -q): reads the whole stream, so unzip never dies of SIGPIPE under pipefail
  DEX_HITS="$(unzip -p "$OUT" 'classes*.dex' | grep -ac 'ai/hermes/streamkeepalive/StreamKeepAliveModule' || true)"
  [ "${DEX_HITS:-0}" -gt 0 ] || { rm -f "$OUT"; echo "APK lacks the StreamKeepAliveModule class – removed"; exit 1; }
  echo "keep-alive service present (manifest + dex)"
fi
if [ "$VARIANT" = release ] && [ -n "${HERMES_KEYSTORE:-}" ]; then
  : "${HERMES_KEYSTORE_PASS:?set HERMES_KEYSTORE_PASS}"; export HERMES_KEYSTORE_PASS
  echo "Re-signing with $HERMES_KEYSTORE (alias ${HERMES_KEY_ALIAS:-hermes})"
  BT="$ANDROID_HOME/build-tools/36.0.0"
  PATH="$JAVA_HOME/bin:$PATH" "$BT/apksigner" sign --ks "$HERMES_KEYSTORE" --ks-key-alias "${HERMES_KEY_ALIAS:-hermes}" \
    --ks-pass env:HERMES_KEYSTORE_PASS --key-pass env:HERMES_KEYSTORE_PASS "$OUT"   # env:, never on the command line (ps)
fi
PATH="$JAVA_HOME/bin:$PATH" "$ANDROID_HOME/build-tools/36.0.0/apksigner" verify --print-certs "$OUT" 2>&1 | head -3 || true
# hermes release: the FINAL signer must be the release key (fingerprint pinned by HERMES_CERT_SHA256 when set)
APKSIGNER="$ANDROID_HOME/build-tools/36.0.0/apksigner" PATH="$JAVA_HOME/bin:$PATH" signing_verify "$OUT" \
  || { rm -f "$OUT"; echo "release APK is not signed with the expected release key – removed"; exit 1; }
[ "$SIGNING_MODE" = debug-signed ] && echo "NOTE: debug-signed release APK (ALLOW_DEBUG_SIGNED=1): local tests only, never publish"
# release gate on the FINAL (re-signed) APK before it gets the latest-* link: denylist + generic patterns + gitleaks
if [ "$FLAVOR" = hermes ]; then
  if [ "${HUI_SKIP_RELEASE_GATE:-0}" = 1 ]; then
    echo "NOTE: release gate skipped here (HUI_SKIP_RELEASE_GATE=1): the caller must run scripts/scan-artifact.sh on this APK before it is used"
  else
    step "Release gate (scripts/scan-artifact.sh)"
    release_gate "$OUT" || { rm -f "$OUT"; echo "hermes APK failed the release gate – removed"; exit 1; }
  fi
fi
# JS fast path (scripts/build-apk-fast.sh): a finished test APK (debug-signed release, never the release key) becomes the
# base for its native fingerprint. Still under the build lock, so BUILD_DIR's generated JS output is this build's.
if [ "$VARIANT" = release ] && [ "$SIGNING_MODE" != release-key ] && [ -z "${HERMES_KEYSTORE:-}" ] && [ "${HUI_FAST_REGISTER:-1}" = 1 ]; then
  step "Register as fast-path base"
  fast_register "$OUT" "$BUILD_DIR/app" "$VARIANT" "$HUI_BUILD_NUMBER" "$BUILD_DIR/fast-key" || echo "fast path: base not registered (the APK itself is fine)"
fi
ln -sf "$(basename "$OUT")" "$ROOT/dist/$LATEST$ABI_SUFFIX$SIGN_SUFFIX.apk"
echo "APK: $OUT ($(du -h "$OUT" | cut -f1))"
echo "Build OK in $((SECONDS-T0))s, peak memory ${PEAK_MB} MB  (log: $LOG)"
if [ "$LOCAL_SMOKE" = 1 ]; then
  echo "lane: running the smoke suite on the Linux emulator host"
  HUI_ANDROID_LANE=local exec "$ROOT/scripts/e2e/smoke.sh" --wait "${HUI_LANE_SMOKE_WAIT:-5}" "$OUT"
fi
