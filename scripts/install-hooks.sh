#!/usr/bin/env bash
# Enable the tracked git hooks (.githooks/) for THIS clone: git config core.hooksPath .githooks
# Not enabled by default on the private archive repo; run it in the public repo checkout.
#   scripts/install-hooks.sh            enable
#   scripts/install-hooks.sh --remove   disable again
set -euo pipefail
cd "$(dirname "$0")/.."
if [ "${1:-}" = "--remove" ]; then
  git config --unset core.hooksPath || true
  echo "hooks disabled (core.hooksPath unset)"
  exit 0
fi
export PATH="$HOME/.local/bin:$PATH"
ok=1
command -v gitleaks >/dev/null || { echo "WARNING: gitleaks not in PATH (hooks will block until installed; see docs/LEAK-GUARD.md)" >&2; ok=0; }
command -v node >/dev/null || { echo "WARNING: node not in PATH" >&2; ok=0; }
[ -n "${HUI_PRIVATE_DIR:-}" ] && [ -f "$HUI_PRIVATE_DIR/leak-denylist.txt" ] \
  || echo "WARNING: \$HUI_PRIVATE_DIR/leak-denylist.txt not found: only generic patterns will be checked" >&2
chmod +x .githooks/pre-commit .githooks/pre-push
git config core.hooksPath .githooks
echo "hooks enabled: core.hooksPath=.githooks (pre-commit: gitleaks+leak-guard --staged; pre-push: gitleaks range + leak-guard --tree)"
[ "$ok" = 1 ] || exit 1
