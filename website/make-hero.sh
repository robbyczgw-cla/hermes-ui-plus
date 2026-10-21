#!/usr/bin/env bash
# Cuts the website's hero clip (media/<HERO_NAME>.mp4 + .jpg, default hero-loop) out of a vertical trailer.
#
#   website/make-hero.sh <vertical-trailer.mp4> [out-dir]      (out-dir defaults to website/media)
#   website/make-hero.sh --raw <take.mp4>@<from>-<to> [<take.mp4>@<from>-<to> ...]   (out-dir: OUT=..., default website/media)
#
# --raw cuts the loop from the recorder's raw footage (scripts/demo-videos: the app's screen only, 60 fps, 2x points,
# e.g. media/0.2-v2/_work/takes/en/<take>/raw.mp4) instead of a finished trailer. The 0.2 trailer has a light paper
# backdrop and zooms, so the screen detection below cannot read it; the raw takes need none: the whole frame is the screen
# (CROP stays unset, the take is scaled to WIDTH). Each argument is one scene: take, start and end second; scenes are
# joined in the order given with hard cuts. HERO_FPS defaults to 60 for raw takes (the loop is smaller than 2 MB at 540 px) and to 30
# for a trailer.
# Without the trailer-specific steps 1 and 2:
#
# The trailer shows the app's screen (light) inside a phone on a dark backdrop, with dark title/end cards and dark
# slide transitions between scenes. This script
#   1. finds the screen: the rows and columns of a mid-trailer frame that are mostly light (override: CROP=w:h:x:y),
#   2. finds the scenes: runs where the screen area is light (mean luma > LIGHT, sampled at 10 fps), each trimmed by
#      0.2 s at both ends, runs shorter than 2 s dropped (override: SEGMENTS="3.6-13.0 13.6-29.8 ..."),
#   3. cuts those runs cropped to the screen (540 px wide, 30 fps) and joins them with hard cuts: H.264, no audio,
#      faststart, raising the CRF until the file is at most MAX_KB (default 4000),
#   4. writes the first frame as the poster, so the still and the loop start match.
# The clip loops from the end of the last scene straight into the first, both clean scene boundaries.
#
# ffmpeg runs in a memory-capped user scope (MemoryMax=3G, no swap) at nice 10 with 2 threads. Without
# systemd-run --user the script refuses to encode unless HERO_NO_SCOPE=1 is set.
set -euo pipefail

RAW=0
if [ "${1:-}" = --raw ]; then RAW=1; shift; fi
if [ "$RAW" = 1 ]; then
  [ $# -ge 1 ] || { echo "usage: website/make-hero.sh --raw <take.mp4>@<from>-<to> ..." >&2; exit 1; }
  OUT=${OUT:-$(cd "$(dirname "$0")" && pwd)/media}
  RAW_SCENES=("$@")
  SRC=${RAW_SCENES[0]%@*}
else
  SRC=${1:?usage: website/make-hero.sh <vertical-trailer.mp4> [out-dir]}
  OUT=${2:-$(cd "$(dirname "$0")" && pwd)/media}
fi
if [ "$RAW" = 1 ]; then HERO_FPS=${HERO_FPS:-60}; else HERO_FPS=${HERO_FPS:-30}; fi
NAME=${HERO_NAME:-hero-loop}   # file stem; media is cached for 30 days, so a changed clip gets a new name (hero-loop-03)
LIGHT=${LIGHT:-150}
MAX_KB=${MAX_KB:-4000}
WIDTH=${WIDTH:-540}
[ -f "$SRC" ] || { echo "make-hero: no such file: $SRC" >&2; exit 1; }
mkdir -p "$OUT"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

export XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR:-/run/user/$(id -u)}
export DBUS_SESSION_BUS_ADDRESS=${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}
capped() {
  if systemd-run --user --scope -q -p MemoryMax=3G -p MemorySwapMax=0 true 2>/dev/null; then
    systemd-run --user --scope -q -p MemoryMax=3G -p MemorySwapMax=0 nice -n 10 "$@"
  elif [ "${HERO_NO_SCOPE:-}" = 1 ]; then
    nice -n 10 "$@"
  else
    echo "make-hero: systemd-run --user is not available; set HERO_NO_SCOPE=1 to encode without a memory cap" >&2
    exit 1
  fi
}
ff() { capped ffmpeg -nostdin -v error -y -threads 2 "$@"; }

read -r SW SH DUR < <(ffprobe -v error -select_streams v:0 -show_entries stream=width,height:format=duration -of default=nw=1:nk=1 "$SRC" | tr '\n' ' '; echo)
echo "make-hero: $SRC (${SW}x${SH}, ${DUR}s)"

