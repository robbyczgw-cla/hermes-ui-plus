#!/usr/bin/env bash
# Deterministic Android E2E smoke suite (docs/E2E.md): one emulator, the scripted mock (scripts/e2e/mock.mjs) and the
# flows in scripts/e2e/suite.py. Writes report.md + report.json (+ screenshots of failed checks) and exits non-zero on
# any FAIL.
#
#   scripts/e2e/smoke.sh [options] APK
#     --host H        run on the emulator host H over ssh (copies the scripts + APK there, fetches the report back);
#                     default: $E2E_HOST (also read from $HUI_PRIVATE_DIR/e2e.env), empty = run on this machine.
#                     H = mac: the build Mac ($MAC_HOST from the environment or $HUI_PRIVATE_DIR/build.env; arm64 emulator,
#                     needs an arm64-v8a APK, e.g. from scripts/build-apk.sh --host mac). HUI_ANDROID_LANE=mac does the same
#                     when no --host is given.
#     --apk-on-host P with --host: the APK is already on the host (path relative to ~, e.g. hui-lane/src/dist/x.apk, as left by
#                     build-apk.sh --host) and so are the scripts (~/hui-lane/src/scripts/e2e, same commit): nothing is uploaded,
#                     only the report is fetched. For slow links to the host.
#     --out DIR       report directory (default /tmp/hui-e2e-<timestamp>)
#     --wait MIN      if another smoke run holds the host's lock or the host is busy (emulator/qemu or Gradle running),
#                     wait for up to MIN minutes instead of refusing at once
#     --only a,b      run only these checks (ids from suite.py; setup, pairing and the logcat check always run)
#     --group g,g     run check groups (core net ui bg share, or all; the table lives in suite.py, `suite.py --list-groups`);
#                     combines with --only (union). Default without --group/--only: all checks. The report says "subset"
#     --debug         keep UI dumps of intermediate states (OUT/debug/)
#     --live FILE     extra stage: 2-3 harmless turns against a real bridge, FILE holds the pair link (never printed);
#                     $E2E_LIVE_LINK_FILE works too. E2E_LIVE_EXTRA=bots,quick adds live bot and ⚡ checks (docs/E2E.md)
#
# Host rules (enforced here, not by the caller): refuses while Gradle or any other emulator/qemu runs, one smoke run
# at a time (flock), the emulator runs in `systemd-run --user --scope -p MemoryMax=5G -p MemorySwapMax=0`, and the
# EXIT trap always kills it (`adb emu kill`, then the scope), stops the mock and the private adb server. No pattern
# kills (`pkill -f`): every process is stopped by its pid or its scope unit.
# macOS (the build Mac): no flock/systemd/timeout. The run takes the Mac's single heavy-job lock (scripts/lib/maclock.sh:
# never together with an iOS/macOS build or the Android build), "busy" also covers xcodebuild, the emulator tree is
# watched (RSS > E2E_EMU_MAX_MB [8192] -> killed by pid) and its thermal state (pmset -g therm) is logged to
# OUT/host.log; the AVD is created on first use (E2E_AVD, android-35 google_apis arm64-v8a).
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
OS=$(uname -s)
PRIVATE=${HUI_PRIVATE_DIR:-$HOME/work/hermesiui-private}
# shellcheck disable=SC1091
[ -f "$PRIVATE/e2e.env" ] && . "$PRIVATE/e2e.env"

