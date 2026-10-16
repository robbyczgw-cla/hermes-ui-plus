#!/usr/bin/env bash
# Rebuild the app's bundled fonts (SIL OFL 1.1) from the official upstream files:
#   native (expo-font config plugin, app.json): app/assets/fonts/*.ttf   – static faces, one file per weight
#   web / desktop (@font-face in app/public/index.html): app/public/fonts/*.woff2 – variable 400–700
#
# Usage: scripts/subset-fonts.sh SRC_DIR
#   SRC_DIR must hold the upstream files listed in SOURCES below (download them yourself, e.g. with curl).
#   Needs fonttools + brotli on PATH (`python3 -m venv v && v/bin/pip install fonttools brotli`).
#
# Roles: Atkinson Hyperlegible Next = UI and text, Gloock = greeting / onboarding titles / empty states only,
# JetBrains Mono = code and commands. Subsets: Latin incl. Latin Extended A/B and Vietnamese for the text face,
# Latin + Latin Extended A for Gloock, Latin + box drawing for the mono face; anything else falls back to the
# system font per glyph. Mono drops `calt` (no programming ligatures: a command reads exactly as typed).
set -euo pipefail
SRC=${1:?usage: subset-fonts.sh SRC_DIR}
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NATIVE="$ROOT/app/assets/fonts"
WEB="$ROOT/app/public/fonts"
# SOURCES (raw.githubusercontent.com):
#   googlefonts/atkinson-hyperlegible-next/main/fonts/ttf/AtkinsonHyperlegibleNext-{Regular,Medium,SemiBold,Bold,Italic}.ttf
#   googlefonts/atkinson-hyperlegible-next/main/fonts/variable/AtkinsonHyperlegibleNext[wght].ttf, …-Italic[wght].ttf
#   JetBrains/JetBrainsMono/master/fonts/ttf/JetBrainsMono-{Regular,Bold}.ttf
#   JetBrains/JetBrainsMono/master/fonts/variable/JetBrainsMono[wght].ttf
#   duartp/gloock/main/fonts/ttf/Gloock-Regular.ttf
TEXT_U="U+0000-00FF,U+0100-017F,U+0180-024F,U+0259,U+02B0-02FF,U+0300-036F,U+1E00-1EFF,U+2000-206F,U+20A0-20CF,U+2100-214F,U+2190-21FF,U+2200-22FF,U+25A0-25FF,U+FB01-FB02"
DISP_U="U+0000-00FF,U+0100-017F,U+0218-021B,U+0300-036F,U+1E9E,U+2000-206F,U+20AC,U+2122,U+2190-2193"
MONO_U="U+0000-00FF,U+0100-017F,U+0218-021B,U+0300-036F,U+2000-206F,U+20A0-20CF,U+2100-214F,U+2190-21FF,U+2200-22FF,U+2500-259F,U+25A0-25FF"
T_FEAT="--layout-features=ccmp,locl,mark,mkmk,kern,liga,calt,case,tnum,frac,sups"
M_FEAT="--layout-features=ccmp,locl,mark,mkmk,kern,case,zero"
NAT="--no-hinting --desubroutinize --name-IDs=* --name-legacy --name-languages=* --notdef-outline"
WOFF="--flavor=woff2 --desubroutinize --notdef-outline"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
mkdir -p "$NATIVE" "$WEB"

for w in Regular Medium SemiBold Bold Italic; do
  pyftsubset "$SRC/AtkinsonHyperlegibleNext-$w.ttf" --unicodes="$TEXT_U" $T_FEAT $NAT --output-file="$NATIVE/AtkinsonHyperlegibleNext-$w.ttf"
done
pyftsubset "$SRC/Gloock-Regular.ttf" --unicodes="$DISP_U" $T_FEAT $NAT --output-file="$NATIVE/Gloock-Regular.ttf"
for w in Regular Bold; do
  pyftsubset "$SRC/JetBrainsMono-$w.ttf" --unicodes="$MONO_U" $M_FEAT $NAT --output-file="$NATIVE/JetBrainsMono-$w.ttf"
done

fonttools varLib.instancer "$SRC/AtkinsonHyperlegibleNext[wght].ttf" wght=400:700 -q -o "$TMP/ahn.ttf"
fonttools varLib.instancer "$SRC/AtkinsonHyperlegibleNext-Italic[wght].ttf" wght=400:700 -q -o "$TMP/ahn-i.ttf"
fonttools varLib.instancer "$SRC/JetBrainsMono[wght].ttf" wght=400:700 -q -o "$TMP/jbm.ttf"
pyftsubset "$TMP/ahn.ttf" --unicodes="$TEXT_U" $T_FEAT $WOFF --output-file="$WEB/atkinson-hyperlegible-next-var.woff2"
pyftsubset "$TMP/ahn-i.ttf" --unicodes="$TEXT_U" $T_FEAT $WOFF --output-file="$WEB/atkinson-hyperlegible-next-italic-var.woff2"
pyftsubset "$TMP/jbm.ttf" --unicodes="$MONO_U" $M_FEAT $WOFF --output-file="$WEB/jetbrains-mono-var.woff2"
pyftsubset "$SRC/Gloock-Regular.ttf" --unicodes="$DISP_U" $T_FEAT $WOFF --output-file="$WEB/gloock-regular.woff2"

ls -l "$NATIVE"/*.ttf "$WEB"/*.woff2 | awk '{ s += $5; print $5, $NF } END { print s, "bytes total" }'
