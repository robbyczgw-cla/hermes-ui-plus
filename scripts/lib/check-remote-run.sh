#!/usr/bin/env bash
# Remote half of `scripts/check.sh all --host` (scripts/lib/check-remote.sh starts it on the check host from the shipped
# tree): bash check-remote-run.sh RUN_DIR, with the checkout in RUN_DIR/src and the caches in RUN_DIR/../..
#   repo.git, trees/  the shipped trees (scripts/lib/check-remote.sh); unused for 14 days -> ref dropped
#   node/   official nodejs.org Node 22 (latest-v22.x, SHA-256 checked) when the host's node cannot strip TypeScript;
#           refreshed at most weekly, an older copy is used when nodejs.org is unreachable
#   npm/    npm's download cache
#   nm/     node_modules per package, keyed by Node ABI + package.json + package-lock.json (+ app/patches): a hit is a
#           hard-link copy (seconds), a miss runs `npm ci` (capped like the checks) and stores the result
# TMPDIR: the host's /tmp may be a small tmpfs that other jobs fill up (ENOSPC in tests), so the run's temp files go to
# RUN_DIR/tmp on disk, or to HUI_CHECK_REMOTE_TMPDIR/hui-check-<run id> when that is set (passed on by the local half).
# The run dir and that temp dir are removed on exit, whatever happens. Env: HUI_NODE_DIST (Node download base URL).
set -euo pipefail
RUN="$(cd "$1" && pwd)"
SRC="$RUN/src"
BASE="$(dirname "$(dirname "$RUN")")"
echo $$ > "$RUN/pgid"   # setsid made this shell a process group leader: the local half stops an interrupted run by it
if [ -n "${HUI_CHECK_REMOTE_TMPDIR:-}" ]; then TMPDIR="$HUI_CHECK_REMOTE_TMPDIR/hui-check-${RUN##*/}"; else TMPDIR="$RUN/tmp"; fi
export TMPDIR
cleanup() { cd /; rm -rf "$RUN" "$TMPDIR"; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP
mkdir -p "$BASE/node" "$BASE/npm" "$BASE/nm" "$TMPDIR"
SECONDS=0
SETUP=()

# runs the local half lost track of (killed ssh, rebooted laptop): older than 12 h and their process group is gone
for d in "$BASE"/runs/*/; do
  d=${d%/}
  [ "$d" != "$RUN" ] && [ -n "$(find "$d" -maxdepth 0 -mmin +720 2>/dev/null)" ] || continue
  p=$(cat "$d/pgid" 2>/dev/null || true)
  if [ -z "$p" ] || ! kill -0 -- "-$p" 2>/dev/null; then rm -rf "$d"; fi
done

# capped like the checks (scripts/check.sh): own 3 GB scope inside the shared heavy slice when systemd is there
cap() { "$@"; }
if command -v systemd-run >/dev/null 2>&1 && [ -d "/run/user/$(id -u)" ]; then
  export XDG_RUNTIME_DIR="/run/user/$(id -u)" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$(id -u)/bus"
  # shellcheck source=heavy.sh
  . "$SRC/scripts/lib/heavy.sh"
  heavy_slice_init 2>/dev/null || true
  cap() { systemd-run --user --scope -q "${HEAVY_SLICE[@]}" -p MemoryMax=3G -p MemorySwapMax=0 "$@"; }
fi

# --- Node 22 with TypeScript stripping (the app tests run .ts directly) ---
strips() { "$1" -e 'process.exit(process.features.typescript ? 0 : 1)' >/dev/null 2>&1; }
fetch_node() { # download latest-v22.x into $BASE/node/<version>, point current at it
  local arch dist tmp name ver
  case "$(uname -m)" in x86_64) arch=x64 ;; aarch64|arm64) arch=arm64 ;; *) echo "no Node build for $(uname -m)" >&2; return 1 ;; esac
  dist="${HUI_NODE_DIST:-https://nodejs.org/dist/latest-v22.x}"
  tmp=$(mktemp -d "$BASE/node/dl.XXXXXX")
  (
    cd "$tmp"
    curl -fsSL --max-time 60 "$dist/SHASUMS256.txt" -o SHASUMS256.txt
    name=$(awk -v a="$arch" '$2 ~ "^node-v22\\.[0-9]+\\.[0-9]+-linux-" a "\\.tar\\.xz$" {print $2}' SHASUMS256.txt | head -n 1)
    [ -n "$name" ] || { echo "no linux-$arch tarball in $dist/SHASUMS256.txt" >&2; exit 1; }
    ver=${name%.tar.xz}
    if [ ! -x "$BASE/node/$ver/bin/node" ]; then
      curl -fsSL --max-time 600 "$dist/$name" -o "$name"
      grep "  $name\$" SHASUMS256.txt | sha256sum -c --quiet -
      tar -xJf "$name"
      mv -T "$ver" "$BASE/node/$ver"
    fi
    ln -sfn "$ver" "$BASE/node/current.tmp" && mv -T "$BASE/node/current.tmp" "$BASE/node/current"
  ) || { rm -rf "$tmp"; return 1; }
  rm -rf "$tmp"
  touch "$BASE/node/stamp"
  # older versions a day after they stopped being current (a parallel run may still be using one)
  find "$BASE/node" -mindepth 1 -maxdepth 1 -type d -name 'node-v*' -mmin +1440 ! -name "$(readlink "$BASE/node/current")" -exec rm -rf {} +
}
if command -v node >/dev/null 2>&1 && strips node; then
  NODE_FROM="host node $(node -v)"
else
  exec 8>"$BASE/node.lock"; flock 8
  if [ -x "$BASE/node/current/bin/node" ] && [ -z "$(find "$BASE/node/stamp" -mmin +10080 2>/dev/null)" ] && [ -f "$BASE/node/stamp" ]; then
    NODE_FROM=cached
  elif fetch_node; then NODE_FROM=downloaded
  elif [ -x "$BASE/node/current/bin/node" ]; then NODE_FROM="cached (refresh failed)"
  else echo "check-remote: no Node 22 with TypeScript stripping on this host and the download failed" >&2; exit 3; fi
  flock -u 8; exec 8>&-
  # resolve the symlink now: a parallel refresh must not swap Node under this run
  NODE_DIR=$(cd "$BASE/node/current" && pwd -P)
  export PATH="$NODE_DIR/bin:$PATH"
  strips node || { echo "check-remote: $NODE_DIR/bin/node cannot strip TypeScript" >&2; exit 3; }
  NODE_FROM="$NODE_FROM $(node -v)"
fi
SETUP+=("node $NODE_FROM")

cd "$SRC"
# trees no run used for 14 days: drop their refs (gc removes the objects later)
for t in "$BASE"/trees/*; do
  [ -n "$(find "$t" -maxdepth 0 -mtime +14 2>/dev/null)" ] || continue
  git -C "$BASE/repo.git" update-ref -d "refs/trees/${t##*/}" 2>/dev/null || true; rm -f "$t"
