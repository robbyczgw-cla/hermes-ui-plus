#!/usr/bin/env bash
# Bots v2 live checks on the test host (bots-test.mjs), run inside a session. With --approval the profile "writer" gets
# the terminal toolset and manual approvals for the run (config.yaml backed up first) and is restored afterwards on every
# exit path; the script checks that writer's and the default config are byte-identical again.
#   bash scripts/test-instance/bots-test.sh [--approval]
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$here/lib.sh"
cfg="$TI_DATA/profiles/writer/config.yaml"
approval=""; [ "${1:-}" = "--approval" ] && approval=1
# --delivery alone: no profile edit needed (the default bot gets a cron job through the API)
if [ -z "$approval" ]; then exec node "$here/bots-test.mjs" "$@"; fi
bak="$(mktemp "${TMPDIR:-/tmp}/hui-bots-writer-XXXXXX")"
cp -p "$cfg" "$bak"
def_sum="$(shasum "$TI_DATA/config.yaml" | cut -d' ' -f1)"
w_sum="$(shasum "$cfg" | cut -d' ' -f1)"
restore() {
  cp -p "$bak" "$cfg" && rm -f "$bak"
  [ "$(shasum "$cfg" | cut -d' ' -f1)" = "$w_sum" ] && say "writer config.yaml restored (sha1 identical)" || say "WARNING: writer config.yaml differs after restore"
  [ "$(shasum "$TI_DATA/config.yaml" | cut -d' ' -f1)" = "$def_sum" ] && say "default config.yaml unchanged" || say "WARNING: default config.yaml changed"
}
trap restore EXIT
# setup.sh writes writer's config.yaml from a fixed template: a text edit, no YAML library needed on either host
grep -q '^  api_server: \[todo\]$' "$cfg" || { say "writer config.yaml is not the setup template; refusing to edit it"; exit 1; }
sed -i.bak 's/^  api_server: \[todo\]$/  api_server: [todo, terminal]/' "$cfg" && rm -f "$cfg.bak"
printf 'approvals:\n  mode: manual\n' >> "$cfg"
say "writer: terminal toolset + manual approvals for this run; waiting 40 s for the gateway's profile rescan"
sleep 40
node "$here/bots-test.mjs" --approval "${@:2}"