# prints the comment block above up to its second bare "#" line (end of the option list), then the group table
usage() {
  awk 'NR == 1 { next } !/^#/ { exit } /^#$/ && ++n == 2 { exit } { sub(/^# ?/, ""); print }' "$0" >&2
  python3 "$HERE/suite.py" --list-groups >&2 || true
  exit 2
}
APK_ON_HOST= HOST=${E2E_HOST:-} HOST_FLAG=0 OUT= WAIT_MIN=0 ONLY= GROUP= LIVE_FILE=${E2E_LIVE_LINK_FILE:-} LOCAL=0 APK= LIVE_STDIN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --host) HOST=$2; HOST_FLAG=1; shift 2 ;;
    --out) OUT=$2; shift 2 ;;
    --apk-on-host) APK_ON_HOST=$2; shift 2 ;;
    --wait) WAIT_MIN=$2; shift 2 ;;
    --only) ONLY=$2; shift 2 ;;
    --group) GROUP=$2; shift 2 ;;
    --live) LIVE_FILE=$2; shift 2 ;;
    --debug) export E2E_DEBUG=1; shift ;;
    --local) LOCAL=1; HOST=; shift ;;          # internal: we are on the emulator host
    --live-stdin) LIVE_STDIN=1; shift ;;       # internal: the pair link arrives on stdin
    -h|--help) usage ;;
    -*) echo "unknown option $1" >&2; usage ;;
    *) APK=$1; shift ;;
  esac
done
# group / check names are validated by suite.py (the one table), before anything is copied or started
if [ -n "$ONLY$GROUP" ]; then
  python3 "$HERE/suite.py" --check-selection --only "$ONLY" --group "$GROUP" >&2 || { python3 "$HERE/suite.py" --list-groups >&2; exit 2; }
fi
mac_host_lookup() { # MAC_HOST from the environment or the private build settings (data, never sourced)
  local h=${MAC_HOST:-}
  [ -n "$h" ] || [ ! -r "$PRIVATE/build.env" ] || h=$(sed -n 's/^[[:space:]]*\(export[[:space:]]\{1,\}\)\{0,1\}MAC_HOST=//p' "$PRIVATE/build.env" | tail -1 | tr -d "\"'")
  printf '%s' "$h"
}
# Lane (docs/BUILD.md "Second Android lane"): an explicit --host wins; HUI_ANDROID_LANE=mac|local forces
# a lane; unset or auto picks by the APK's ABI and, for APKs that run on both, by the Mac's state (scripts/lib/lane-choose.sh).
if [ "$HOST_FLAG" = 0 ] && [ "$LOCAL" = 0 ] && [ -z "$APK_ON_HOST" ]; then
  case "${HUI_ANDROID_LANE:-auto}" in
    mac) HOST=mac ;;
    local|linux) ;;
    auto)
      if [ -f "$APK" ] && [ -n "$(mac_host_lookup)" ]; then
        # shellcheck source=../lib/lane-choose.sh
        . "$HERE/../lib/lane-choose.sh"
        lane_for_apk "$APK" "$(mac_host_lookup)"
        [ "$LANE_CHOICE" = mac ] && HOST=mac
      fi ;;
    *) echo "HUI_ANDROID_LANE must be mac, local or auto (got '${HUI_ANDROID_LANE}')" >&2; exit 2 ;;
  esac
fi
if [ "$HOST" = mac ]; then
  HOST=$(mac_host_lookup)
  [ -n "$HOST" ] || { echo "--host mac: MAC_HOST is not set (environment or \$HUI_PRIVATE_DIR/build.env)" >&2; exit 2; }
