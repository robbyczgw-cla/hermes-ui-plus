#!/usr/bin/env bash
# Stop the test instance (bridge, gateway, watchdog). Data, keys and sessions stay for the next start.sh. Releases a
# lease lock; refuses while a live session.sh holds the lock (--force overrides).
#   scripts/test-instance/stop.sh [--force]
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$here/lib.sh"
user_bus
if [ "${TI_LOCK_OWNED:-0}" != 1 ] && [ "${1:-}" != --force ] && tilock_is_session; then
  die "a session holds the instance ($(tilock_status)); stop.sh --force overrides"
fi
bridge_stop
gateway_stop
watchdog_stop
left=0
bridge_running && { say "bridge still active"; left=1; }
gateway_running && { say "gateway still running"; left=1; }
if any_listener; then
  say "a port of the instance is still open:"; check_listeners || true; left=1
fi
if [ "$left" = 0 ]; then
  say "stopped: no gateway, no bridge, no listener on $TI_API_PORT/$TI_PLUGIN_PORT/$TI_BRIDGE_PORT"
  [ "${TI_LOCK_OWNED:-0}" = 1 ] || tilock_is_session || tilock_release
fi
exit "$left"
