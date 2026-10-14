#!/usr/bin/env bash
# Build the Hermes UI+ web app (PWA) as a static bundle, memory-capped and in a clean copy of app/.
#
# Usage: [FLAVOR=hermes|personal] [HUI_PRIVATE_DIR=…] scripts/build-web.sh [--brand <brand.env>]   (docs/BUILD.md "Flavors")
#   FLAVOR=hermes (default)  official build → dist/web/. Fails if anything from the private overlay would ship
#                            (scripts/flavor-guard.mjs: env, build input, output incl. the private term list).
#   FLAVOR=personal          EXPO_PUBLIC_* defaults from $HUI_PRIVATE_DIR/app/personal.env → dist/web-personal/
#   --brand <file>           personal only: KEY=VALUE file with EXPO_PUBLIC_APP_NAME/_SHORT_NAME/_THEME_COLOR(_DARK) and
#                            BRAND_ICON (path relative to HUI_PRIVATE_DIR) [+ BRAND_BG]; the icon is applied with
#                            scripts/web-brand.sh after the export
#   WEB_OUT                  output dir override
# Output: dist/web/ or dist/web-personal/ (static files: index.html, manifest.webmanifest, sw.js, icons/, _expo/, assets/, plus
#         precompressed .br/.gz siblings of the text files – for static servers with brotli_static/gzip_static)
#         <out>.build-info (flavor / sw / sha, next to the bundle; checked by build-desktop-mac.sh SKIP_WEB=1)
#         dist/build-web-<timestamp>.log
# hermes: the bundle is promoted only after flavor-guard AND the release gate (scripts/scan-artifact.sh) passed.
#
# Same safety model as scripts/build-apk.sh (docs/BUILD.md): this machine has NO swap and hosts other
# sessions, so `expo export` runs inside a transient systemd user scope with MemoryMax / MemorySwapMax=0,
# one web build at a time (flock), refusing to start when MemAvailable is too low.
#
# Env (defaults in brackets):
#   EXPO_PUBLIC_APP_NAME [BRAND_NAME]        app name (manifest name, iOS home-screen title fallback); hermes default from
#                                            app/brand/identity.json, personal: from personal.env
#   EXPO_PUBLIC_APP_SHORT_NAME [BRAND_SHORT_NAME / =APP_NAME]  home-screen label + in-app header (keep it ≤ 12 chars)
#   EXPO_PUBLIC_THEME_COLOR [#ffffff]        manifest theme/background colour, light theme-color meta
#                                            (hermes default: identity.json colors.paper)
#   EXPO_PUBLIC_THEME_COLOR_DARK [#000000]   dark theme-color meta (hermes default: identity.json colors.ink)
#   WEB_SW [1]                               0 = no service worker registered; sw.js is a retirement worker that removes
#                                            an earlier deployment's worker + hui-shell-* caches (scripts/web-finalize.mjs)
#   MEM_MAX [4G]  CPU_QUOTA [300%]  MIN_AVAIL_GB [5]  MAX_WORKERS [2]
#   BUILD_DIR [~/builds/hermes-ui-web]
#   NPM_CI=1                                 install node_modules with `npm ci` instead of hard-linking the
#                                            repo's app/node_modules into the clean copy (default: hard-link
#                                            copy when the repo has node_modules, else npm ci)
# EXPO_PUBLIC_* values are inlined into the JS bundle – never put secrets (tokens) there.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="${BUILD_DIR:-$HOME/builds/hermes-ui-web}"
# shellcheck source=lib/flavor.sh
. "$ROOT/scripts/lib/flavor.sh"
# shellcheck source=lib/heavy.sh
. "$ROOT/scripts/lib/heavy.sh"
MEM_MAX="${MEM_MAX:-4G}"; CPU_QUOTA="${CPU_QUOTA:-300%}"; MIN_AVAIL_GB="${MIN_AVAIL_GB:-5}"; MAX_WORKERS="${MAX_WORKERS:-2}"

