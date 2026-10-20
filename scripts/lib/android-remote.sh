# shellcheck shell=bash
# Remote Android lane (scripts/build-apk.sh --host H): build an arm64 test APK on another machine (the build Mac) and
# keep it there. Sourced by build-apk.sh after flavor_init; uses its ROOT / FLAVOR / BRAND_ARTIFACT / helpers.
#   android_remote_build HOST VARIANT FETCH SMOKE [SCRIPT]     SCRIPT: build-apk.sh (default) or build-apk-fast.sh (the JS swap
#                                 on the host's own base APK, which falls back to a full build there)
# HOST "mac" = MAC_HOST from $HUI_PRIVATE_DIR/build.env (or the environment); anything else is an ssh host name.
# Traffic to the host is minimal on purpose (the link from here may be a ~0.7 MB/s relay):
#   - sources: the host gets the exact commit through git (scripts/lib/lane-sync.sh: bundle of the missing commits, or its own
#     fetch from HUI_LANE_GIT_URL), uncommitted changes as a small rsync overlay; no app/ rsync
#   - every call builds in a run directory of its own (~/<lane>/runs/<run id>, lane-sync.sh), never in a checkout another agent
#     can re-sync; the build checks the run's stamp on its copy of app/ (scripts/lib/lane-stamp.sh) and this script checks
#     afterwards that the APK names the synced commit (assets/app.config buildSource): a mismatch fails loudly, nothing is
#     fetched or smoke-tested
#   - the APK stays on the host (~/<lane>/runs/<run id>/dist/...-mac[-debugsigned].apk). FETCH=1 (--fetch) copies it here and runs
#     flavor mark + flavor guard + release gate (private denylist) on it before it lands in dist/; without it the APK never leaves
#     the host
#   - SMOKE=1 (--smoke): the E2E suite then runs ON the host against that APK, with the scripts of the same run; only the report
#     comes back. Afterwards the run's app/ is dropped (lane_finish); scripts/ and the APK stay until the run is pruned
# Hermes flavor and ABIS=arm64-v8a only; no keystore, no private overlay, no .env goes to the host; release builds are always
# debug-signed test APKs. Env passed on: HUI_MAC_LOCK_WAIT, MEM_MAX, GRADLE_WORKERS, GRADLE_XMX, NINJA_JOBS, SKIP_NPM_CI,
# MIN_FREE_DISK_GB, HUI_MAC_MIN_AVAIL_MB. HUI_LANE_HOME [hui-lane] = directory on the host, relative to ~.

android_resolve_host() { # android_resolve_host NAME -> ssh host on stdout
  local h="$1"
  if [ "$h" = mac ]; then
    flavor_load_build_env
    h="${MAC_HOST:-}"
    [ -n "$h" ] || { echo "--host mac: MAC_HOST is not set (env or \$HUI_PRIVATE_DIR/build.env)" >&2; return 2; }
  fi
  case "$h" in -*|*[[:space:]]*|'') echo "invalid host '$h'" >&2; return 2 ;; esac
  printf '%s' "$h"
}

android_remote_build() {
  local rc=0
  LANE_DIR=""
  _android_remote_run "$@" || rc=$?
  # ssh itself failed (255): the host side may still run, leave the run to the TTL instead of pulling its sources away
  if [ -n "${LANE_DIR:-}" ] && [ "$rc" != 255 ] && [ -n "${LANE_HOST:-}" ]; then lane_finish "$LANE_HOST" "$LANE_DIR"; fi
  return "$rc"
}