fi
if [ -n "$APK_ON_HOST" ]; then
  [ -n "$HOST" ] && [ "$LOCAL" = 0 ] || { echo "--apk-on-host needs --host" >&2; exit 2; }
  case "$APK_ON_HOST" in /*|*..*|*[!A-Za-z0-9._/+-]*) echo "--apk-on-host must be a plain path relative to ~" >&2; exit 2 ;; esac
  APK=$APK_ON_HOST
else
  [ -n "$APK" ] && [ -f "$APK" ] || { echo "APK not found: ${APK:-<missing>}" >&2; usage; }
  # a symlink (dist/latest-*.apk) would be copied to the host as a dangling link: use the file it points to
  APK=$(readlink -f "$APK")
fi
OUT=${OUT:-/tmp/hui-e2e-$(date +%Y%m%d-%H%M%S)}
[ -n "$LIVE_FILE" ] && { [ -r "$LIVE_FILE" ] || { echo "live pair-link file not readable" >&2; exit 2; }; }

# ── remote mode: copy a minimal bundle to the host, run there, fetch the report ─────────────────────────────────────
if [ -n "$HOST" ] && [ "$LOCAL" = 0 ]; then
  ROOT=$(cd "$HERE/../.." && pwd)
  RDIR=/tmp/hui-e2e-run-$(id -un)-$$
  args=(--local --out "$RDIR/out" --wait "$WAIT_MIN")
  [ -n "$ONLY" ] && args+=(--only "$ONLY")
  [ -n "$GROUP" ] && args+=(--group "$GROUP")
  [ -n "${E2E_DEBUG:-}" ] && args+=(--debug)
  # E2E_DRY_RUN=1: print what would run on the host and stop (used by scripts/e2e/groups.test.mjs)
  [ -n "${E2E_DRY_RUN:-}" ] && { echo "dry-run remote args: ${args[*]}"; exit 0; }
  if [ -n "$APK_ON_HOST" ]; then
    # APK and scripts are already on the host (same commit, left by build-apk.sh --host): nothing to upload
    echo "== using the APK and scripts on $HOST (~/$APK_ON_HOST), only the report comes back"
    ssh "$HOST" "mkdir -p $RDIR/out"
    RSCRIPTS='$HOME/'"${APK_ON_HOST%%/src/*}/src/scripts/e2e"
    RAPK='$HOME/'"$APK_ON_HOST"
  else
    echo "== bundle -> $HOST:$RDIR"
    ssh "$HOST" "mkdir -p $RDIR/scripts/demo-videos $RDIR/scripts/lib $RDIR/bridge/src $RDIR/out"
    rsync -a --exclude '__pycache__' --exclude '*.test.*' "$ROOT/scripts/e2e/" "$HOST:$RDIR/scripts/e2e/"
    rsync -a "$ROOT/scripts/demo-videos/scenarios.mjs" "$HOST:$RDIR/scripts/demo-videos/"
    rsync -a "$ROOT/scripts/lib/maclock.sh" "$ROOT/scripts/lib/hostmem.sh" "$HOST:$RDIR/scripts/lib/"   # macOS hosts: lock + memory watch
    rsync -a "$ROOT/bridge/src/replay.mjs" "$HOST:$RDIR/bridge/src/"   # the mock resumes streams with the bridge's own code
    RAPK=$RDIR/$(basename "$APK")   # keep the name: the report shows it and checks its commit against the version label
    rsync -a "$APK" "$HOST:$RAPK"
    RSCRIPTS=$RDIR/scripts/e2e
  fi
  rc=0
  RPATH='PATH="$HOME/.local/node/bin:/opt/homebrew/bin:$PATH"'   # non-login ssh shell on a Mac: node lives here
  # optional live checks (suite.py LIVE_EXTRA): plain settings, no secrets
  envs=()
  for v in E2E_LIVE_EXTRA E2E_LIVE_BOT E2E_LIVE_BOT_LABEL E2E_LIVE_BOT_MARK; do
    [ -n "${!v:-}" ] && envs+=("$v=$(printf %q "${!v}")")
  done
  if [ -n "$LIVE_FILE" ]; then
    # the link travels on the ssh stdin only (never in an argument, a file on the host or the output)
    ssh "$HOST" "$RPATH ${envs[*]} bash $RSCRIPTS/smoke.sh ${args[*]} --live-stdin $RAPK" < "$LIVE_FILE" || rc=$?
  else
    ssh "$HOST" "$RPATH bash $RSCRIPTS/smoke.sh ${args[*]} $RAPK" < /dev/null || rc=$?
  fi
  mkdir -p "$OUT"
  rsync -a "$HOST:$RDIR/out/" "$OUT/" || echo "!! could not fetch the report from $HOST:$RDIR/out" >&2
  ssh "$HOST" "rm -rf $RDIR" || true
  echo "== report: $OUT/report.md (exit $rc)"
  exit "$rc"
fi

# ── local mode: this machine runs the emulator ──────────────────────────────────────────────────────────────────────
mkdir -p "$OUT"
LIVE_LINK=
if [ "$LIVE_STDIN" = 1 ]; then IFS= read -r LIVE_LINK || true; elif [ -n "$LIVE_FILE" ]; then IFS= read -r LIVE_LINK < "$LIVE_FILE" || true; fi
SDK=${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}
for d in "$SDK" "$HOME/android" /opt/android-sdk /var/tmp/hiui-android-sdk; do [ -n "$d" ] && [ -x "$d/emulator/emulator" ] && SDK=$d && break; done
[ -x "$SDK/emulator/emulator" ] || { echo "Android SDK with emulator not found (set ANDROID_SDK_ROOT)" >&2; exit 2; }
export ANDROID_SDK_ROOT=$SDK PATH="$SDK/platform-tools:$PATH"
AVD=${E2E_AVD:-HermesUIPlusQA}
EMU_PORT=${E2E_EMU_PORT:-5584}                       # own console port + own adb server port: never touches other adb users
export ANDROID_ADB_SERVER_PORT=${E2E_ADB_PORT:-5137} ANDROID_SERIAL=emulator-$EMU_PORT
MOCK_PORT=${E2E_MOCK_PORT:-8791}
MIN_AVAIL_GB=${MIN_AVAIL_GB:-4}
# shellcheck source=../lib/hostmem.sh
. "$HERE/../lib/hostmem.sh"
if [ "$OS" = Darwin ]; then
  # no timeout(1) on macOS
  command -v timeout >/dev/null 2>&1 || timeout() { perl -e 'alarm shift; exec @ARGV or exit 127' "$@"; }
  [ "$(unzip -l "$APK" 2>/dev/null | grep -c ' lib/arm64-v8a/')" -gt 0 ] || { echo "this Mac runs an arm64 emulator: $APK has no lib/arm64-v8a (build with ABIS=arm64-v8a)" >&2; exit 2; }
fi
UNIT=hui-e2e-emu-$$
export XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR:-/run/user/$(id -u)}
export DBUS_SESSION_BUS_ADDRESS=${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}
log() { echo "$(date +%T) $*"; }

# One smoke run per host. Background children (mock, adb server, emulator) get fd 9 closed (9>&-): a daemonized
# adb server left over from a killed run held the lock for hours.
# --wait MIN covers both: another smoke run (the lock) and a busy host (below), within one deadline.
deadline=$(( $(date +%s) + WAIT_MIN * 60 ))
# shellcheck source=runlock.sh
. "$HERE/runlock.sh"
if [ "$OS" = Darwin ]; then
  # no flock here: the Mac's one heavy-job lock (also covers iOS/macOS builds and the Android build)
  # shellcheck source=../lib/maclock.sh
  . "$HERE/../lib/maclock.sh"
  maclock_acquire android-emu $(( WAIT_MIN * 60 )) || exit 3
else
  exec 9>/tmp/hui-e2e.lock
  run_lock $(( WAIT_MIN * 60 )) /tmp/hui-e2e.lock || exit 3
fi

# Busy = any emulator/qemu process or a Gradle JVM (macOS: also xcodebuild). Matched on ps fields, never with pkill/pgrep -f
# (which would also match shells whose command line merely mentions these words). earlyoom's argument list names gradle:
# not a JVM. `comm` is the bare name on Linux and the full path on macOS: compare its last path segment.
busy() {
  ps -eo pid=,comm=,args= | awk -v me=$$ '
    $1 == me { next }
    { n = split($2, seg, "/"); name = seg[n] }
    name ~ /^(qemu-system|emulator)/ { print "emulator: pid " $1 " " name; next }
    name == "xcodebuild" { print "xcodebuild: pid " $1; next }
    name == "java" && /(GradleDaemon|GradleWrapperMain|org\.gradle\.launcher|gradle-launcher)/ { print "gradle: pid " $1 }'
}
while b=$(busy) && [ -n "$b" ]; do
  if [ "$(date +%s)" -ge "$deadline" ]; then echo "host busy, refusing:"$'\n'"$b" >&2; exit 3; fi
  log "host busy ($(echo "$b" | head -1)), next check in 2 min"
  sleep 120
done
avail=$(( $(host_avail_kb) / 1048576 ))
[ "$avail" -ge "$MIN_AVAIL_GB" ] || { echo "only ${avail} GB available (< $MIN_AVAIL_GB GB), refusing" >&2; exit 3; }

EMU_PID= MOCK_PID= WATCH_PID=
teardown() {
  local rc=$?
  trap - EXIT INT TERM HUP
  set +e
  log "teardown"
  if [ -n "$EMU_PID" ]; then
    timeout 20 adb emu kill >/dev/null 2>&1
    for _ in $(seq 1 30); do kill -0 "$EMU_PID" 2>/dev/null || break; sleep 1; done
    if kill -0 "$EMU_PID" 2>/dev/null; then
      if [ "$OS" = Darwin ]; then log "emulator still up, stopping its process tree (pid $EMU_PID)"; kill_tree "$EMU_PID"
      else log "emulator still up, stopping scope $UNIT"; systemctl --user stop "$UNIT.scope"; fi
      sleep 2
    fi
  fi
  [ -n "$WATCH_PID" ] && { kill "$WATCH_PID" 2>/dev/null; wait "$WATCH_PID" 2>/dev/null; }
  [ "$OS" = Darwin ] && maclock_release
  [ -n "$MOCK_PID" ] && kill "$MOCK_PID" 2>/dev/null && wait "$MOCK_PID" 2>/dev/null
  timeout 10 adb kill-server >/dev/null 2>&1
  local left
  left=$(ps -eo pid=,comm=,args= | awk -v p="-port $EMU_PORT" '{ n = split($2, seg, "/") } seg[n] ~ /^(qemu-system|emulator)/ && index($0, p) { print $1 }')
  if [ -n "$left" ]; then log "!! emulator processes left: $left"; rc=${rc:-1}; [ "$rc" = 0 ] && rc=1; else log "no emulator left"; fi
  exit "$rc"
}
trap teardown EXIT
trap 'exit 130' INT TERM HUP

# ── mock ───────────────────────────────────────────────────────────────────────────────────────────────────────────
command -v node >/dev/null || { echo "node missing on this host" >&2; exit 2; }
node "$HERE/mock.mjs" --port "$MOCK_PORT" > "$OUT/mock.log" 2>&1 9>&- &
MOCK_PID=$!
for _ in $(seq 1 50); do curl -fsS "http://127.0.0.1:$MOCK_PORT/__e2e/state" >/dev/null 2>&1 && break; sleep 0.2; done
curl -fsS "http://127.0.0.1:$MOCK_PORT/__e2e/state" >/dev/null || { echo "mock did not start, see $OUT/mock.log" >&2; exit 2; }

# ── emulator in a memory-capped scope (Linux) / watched process tree (macOS) ────────────────────────────────────────
T_BOOT=$(date +%s)
adb start-server >/dev/null 2>&1 9>&-
if [ "$OS" = Darwin ]; then
  EMU_RAM=${E2E_RAM:-3072} EMU_GPU=${E2E_GPU:-host} EMU_ABI=arm64-v8a
  # the AVD is created on first use (same device/API as the Linux one: pixel_6, android-35 google_apis); data partition
  # capped at 3 GB because the Mac's disk is tight
  if ! "$SDK/emulator/emulator" -list-avds 2>/dev/null | grep -qx "$AVD"; then
    AVDM=$(command -v avdmanager || true); [ -x "$SDK/cmdline-tools/latest/bin/avdmanager" ] && AVDM=$SDK/cmdline-tools/latest/bin/avdmanager
    [ -n "$AVDM" ] || { echo "AVD $AVD missing and no avdmanager found (brew install --cask android-commandlinetools)" >&2; exit 2; }
    for jh in "${JAVA_HOME:-}" /opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home /opt/homebrew/opt/openjdk@17; do
      [ -n "$jh" ] && [ -x "$jh/bin/java" ] && { export JAVA_HOME=$jh; break; }
    done
    log "creating AVD $AVD (system-images;android-35;google_apis;$EMU_ABI)"
    echo no | "$AVDM" create avd -n "$AVD" -k "system-images;android-35;google_apis;$EMU_ABI" -d pixel_6 --force > "$OUT/avdmanager.log" 2>&1 \
      || { echo "avdmanager failed, see $OUT/avdmanager.log" >&2; exit 2; }
    cfg="$HOME/.android/avd/$AVD.avd/config.ini"
    if [ -f "$cfg" ]; then
      grep -v '^disk.dataPartition.size=' "$cfg" > "$cfg.tmp" && echo 'disk.dataPartition.size=3G' >> "$cfg.tmp" && mv "$cfg.tmp" "$cfg"
    fi
  fi
  log "emulator $AVD on port $EMU_PORT (macOS, RAM ${EMU_RAM} MB, gpu $EMU_GPU, tree cap ${E2E_EMU_MAX_MB:-8192} MB)"
  "$SDK/emulator/emulator" -avd "$AVD" -port "$EMU_PORT" -no-window -no-audio -no-boot-anim -gpu "$EMU_GPU" \
    -memory "$EMU_RAM" -cores 4 -no-snapshot-save > "$OUT/emulator.log" 2>&1 9>&- &
  EMU_PID=$!
  # watch the emulator tree: RSS cap (killed by pid) and thermal state, one line every 30 s in OUT/host.log
  ( while kill -0 "$EMU_PID" 2>/dev/null; do
      set -- $(tree_rss "$EMU_PID"); cur=$(( $1 / 1024 ))
      sp=$(pmset -g therm 2>/dev/null | awk '/CPU_Speed_Limit/ { print $NF }')
      echo "$(date +%T) emulator_tree=${cur}MB hostAvail=$(( $(host_avail_kb) / 1024 ))MB speedLimit=${sp:-100} swap=$(sysctl -n vm.swapusage 2>/dev/null | awk '{ print $6 }')" >> "$OUT/host.log"
      if [ "$cur" -gt "${E2E_EMU_MAX_MB:-8192}" ]; then echo "$(date +%T) emulator tree ${cur} MB > cap, killing" >> "$OUT/host.log"; kill_tree "$EMU_PID"; break; fi
      sleep 30
    done ) 9>&- &
  WATCH_PID=$!
else
  log "emulator $AVD on port $EMU_PORT (scope $UNIT, MemoryMax=5G)"
  systemd-run --user --scope -q --unit="$UNIT" -p MemoryMax=5G -p MemorySwapMax=0 \
    "$SDK/emulator/emulator" -avd "$AVD" -port "$EMU_PORT" -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect \
    -memory 2048 -cores 4 -no-snapshot-save > "$OUT/emulator.log" 2>&1 9>&- &
  EMU_PID=$!
fi
booted=
for _ in $(seq 1 120); do
  kill -0 "$EMU_PID" 2>/dev/null || { echo "emulator exited, see $OUT/emulator.log" >&2; exit 2; }
  [ "$(timeout 5 adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ] && booted=1 && break
  sleep 2
done
[ -n "$booted" ] || { echo "emulator did not boot in 240 s" >&2; exit 2; }
log "booted in $(( $(date +%s) - T_BOOT )) s"

# ── suite ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export E2E_MOCK_PORT=$MOCK_PORT E2E_BOOT_S=$(( $(date +%s) - T_BOOT ))
suite_args=(--apk "$APK" --out "$OUT")
[ -n "$ONLY" ] && suite_args+=(--only "$ONLY")
[ -n "$GROUP" ] && suite_args+=(--group "$GROUP")
rc=0
if [ -n "$LIVE_LINK" ]; then
  printf '%s\n' "$LIVE_LINK" | python3 "$HERE/suite.py" "${suite_args[@]}" --live-stdin || rc=$?
else
  python3 "$HERE/suite.py" "${suite_args[@]}" < /dev/null || rc=$?
fi
LIVE_LINK=
exit "$rc"
