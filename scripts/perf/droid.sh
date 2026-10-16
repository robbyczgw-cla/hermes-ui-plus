#!/usr/bin/env bash
# Android streaming perf A/B (docs/PERF.md): one emulator, the E2E mock (scripts/e2e/mock.mjs, perf scenarios) and
# scripts/perf/droid.py. Builds must be perf builds (EXPO_PUBLIC_HUI_PERF=1, ABIS=x86_64). Summary:
# scripts/perf/droid-summary.py OUT/results.jsonl.
#
#   scripts/perf/droid.sh [options] NAME=APK [NAME=APK ...]
#     --host H        run on the emulator host H over ssh (copies scripts + APKs there, fetches the results back);
#                     default: $E2E_HOST (also read from $HUI_PRIVATE_DIR/e2e.env), empty = this machine
#     --out DIR       result directory (default /tmp/hui-perf-<timestamp>)
#     --runs N        runs per build (default 3); builds alternate A B A B …
#     --scenarios L   comma list of real,stress,huge,history (default all)
#     --trace         also record a perfetto trace (sched + view/gfx atrace) of every `real` stream (OUT/<run>/real.pftrace)
#     --wait MIN      if the host is busy (the E2E lock is held, an emulator/qemu or Gradle runs), poll every 2 min for
#                     up to MIN minutes instead of refusing at once
#
# Host rules (same as scripts/e2e/smoke.sh): holds /tmp/hui-e2e.lock for the whole session (the smoke suite and other
# emulator users wait for it), refuses while Gradle or any other emulator runs or less than MIN_AVAIL_GB (4) is
# available, the emulator runs in `systemd-run --user --scope -p MemoryMax=5G -p MemorySwapMax=0`, and the EXIT trap
# always stops it (`adb emu kill`, then the scope), the mock (by pid) and the private adb server. No pattern kills.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
PRIVATE=${HUI_PRIVATE_DIR:-$HOME/work/hermesiui-private}
# shellcheck disable=SC1091
[ -f "$PRIVATE/e2e.env" ] && . "$PRIVATE/e2e.env"

usage() { sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 2; }
HOST=${E2E_HOST:-} OUT= WAIT_MIN=0 RUNS=3 SCEN=real,stress,huge,history LOCAL=0
BUILDS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --host) HOST=$2; shift 2 ;;
    --out) OUT=$2; shift 2 ;;
    --runs) RUNS=$2; shift 2 ;;
    --scenarios) SCEN=$2; shift 2 ;;
    --wait) WAIT_MIN=$2; shift 2 ;;
    --trace) export PERF_TRACE=1; shift ;;
    --local) LOCAL=1; HOST=; shift ;;   # internal: we are on the emulator host
    -h|--help) usage ;;
    -*) echo "unknown option $1" >&2; usage ;;
    *=*) BUILDS+=("$1"); shift ;;
    *) echo "expected NAME=APK, got $1" >&2; usage ;;
  esac
