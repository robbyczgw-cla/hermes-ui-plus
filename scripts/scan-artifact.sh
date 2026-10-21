#!/usr/bin/env bash
# Release gate: scan a built artifact for private content and secrets BEFORE it is published or shared.
#   scripts/scan-artifact.sh <app-release.apk | .aab | .ipa | .zip | directory (dist/web, unzipped APK) | Foo.app | single file>
# A single file (.dmg .AppImage .deb .gz, mp4/mov/m4a/mp3/webm/png/jpg/webp, .md/.txt/.json) is scanned as it is; the copy keeps
# its file name, which is scanned too. Media containers: only their metadata/text parts, never the compressed stream.
# Runs leak-guard --path (denylist REQUIRED + generic patterns) and gitleaks dir on the unpacked content.
# A JS bundle (index.android.bundle / main.jsbundle) must decode as Hermes bytecode, so every string of its string
# table is scanned with its real boundaries (leak-guard --expect-hermes). AAB and IPA are release-only and must contain
# one; a debug APK has none (it loads from Metro).
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
HERMES=()
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
    # a single file that is not an archive: scanned as it is (media containers: metadata only, see docs/LEAK-GUARD.md)
    *.dmg|*.AppImage|*.deb|*.rpm|*.tar.gz|*.tgz|*.gz|*.mp4|*.m4v|*.mov|*.m4a|*.mp3|*.webm|*.png|*.jpg|*.jpeg|*.webp|*.md|*.txt|*.json|*.sha256)
      work="$(mktemp -d "${TMPDIR:-/tmp}/hui-scan.XXXXXX")"
      cp -- "$target" "$work/" || { echo "scan-artifact: could not copy $target" >&2; exit 2; }
      scan_dir="$work" ;;
    *) echo "scan-artifact: don't know how to unpack $target (give an apk/aab/ipa/zip, a directory, or a single dmg/AppImage/deb/gz/media/text file)" >&2; exit 2 ;;
  esac
fi
if [ -n "$(find "$scan_dir" -type f \( -name index.android.bundle -o -name main.jsbundle \) -print -quit)" ]; then
  HERMES=(--expect-hermes)
else
  case "$target" in
    *.aab|*.ipa) echo "scan-artifact: $target has no JS bundle (index.android.bundle / main.jsbundle)" >&2; exit 2 ;;
    *.apk) echo "scan-artifact: no JS bundle in $target (debug APK)" ;;
  esac
fi
echo "scan-artifact: scanning $target"
rc=0
# leak-guard --path reads .leak-guard-allow from the working directory: always the repo's, wherever this is called from
scan_dir="$(cd "$scan_dir" && pwd)"
lg() { (cd "$ROOT" && node scripts/leak-guard.mjs --path "$scan_dir" "$@"); }
if [ "$PUBLIC" = 1 ]; then
  echo "== leak-guard (public: generic patterns only, no private overlay) =="
  lg --generic-only ${HERMES[@]+"${HERMES[@]}"} || rc=1
else
  echo "== leak-guard (denylist required + generic patterns) =="
  lg --require-denylist ${HERMES[@]+"${HERMES[@]}"} || rc=1
fi
echo "== gitleaks (secrets) =="
# gitleaks gets a copy in which every Hermes bytecode file is replaced by its decoded strings, one per line: in the raw
# string storage unrelated neighbours run together into fake tokens (generic-api-key false positive). Text bundles and
# all other files are copied unchanged, so nothing is hidden. A bytecode file that does not decode fails the gate.
gl_dir="$(mktemp -d "${TMPDIR:-/tmp}/hui-gl.XXXXXX")"
trap 'cleanup; rm -rf "$gl_dir"' EXIT
node "$ROOT/scripts/hermes-strings-dump.mjs" "$scan_dir" "$gl_dir/tree" || rc=1
[ -d "$gl_dir/tree" ] && { gitleaks dir "$gl_dir/tree" --config "$ROOT/.gitleaks.toml" --redact --no-banner --verbose || rc=1; }
if [ "$rc" -ne 0 ]; then
  echo "scan-artifact: FAILED: do not publish $target" >&2
  exit 1
fi
echo "scan-artifact: OK: $target is clean"
