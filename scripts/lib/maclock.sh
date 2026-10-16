# shellcheck shell=bash
# One heavy job at a time on the build Mac (16 GB, fanless, no swap headroom to spare): an iOS / macOS build
# (scripts/build-ios.sh, scripts/build-desktop-mac.sh) and the Android lane (scripts/build-apk.sh, the emulator of
# scripts/e2e/smoke.sh) must never run together. macOS has no flock, so the lock is a directory made with mkdir
# (atomic) at a fixed path. It holds an `owner` file (pid, process start time, kind, start epoch); a lock whose owner
# is gone, or whose pid now belongs to another process, is stale and is taken over.
# Runs on the Mac, so: bash 3.2 compatible (no associative arrays, no ${x,,}, no mapfile).
#
#   . maclock.sh
#   maclock_acquire KIND [WAIT_S]   KIND = ios | desktop | android-build | android-emu (label for the messages).
#                                   WAIT_S default $HUI_MAC_LOCK_WAIT (2700). 0 = refuse at once. Returns 0 held,
#                                   3 = still held by someone else after WAIT_S (message names the holder).
#   maclock_release                 only releases a lock this shell holds
#   maclock_status                  one line, "free" or the holder
#   bash maclock.sh run KIND WAIT_S -- CMD…   acquire, run CMD as a child, release (exit status of CMD, 3 = not acquired)
#   bash maclock.sh status
# The holder is the shell that called maclock_acquire ($$); `exec` keeps the pid, so a lock that is never released
# explicitly is still reclaimed as soon as that process is gone.
#   HUI_MAC_LOCK_DIR   lock directory (default /tmp/hui-mac-heavy.lock)
HUI_MAC_LOCK_DIR="${HUI_MAC_LOCK_DIR:-/tmp/hui-mac-heavy.lock}"
HUI_MAC_LOCK_HELD=0

_maclock_started() { ps -o lstart= -p "$1" 2>/dev/null | sed 's/^ *//; s/  */ /g'; }

# prints "pid|lstart|kind|epoch" of the recorded owner (empty when there is no readable owner file)
_maclock_owner() {
  local f="$HUI_MAC_LOCK_DIR/owner" pid ls kind ep
  [ -r "$f" ] || return 0
  pid=$(sed -n 1p "$f"); ls=$(sed -n 2p "$f"); kind=$(sed -n 3p "$f"); ep=$(sed -n 4p "$f")
  printf '%s|%s|%s|%s' "$pid" "$ls" "$kind" "$ep"
}

# 0 = the lock is held by a live owner, 1 = free / stale
_maclock_live() {
  local o pid ls kind ep now
  o=$(_maclock_owner)
  if [ -z "$o" ]; then
    # directory without owner file: its creator is between mkdir and the write; stale after 15 s
    [ -d "$HUI_MAC_LOCK_DIR" ] || return 1
    now=$(date +%s); ep=$(stat -c %Y "$HUI_MAC_LOCK_DIR" 2>/dev/null || stat -f %m "$HUI_MAC_LOCK_DIR" 2>/dev/null || echo 0)
    case "$ep" in ''|*[!0-9]*) ep=0 ;; esac
    [ $(( now - ep )) -lt 15 ] && return 0
    return 1
  fi
  pid=${o%%|*}; o=${o#*|}; ls=${o%%|*}
  case "$pid" in ''|*[!0-9]*) return 1 ;; esac
  kill -0 "$pid" 2>/dev/null || return 1
  [ "$(_maclock_started "$pid")" = "$ls" ] || return 1
  return 0
}

maclock_status() {
  local o pid kind ep
  if ! _maclock_live; then echo "free"; return 0; fi
  o=$(_maclock_owner)
  if [ -z "$o" ]; then echo "taken (starting)"; return 0; fi
  pid=${o%%|*}; o=${o#*|}; o=${o#*|}; kind=${o%%|*}; ep=${o#*|}
  echo "held by $kind (pid $pid, $(( ($(date +%s) - ep) / 60 )) min)"
}

maclock_acquire() {
  local kind=${1:-job} wait_s=${2:-${HUI_MAC_LOCK_WAIT:-2700}} deadline last=0 now o d stale
  deadline=$(( $(date +%s) + wait_s ))
  while :; do
    if mkdir "$HUI_MAC_LOCK_DIR" 2>/dev/null; then
      printf '%s\n%s\n%s\n%s\n' "$$" "$(_maclock_started $$)" "$kind" "$(date +%s)" > "$HUI_MAC_LOCK_DIR/owner"
      HUI_MAC_LOCK_HELD=1
      echo "$(date +%T) mac lock taken ($kind, pid $$, $HUI_MAC_LOCK_DIR)"
      return 0
    fi
    if ! _maclock_live; then
      # stale: move it away first (only one of several waiters wins the rename), then retry the mkdir
      stale="$HUI_MAC_LOCK_DIR.stale.$$"
      if mv "$HUI_MAC_LOCK_DIR" "$stale" 2>/dev/null; then
        echo "$(date +%T) mac lock: removed a stale lock ($(sed -n 3p "$stale/owner" 2>/dev/null || echo unknown), pid $(sed -n 1p "$stale/owner" 2>/dev/null || echo ?))"
        rm -rf "$stale"
      fi
      continue
    fi
    now=$(date +%s)
    if [ "$wait_s" -le 0 ] || [ "$now" -ge "$deadline" ]; then
      echo "mac lock: $(maclock_status); not waiting any longer (iOS/macOS builds and the Android build/emulator never run together on the Mac)" >&2
      return 3
    fi
    if [ $(( now - last )) -ge 60 ]; then
      echo "$(date +%T) mac lock: $(maclock_status); waiting up to $(( (deadline - now + 59) / 60 )) more min for it ($kind)"
      last=$now
    fi
    sleep 3
  done
}

maclock_release() {
  [ "$HUI_MAC_LOCK_HELD" = 1 ] || return 0
  local o pid
  o=$(_maclock_owner); pid=${o%%|*}
  if [ "$pid" = "$$" ]; then rm -rf "$HUI_MAC_LOCK_DIR"; echo "$(date +%T) mac lock released"; fi
  HUI_MAC_LOCK_HELD=0
}

# CLI (only when executed, not sourced)
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  case "${1:-}" in
    status) maclock_status ;;
    run)
      kind=${2:?kind}; wait_s=${3:?wait seconds}; shift 3
      [ "${1:-}" = -- ] && shift
      [ $# -gt 0 ] || { echo "usage: maclock.sh run KIND WAIT_S -- CMD…" >&2; exit 2; }
      maclock_acquire "$kind" "$wait_s" || exit 3
      trap 'maclock_release' EXIT
      trap 'exit 130' INT TERM HUP
      "$@"
      ;;
    *) echo "usage: maclock.sh status | run KIND WAIT_S -- CMD…" >&2; exit 2 ;;
  esac
fi
