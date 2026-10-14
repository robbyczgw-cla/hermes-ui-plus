#!/usr/bin/env bash
# Package the official web app (PWA) bundle as a release asset: dist/release/hermes-ui-plus-web-<version>.tar.gz + .sha256
#
# Usage: [VERSION=x.y.z] [WEB_DIR=dist/web] [OUT_DIR=dist/release] scripts/package-web.sh
#   Run `FLAVOR=hermes scripts/build-web.sh` first (heavy, not done here). This script is light: it only checks,
#   scans and archives.
#   VERSION      release version [bridge/package.json "version": the release number, app/package.json is a placeholder]
#   WEB_DIR      the bundle [dist/web]; its provenance file is <WEB_DIR>.build-info (written by build-web.sh)
#   OUT_DIR      where the archive goes [dist/release]
#   SOURCE_DATE_EPOCH  mtime of all archive entries [2026-01-01]
# Refuses to package when
#   - WEB_DIR or its .build-info is missing, or the build was not FLAVOR=hermes (the personal flavor never ships)
#   - scripts/flavor-guard.mjs --output or the release gate scripts/scan-artifact.sh (leak-guard + gitleaks) fail
# Archive: top-level folder hermes-ui-plus-web/, entries sorted, fixed owner/mtime/modes, gzip without a timestamp
#   (same bundle -> same bytes). The precompressed .br / .gz files of the build are kept.
# Install on the server: docs/WEB-APP.md. The sha256 file is in `sha256sum -c` format.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_DIR="${WEB_DIR:-$ROOT/dist/web}"
OUT_DIR="${OUT_DIR:-$ROOT/dist/release}"
TOP="hermes-ui-plus-web"
die() { echo "package-web: $*" >&2; exit 1; }

command -v node >/dev/null || die "node not found"
command -v tar >/dev/null && tar --version 2>/dev/null | grep -q 'GNU tar' || die "GNU tar is required (macOS: brew install gnu-tar, then put it first in PATH as tar)"

[ -d "$WEB_DIR" ] || die "$WEB_DIR does not exist. Build it first: FLAVOR=hermes scripts/build-web.sh"
WEB_DIR="$(cd "$WEB_DIR" && pwd)"
[ -f "$WEB_DIR/index.html" ] && [ -f "$WEB_DIR/manifest.webmanifest" ] && [ -f "$WEB_DIR/sw.js" ] \
  || die "$WEB_DIR is not a web build (index.html / manifest.webmanifest / sw.js missing)"

# provenance: build-web.sh writes <out>.build-info (flavor / sw / sha / built) next to the bundle
INFO="$WEB_DIR.build-info"
[ -f "$INFO" ] || die "$INFO is missing, so the flavor of the bundle is unknown. Rebuild: FLAVOR=hermes scripts/build-web.sh"
FLAVOR_BUILT="$(sed -n 's/^flavor=//p' "$INFO")"
SW_BUILT="$(sed -n 's/^sw=//p' "$INFO")"
SHA_BUILT="$(sed -n 's/^sha=//p' "$INFO")"
[ "$FLAVOR_BUILT" = hermes ] || die "$WEB_DIR is a '${FLAVOR_BUILT:-unknown}' build; only FLAVOR=hermes bundles are packaged"
[ "$SW_BUILT" = 1 ] || echo "package-web: WARNING: the bundle was built with WEB_SW=${SW_BUILT:-?} (no offline shell); a release should use the default" >&2
HEAD_SHA="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo nogit)"
[ "$SHA_BUILT" = "$HEAD_SHA" ] || echo "package-web: WARNING: bundle built from $SHA_BUILT, repository HEAD is $HEAD_SHA (rebuild for a release)" >&2

VERSION="${VERSION:-$(node -p "require('$ROOT/bridge/package.json').version")}"
[[ "$VERSION" =~ ^[0-9A-Za-z][0-9A-Za-z.+_-]*$ ]] || die "bad VERSION '$VERSION'"

# the same gates as the build: identity check (flavor-guard) and release gate (private denylist + gitleaks)
export FLAVOR=hermes EXPO_PUBLIC_FLAVOR=hermes
# shellcheck source=lib/flavor.sh
. "$ROOT/scripts/lib/flavor.sh"
flavor_init
flavor_guard_output "$WEB_DIR" || die "flavor-guard rejected $WEB_DIR (private content); nothing packaged"
release_gate "$WEB_DIR" || die "release gate (scripts/scan-artifact.sh) failed for $WEB_DIR; nothing packaged"

mkdir -p "$OUT_DIR"
NAME="hermes-ui-plus-web-$VERSION"
ARCHIVE="$OUT_DIR/$NAME.tar.gz"
TMP="$ARCHIVE.tmp.$$"
trap 'rm -f "$TMP"' EXIT
DATE_EPOCH="${SOURCE_DATE_EPOCH:-$(date -u -d '2026-01-01 00:00:00' +%s)}"

# "." becomes "hermes-ui-plus-web"; names are sorted, owner/group 0, modes normalized (dirs 755, files 644)
tar -C "$WEB_DIR" --sort=name --mtime="@$DATE_EPOCH" --owner=0 --group=0 --numeric-owner \
    --mode='u+rwX,go+rX,go-w' --format=gnu --transform "s,^\.,$TOP," -cf - . | gzip -n -9 > "$TMP"
mv "$TMP" "$ARCHIVE"
trap - EXIT

# sha256 file in `sha256sum -c` format (relative file name, so it verifies next to the tarball)
( cd "$OUT_DIR" && sha256sum "$NAME.tar.gz" > "$NAME.tar.gz.sha256" )

echo "package-web: $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1), $(tar -tzf "$ARCHIVE" | wc -l) entries, top folder $TOP/)"
echo "package-web: $(cat "$ARCHIVE.sha256")"
