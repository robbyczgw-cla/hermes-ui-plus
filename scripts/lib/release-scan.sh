#!/usr/bin/env bash
# Scans for release.sh that fail loudly: every function returns non-zero when the scan finds something or cannot run, and
# never sits in a pipe (`scan | tail` would swallow the exit code; that let a DMG upload run before its own scan was
# known). Callers use them as a plain statement under `set -e`, or as `release_scan_… || die`.
#   SCAN_ARTIFACT  the scanner [scripts/scan-artifact.sh]
release_scan_artifact() { # FILE… : each file is scanned on its own, in order; stops at the first failure
  local f scan="${SCAN_ARTIFACT:-$(dirname "${BASH_SOURCE[0]}")/../scan-artifact.sh}"
  [ $# -gt 0 ] || { echo "release-scan: nothing to scan" >&2; return 2; }
  for f in "$@"; do
    [ -f "$f" ] || { echo "release-scan: $f is not a file" >&2; return 2; }
    echo "  scan: $f"
    "$scan" "$f" || { echo "release-scan: FAILED: $f (nothing is uploaded)" >&2; return 1; }
  done
}
release_scan_notes() { # NOTES.md : scanned by content from a neutral temp dir (a private path must not be what is flagged)
  local notes="$1" d rc=0 scan="${SCAN_ARTIFACT:-$(dirname "${BASH_SOURCE[0]}")/../scan-artifact.sh}"
  [ -s "$notes" ] || { echo "release-scan: release notes $notes missing or empty" >&2; return 2; }
  d="$(mktemp -d "${TMPDIR:-/tmp}/hui-notes.XXXXXX")" || return 2
  cp "$notes" "$d/release-notes.md" || { rm -rf "$d"; return 2; }
  "$scan" "$d" || rc=1
  rm -rf "$d"
  [ "$rc" = 0 ] || echo "release-scan: FAILED: the release notes (no release is created)" >&2
  return "$rc"
}
