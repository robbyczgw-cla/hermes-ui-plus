# shellcheck shell=bash
# Shared by the Hermes Interactive UI+ git hooks. Sourced, not executed.
# Rule: a missing tool or a failing scanner BLOCKS (never a silent pass). Bypass only consciously: git commit/push --no-verify.
ROOT="$(git rev-parse --show-toplevel)"
export PATH="$HOME/.local/bin:$PATH"
LEAK_GUARD=(node "$ROOT/scripts/leak-guard.mjs")
GITLEAKS_CFG="$ROOT/.gitleaks.toml"

hui_need() {
  command -v "$1" >/dev/null 2>&1 || { echo "hooks: '$1' not found in PATH. $2" >&2; exit 1; }
}
hui_check_env() {
  hui_need node "Install Node (see docs/BUILD.md)."
  hui_need gitleaks "Install gitleaks to ~/.local/bin (docs/LEAK-GUARD.md, 'Install')."
  [ -f "$GITLEAKS_CFG" ] || { echo "hooks: $GITLEAKS_CFG missing" >&2; exit 1; }
}
