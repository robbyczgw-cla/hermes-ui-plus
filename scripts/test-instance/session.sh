#!/usr/bin/env bash
# One exclusive test session: take the instance lock (wait for it if asked), start the instance, run CMD, stop the
# instance, release the lock. The instance is stopped on every exit path (CMD fails, Ctrl-C, ssh drops). On the Mac
# the shared heavy-job lock of the Android lane is respected too.
#   scripts/test-instance/session.sh [--wait SECONDS] [--label NAME] -- CMD [ARGS...]
#   e.g. scripts/test-instance/session.sh --wait 600 -- node scripts/test-instance/api-test.mjs
# (TI_START_SCRIPT / TI_STOP_SCRIPT replace start.sh / stop.sh in tests.)
# On the Linux host it also takes `flock /tmp/hui-testinst.lock` (what agents used before), so both ways exclude each other.
# Exit status: that of CMD; 3 = the lock was not free within --wait; 4 = start failed; 5 = stop left something running.
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$here/lib.sh"
wait_s=0; label="session"
while [ $# -gt 0 ]; do
  case "$1" in
    --wait) wait_s="$2"; shift 2 ;;
    --label) label="$2"; shift 2 ;;
    --) shift; break ;;
    *) break ;;
  esac
done
[ $# -gt 0 ] || { echo "usage: session.sh [--wait S] [--label NAME] -- CMD [ARGS...]" >&2; exit 2; }

# the classic flock of the Linux host (held on fd 9 until this process ends; a plain `flock` user in another shell waits for us)
if [ -n "$TI_FLOCK_FILE" ] && command -v flock >/dev/null 2>&1; then
  exec 9>"$TI_FLOCK_FILE"
  if [ "$wait_s" -gt 0 ]; then flock -w "$wait_s" 9; else flock -n 9; fi || { say "instance flock $TI_FLOCK_FILE is held by someone else"; exit 3; }
fi
tilock_acquire "$label" "$wait_s" "$$" 0 || exit 3
export TI_LOCK_OWNED=1
child=""
finish() {
  local rc=$?
  trap - EXIT INT TERM HUP
  set +e
  [ -n "$child" ] && kill "$child" 2>/dev/null
  bash "${TI_STOP_SCRIPT:-$here/stop.sh}" || rc=5
  command -v maclock_release >/dev/null 2>&1 && maclock_release
  tilock_release
  exit "$rc"
}
trap finish EXIT
trap 'exit 130' INT TERM HUP   # CMD runs in the background and is waited for, so these fire at once

# the Mac lane's heavy lock (queued behind a running build, held while this session runs); optional library
if [ "$TI_FLAVOR" = native ] && [ -f "$TI_MAC_LOCK_LIB" ]; then
  export HUI_MAC_LOCK_DIR="$TI_MAC_LOCK_DIR"
  # shellcheck disable=SC1090
  . "$TI_MAC_LOCK_LIB"
  maclock_acquire testinst "$wait_s" || exit 3
  export TI_MAC_LOCK_MINE=1   # start.sh must not refuse because of the lock this session holds itself
fi

bash "${TI_START_SCRIPT:-$here/start.sh}" || exit 4
"$@" &
child=$!
rc=0
wait "$child" || rc=$?
child=""
exit "$rc"
