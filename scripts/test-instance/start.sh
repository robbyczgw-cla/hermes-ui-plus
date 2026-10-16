#!/usr/bin/env bash
# Start the test instance: Hermes gateway (multiplexed profiles, hermes-ui-plus plugin) and the UI bridge, everything
# on 127.0.0.1 and memory-capped (docker flavor: container + systemd --user unit; native flavor: pid-tracked processes
# + RSS watchdog). Takes the instance lock as a 2 h lease when it is free; refuses while a session.sh holds it.
# Prefer session.sh for start -> tests -> stop: it holds the lock for exactly that long.
#   scripts/test-instance/start.sh
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$here/lib.sh"
user_bus
[ -f "$TI_DATA/config.yaml" ] && [ -f "$TI_BRIDGE_ENV" ] || die "not set up yet: run $here/setup.sh"

if [ "${TI_LOCK_OWNED:-0}" != 1 ]; then
  tilock_is_session && die "a session holds the instance ($(tilock_status)); queue with session.sh --wait N"
  tilock_live || tilock_acquire "start.sh" 0 0 "$TI_LEASE_S" || die "could not take the instance lock"
fi
mac_heavy_check
if ! gateway_running; then
  [ "$(mem_avail_gb)" -ge "$TI_MIN_AVAIL_GB" ] || die "less than $TI_MIN_AVAIL_GB GB available"
  gateway_start
else
  say "gateway already runs"
fi
watchdog_start

api_key="$(cat "$TI_SECRETS/api_server_key")"
say "waiting for the Hermes API on 127.0.0.1:$TI_API_PORT"
for _ in $(seq 1 90); do
  curl -fsS -o /dev/null "http://127.0.0.1:$TI_API_PORT/health" 2>/dev/null && break
  sleep 2
done
curl -fsS -o /dev/null "http://127.0.0.1:$TI_API_PORT/health" || die "Hermes API did not come up ($([ "$TI_FLAVOR" = docker ] && echo "docker logs $TI_CONTAINER" || echo "$TI_RUN/gateway.log"))"
code="$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $api_key" "http://127.0.0.1:$TI_API_PORT/p/writer/v1/models")"
say "Hermes up; /p/writer/v1/models -> $code"

if bridge_running; then
  say "bridge already runs"
else
  bridge_start
fi
for _ in $(seq 1 30); do
  curl -fsS -o /dev/null "http://127.0.0.1:$TI_BRIDGE_PORT/health" 2>/dev/null && break
  sleep 1
done
curl -fsS -o /dev/null "http://127.0.0.1:$TI_BRIDGE_PORT/health" || die "bridge did not come up ($([ "$TI_FLAVOR" = docker ] && echo "journalctl --user -u $TI_BRIDGE_UNIT" || echo "$TI_RUN/bridge.log"))"

if [ "$TI_FLAVOR" = docker ]; then
  say "gateway python: $(docker exec "$TI_CONTAINER" sh -c 'for p in /proc/[0-9]*; do c=$(tr "\0" " " < $p/cmdline 2>/dev/null); case "$c" in *"gateway run"*) echo "$c"; break;; esac; done' | cut -c1-120)"
else
  say "gateway python: $TI_VENV/bin/python ($("$TI_VENV/bin/python" -V 2>&1)), tree RSS $(($(tree_rss "$(pid_of gateway)" | cut -d' ' -f1) / 1024)) MB"
fi
say "listeners (must all be 127.0.0.1):"
check_listeners || die "something listens beyond 127.0.0.1, stopping"
say "ready: bridge http://127.0.0.1:$TI_BRIDGE_PORT (emulator on this host: http://10.0.2.2:$TI_BRIDGE_PORT)"
