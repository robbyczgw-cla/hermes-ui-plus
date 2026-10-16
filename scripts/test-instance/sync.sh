#!/usr/bin/env bash
# Copy the parts of this repo the test instance needs to the test host.
#   scripts/test-instance/sync.sh [--host mac|linux|<ssh alias>]    default: TI_HOST from $HUI_PRIVATE_DIR/test-instance.env
# Target: ~/hermes-test/repo (Linux host) or ~/hermes-test-mac/repo (Mac) with bridge/, hermes-plugin/, hermes-skill/,
# scripts/test-instance/, scripts/e2e/.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
# shellcheck source=host.sh
. "$here/host.sh"
name=""
[ "${1:-}" = "--host" ] && name="${2:?--host needs mac|linux|<alias>}"
host="$(ti_resolve_host "$name")"
rel="$(ti_remote_rel "$host")"
dest="\$HOME/$rel/repo"
ti_ssh "$host" "umask 077; mkdir -p $dest/scripts && chmod 700 \$HOME/$rel"
COPYFILE_DISABLE=1 tar -C "$repo" --exclude=node_modules --exclude=__pycache__ --exclude=bridge/eval \
  -cf - bridge hermes-plugin hermes-skill scripts/test-instance scripts/e2e \
  | ti_ssh "$host" "cd $dest && rm -rf bridge hermes-plugin hermes-skill scripts/test-instance scripts/e2e && tar -xf -"
echo "synced $(git -C "$repo" rev-parse --short HEAD) to ~/$rel/repo on the ${name:-default} host" >&2
