#!/usr/bin/env bash
# Writes media/<name>.webp next to every committed poster media/<name>.jpg (about half the bytes). The page uses the
# .webp posters; the .jpg files stay as masters, and trailer-poster.jpg is also the og:image (share crawlers want JPEG/PNG).
# The trailer poster is cut to 1280 px wide: it is never shown larger than that.
set -euo pipefail
cd "$(dirname "$0")/media"
for f in *.jpg; do
  n="${f%.jpg}"
  vf=()
  [ "$n" = trailer-poster ] && vf=(-vf scale=1280:-2)
  ffmpeg -loglevel error -y -i "$f" "${vf[@]}" -c:v libwebp -quality 80 -compression_level 6 "$n.webp"
done
ls -l *.webp | awk '{s+=$5} END {print NR " posters, " s " bytes"}'