done
git -C "$BASE/repo.git" gc --auto --quiet 2>/dev/null || true

# --- node_modules, from the cache when the lockfile did not change ---
export npm_config_cache="$BASE/npm" npm_config_audit=false npm_config_fund=false npm_config_update_notifier=false
abi="$(node -p 'process.versions.modules + " " + process.platform + " " + process.arch')"
for pkg in app bridge push; do
  [ -f "$SRC/$pkg/package-lock.json" ] || continue   # push has no dependencies
  key=$( { echo "$abi"; cat "$SRC/$pkg/package.json" "$SRC/$pkg/package-lock.json"
           if [ -d "$SRC/$pkg/patches" ]; then (cd "$SRC/$pkg" && find patches -type f | LC_ALL=C sort | xargs cat); fi
         } | sha256sum | cut -c1-16)
  c="$BASE/nm/$pkg-$key"
  t=$SECONDS
  if [ -d "$c/node_modules" ]; then
    cp -al "$c/node_modules" "$SRC/$pkg/node_modules"
    touch "$c"
    SETUP+=("$pkg cached")
  else
    echo "check-remote: npm ci in $pkg (lockfile changed or first run)"
    (cd "$SRC/$pkg" && cap npm ci --prefer-offline --no-progress)
    exec 9>"$BASE/nm.lock"; flock 9
    if [ ! -d "$c" ]; then
      rm -rf "$c.tmp" && mkdir -p "$c.tmp" && cp -al "$SRC/$pkg/node_modules" "$c.tmp/" && mv -T "$c.tmp" "$c"
    fi
    # keep the three newest entries per package (hard links: a running copy keeps its files)
    { ls -1dt "$BASE/nm/$pkg-"* 2>/dev/null | grep -v '\.tmp$' | tail -n +4 | while read -r old; do rm -rf "$old"; done; } || true
    flock -u 9; exec 9>&-
    SETUP+=("$pkg npm ci $((SECONDS - t))s")
  fi
done
SETUP_LINE=""
for s in "${SETUP[@]}"; do SETUP_LINE+="${SETUP_LINE:+, }$s"; done
echo "check-remote: setup $SETUP_LINE in ${SECONDS}s"

# --- the gate itself, capped and queued by its own per-step lock ---
bash scripts/check.sh all
