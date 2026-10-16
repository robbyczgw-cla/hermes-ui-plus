#!/usr/bin/env bash
# The exclusive instance lock (start -> tests -> stop), for people who do not use session.sh.
#   scripts/test-instance/lock.sh status
#   scripts/test-instance/lock.sh take [--wait SECONDS] [--lease SECONDS] [LABEL]   lease lock (default 2 h)
#   scripts/test-instance/lock.sh release [--force]                                  only a lease; a live session needs --force
# Lock directory: /tmp/hui-testinst-<mac|linux>.lock (TI_LOCK_DIR). Works on Linux and macOS (mkdir, no flock).
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$here/lib.sh"
cmd="${1:-status}"; [ $# -gt 0 ] && shift
case "$cmd" in
  status) tilock_status ;;
  take)
    wait_s=0; lease_s="$TI_LEASE_S"; label="manual"
    while [ $# -gt 0 ]; do
      case "$1" in
        --wait) wait_s="$2"; shift 2 ;;
        --lease) lease_s="$2"; shift 2 ;;
        *) label="$1"; shift ;;
      esac
    done
    tilock_acquire "$label" "$wait_s" 0 "$lease_s" || exit 3 ;;
  release)
    if tilock_is_session && [ "${1:-}" != --force ]; then die "a session holds the lock ($(tilock_status)); --force overrides"; fi
    tilock_release ;;
  *) echo "usage: lock.sh status | take [--wait S] [--lease S] [LABEL] | release [--force]" >&2; exit 2 ;;
esac