_android_remote_run() {
  local want="$1" variant="$2" fetch="${3:-0}" smoke="${4:-0}" script="${5:-build-apk.sh}" host lane ts log apk_name sign stage rc=0 final
  local T0=$SECONDS T_SYNC T_BUILD T_FETCH
  [ "$FLAVOR" = hermes ] || { echo "the remote lane builds the hermes flavor only (the private overlay never leaves this machine)" >&2; return 2; }
  [ "${ABIS:-arm64-v8a}" = arm64-v8a ] || { echo "the remote lane builds ABIS=arm64-v8a only (arm64 emulator on the Mac)" >&2; return 2; }
  host="$(android_resolve_host "$want")" || return 2
  LANE_HOST="$host"
  lane="${HUI_LANE_HOME:-hui-lane}"
  case "$lane" in /*|*..*|*[!A-Za-z0-9._/-]*) echo "HUI_LANE_HOME must be a plain relative path" >&2; return 2 ;; esac
  ts="$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$ROOT/dist"
  log="$ROOT/dist/build-$variant-$ts-remote.log"
  exec > >(tee -a "$log") 2>&1
  # shellcheck source=lane-sync.sh
  . "$ROOT/scripts/lib/lane-sync.sh"
  echo "== remote Android lane: $variant, log $log"
  # shellcheck source=lane-stamp.sh
  . "$ROOT/scripts/lib/lane-stamp.sh"
  lane_sync "$host" "$lane" "$ROOT" || { echo "could not sync the commit to the lane host" >&2; return 1; }
  local run="$LANE_DIR"
  T_SYNC=$((SECONDS - T0)); echo "== synced ${LANE_LABEL} in ${T_SYNC} s"
  sign=""; [ "$variant" = release ] && sign="-debugsigned"
  apk_name="$BRAND_ARTIFACT-$variant-$LANE_LABEL-mac$sign.apk"
  # the environment handed to the host: explicit list, values quoted for the remote shell
  local envs="" v val
  for v in HUI_FAST HUI_FAST_ONLY HUI_MAC_LOCK_WAIT MEM_MAX GRADLE_WORKERS GRADLE_XMX NINJA_JOBS SKIP_NPM_CI MIN_FREE_DISK_GB HUI_MAC_MIN_AVAIL_MB; do
    # only what the caller exported: this script's own (Linux) defaults must not override the host's
    val="$(printenv "$v" 2>/dev/null || true)"
    [ -n "$val" ] && envs="$envs $(printf '%s=%q' "$v" "$val")"
  done
  ssh -o BatchMode=yes "$host" "bash -s" <<REMOTE || rc=$?
set -euo pipefail
export PATH="\$HOME/.local/node/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export npm_config_cache="\$HOME/$lane/npm-cache"   # lane-owned: never the user's ~/.npm
cd "\$HOME/$run"
env FLAVOR=hermes HUI_ANDROID_LANE=local ABIS=arm64-v8a HUI_BUILD_SHA='$LANE_LABEL' HUI_LANE_STAMP='$LANE_STAMP' HUI_APK_TAG=-mac HUI_SKIP_RELEASE_GATE=1 ALLOW_DEBUG_SIGNED=1$envs \\
  bash scripts/$script $variant
REMOTE
  [ "$rc" = 0 ] || { echo "REMOTE BUILD FAILED (exit $rc). Log: $log" >&2; return "$rc"; }
  # what the host actually produced (the fast path may have fallen back to a full build): the last "APK: <path> (" line of its output
  sleep 1   # the tee behind the log may lag a moment
  local made; made="$(grep -a '^APK: ' "$log" | tail -1 | sed -E 's#^APK: ([^ ]+).*#\1#')"
  if [ -n "$made" ]; then
    case "$made" in */"$run"/dist/*) ;; *) echo "LANE COMMIT MISMATCH: the host reported $made, outside this run (~/$run)" >&2; return 1 ;; esac
    apk_name="$(basename "$made")"
  fi
  T_BUILD=$((SECONDS - T0 - T_SYNC)); echo "== remote build done in ${T_BUILD} s (APK stays on the host: ~/$run/dist/$apk_name)"
  # the APK must name the synced commit (its buildSource comes from the stamp of the build's own copy of app/)
  local got want_src="${LANE_LABEL%-dirty}"
  got="$(ssh -o BatchMode=yes "$host" "bash -s" <<VERIFY
cd "\$HOME/$run"
[ -f "dist/$apk_name" ] || { echo "<no APK>"; exit 0; }
. scripts/lib/lane-stamp.sh
lane_apk_source "dist/$apk_name"
VERIFY
)" || got="<ssh failed>"
  if [ "$got" != "$want_src" ]; then
    echo "LANE COMMIT MISMATCH: ~/$run/dist/$apk_name was built from '${got:-<no buildSource>}', this run synced $want_src. Not fetched, not smoke-tested." >&2
    return 1
  fi
  echo "== APK verified: built from $want_src (run $LANE_RUN)"
  T_FETCH=0
  if [ "$fetch" = 1 ]; then
    stage="$(mktemp -d "${TMPDIR:-/tmp}/hui-apk-fetch.XXXXXX")"
    # shellcheck disable=SC2064
    trap "rm -rf '$stage'" RETURN
    rsync -a "$host:$run/dist/$apk_name" "$stage/" || { echo "APK $apk_name not found on the host" >&2; return 1; }
    [ "$(lane_apk_source "$stage/$apk_name")" = "$want_src" ] || { echo "LANE COMMIT MISMATCH: the fetched APK does not name $want_src" >&2; return 1; }
    flavor_verify_artifact "$stage/$apk_name" || { echo "fetched APK does not carry the FLAVOR=$FLAVOR mark" >&2; return 1; }
    local gx; gx="$(mktemp -d)"; (cd "$gx" && unzip -q "$stage/$apk_name")
    flavor_guard_output "$gx" || { rm -rf "$gx"; echo "fetched APK contains private content" >&2; return 1; }
    rm -rf "$gx"
    release_gate "$stage/$apk_name" || { echo "fetched APK failed the release gate" >&2; return 1; }
    final="$ROOT/dist/$apk_name"
    mv -f "$stage/$apk_name" "$final"
    ln -sf "$apk_name" "$ROOT/dist/latest-hermes-$variant-mac$sign.apk"
    T_FETCH=$((SECONDS - T0 - T_SYNC - T_BUILD))
    echo "APK fetched and gated: $final ($(du -h "$final" | cut -f1)) in ${T_FETCH} s"
  fi
  local T_SMOKE=0 src=0
  if [ "$smoke" = 1 ]; then
    local s0=$SECONDS out="${HUI_LANE_SMOKE_OUT:-/tmp/hui-e2e-mac-$ts}"
    "$ROOT/scripts/e2e/smoke.sh" --host "$host" --apk-on-host "$run/dist/$apk_name" --wait "${HUI_LANE_SMOKE_WAIT:-5}" --out "$out" || src=$?
    T_SMOKE=$((SECONDS - s0)); echo "== smoke on the host: exit $src in ${T_SMOKE} s, report $out/report.md"
  fi
  echo "Remote lane $([ "$src" = 0 ] && echo OK || echo "FAILED (smoke exit $src)"): sync ${T_SYNC} s + build ${T_BUILD} s + fetch ${T_FETCH} s + smoke ${T_SMOKE} s = $((SECONDS - T0)) s end to end"
  return "$src"
}