done
[ ${#BUILDS[@]} -gt 0 ] || usage
for b in "${BUILDS[@]}"; do [ -f "${b#*=}" ] || { echo "APK not found: ${b#*=}" >&2; exit 2; }; done
OUT=${OUT:-/tmp/hui-perf-$(date +%Y%m%d-%H%M%S)}

# ── remote mode ────────────────────────────────────────────────────────────────────────────────────────────────────
if [ -n "$HOST" ] && [ "$LOCAL" = 0 ]; then
  ROOT=$(cd "$HERE/../.." && pwd)
  RDIR=/tmp/hui-perf-run-$(id -un)-$$
  echo "== bundle -> $HOST:$RDIR"
  ssh "$HOST" "mkdir -p $RDIR/scripts/demo-videos $RDIR/bridge/src $RDIR/apk $RDIR/out"
  rsync -a --exclude '__pycache__' --exclude '*.test.*' "$ROOT/scripts/e2e/" "$HOST:$RDIR/scripts/e2e/"
  rsync -a --exclude '__pycache__' "$ROOT/scripts/perf/" "$HOST:$RDIR/scripts/perf/"
  rsync -a "$ROOT/scripts/demo-videos/scenarios.mjs" "$HOST:$RDIR/scripts/demo-videos/"
  rsync -a "$ROOT/bridge/src/replay.mjs" "$HOST:$RDIR/bridge/src/"
  rargs=()
  for b in "${BUILDS[@]}"; do
    rsync -a "${b#*=}" "$HOST:$RDIR/apk/"
    rargs+=("${b%%=*}=$RDIR/apk/$(basename "${b#*=}")")
  done
  rc=0
  ssh "$HOST" "PERF_TRACE=${PERF_TRACE:-} bash $RDIR/scripts/perf/droid.sh --local --out $RDIR/out --runs $RUNS --scenarios $SCEN --wait $WAIT_MIN ${rargs[*]}" < /dev/null || rc=$?
  mkdir -p "$OUT"
  rsync -a "$HOST:$RDIR/out/" "$OUT/" || echo "!! could not fetch the results from $HOST:$RDIR/out" >&2
  ssh "$HOST" "rm -rf $RDIR" || true
  [ -s "$OUT/results.jsonl" ] && python3 "$HERE/droid-summary.py" "$OUT/results.jsonl" > "$OUT/summary.md" && echo "== summary: $OUT/summary.md"
  exit "$rc"
fi

# ── local mode ─────────────────────────────────────────────────────────────────────────────────────────────────────
mkdir -p "$OUT"
SDK=${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}
for d in "$SDK" "$HOME/android" /opt/android-sdk; do [ -n "$d" ] && [ -x "$d/emulator/emulator" ] && SDK=$d && break; done
[ -x "$SDK/emulator/emulator" ] || { echo "Android SDK with emulator not found (set ANDROID_SDK_ROOT)" >&2; exit 2; }
export ANDROID_SDK_ROOT=$SDK PATH="$SDK/platform-tools:$PATH"
AVD=${E2E_AVD:-HermesUIPlusQA}
EMU_PORT=${PERF_EMU_PORT:-5594}
export ANDROID_ADB_SERVER_PORT=${PERF_ADB_PORT:-5147} ANDROID_SERIAL=emulator-$EMU_PORT
MOCK_PORT=${PERF_MOCK_PORT:-8795}
MIN_AVAIL_GB=${MIN_AVAIL_GB:-4}
UNIT=hui-perf-emu-$$
export XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR:-/run/user/$(id -u)}
export DBUS_SESSION_BUS_ADDRESS=${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}
log() { echo "$(date +%T) $*"; }

busy() {
  ps -eo pid=,comm=,args= | awk -v me=$$ '
    $1 == me { next }
    $2 ~ /^(qemu-system|emulator)/ { print "emulator: pid " $1 " " $2; next }
    $2 == "java" && /(GradleDaemon|GradleWrapperMain|org\.gradle\.launcher|gradle-launcher)/ { print "gradle: pid " $1 }'
}
# the E2E lock for the whole session: smoke runs and other emulator users wait for it (9>&-: children don't keep it)
exec 9>/tmp/hui-e2e.lock
deadline=$(( $(date +%s) + WAIT_MIN * 60 ))
while :; do
  if flock -n 9; then
    b=$(busy)
    [ -z "$b" ] && break
    flock -u 9
  else
    b="/tmp/hui-e2e.lock is held (smoke run or another emulator session)"
  fi
  if [ "$(date +%s)" -ge "$deadline" ]; then echo "host busy, refusing:"$'\n'"$b" >&2; exit 3; fi
  log "host busy ($(echo "$b" | head -1)), next check in 2 min"
  sleep 120
done
avail=$(awk '/MemAvailable/ { printf "%d", $2 / 1048576 }' /proc/meminfo)
[ "$avail" -ge "$MIN_AVAIL_GB" ] || { echo "only ${avail} GB available (< $MIN_AVAIL_GB GB), refusing" >&2; exit 3; }

EMU_PID= MOCK_PID=
teardown() {
  local rc=$?
  trap - EXIT INT TERM HUP
  set +e
  log "teardown"
  if [ -n "$EMU_PID" ]; then
    timeout 20 adb emu kill >/dev/null 2>&1
    for _ in $(seq 1 30); do kill -0 "$EMU_PID" 2>/dev/null || break; sleep 1; done
    if kill -0 "$EMU_PID" 2>/dev/null; then log "emulator still up, stopping scope $UNIT"; systemctl --user stop "$UNIT.scope"; sleep 2; fi
  fi
  [ -n "$MOCK_PID" ] && kill "$MOCK_PID" 2>/dev/null && wait "$MOCK_PID" 2>/dev/null
  timeout 10 adb kill-server >/dev/null 2>&1
  local left
  left=$(ps -eo pid=,comm=,args= | awk -v p="-port $EMU_PORT" '$2 ~ /^(qemu-system|emulator)/ && index($0, p) { print $1 }')
  if [ -n "$left" ]; then log "!! emulator processes left: $left"; [ "$rc" = 0 ] && rc=1; else log "no emulator left"; fi
  exit "$rc"
}
trap teardown EXIT
trap 'exit 130' INT TERM HUP

command -v node >/dev/null || { echo "node missing on this host" >&2; exit 2; }
node "$HERE/../e2e/mock.mjs" --port "$MOCK_PORT" > "$OUT/mock.log" 2>&1 9>&- &
MOCK_PID=$!
for _ in $(seq 1 50); do curl -fsS "http://127.0.0.1:$MOCK_PORT/__e2e/state" >/dev/null 2>&1 && break; sleep 0.2; done
curl -fsS "http://127.0.0.1:$MOCK_PORT/__e2e/state" >/dev/null || { echo "mock did not start, see $OUT/mock.log" >&2; exit 2; }

T_BOOT=$(date +%s)
adb start-server >/dev/null 2>&1 9>&-
log "emulator $AVD on port $EMU_PORT (scope $UNIT, MemoryMax=5G)"
systemd-run --user --scope -q --unit="$UNIT" -p MemoryMax=5G -p MemorySwapMax=0 \
  "$SDK/emulator/emulator" -avd "$AVD" -port "$EMU_PORT" -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect \
  -memory 2048 -cores 4 -no-snapshot-save > "$OUT/emulator.log" 2>&1 9>&- &
EMU_PID=$!
booted=
for _ in $(seq 1 120); do
  kill -0 "$EMU_PID" 2>/dev/null || { echo "emulator exited, see $OUT/emulator.log" >&2; exit 2; }
  [ "$(timeout 5 adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ] && booted=1 && break
  sleep 2
done
[ -n "$booted" ] || { echo "emulator did not boot in 240 s" >&2; exit 2; }
log "booted in $(( $(date +%s) - T_BOOT )) s; settling 30 s"
sleep 30   # boot-time dexopt / package scans would land in the first run's numbers
{
  echo "host: $(nproc) cpus, load $(cut -d' ' -f1-3 /proc/loadavg), MemAvailable ${avail} GB"
  for b in "${BUILDS[@]}"; do echo "${b%%=*}: $(basename "${b#*=}") sha256 $(sha256sum "${b#*=}" | cut -c1-16)"; done
} > "$OUT/meta.txt"
cat "$OUT/meta.txt"
export E2E_MOCK_PORT=$MOCK_PORT
python3 "$HERE/droid.py" --out "$OUT" --runs "$RUNS" --scenarios "$SCEN" "${BUILDS[@]}" < /dev/null 9>&-
