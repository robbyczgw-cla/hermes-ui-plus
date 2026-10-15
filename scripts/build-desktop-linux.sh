#!/usr/bin/env bash
# Build the Hermes Linux desktop app (Tauri v2, desktop/) as AppImage + .deb (x86_64) on a Linux build host over
# ssh and publish it under dist/share/desktop-linux/ (personal) or dist/share/desktop-linux-plus/ (hermes).
#
# Usage: [FLAVOR=hermes|personal] [HUI_PRIVATE_DIR=…] scripts/build-desktop-linux.sh   (docs/BUILD.md "Flavors")
# Output: dist/share/desktop-linux[-plus]/{<artifact>_<ver>_x86_64.AppImage,<artifact>_<ver>_amd64.deb,index.html,
#         icon-256.png,build.txt}
#         hermes: name/id from app/brand/identity.json ("Hermes UI+", xyz.hermesui.desktop), files/binary hermes-ui-plus;
#         personal: desktopName/desktopId of $HUI_PRIVATE_DIR/app/identity.json, else "Hermes" / io.hermesiui.desktop,
#         files/binary hermes
#         dist/build-desktop-linux-<timestamp>.log
#
# Flow (runs on the build machine, mirrors scripts/build-desktop-mac.sh):
#   1. web bundle: scripts/build-web.sh (memory-capped, own flock; waits while another web build runs) with FLAVOR,
#      WEB_SW=0 (no service worker: WebKitGTK on tauri:// has none) and WEB_OUT=dist/web-desktop-linux (not the mac
#      script's dir, so both can run on the same evening); EXPO_PUBLIC_* of the calling shell are unset. A hermes
#      build fails if private content would ship. SKIP_WEB=1 reuses an existing dist/web-desktop-linux. Built or
#      reused, its JS must carry the flavor mark of FLAVOR (scripts/verify-flavor-artifact.mjs) before it is uploaded.
#   2. rsync desktop/ (no node_modules/target/gen) + the web bundle -> $LINUX_HOST:~/$REMOTE_DIR/desktop{,/dist-web}
#   3. on the Linux host: waits while an Android emulator runs there; memory-capped (MemoryMax=$MEM_MAX, no swap,
#      CARGO_BUILD_JOBS=$JOBS): npm ci (@tauri-apps/cli, npm cache inside the build dir), `tauri build --bundles
#      appimage,deb` (x86_64). Tauri's tool downloads (linuxdeploy) go to the build dir too (XDG_CACHE_HOME);
#      RUSTFLAGS remap home paths out of the binary. Two ways to run the build (LINUX_BUILD_IMAGE):
#        container (default when docker works for the ssh user): inside an Ubuntu 22.04 image
#                  (scripts/docker/desktop-linux-build.Dockerfile, built once and kept), unprivileged uid, only the
#                  build dir mounted, `docker run --memory`. The binary and the bundled libraries then need glibc
#                  <= 2.35, i.e. the AppImage / .deb run on Ubuntu 22.04+ / Debian 12+.
#        host      directly on the host inside a `systemd-run --user --scope` (fallback): the glibc of the host
#                  (e.g. 2.43 on Ubuntu 26.04) becomes the minimum of the result.
#   4. copy back AppImage + .deb + build.txt, download page, release gate (hermes), atomic publish; clean up remotely
#
# Build host (user-space, no sudo): container mode: docker (daemon reachable for the ssh user), dpkg-deb, objdump;
# host mode: rustup/cargo in ~/.cargo (stable), node + npm, the Tauri Linux dev packages (libwebkit2gtk-4.1-dev,
# librsvg2-dev, libayatana-appindicator3-dev, build-essential), file, dpkg-deb, systemd-run.
# Build machine: unsquashfs + dpkg-deb (release gate of the hermes flavor).
#
# Env (defaults in brackets):
#   FLAVOR [hermes]                 web bundle flavor (scripts/lib/flavor.sh)
#   LINUX_HOST [build.env]          ssh host (BatchMode), required (env or $HUI_PRIVATE_DIR/build.env)
#   REMOTE_DIR [builds/hermes-desktop-linux]  build dir on the host, relative to ~
#   SKIP_WEB=1                      do not rebuild the web bundle (use dist/web-desktop-linux as is)
#   KEEP_CACHE=1                    keep the build dir (src-tauri/target, node_modules, tauri tool cache) on the host;
#                                   default: ~/$REMOTE_DIR is removed after the build (the cargo registry in ~/.cargo stays)
#   LINUX_BUILD_IMAGE [auto]        auto: ubuntu:22.04 container when docker works on the host, else host build;
#                                   an image name (e.g. ubuntu:22.04, debian:12): container with that base (the
#                                   build fails if docker is unusable); host: build directly on the host
#   LINUX_IMAGE_REFRESH=1           rebuild the build image (docker build --pull --no-cache: current apt packages / Node 22.x)
#   LINUX_RUST_VERSION [Dockerfile] Rust version of the container image (pinned in the Dockerfile: 1.97.1)
#   MEM_MAX [8G]  JOBS [6]          memory cap of the remote scope or container / cargo parallelism
#   MIN_FREE_GB [8]                 refuse to start below this much free disk on the host
#   EMU_WAIT_MIN [90]               max. minutes to wait for a running Android emulator (qemu) on the host to end
#   PUBLIC_BASE [$DESKTOP_PUBLIC_BASE with /desktop -> /desktop-linux]  URL of the published dir (download page link)
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib/flavor.sh
. "$ROOT/scripts/lib/flavor.sh"
FLAVOR="${FLAVOR:-${EXPO_PUBLIC_FLAVOR:-hermes}}"
case "$FLAVOR" in hermes|personal) ;; *) echo "FLAVOR must be hermes or personal (got '$FLAVOR')" >&2; exit 2 ;; esac
HUI_PRIVATE_DIR="${HUI_PRIVATE_DIR:-$HOME/work/hermesiui-private}"
case "$HUI_PRIVATE_DIR" in "~/"*) HUI_PRIVATE_DIR="$HOME/${HUI_PRIVATE_DIR#\~/}" ;; esac
export FLAVOR HUI_PRIVATE_DIR
flavor_load_build_env
if [ "$FLAVOR" = personal ]; then
  _pid() { node -p "try{require(process.argv[1])[process.argv[2]]||''}catch{''}" "$HUI_PRIVATE_DIR/app/identity.json" "$1"; }
  DESKTOP_NAME="$(_pid desktopName)"; DESKTOP_NAME="${DESKTOP_NAME:-Hermes}"
  DESKTOP_ID="$(_pid desktopId)"; DESKTOP_ID="${DESKTOP_ID:-io.hermesiui.desktop}"; ART="hermes"
