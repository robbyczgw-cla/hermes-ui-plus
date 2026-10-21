#!/usr/bin/env bash
# Copy the parts of this repo the test instance needs to the test host.
#   scripts/test-instance/sync.sh [--host mac|linux|<ssh alias>] [--force]    default: TI_HOST from $HUI_PRIVATE_DIR/test-instance.env
# Refuses while the instance lock is held (a session or hold.sh backup/restore is using the very files this replaces,
# and a backup proof taken meanwhile would not match); --force overrides.
# Target: ~/hermes-test/repo (Linux host) or ~/hermes-test-mac/repo (Mac) with bridge/, hermes-plugin/, hermes-skill/,
# scripts/test-instance/, scripts/e2e/.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
# shellcheck source=host.sh
. "$here/host.sh"
name=""
force=0
while [ $# -gt 0 ]; do
  case "$1" in
    --host) name="${2:?--host needs mac|linux|<alias>}"; shift 2 ;;
    --force) force=1; shift ;;
    *) echo "usage: sync.sh [--host mac|linux|<alias>] [--force]" >&2; exit 2 ;;
  esac
done
host="$(ti_resolve_host "$name")"
rel="$(ti_remote_rel "$host")"
dest="\$HOME/$rel/repo"
if [ "$force" != 1 ]; then
  held="$(ti_ssh "$host" "f=$dest/scripts/test-instance/lock.sh; [ -f \$f ] && bash \$f status 2>/dev/null || echo free" | tail -n 1)"
  [ "$held" = free ] || { echo "sync refused: the instance lock is held ($held); wait for it or use --force" >&2; exit 3; }
fi
ti_ssh "$host" "umask 077; mkdir -p $dest/scripts && chmod 700 \$HOME/$rel"
COPYFILE_DISABLE=1 tar -C "$repo" --exclude=node_modules --exclude=__pycache__ --exclude=bridge/eval \
  -cf - bridge hermes-plugin hermes-skill scripts/test-instance scripts/e2e \
  | ti_ssh "$host" "cd $dest && rm -rf bridge hermes-plugin hermes-skill scripts/test-instance scripts/e2e && tar -xf -"
echo "synced $(git -C "$repo" rev-parse --short HEAD) to ~/$rel/repo on the ${name:-default} host" >&2