# --raw: the scenes are given; the frame is the screen
if [ "$RAW" = 1 ]; then
  CROP=""
  SCENES=()
  for sc in "${RAW_SCENES[@]}"; do
    [[ "$sc" =~ ^(.+)@([0-9]+(\.[0-9]+)?)-([0-9]+(\.[0-9]+)?)$ ]] || { echo "make-hero: bad scene '$sc' (want take.mp4@from-to)" >&2; exit 1; }
    f=${BASH_REMATCH[1]}; a=${BASH_REMATCH[2]}; b=${BASH_REMATCH[4]}
    [ -f "$f" ] || { echo "make-hero: no such take: $f" >&2; exit 1; }
    awk -v a="$a" -v b="$b" 'BEGIN { exit !(b > a) }' || { echo "make-hero: scene '$sc' ends before it starts" >&2; exit 1; }
    d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f")
    awk -v b="$b" -v d="$d" 'BEGIN { exit !(b <= d + 0.05) }' || { echo "make-hero: scene '$sc' is past the end of the take (${d}s)" >&2; exit 1; }
    SCENES+=("$f|$a|$b")
  done
  echo "make-hero: raw scenes ${RAW_SCENES[*]}"
else
# 1. the screen rectangle, measured on a quarter-size grey frame from the middle of the trailer
if [ -z "${CROP:-}" ]; then
  Q=4; QW=$((SW / Q)); QH=$((SH / Q))
  ff -ss "$(awk -v d="$DUR" 'BEGIN{print d*0.45}')" -i "$SRC" -frames:v 1 -vf "scale=$QW:$QH,format=gray" -f rawvideo "$TMP/frame.gray"
  CROP=$(od -An -v -tu1 -w"$QW" "$TMP/frame.gray" | awk -v w="$QW" -v q="$Q" -v light="$LIGHT" '
    { n = 0; for (i = 1; i <= NF; i++) { if ($i > light) { n++; col[i]++ } } if (n > 0.5 * w) { if (!top) top = NR; bot = NR; rows++ } }
    END {
      for (i = 1; i <= w; i++) if (col[i] > 0.5 * rows) { if (!l) l = i; r = i }
      x = (l - 1) * q; y = (top - 1) * q; cw = (r - l + 1) * q; ch = (bot - top + 1) * q
      x += q; y += q; cw -= 2 * q; ch -= 2 * q   # stay one sample inside the edge
      printf "%d:%d:%d:%d", cw - cw % 2, ch - ch % 2, x, y }')
fi
echo "make-hero: screen crop $CROP"

# 2. the light scene runs
if [ -z "${SEGMENTS:-}" ]; then
  ff -i "$SRC" -vf "fps=10,crop=$CROP,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=$TMP/yavg.txt" -f null -
  SEGMENTS=$(awk -v light="$LIGHT" '
    /pts_time/ { split($3, a, ":"); t = a[2] }
    /YAVG/ { split($0, b, "="); on = b[2] > light
      if (on && !run) { run = 1; s = t } if (!on && run) { run = 0; emit(s, last) } last = t }
    END { if (run) emit(s, last) }
    function emit(a, b) { a += 0.2; b -= 0.2; if (b - a >= 2) printf "%.2f-%.2f ", a, b }' "$TMP/yavg.txt")
fi
[ -n "$SEGMENTS" ] || { echo "make-hero: found no light scenes (try LIGHT=... or SEGMENTS=..., or cut from raw takes with --raw)" >&2; exit 1; }
echo "make-hero: scenes $SEGMENTS"
SCENES=()
for seg in $SEGMENTS; do SCENES+=("$SRC|${seg%-*}|${seg#*-}"); done
fi

# 3. cut each scene (input seeking, cropped and scaled, near-lossless), then join them with hard cuts and encode,
#    raising the CRF until the file fits. Cutting per scene keeps memory small.
k=0; : > "$TMP/list.txt"
for scene in "${SCENES[@]}"; do
  IFS='|' read -r f a b <<<"$scene"
  ff -ss "$a" -to "$b" -i "$f" -an \
    -vf "${CROP:+crop=$CROP,}scale=$WIDTH:-2:flags=lanczos,setsar=1,fps=$HERO_FPS,format=yuv420p" -c:v libx264 -preset veryfast -crf 10 "$TMP/s$k.mp4"
  echo "file 's$k.mp4'" >> "$TMP/list.txt"; k=$((k + 1))
done
CRF=${CRF:-22}
while :; do
  ff -f concat -safe 0 -i "$TMP/list.txt" -an -c:v libx264 -preset slow -profile:v high -pix_fmt yuv420p -crf "$CRF" \
    -r "$HERO_FPS" -g $((HERO_FPS * 2)) -movflags +faststart "$TMP/$NAME.mp4"
  KB=$(( $(stat -c %s "$TMP/$NAME.mp4") / 1024 ))
  echo "make-hero: crf $CRF -> ${KB} KB"
  if [ "$KB" -le "$MAX_KB" ] || [ "$CRF" -ge 36 ]; then break; fi
  CRF=$((CRF + 2))
done
mv "$TMP/$NAME.mp4" "$OUT/$NAME.mp4"

# 4. the poster is the clip's first frame
ff -i "$OUT/$NAME.mp4" -frames:v 1 -q:v 4 "$OUT/$NAME.jpg"
ffprobe -v error -select_streams v:0 -show_entries stream=width,height,r_frame_rate:format=duration,size -of compact=p=0 "$OUT/$NAME.mp4"
echo "make-hero: wrote $OUT/$NAME.mp4 and $OUT/$NAME.jpg"
