#!/usr/bin/env bash
# Stop hook for the skill-language eval (TI_STOP_SCRIPT, see ti-start.sh): the normal stop.sh, then restore config.yaml,
# the bridge's skill copy and the skills directory (removes hermes-ui and anything the model created during the eval).
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"
# shellcheck source=../../../scripts/test-instance/lib.sh
. "$repo/scripts/test-instance/lib.sh"
rc=0
bash "$repo/scripts/test-instance/stop.sh" || rc=$?
bak="$TI_DIR/skilllang-backup"
if [ -d "$bak" ]; then
  cp -a "$bak/config.yaml" "$TI_DATA/config.yaml"
  if [ -d "$bak/src-hermes-skill" ]; then rm -rf "$TI_SRC/hermes-skill"; cp -a "$bak/src-hermes-skill" "$TI_SRC/hermes-skill"; fi
  for e in $(ls -A "$TI_DATA/skills"); do
    grep -qxF "$e" "$bak/skills.list" || { rm -rf "${TI_DATA:?}/skills/$e"; say "removed skills/$e"; }
  done
  rm -rf "$bak"
  say "skill-language eval: config.yaml, skills and the bridge skill copy restored"
fi
exit "$rc"
