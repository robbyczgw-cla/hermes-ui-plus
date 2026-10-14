# shellcheck shell=bash
# Aggregate memory cap for ALL heavy local jobs (scripts/build-apk.sh, scripts/build-web.sh, scripts/check.sh).
# Each job keeps its own per-scope MemoryMax, but they use different locks and may run at the same time; their
# per-job caps (8G + 4G + 3G) can add up to more than this host (no swap) has. Every job's scope therefore runs
# inside one shared systemd user slice whose MemoryMax bounds the SUM: under aggregate pressure a build is
# OOM-killed inside the slice instead of interactive sessions outside it.
#   HUI_HEAVY_MAX         slice MemoryMax (default: MemTotal - HUI_HEAVY_RESERVE_MB)
#   HUI_HEAVY_RESERVE_MB  memory kept for everything else (default 3072)
# Source it, call heavy_slice_init, then pass "${HEAVY_SLICE[@]}" to `systemd-run --user --scope`.
HUI_HEAVY_SLICE_NAME="huiheavy.slice"   # no '-' in the name: systemd would nest it under hui.slice
heavy_slice_init() {
  local total_kb cap
  HEAVY_SLICE=()
  total_kb="$(awk '/^MemTotal:/{print $2}' /proc/meminfo 2>/dev/null)"
  case "$total_kb" in ''|*[!0-9]*) echo "heavy: cannot read MemTotal; no aggregate cap" >&2; return 0 ;; esac
  cap="${HUI_HEAVY_MAX:-$(( total_kb / 1024 - ${HUI_HEAVY_RESERVE_MB:-3072} ))M}"
  if systemctl --user set-property --runtime "$HUI_HEAVY_SLICE_NAME" MemoryMax="$cap" MemorySwapMax=0 >/dev/null 2>&1; then
    HEAVY_SLICE=(--slice="$HUI_HEAVY_SLICE_NAME")
  else
    echo "heavy: could not configure $HUI_HEAVY_SLICE_NAME (MemoryMax=$cap); per-job caps only" >&2
  fi
}