# ---------------------------------------------------------------- inner mode (inside the scope)
if [ "${HERMES_WEB_INNER:-0}" = 1 ]; then
  t() { echo "--- [$(date +%T)] $*"; }
  export CI=1 EXPO_NO_TELEMETRY=1 NODE_OPTIONS="--max-old-space-size=3072"
  cd "$BUILD_DIR/app"
  LOCK_HASH="$(sha256sum package-lock.json | cut -d' ' -f1)"
  if [ -f node_modules/.lock-hash ] && [ "$LOCK_HASH" = "$(cat node_modules/.lock-hash)" ]; then
    t "node_modules up to date"
  elif [ "${NPM_CI:-0}" != 1 ] && [ -d "$ROOT/app/node_modules" ] && cmp -s package-lock.json "$ROOT/app/package-lock.json"; then
    t "hard-link copy of app/node_modules (same package-lock.json)"
    rm -rf node_modules
    # "/." follows a symlinked app/node_modules (worktrees / public export sharing the main install)
    if ! { mkdir node_modules && cp -al "$ROOT/app/node_modules/." node_modules/; } 2>/dev/null; then
      t "hard links not possible (other filesystem?) → npm ci"
      rm -rf node_modules
      npm ci --no-audit --no-fund
    fi
    echo "$LOCK_HASH" > node_modules/.lock-hash
  else
    t "npm ci"
    rm -rf node_modules
    npm ci --no-audit --no-fund
    echo "$LOCK_HASH" > node_modules/.lock-hash
  fi
  t "expo export -p web (max-workers=$MAX_WORKERS)"
  rm -rf dist-web
  nice -n 10 npx expo export -p web --output-dir dist-web --max-workers "$MAX_WORKERS" --clear
  # brand icon BEFORE finalize: the service-worker cache version hashes the final icons (scripts/web-finalize.mjs)
  if [ -n "${BRAND_ICON_FILE:-}" ]; then
    t "brand icon $BRAND_ICON_FILE"
    BRAND_BG="${BRAND_BG:-white}" "$ROOT/scripts/web-brand.sh" "$BRAND_ICON_FILE" dist-web
  fi
  t "PWA finalize"
  node "$ROOT/scripts/web-finalize.mjs" dist-web
  t "precompress (.br / .gz siblings for js/css/html/json/svg/webmanifest > 1 KB)"
  node "$ROOT/scripts/web-precompress.mjs" dist-web
  exit 0
fi

# ---------------------------------------------------------------- outer mode
BRAND=""
while [ $# -gt 0 ]; do
  case "$1" in
    --brand) BRAND="${2:?--brand needs a file}"; shift 2 ;;
    -h|--help) sed -n '2,/^set -E/p' "$0" | sed '$d'; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
if [ -n "$BRAND" ]; then  # brand values must win over personal.env → load them before flavor_init
  [ "${FLAVOR:-${EXPO_PUBLIC_FLAVOR:-hermes}}" = personal ] || { echo "--brand is for FLAVOR=personal builds only"; exit 2; }
  [ -f "$BRAND" ] || { echo "brand file not found: $BRAND"; exit 2; }
  _flavor_load_env "$BRAND"
fi
flavor_init
if [ "$FLAVOR" = personal ]; then DEFAULT_OUT="$ROOT/dist/web-personal"; else DEFAULT_OUT="$ROOT/dist/web"; fi
WEB_OUT="${WEB_OUT:-$DEFAULT_OUT}"
if [ "$FLAVOR" != personal ]; then
  export EXPO_PUBLIC_APP_NAME="${EXPO_PUBLIC_APP_NAME:-$BRAND_NAME}" EXPO_PUBLIC_APP_SHORT_NAME="${EXPO_PUBLIC_APP_SHORT_NAME:-$BRAND_SHORT_NAME}"
  export WEB_DESCRIPTION="${WEB_DESCRIPTION:-$BRAND_TAGLINE}"
  # browser chrome / PWA splash in the Standard theme's backgrounds (identity.json colors.paper / colors.ink)
  export EXPO_PUBLIC_THEME_COLOR="${EXPO_PUBLIC_THEME_COLOR:-$BRAND_PAPER}" EXPO_PUBLIC_THEME_COLOR_DARK="${EXPO_PUBLIC_THEME_COLOR_DARK:-$BRAND_INK}"
elif [ -z "${BRAND_ICON:-}" ]; then
  # personal without --brand: keep the personal icon instead of the official web icons in app/public/icons
  _pi="$(node -p "try{require(process.argv[1]).icon||''}catch{''}" "$HUI_PRIVATE_DIR/app/identity.json")"
  [ -z "$_pi" ] || BRAND_ICON="app/$_pi"
fi
mkdir -p "$ROOT/dist" "$BUILD_DIR" "$HOME/builds"
TS="$(date +%Y%m%d-%H%M%S)"
LOG="$ROOT/dist/build-web-$TS.log"
exec > >(tee -a "$LOG") 2>&1
trap 'echo "WEB BUILD FAILED (line $LINENO). Log: $LOG" >&2' ERR
T0=$SECONDS

exec 9>"$HOME/builds/.hermes-web-build.lock"
flock -n 9 || { echo "another web build is running ($HOME/builds/.hermes-web-build.lock)"; exit 1; }

AVAIL_KB="$(awk '/^MemAvailable:/{print $2}' /proc/meminfo)"
echo "MemAvailable: $((AVAIL_KB/1024)) MB (need >= $((MIN_AVAIL_GB*1024)) MB)"
if [ "$AVAIL_KB" -lt $((MIN_AVAIL_GB*1024*1024)) ]; then
  echo "REFUSING TO BUILD: not enough free memory (lower MIN_AVAIL_GB deliberately if you must)."
  exit 1