else
  DESKTOP_NAME="$BRAND_SHORT_NAME"; DESKTOP_ID="$BRAND_DESKTOP_ID"; ART="$BRAND_ARTIFACT"
fi
LINUX_HOST="${LINUX_HOST:-}"
[ -n "$LINUX_HOST" ] || { echo "LINUX_HOST is not set (env or \$HUI_PRIVATE_DIR/build.env)"; exit 2; }
REMOTE_DIR="${REMOTE_DIR:-builds/hermes-desktop-linux}"
# REMOTE_DIR is interpolated into remote shell commands and `rm -rf` targets: a plain relative path below ~ only
if ! [[ "$REMOTE_DIR" =~ ^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$ ]] || [[ "/$REMOTE_DIR/" == */../* || "/$REMOTE_DIR/" == */./* ]]; then
  echo "REMOTE_DIR must be a relative path below ~ of [A-Za-z0-9._-] segments (got '$REMOTE_DIR')" >&2; exit 2
fi
# names end up in the Tauri config (JSON via node), the remote env (printf %q), file names and the download page
[[ "$DESKTOP_ID" =~ ^[A-Za-z0-9.-]+$ ]] || { echo "invalid desktop id '$DESKTOP_ID'" >&2; exit 2; }
[[ "$ART" =~ ^[a-z0-9][a-z0-9-]*$ ]] || { echo "invalid artifact/binary name '$ART'" >&2; exit 2; }
case "$DESKTOP_NAME" in ''|*/*|*$'\n'*) echo "invalid desktop name" >&2; exit 2 ;; esac
html_esc() { sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g' -e "s/'/\&#39;/g" <<<"$1"; }
SKIP_WEB="${SKIP_WEB:-0}"; KEEP_CACHE="${KEEP_CACHE:-0}"; MIN_FREE_GB="${MIN_FREE_GB:-8}"; EMU_WAIT_MIN="${EMU_WAIT_MIN:-90}"
MEM_MAX="${MEM_MAX:-8G}"; JOBS="${JOBS:-6}"
LINUX_BUILD_IMAGE="${LINUX_BUILD_IMAGE:-auto}"; LINUX_IMAGE_REFRESH="${LINUX_IMAGE_REFRESH:-0}"
[[ "$LINUX_BUILD_IMAGE" =~ ^(auto|host|[a-z0-9][A-Za-z0-9._/-]*(:[A-Za-z0-9._-]+)?)$ ]] || { echo "invalid LINUX_BUILD_IMAGE '$LINUX_BUILD_IMAGE'" >&2; exit 2; }
LINUX_RUST_VERSION="${LINUX_RUST_VERSION:-}"
[[ -z "$LINUX_RUST_VERSION" || "$LINUX_RUST_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "invalid LINUX_RUST_VERSION '$LINUX_RUST_VERSION'" >&2; exit 2; }
[[ "$LINUX_IMAGE_REFRESH" =~ ^[01]$ ]] || { echo "LINUX_IMAGE_REFRESH must be 0 or 1" >&2; exit 2; }
[[ "$MEM_MAX" =~ ^[0-9]+[KMG]$ ]] || { echo "invalid MEM_MAX '$MEM_MAX'" >&2; exit 2; }
[[ "$JOBS" =~ ^[1-9][0-9]*$ && "$MIN_FREE_GB" =~ ^[0-9]+$ && "$EMU_WAIT_MIN" =~ ^[0-9]+$ ]] || { echo "JOBS/MIN_FREE_GB/EMU_WAIT_MIN must be numbers" >&2; exit 2; }
PUBLIC_BASE="${PUBLIC_BASE:-}"
if [ -z "$PUBLIC_BASE" ] && [ -n "${DESKTOP_PUBLIC_BASE:-}" ]; then PUBLIC_BASE="${DESKTOP_PUBLIC_BASE%/}"; PUBLIC_BASE="${PUBLIC_BASE%/desktop}/desktop-linux"; fi
[ -n "$PUBLIC_BASE" ] || { echo "PUBLIC_BASE is not set (env or DESKTOP_PUBLIC_BASE in \$HUI_PRIVATE_DIR/build.env)"; exit 2; }
WEB_OUT="$ROOT/dist/web-desktop-linux"
# both flavors are served side by side: personal in desktop-linux/, hermes in desktop-linux-plus/
OUT="$ROOT/dist/share/desktop-linux"
if [ "$FLAVOR" = hermes ]; then OUT="$ROOT/dist/share/desktop-linux-plus"; PUBLIC_BASE="${PUBLIC_BASE%/}-plus"; fi
SSH=(ssh -o BatchMode=yes "$LINUX_HOST")

mkdir -p "$ROOT/dist" "$HOME/builds"
TS="$(date +%Y%m%d-%H%M%S)"
LOG="$ROOT/dist/build-desktop-linux-$TS.log"
exec > >(tee -a "$LOG") 2>&1
trap 'echo "DESKTOP LINUX BUILD FAILED (line $LINENO). Log: $LOG" >&2' ERR
T0=$SECONDS
t() { echo "--- [$(date +%T)] $*"; }

# own lock: a mac desktop build (other host, other web output dir) may run at the same time
exec 9>"$HOME/builds/.hermes-desktop-linux-build.lock"
flock -n 9 || { echo "another Linux desktop build is running ($HOME/builds/.hermes-desktop-linux-build.lock)"; exit 1; }

SHA="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo nogit)"
[ -z "$(git -C "$ROOT" status --porcelain -- app desktop 2>/dev/null)" ] || SHA="$SHA-dirty"

# ---------------------------------------------------------------- 1. web bundle (the build machine, memory-capped)
if [ "$SKIP_WEB" != 1 ]; then
  # build-web.sh refuses (flock -n) while another web build runs: wait for its lock to be free first
  WEB_LOCK="$HOME/builds/.hermes-web-build.lock"
  if [ -e "$WEB_LOCK" ] && ! flock -n "$WEB_LOCK" true; then
    t "another web build is running, waiting (max 60 min)"
    flock -w 3600 "$WEB_LOCK" true || { echo "web build lock still busy after 60 min"; exit 1; }
  fi
  t "web bundle (scripts/build-web.sh, FLAVOR=$FLAVOR, WEB_SW=0) -> $WEB_OUT"
  unset_public=(); while IFS= read -r v; do unset_public+=(-u "$v"); done < <(env | sed -n 's/^\(EXPO_PUBLIC_[A-Za-z0-9_]*\)=.*/\1/p')
  rc=0
  env "${unset_public[@]}" FLAVOR="$FLAVOR" HUI_PRIVATE_DIR="$HUI_PRIVATE_DIR" WEB_SW=0 WEB_OUT="$WEB_OUT" "$ROOT/scripts/build-web.sh" || rc=$?
  [ "$rc" -eq 0 ] || { echo "web bundle build failed (exit $rc)"; exit "$rc"; }
fi
[ -f "$WEB_OUT/index.html" ] || { echo "no web bundle in $WEB_OUT (run without SKIP_WEB=1)"; exit 1; }
if grep -q 'data-pwa="sw"' "$WEB_OUT/index.html"; then echo "web bundle registers a service worker (built without WEB_SW=0?)"; exit 1; fi
# provenance (written by scripts/build-web.sh): a reused bundle must be of THIS flavor, built with WEB_SW=0
WEB_FLAVOR="$(sed -n 's/^flavor=//p' "$WEB_OUT.build-info" 2>/dev/null || true)"
WEB_SWV="$(sed -n 's/^sw=//p' "$WEB_OUT.build-info" 2>/dev/null || true)"
if [ "$WEB_FLAVOR" != "$FLAVOR" ] || [ "$WEB_SWV" != 0 ]; then
  echo "web bundle $WEB_OUT is flavor='${WEB_FLAVOR:-unknown}' sw='${WEB_SWV:-?}' (need $FLAVOR, sw=0): rebuild without SKIP_WEB=1"; exit 1
fi
# the JS that gets embedded must be this flavor's (app/src/flavor.ts FLAVOR_MARK), also for a reused bundle
flavor_verify_artifact "$WEB_OUT" || { echo "web bundle $WEB_OUT does not carry the FLAVOR=$FLAVOR mark: rebuild without SKIP_WEB=1"; exit 1; }
# hermes: guard the bundle as it is now (also when reused), not only when it was built
if [ "$FLAVOR" = hermes ]; then flavor_guard_output "$WEB_OUT" || { echo "web bundle contains private content"; exit 1; }; fi
echo "web bundle: $(du -sh "$WEB_OUT" | cut -f1)"

# ---------------------------------------------------------------- 2. sync to the Linux host
# local staging copy of exactly what is sent: guarded (hermes) before it leaves this machine
SRC_STAGE="$(mktemp -d "${TMPDIR:-/tmp}/hui-desktop-linux-src.XXXXXX")"
OUT_STAGE="$OUT.staging-$TS"
trap 'rm -rf "$SRC_STAGE" "$OUT_STAGE"' EXIT
rsync -a --delete \
  --exclude node_modules --exclude /dist-web/ --exclude src-tauri/target/ --exclude src-tauri/gen/ \
  --exclude '.env*' --exclude '*.p8' --exclude '*.p12' --exclude '*.key' --exclude '*.pem' \
  "$ROOT/desktop/" "$SRC_STAGE/"
if [ "$FLAVOR" = hermes ]; then
  t "flavor guard (desktop sources)"
  flavor_guard_tree "$SRC_STAGE" --no-expo-config
  flavor_guard_output "$SRC_STAGE"   # Rust/config/icons: overlay content, private terms, generic patterns
fi
t "rsync desktop/ + web bundle -> $LINUX_HOST:~/$REMOTE_DIR/desktop"
"${SSH[@]}" "mkdir -p ~/$REMOTE_DIR/desktop"
rsync -a --delete "$SRC_STAGE/" "$LINUX_HOST:$REMOTE_DIR/desktop/"
rsync -a --delete "$WEB_OUT/" "$LINUX_HOST:$REMOTE_DIR/desktop/dist-web/"
# build context of the container image (a single Dockerfile, no private content)
"${SSH[@]}" "mkdir -p ~/$REMOTE_DIR/image"
rsync -a "$ROOT/scripts/docker/desktop-linux-build.Dockerfile" "$LINUX_HOST:$REMOTE_DIR/image/Dockerfile"

# ---------------------------------------------------------------- 3. remote build
t "remote build on $LINUX_HOST"
# every value shell-quoted for the remote shell (a name with an apostrophe or spaces must not break / inject)
printf -v REMOTE_ENV '%q=%q ' REMOTE_DIR "$REMOTE_DIR" KEEP_CACHE "$KEEP_CACHE" MIN_FREE_GB "$MIN_FREE_GB" \
  EMU_WAIT_MIN "$EMU_WAIT_MIN" MEM_MAX "$MEM_MAX" JOBS "$JOBS" SHA "$SHA" DESKTOP_NAME "$DESKTOP_NAME" \
  DESKTOP_ID "$DESKTOP_ID" ART "$ART" LINUX_BUILD_IMAGE "$LINUX_BUILD_IMAGE" LINUX_IMAGE_REFRESH "$LINUX_IMAGE_REFRESH" \
  LINUX_RUST_VERSION "$LINUX_RUST_VERSION"
# the script is read from stdin (`bash -s`), so no remote process command line contains "qemu-system"
"${SSH[@]}" "${REMOTE_ENV}/bin/bash -s" <<'REMOTE'
set -Eeuo pipefail
t() { echo "--- [linux $(date +%T)] $*"; }
export PATH="$HOME/.cargo/bin:/usr/local/bin:/usr/bin:/bin"
export CI=true NO_COLOR=1 CARGO_TERM_COLOR=never
B="$HOME/$REMOTE_DIR"; D="$B/desktop"; PUB="$B/out"
export npm_config_cache="$B/.npm-cache"   # never touch the user's ~/.npm
export XDG_CACHE_HOME="$B/.cache"         # tauri-bundler's linuxdeploy/AppRun downloads (else ~/.cache/tauri)
export APPIMAGE_EXTRACT_AND_RUN=1         # linuxdeploy (itself an AppImage) without FUSE mounts …
export TMPDIR="$B/tmp"                    # … extracted below TMPDIR (else /tmp/appimage_extracted_*, never removed)
mkdir -p "$TMPDIR"
export NO_STRIP=true                      # linuxdeploy's bundled strip is too old for current .relr.dyn sections
export CARGO_BUILD_JOBS="$JOBS"
free_gb() { df -BG --output=avail "$HOME" | tail -1 | tr -dc 0-9; }
cleanup() {
  t "cleanup (KEEP_CACHE=$KEEP_CACHE)"
  rm -rf "$npm_config_cache" "$TMPDIR" "$B/image"
  # default: nothing stays on the host but out/ (fetched and removed by the caller); the sources are re-synced anyway
  if [ "$KEEP_CACHE" != 1 ]; then rm -rf "$D" "$XDG_CACHE_HOME" "$B/home" "$B/.cargo-home"; fi
  echo "disk free after: $(free_gb) GB"
}
trap cleanup EXIT

echo "disk free before: $(free_gb) GB (need >= $MIN_FREE_GB GB)"
[ "$(free_gb)" -ge "$MIN_FREE_GB" ] || { echo "REFUSING TO BUILD: not enough free disk on the build host"; exit 1; }
# never build next to a running Android emulator on this host (memory)
waited=0
while pgrep -f '^[^ ]*qemu-system' >/dev/null; do
  [ "$waited" -lt "$EMU_WAIT_MIN" ] || { echo "an Android emulator is still running after $EMU_WAIT_MIN min, giving up"; exit 1; }
  [ "$waited" -gt 0 ] || t "Android emulator running, waiting (max $EMU_WAIT_MIN min)"
  sleep 60; waited=$((waited+1))
done

# ---- build mode: container (old glibc) or the host itself
MODE=host; IMAGE=""
if [ "$LINUX_BUILD_IMAGE" != host ]; then
  IMAGE="$LINUX_BUILD_IMAGE"; [ "$IMAGE" != auto ] || IMAGE="ubuntu:22.04"
  if command -v docker >/dev/null && docker info >/dev/null 2>&1; then MODE=container
  elif [ "$LINUX_BUILD_IMAGE" = auto ]; then echo "docker is not usable for this user on the build host: building on the host itself (glibc of the host!)"
  else echo "LINUX_BUILD_IMAGE=$LINUX_BUILD_IMAGE needs a working docker for the ssh user on the build host"; exit 1; fi
fi
echo "build mode: $MODE${IMAGE:+ (base image $IMAGE)}"

# the Tauri config override is built where node runs (container or host) from this environment
# shellcheck disable=SC2016
INNER='set -Eeuo pipefail
TAURI_CFG="$(node -e '"'"'console.log(JSON.stringify({productName: process.env.DESKTOP_NAME, identifier: process.env.DESKTOP_ID, mainBinaryName: process.env.ART}))'"'"')"
echo "app: $DESKTOP_NAME ($DESKTOP_ID), binary $ART"
if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi
npx tauri build --bundles appimage,deb --config "$TAURI_CFG"'
export DESKTOP_NAME DESKTOP_ID ART

if [ "$MODE" = container ]; then
  # Toolchain image: one tag per base image + Dockerfile content, built once and reused (docker layer cache).
  # Container: unprivileged host uid, no capabilities, only the build dir (+ the cargo download cache) mounted,
  # memory capped by docker (swap = memory limit, i.e. none), the same CARGO_BUILD_JOBS.
  DFHASH="$(sha256sum "$B/image/Dockerfile" | cut -c1-10)"
  TAG="hermes-desktop-build:$(printf '%s' "$IMAGE" | tr -c 'A-Za-z0-9_.-' '-')-$DFHASH${LINUX_RUST_VERSION:+-rust$LINUX_RUST_VERSION}"
  if [ "$LINUX_IMAGE_REFRESH" = 1 ] || ! docker image inspect "$TAG" >/dev/null 2>&1; then
    t "docker build $TAG (base $IMAGE; toolchain: apt dev packages, node 22, rust stable)"
    extra=(); [ "$LINUX_IMAGE_REFRESH" != 1 ] || extra=(--pull --no-cache)
    [ -z "${LINUX_RUST_VERSION:-}" ] || extra+=(--build-arg "RUST_VERSION=$LINUX_RUST_VERSION")
    docker build "${extra[@]}" --memory "$MEM_MAX" --memory-swap "$MEM_MAX" --build-arg "BASE=$IMAGE" -t "$TAG" "$B/image"
  fi
  echo "image: $TAG"
  mkdir -p "$B/home" "$B/.cargo-home/registry" "$B/.cargo-home/git" "$B/tmp" "$HOME/.cargo/registry" "$HOME/.cargo/git"
  # the build dir is mounted at the SAME absolute path as on the host (cargo derives the crate ids / symbol hashes of
  # the app crate from its path, so the binary equals a host build of the same sources); the paths are remapped out
  # of the shipped binary below
  CRUN=(docker run --rm --user "$(id -u):$(id -g)" --cap-drop ALL --security-opt no-new-privileges
    --memory "$MEM_MAX" --memory-swap "$MEM_MAX"
    -v "$B:$B" -v "$HOME/.cargo/registry:$B/.cargo-home/registry" -v "$HOME/.cargo/git:$B/.cargo-home/git"
    -e "HOME=$B/home" -e "CARGO_HOME=$B/.cargo-home" -e "npm_config_cache=$B/.npm-cache"
    -e "XDG_CACHE_HOME=$B/.cache" -e "TMPDIR=$TMPDIR" -e APPIMAGE_EXTRACT_AND_RUN=1 -e NO_STRIP=true
    -e CI=true -e NO_COLOR=1 -e CARGO_TERM_COLOR=never -e "CARGO_BUILD_JOBS=$JOBS"
    -e DESKTOP_NAME -e DESKTOP_ID -e ART
    -e "RUSTFLAGS=--remap-path-prefix=$B=/build --remap-path-prefix=$B/.cargo-home=/cargo --remap-path-prefix=/opt/rustup=/rustup"
    -w "$D")
  BUILT_ON="$("${CRUN[@]}" "$TAG" bash -c '. /etc/os-release; echo "$PRETTY_NAME (container), webkit2gtk $(pkg-config --modversion webkit2gtk-4.1), glibc $(ldd --version | head -1 | awk "{print \$NF}"), $(rustc -V | cut -d" " -f1-2), node $(node -v)"')"
  echo "toolchain: $BUILT_ON"
  t "npm ci + tauri build (x86_64, appimage + deb) in the container: --memory $MEM_MAX, no swap, $JOBS jobs"
  "${CRUN[@]}" "$TAG" bash -c "$INNER"
else
  command -v cargo >/dev/null && command -v node >/dev/null || { echo "toolchain missing (~/.cargo/bin/cargo, node)"; exit 1; }
  pkg-config --exists webkit2gtk-4.1 || { echo "libwebkit2gtk-4.1-dev missing on the build host"; exit 1; }
  command -v systemd-run >/dev/null || { echo "systemd-run missing (needed for the memory cap)"; exit 1; }
  BUILT_ON="$(. /etc/os-release && echo "$PRETTY_NAME"), webkit2gtk $(pkg-config --modversion webkit2gtk-4.1), glibc $(ldd --version | head -1 | awk '{print $NF}'), $(rustc -V | cut -d' ' -f1-2), node $(node -v)"
  echo "toolchain: $BUILT_ON"
  # no /home/<name>/… paths (cargo registry, build dir) in panic strings / debug info of the shipped binary
  # (rustc applies the LAST matching --remap-path-prefix, so the most specific prefixes come last)
  export RUSTFLAGS="${RUSTFLAGS:-} --remap-path-prefix=$HOME=/home --remap-path-prefix=$HOME/.cargo=/cargo --remap-path-prefix=$HOME/.rustup=/rustup --remap-path-prefix=$B=/build"
  t "npm ci + tauri build (x86_64, appimage + deb) in a scope: MemoryMax=$MEM_MAX, no swap, $JOBS jobs"
  # a scope runs the command as a child of this shell: it inherits the environment (RUSTFLAGS, caches)
  (cd "$D" && systemd-run --user --scope --quiet -p MemoryMax="$MEM_MAX" -p MemorySwapMax=0 /bin/bash -c "$INNER")
fi
cd "$D"

BUNDLE="src-tauri/target/release/bundle"
AI="$(ls "$BUNDLE"/appimage/*.AppImage | head -1)"; DEB="$(ls "$BUNDLE"/deb/*.deb | head -1)"
[ -f "$AI" ] && [ -f "$DEB" ] || { echo "bundle output missing"; exit 1; }
BIN="src-tauri/target/release/$ART"; [ -f "$BIN" ] || BIN="src-tauri/target/release/hermes-ui-desktop"
VER="$(dpkg-deb -f "$DEB" Version)"
GLIBC_REQ="$(objdump -T "$BIN" | grep -o 'GLIBC_[0-9][0-9.]*' | sed 's/^GLIBC_//' | sort -V | tail -1)"
[ -n "$GLIBC_REQ" ] || { echo "cannot determine the glibc requirement of $BIN (objdump)"; exit 1; }
t "glibc requirement of the binary: >= $GLIBC_REQ"
rm -rf "$PUB"; mkdir -p "$PUB"
cp "$AI" "$PUB/${ART}_${VER}_x86_64.AppImage"; chmod 755 "$PUB/${ART}_${VER}_x86_64.AppImage"
cp "$DEB" "$PUB/${ART}_${VER}_amd64.deb"
cp src-tauri/icons/128x128@2x.png "$PUB/icon-256.png"
{
  echo "bundle id:  $DESKTOP_ID  version $VER  build $SHA"
  echo "arch:       $(file -b "$BIN" | cut -d, -f1-2)"
  echo "binary:     $(du -h "$BIN" | cut -f1)"
  echo "appimage:   ${ART}_${VER}_x86_64.AppImage $(du -h "$AI" | cut -f1)"
  echo "deb:        ${ART}_${VER}_amd64.deb $(du -h "$DEB" | cut -f1)  package $(dpkg-deb -f "$DEB" Package)"
  echo "deb deps:   $(dpkg-deb -f "$DEB" Depends)"
  echo "built on:   $BUILT_ON"
  echo "needs:      glibc >= $GLIBC_REQ (highest GLIBC_ symbol version the binary imports)"
} | tee "$PUB/build.txt"
REMOTE

# ---------------------------------------------------------------- 4. copy back + download page
# Everything is assembled in a staging dir, gated, and only then replaces the served $OUT.
t "copy back -> $OUT_STAGE"
rm -rf "$OUT_STAGE"; mkdir -p "$OUT_STAGE"
rsync -a "$LINUX_HOST:$REMOTE_DIR/out/" "$OUT_STAGE/"
"${SSH[@]}" "rm -rf ~/$REMOTE_DIR/out; rmdir ~/$REMOTE_DIR 2>/dev/null || true"
AI="$(cd "$OUT_STAGE" && ls -- *.AppImage | head -1)"; DEB="$(cd "$OUT_STAGE" && ls -- *.deb | head -1)"
[ -n "$AI" ] && [ -n "$DEB" ] || { echo "build output incomplete (AppImage/deb missing)"; exit 1; }
AI_SIZE="$(du -h "$OUT_STAGE/$AI" | cut -f1)"; DEB_SIZE="$(du -h "$OUT_STAGE/$DEB" | cut -f1)"
H_NAME="$(html_esc "$DESKTOP_NAME")"; H_AI="$(html_esc "$AI")"; H_DEB="$(html_esc "$DEB")"
cat > "$OUT_STAGE/index.html" <<HTML
<!doctype html>
<html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>$H_NAME für Linux</title>
<style>
 body{font-family:system-ui,sans-serif;max-width:38rem;margin:2rem auto;padding:0 1rem;line-height:1.45;color:#111}
 img.icon{width:96px;height:96px} .btn{display:block;text-align:center;background:#2563EB;color:#fff;
 padding:1rem;border-radius:12px;text-decoration:none;font-weight:600;font-size:1.15rem;margin:1.5rem 0 .5rem}
 small{color:#666} li{margin:.4rem 0} code{background:#f1f1f1;padding:.1rem .3rem;border-radius:4px}
 @media(prefers-color-scheme:dark){body{background:#000;color:#eee}small{color:#999}code{background:#222}}
</style></head><body>
<img class="icon" src="icon-256.png" alt="">
<h1>$H_NAME für Linux</h1>
<p>x86_64 &middot; Alpha &middot; Build ${SHA} &middot; $(date +%Y-%m-%d)</p>
<a class="btn" href="$H_AI">$H_AI herunterladen ($AI_SIZE)</a>
<p><small>Debian/Ubuntu: <a href="$H_DEB">$H_DEB</a> ($DEB_SIZE) &middot; <a href="build.txt">build.txt</a></small></p>
<h2>Installieren</h2>
<ol>
 <li><b>AppImage</b>: <code>chmod +x $H_AI</code>, dann starten. Braucht FUSE 2 (<code>libfuse2</code> bzw.
     <code>libfuse2t64</code>); ohne FUSE: <code>./$H_AI --appimage-extract-and-run</code>.</li>
 <li><b>.deb</b> (Debian/Ubuntu): <code>sudo apt install ./$H_DEB</code> &ndash; zieht WebKitGTK 4.1 und
     die übrigen Abhängigkeiten nach.</li>
</ol>
<h2>Bedienung</h2>
<ul>
 <li><b>Alt+Leertaste</b> (global, nur X11; unter GNOME/Xfce ggf. vom Fenstermenü belegt): Hermes nach vorne holen,
     neuer Chat. Nochmal drücken blendet Hermes aus.</li>
 <li><b>Strg+N</b> neuer Chat &middot; Tray-Symbol (braucht einen StatusNotifier-/AppIndicator-Bereich): Neuer Chat /
     Fenster zeigen / Beenden.</li>
 <li>Fenster schließen lässt Hermes im Tray weiterlaufen; beenden über das Tray-Menü oder <b>Strg+Q</b>.</li>
</ul>
<p><small>Nur im Tailnet erreichbar.</small></p>
</body></html>
HTML
if [ "$FLAVOR" = hermes ]; then
  t "release gate (unpacked AppImage + deb, download page)"
  APPX="$(mktemp -d "${TMPDIR:-/tmp}/hui-desktop-linux-app.XXXXXX")"
  # unpack without running the AppImage: a squashfs appended to an ELF64 runtime, offset = end of the section
  # header table (e_shoff + e_shentsize * e_shnum)
  OFF="$(node -e 'const b=require("fs").readFileSync(process.argv[1]);
    if (b.readUInt32BE(0)!==0x7f454c46 || b[4]!==2) process.exit(1);
    const o=Number(b.readBigUInt64LE(0x28))+b.readUInt16LE(0x3a)*b.readUInt16LE(0x3c);
    if (b.toString("latin1",o,o+4)!=="hsqs") process.exit(1); console.log(o)' "$OUT_STAGE/$AI" || true)"
  ok=1
  { [ -n "$OFF" ] && unsquashfs -q -n -o "$OFF" -d "$APPX/appimage" "$OUT_STAGE/$AI" >/dev/null; } || ok=0
  # The AppImage carries ~270 MB of third-party shared libraries (GTK, WebKitGTK, …) that linuxdeploy copies verbatim
  # from the build host's distro packages; scanning them takes far over half an hour and finds nothing of ours.
  # Gated: everything else (our binary in usr/bin, desktop file, icons, AppRun hooks, the gtk/gdk-pixbuf/gio caches
  # and module configs that linuxdeploy generates) + the whole .deb (same binary). Also skipped: the libraries'
  # Debian copyright files (usr/share/doc/<package>/copyright) and the GSettings schema sources copied from the
  # host's /usr/share/glib-2.0/schemas (*.gschema.xml): upstream authors' e-mail addresses, nothing of ours.
  if [ "$ok" = 1 ]; then
    find "$APPX/appimage/usr/lib" -type f \( -name '*.so' -o -name '*.so.*' \) -delete 2>/dev/null || true
    rm -rf "$APPX/appimage/usr/share/doc"
    find "$APPX/appimage/usr/share/glib-2.0/schemas" -type f -name '*.xml' -delete 2>/dev/null || true
  fi
  { mkdir -p "$APPX/deb" && dpkg-deb -x "$OUT_STAGE/$DEB" "$APPX/deb"; } || ok=0
  [ "$ok" = 1 ] || { rm -rf "$APPX"; echo "DESKTOP BUILD REJECTED: cannot unpack the AppImage/deb for the gate (unsquashfs, dpkg-deb); $OUT left unchanged"; exit 1; }
  flavor_guard_output "$APPX" || { rm -rf "$APPX"; echo "DESKTOP BUILD REJECTED: the app contains private content; $OUT left unchanged"; exit 1; }
  release_gate "$APPX" || { rm -rf "$APPX"; echo "DESKTOP BUILD REJECTED by the release gate; $OUT left unchanged"; exit 1; }
  rm -rf "$APPX"
  # download dir: everything but the AppImage itself, whose raw squashfs holds the third-party libraries above (e.g.
  # OpenSSL's "CRYPTOGAMS by <author e-mail>" in uncompressed blocks); its unpacked content was gated above
  DLX="$(mktemp -d "${TMPDIR:-/tmp}/hui-desktop-linux-dl.XXXXXX")"
  find "$OUT_STAGE" -maxdepth 1 -type f ! -name '*.AppImage' -exec cp -p {} "$DLX/" \;
  release_gate "$DLX" || { rm -rf "$DLX"; echo "DESKTOP BUILD REJECTED by the release gate (download dir); $OUT left unchanged"; exit 1; }
  rm -rf "$DLX"
fi
chmod -R o+rX "$OUT_STAGE"
rm -rf "$OUT.old-$TS"
[ ! -e "$OUT" ] || mv "$OUT" "$OUT.old-$TS"
mv "$OUT_STAGE" "$OUT"
rm -rf "$OUT.old-$TS"
chmod o+rx "$ROOT/dist/share" 2>/dev/null || true
echo
cat "$OUT/build.txt"
echo "download page: $PUBLIC_BASE/"
echo "OK in $(( (SECONDS-T0)/60 )) min. Log: $LOG"
