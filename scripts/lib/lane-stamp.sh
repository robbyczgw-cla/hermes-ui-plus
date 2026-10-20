# shellcheck shell=bash
# Proof that a remote lane build used the sources of its own sync (scripts/lib/lane-sync.sh). Every sync gets its own run
# directory on the host and writes a stamp "<full sha> <run id>" into it (.lane-stamp and app/.lane-stamp); the caller hands the
# same text over as HUI_LANE_STAMP. Two agents once shared one checkout on the Mac: B re-synced it while A's build waited for the
# lock, and A's APK, named after A's commit, held B's code.
#   lane_stamp_check DIR    (build-apk.sh / build-apk-fast.sh, under the build lock, right after app/ was copied to DIR)
#                           no HUI_LANE_STAMP: nothing to check. Otherwise DIR/.lane-stamp must hold exactly HUI_LANE_STAMP,
#                           else it fails loudly. Sets LANE_STAMP_SOURCE = the short commit of the stamp (the APK's buildSource,
#                           assets/app.config, Settings -> About), so the APK names the commit its JS really came from.
#   lane_apk_source APK     prints extra.buildSource of the APK's assets/app.config (empty when there is none)
# bash 3.2 compatible (runs on the Mac).

lane_stamp_check() {
  local dir="$1" got
  LANE_STAMP_SOURCE=""
  [ -n "${HUI_LANE_STAMP:-}" ] || return 0
  got="$(cat "$dir/.lane-stamp" 2>/dev/null || true)"
  if [ "$got" != "$HUI_LANE_STAMP" ]; then
    echo "LANE SOURCE MISMATCH: the build input $dir carries the stamp '${got:-<none>}', this run synced '$HUI_LANE_STAMP'." >&2
    echo "Another run changed the sources between the sync and this build; refusing to build an APK with the wrong code." >&2
    return 1
  fi
  LANE_STAMP_SOURCE="$(printf '%s' "${got%% *}" | cut -c1-7)"
  echo "lane: build input verified (commit $LANE_STAMP_SOURCE, run ${got#* })"
}

lane_apk_source() {
  unzip -p "$1" assets/app.config 2>/dev/null | sed -n 's/.*"buildSource" *: *"\([0-9A-Za-z-]*\)".*/\1/p' | head -1
}