fi
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=/run/user/$(id -u)/bus}"
systemd-run --user --scope -q -p MemoryMax=64M true 2>/dev/null \
  || { echo "systemd-run --user --scope not usable; refusing to build without memory limits"; exit 1; }

echo "=== rsync app/ -> $BUILD_DIR/app (clean copy)"
mkdir -p "$BUILD_DIR/app"
rsync -a --delete \
  --exclude node_modules --exclude /.expo/ --exclude /android/ --exclude /ios/ --exclude /dist/ --exclude /dist-web/ \
  --exclude /refs/ --exclude '*.keystore' --exclude '*.jks' --exclude .env --exclude '.env.*' \
  "$ROOT/app/" "$BUILD_DIR/app/"
flavor_guard_tree "$BUILD_DIR/app" --no-expo-config   # web export does not use the native identity

BRAND_ICON_FILE=""
if [ -n "${BRAND_ICON:-}" ]; then
  case "$BRAND_ICON" in /*) BRAND_ICON_FILE="$BRAND_ICON" ;; *) BRAND_ICON_FILE="$HUI_PRIVATE_DIR/$BRAND_ICON" ;; esac
  [ -f "$BRAND_ICON_FILE" ] || { echo "brand icon not found: $BRAND_ICON_FILE"; exit 2; }
fi

heavy_slice_init   # shared aggregate cap with APK builds / checks (scripts/lib/heavy.sh)
UNIT="hermes-web-build-$TS"
STAGE="$WEB_OUT.staging-$TS"
# stop the scope (and any orphaned Metro workers) and drop the staging copy on every exit, also on Ctrl-C
trap 'systemctl --user stop "$UNIT.scope" 2>/dev/null || true; rm -rf "$STAGE"' EXIT
echo "=== expo export in scope $UNIT (MemoryMax=$MEM_MAX MemorySwapMax=0 CPUQuota=$CPU_QUOTA)"
rc=0
HERMES_WEB_INNER=1 BUILD_DIR="$BUILD_DIR" MAX_WORKERS="$MAX_WORKERS" BRAND_ICON_FILE="$BRAND_ICON_FILE" \
systemd-run --user --scope --quiet --unit="$UNIT" "${HEAVY_SLICE[@]}" \
  -p MemoryMax="$MEM_MAX" -p MemorySwapMax=0 -p CPUQuota="$CPU_QUOTA" \
  bash "$ROOT/scripts/build-web.sh" || rc=$?
PEAK="$(systemctl --user show "$UNIT.scope" -p MemoryPeak --value 2>/dev/null || true)"
systemctl --user stop "$UNIT.scope" 2>/dev/null || true
if [ "$rc" -ne 0 ]; then
  [ "$rc" = 137 ] && echo "Exit 137: SIGKILL – likely OOM-killed by MemoryMax=$MEM_MAX (try MAX_WORKERS=1)."
  echo "WEB BUILD FAILED (exit $rc). Log: $LOG"
  exit "$rc"
fi

if ! flavor_guard_output "$BUILD_DIR/app/dist-web"; then
  echo "WEB BUILD REJECTED: the hermes bundle contains private content (see above); $WEB_OUT left unchanged."
  exit 1
fi
# promote via a staging copy: the gate scans exactly what gets served, $WEB_OUT is replaced only after it passed
rm -rf "$STAGE"
cp -a "$BUILD_DIR/app/dist-web" "$STAGE"
if ! release_gate "$STAGE"; then
  echo "WEB BUILD REJECTED by the release gate (scripts/scan-artifact.sh); $WEB_OUT left unchanged."
  exit 1
fi
rm -rf "$WEB_OUT.old-$TS"
[ ! -e "$WEB_OUT" ] || mv "$WEB_OUT" "$WEB_OUT.old-$TS"
mv "$STAGE" "$WEB_OUT"
rm -rf "$WEB_OUT.old-$TS"
# provenance next to (not inside) the bundle: scripts/build-desktop-mac.sh SKIP_WEB=1 refuses a bundle of another flavor
printf 'flavor=%s\nsw=%s\nsha=%s\nbuilt=%s\n' "$FLAVOR" "${WEB_SW:-1}" \
  "$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo nogit)" "$TS" > "$WEB_OUT.build-info"
echo "Web app ($FLAVOR): $WEB_OUT ($(du -sh "$WEB_OUT" | cut -f1))"
case "$PEAK" in ''|*[!0-9]*) ;; *) echo "Peak scope memory: $((PEAK/1048576)) MB (limit $MEM_MAX)";; esac
echo "Web build OK in $((SECONDS-T0))s (log: $LOG)"
