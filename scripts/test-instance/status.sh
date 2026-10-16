#!/usr/bin/env bash
# What of the test instance runs and listens right now (and who holds the lock).
#   scripts/test-instance/status.sh
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$here/lib.sh"
user_bus
say "flavor $TI_FLAVOR ($TI_NAME), instance lock: $(tilock_status)"
if [ "$TI_FLAVOR" = docker ]; then
  if container_running; then say "container $TI_CONTAINER: running ($(docker stats --no-stream --format '{{.MemUsage}}' "$TI_CONTAINER"))"
  elif docker inspect "$TI_CONTAINER" >/dev/null 2>&1; then say "container $TI_CONTAINER: exists, stopped"
  else say "container $TI_CONTAINER: none"; fi
  if bridge_running; then say "bridge unit $TI_BRIDGE_UNIT: active"; else say "bridge unit $TI_BRIDGE_UNIT: inactive"; fi
else
  for n in gateway bridge watchdog; do
    p="$(pid_of "$n")"
    if [ -n "$p" ]; then say "$n: running (pid $p, tree RSS $(($(tree_rss "$p" | cut -d' ' -f1) / 1024)) MB)"; else say "$n: not running"; fi
  done
fi
say "listeners on $TI_API_PORT/$TI_PLUGIN_PORT/$TI_BRIDGE_PORT:"
check_listeners && say "(none beyond 127.0.0.1)" || say "!! something listens beyond 127.0.0.1"
[ -d "$TI_DIR" ] && say "data: $TI_DIR ($(du -sh "$TI_DIR" 2>/dev/null | cut -f1))"
if [ "$TI_FLAVOR" = docker ]; then
  docker image inspect "$TI_IMAGE" >/dev/null 2>&1 && say "image: $TI_IMAGE (present)"
else
  [ -x "$TI_VENV/bin/hermes" ] && say "hermes: $TI_HERMES_TAG at $(git -C "$TI_HERMES_SRC" rev-parse --short HEAD 2>/dev/null), venv $TI_VENV"
  say "memory available: $(mem_avail_gb) GB; heavy lock: $([ -f "$TI_MAC_LOCK_LIB" ] && HUI_MAC_LOCK_DIR="$TI_MAC_LOCK_DIR" bash "$TI_MAC_LOCK_LIB" status || echo "(lane lock library not installed)")"
fi
true
