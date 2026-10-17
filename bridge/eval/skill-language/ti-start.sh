#!/usr/bin/env bash
# Start hook for scripts/test-instance/session.sh (TI_START_SCRIPT) used by the skill-language eval. Runs on the test
# host inside the session lock. Before the normal start.sh it installs THIS checkout's hermes-ui skill into the test
# Hermes (skills/hermes-ui, so skill_view can load the references like on a normal install) and into the bridge's
# skill copy (bootstrap + inline core), and gives the API platform the `skills` toolset. ti-stop.sh undoes all of it.
#   TI_START_SCRIPT=<this> TI_STOP_SCRIPT=<dir>/ti-stop.sh session.sh --wait 600 --label skill-language -- node run.mjs …
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"
# shellcheck source=../../../scripts/test-instance/lib.sh
. "$repo/scripts/test-instance/lib.sh"
bak="$TI_DIR/skilllang-backup"
[ -e "$bak" ] && die "$bak exists: a previous eval did not restore; run ti-stop.sh first"
mkdir -p "$bak"
cp -a "$TI_DATA/config.yaml" "$bak/config.yaml"
ls -A "$TI_DATA/skills" > "$bak/skills.list"
[ -d "$TI_SRC/hermes-skill" ] && cp -a "$TI_SRC/hermes-skill" "$bak/src-hermes-skill"
grep -q '^  api_server: \[todo\]$' "$TI_DATA/config.yaml" || die "unexpected platform_toolsets in config.yaml"
sed -i.tmp 's/^  api_server: \[todo\]$/  api_server: [todo, skills]/' "$TI_DATA/config.yaml" && rm -f "$TI_DATA/config.yaml.tmp"
rm -rf "$TI_DATA/skills/hermes-ui"
cp -a "$repo/hermes-skill/hermes-ui" "$TI_DATA/skills/hermes-ui"
rm -rf "$TI_SRC/hermes-skill"
cp -a "$repo/hermes-skill" "$TI_SRC/hermes-skill"
say "skill-language eval: hermes-ui $(sed -n 's/^version: //p' "$repo/hermes-skill/hermes-ui/SKILL.md") installed, api_server toolsets [todo, skills]"
exec bash "$repo/scripts/test-instance/start.sh"
