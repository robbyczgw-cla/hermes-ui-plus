#!/usr/bin/env bash
# Bots v2 slices 4 + 5 live checks on the test host (bots-about-test.mjs), run inside a session: "Immer erlaubt" read and
# revoked (a fresh session asks again), another bot's library, archive / bring back (gateway.parked), the activity of a
# running turn and Stop through the bridge. `writer` gets the terminal toolset + manual approvals for the run, like
# `bots-test.sh --approval`; its config is restored on every exit path, then bots-create-test.sh's cleanup compares every
# config / memory / key file with the snapshot, restores devices.json and checks gateway pid + venv and facts.json.
#   bash scripts/test-instance/bots-about-test.sh [--out DIR]
# Never prints tokens or keys.
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$here/lib.sh"
W="$TI_DATA/profiles/writer"
cfg="$W/config.yaml"
bash "$here/bots-create-test.sh" snapshot || die "snapshot failed"
bak="$(mktemp "${TMPDIR:-/tmp}/hui-bots-about-writer-XXXXXX")"
cp -p "$cfg" "$bak"
restore() {
  cp -p "$bak" "$cfg" && rm -f "$bak"
  # a marker the run left behind (a failed restore) must not park writer for the next test
  rm -f "$W/gateway.parked"
  say "writer config.yaml restored, no gateway.parked left"
  bash "$here/bots-create-test.sh" cleanup || rc=1
  exit "${rc:-0}"
}
trap restore EXIT
# setup.sh writes writer's config.yaml from a fixed template: a text edit, no YAML library needed on either host
grep -q '^  api_server: \[todo\]$' "$cfg" || { say "writer config.yaml is not the setup template; refusing to edit it"; rc=1; exit 1; }
sed -i.bak 's/^  api_server: \[todo\]$/  api_server: [todo, terminal]/' "$cfg" && rm -f "$cfg.bak"
printf 'approvals:\n  mode: manual\n' >> "$cfg"
say "writer: terminal toolset + manual approvals for this run; waiting 40 s for the gateway's profile rescan"
sleep 40
TI_DATA="$TI_DATA" node "$here/bots-about-test.mjs" "$@"
rc=$?
