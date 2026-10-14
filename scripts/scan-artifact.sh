#!/usr/bin/env bash
# Release gate: scan a built artifact for private content and secrets BEFORE it is published or shared.
#   scripts/scan-artifact.sh <app-release.apk | .aab | .ipa | .zip | directory (dist/web, unzipped APK) | Foo.app>
# Runs leak-guard --path (denylist REQUIRED + generic patterns) and gitleaks dir on the unpacked content.
# Exit 0 only when both are clean. Needs HUI_PRIVATE_DIR (private denylist) and gitleaks (docs/LEAK-GUARD.md).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/.local/bin:$PATH"
# --public: for a contributor WITHOUT the private overlay (no $HUI_PRIVATE_DIR/leak-denylist.txt): generic patterns +
#           gitleaks only. Refused when a denylist exists, so the maintainer's gate can never be weakened by it.
PUBLIC=0
if [ "${1:-}" = --public ]; then PUBLIC=1; shift; fi
[ $# -eq 1 ] || { echo "usage: $0 [--public] <apk|aab|ipa|zip|dir|.app>" >&2; exit 2; }
target="$1"
PDIR="${HUI_PRIVATE_DIR:-$HOME/work/hermesiui-private}"
if [ "$PUBLIC" = 1 ] && [ -e "$PDIR/leak-denylist.txt" ]; then
  echo "scan-artifact: --public refused: $PDIR/leak-denylist.txt exists (run the full gate)" >&2; exit 2
fi
[ -e "$target" ] || { echo "scan-artifact: $target does not exist" >&2; exit 2; }
command -v node >/dev/null || { echo "scan-artifact: node not found" >&2; exit 2; }
command -v gitleaks >/dev/null || { echo "scan-artifact: gitleaks not found (docs/LEAK-GUARD.md)" >&2; exit 2; }

work=""
cleanup() { [ -n "$work" ] && rm -rf "$work"; return 0; }
trap cleanup EXIT

if [ -d "$target" ]; then
  scan_dir="$target"
else
  case "$target" in
    *.apk|*.aab|*.ipa|*.zip|*.jar)
      command -v unzip >/dev/null || { echo "scan-artifact: unzip not found" >&2; exit 2; }
      work="$(mktemp -d "${TMPDIR:-/tmp}/hui-scan.XXXXXX")"
      unzip -q -o "$target" -d "$work" || { echo "scan-artifact: could not unpack $target" >&2; exit 2; }
      scan_dir="$work" ;;
    *) echo "scan-artifact: don't know how to unpack $target (give an apk/aab/ipa/zip or a directory)" >&2; exit 2 ;;
  esac
fi
echo "scan-artifact: scanning $target"
rc=0
if [ "$PUBLIC" = 1 ]; then
  echo "== leak-guard (public: generic patterns only, no private overlay) =="
  node "$ROOT/scripts/leak-guard.mjs" --path "$scan_dir" --generic-only || rc=1
else
  echo "== leak-guard (denylist required + generic patterns) =="
  node "$ROOT/scripts/leak-guard.mjs" --path "$scan_dir" --require-denylist || rc=1
fi
echo "== gitleaks (secrets) =="
gitleaks dir "$scan_dir" --config "$ROOT/.gitleaks.toml" --redact --no-banner --verbose || rc=1
if [ "$rc" -ne 0 ]; then
  echo "scan-artifact: FAILED: do not publish $target" >&2
  exit 1
fi
echo "scan-artifact: OK: $target is clean"
