#!/usr/bin/env bash
# Re-brand an exported web build with a custom icon (e.g. a family instance).
# Usage: scripts/web-brand.sh <square-icon.png> [dist/web]
# Generates icon-192/512, maskable (with safe-zone padding), apple-touch-icon (opaque) and favicon.
set -euo pipefail
SRC=${1:?icon png}; DIST=${2:-dist/web}
command -v convert >/dev/null || { echo "ImageMagick 'convert' required" >&2; exit 1; }
[ -d "$DIST/icons" ] || { echo "no $DIST/icons — run scripts/build-web.sh first" >&2; exit 1; }
BG=${BRAND_BG:-white}
base() { convert "$SRC" -background "$BG" -alpha remove -alpha off -gravity center -resize "$1x$1" -extent "$1x$1" "$2"; }
padded() { local inner=$(( $1 * $3 / 100 )); convert "$SRC" -background "$BG" -alpha remove -alpha off -resize "${inner}x${inner}" -gravity center -extent "$1x$1" "$2"; }
padded 512 "$DIST/icons/icon-512.png" 92
padded 192 "$DIST/icons/icon-192.png" 92
padded 512 "$DIST/icons/icon-maskable-512.png" 72   # Android maskable: keep the motif inside the 80 % safe zone
padded 180 "$DIST/icons/apple-touch-icon.png" 88    # iOS rounds corners itself; must be opaque
base 48 /tmp/hui-favicon-48.png && convert /tmp/hui-favicon-48.png "$DIST/favicon.ico" && rm -f /tmp/hui-favicon-48.png
echo "branded $DIST with $SRC"
