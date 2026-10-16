#!/usr/bin/env bash
# ⚡ without the plugin: take hermes-ui-plus out of plugins.enabled (config.yaml, never the CLI), restart the
# gateway, run the API checks of phase "off", then enable it again and restart. The bridge keeps running.
#   scripts/test-instance/quick-off-test.sh [api-test options]
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$here/lib.sh"
cfg="$TI_DATA/config.yaml"
gateway_running || die "the instance is not running (start.sh)"
grep -q '^  enabled: \[hermes-ui-plus\]$' "$cfg" || die "unexpected plugins.enabled line in $cfg"

restart_gateway() {
  gateway_restart
  for _ in $(seq 1 90); do
    curl -fsS -o /dev/null "http://127.0.0.1:$TI_API_PORT/health" 2>/dev/null && return 0
    sleep 2
  done
  die "Hermes API did not come back"
}
restore() {
  sed 's/^  enabled: \[\]  # quick-off-test$/  enabled: [hermes-ui-plus]/' "$cfg" > "$cfg.tmp" && cat "$cfg.tmp" > "$cfg" && rm -f "$cfg.tmp"
  restart_gateway
  say "plugin enabled again: $(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$TI_PLUGIN_PORT/health") from /health"
}
trap restore EXIT

sed 's/^  enabled: \[hermes-ui-plus\]$/  enabled: []  # quick-off-test/' "$cfg" > "$cfg.tmp" && cat "$cfg.tmp" > "$cfg" && rm -f "$cfg.tmp"
restart_gateway
sleep 3
if curl -fsS -o /dev/null "http://127.0.0.1:$TI_PLUGIN_PORT/health" 2>/dev/null; then die "plugin still listens"; fi
say "plugin disabled (port $TI_PLUGIN_PORT closed); running phase off"
TI_DIR="$TI_DIR" TI_BRIDGE_PORT="$TI_BRIDGE_PORT" TI_PLUGIN_PORT="$TI_PLUGIN_PORT" node "$here/api-test.mjs" --phase off "$@"
