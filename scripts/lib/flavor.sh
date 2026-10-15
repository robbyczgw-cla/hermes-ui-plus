# shellcheck shell=bash
# Build flavor + private overlay for the build scripts (docs/BUILD.md "Flavors"). Source it, then call
# `flavor_init`. Sets/exports:
#   FLAVOR=hermes|personal (default hermes; EXPO_PUBLIC_FLAVOR is accepted as an alias), EXPO_PUBLIC_FLAVOR=$FLAVOR
#   HUI_PRIVATE_DIR (default ~/work/hermesiui-private)
# personal: requires the overlay and loads (set -a) $HUI_PRIVATE_DIR/app/personal.env (EXPO_PUBLIC_* defaults of the
#           personal app) and $HUI_PRIVATE_DIR/build.env (hosts / Apple team / publish URLs of the build scripts).
#           Values already set in the environment win over both files.
# hermes:   loads nothing from the overlay and refuses personal EXPO_PUBLIC_* values (scripts/flavor-guard.mjs --env).
#           `flavor_guard_tree DIR` / `flavor_guard_output DIR` fail the build if private content would ship.
# both:     TMPDIR=/var/tmp/hiui-tmp-$FLAVOR (Metro cache per flavor, `flavor_require_tmpdir` before bundling);
#           `flavor_verify_artifact ARTIFACT` fails unless the artifact's JS carries this flavor's mark.

_flavor_load_env() { # file: KEY=VALUE lines; existing env wins
  # Data, never code: no eval/expansion. Supported: [export ]KEY=value, KEY="value", KEY='value' (one pair of
  # matching outer quotes is removed, nothing else is interpreted). Lines that are not KEY=… are rejected.
  local _fl_f="$1" _fl_line _fl_key _fl_val _fl_n=0
  [ -f "$_fl_f" ] || return 0
  while IFS= read -r _fl_line || [ -n "$_fl_line" ]; do
    _fl_n=$((_fl_n+1))
    _fl_line="${_fl_line%$'\r'}"
    _fl_line="${_fl_line#"${_fl_line%%[![:space:]]*}"}"
    case "$_fl_line" in ''|'#'*) continue ;; esac
    _fl_line="${_fl_line#export }"
    _fl_key="${_fl_line%%=*}"
    if [ "$_fl_key" = "$_fl_line" ] || ! [[ "$_fl_key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
      echo "$_fl_f:$_fl_n: not a KEY=VALUE line" >&2; return 2
    fi
    _fl_val="${_fl_line#*=}"
    if [[ "$_fl_val" =~ ^\"(.*)\"$ ]] || [[ "$_fl_val" =~ ^\'(.*)\'$ ]]; then _fl_val="${BASH_REMATCH[1]}"; fi
    if [ -z "${!_fl_key+x}" ]; then
      printf -v "$_fl_key" '%s' "$_fl_val"
      export "${_fl_key?}"
    fi
  done < "$_fl_f"
}

flavor_init() {
  FLAVOR="${FLAVOR:-${EXPO_PUBLIC_FLAVOR:-hermes}}"
  case "$FLAVOR" in
    hermes|personal) ;;
    *) echo "FLAVOR must be hermes or personal (got '$FLAVOR')" >&2; return 2 ;;
  esac
  if [ -n "${EXPO_PUBLIC_FLAVOR:-}" ] && [ "$EXPO_PUBLIC_FLAVOR" != "$FLAVOR" ]; then
    echo "FLAVOR=$FLAVOR but EXPO_PUBLIC_FLAVOR=$EXPO_PUBLIC_FLAVOR" >&2; return 2
  fi
  HUI_PRIVATE_DIR="${HUI_PRIVATE_DIR:-$HOME/work/hermesiui-private}"
  case "$HUI_PRIVATE_DIR" in "~/"*) HUI_PRIVATE_DIR="$HOME/${HUI_PRIVATE_DIR#\~/}" ;; esac
  export FLAVOR EXPO_PUBLIC_FLAVOR="$FLAVOR" HUI_PRIVATE_DIR
  # Metro keeps its transform cache in $TMPDIR (metro-cache) and inlines EXPO_PUBLIC_* there without keying the
  # cache on them: two flavors sharing it ship each other's JS (a personal APK once ran as the hermes flavor).
  # Each flavor gets its own TMPDIR, outside $HOME so no local path ends up in public build output.
  # (app/metro.config.js also keys the cache on EXPO_PUBLIC_*; flavor_require_tmpdir checks this before bundling.)
  export TMPDIR="/var/tmp/hiui-tmp-$FLAVOR"
  mkdir -p "$TMPDIR" && chmod 700 "$TMPDIR"
  if [ "$FLAVOR" = personal ]; then
    if [ ! -f "$HUI_PRIVATE_DIR/app/identity.json" ]; then
      echo "FLAVOR=personal needs the private overlay: $HUI_PRIVATE_DIR/app/identity.json (set HUI_PRIVATE_DIR)" >&2
      return 2
    fi
    _flavor_load_env "$HUI_PRIVATE_DIR/app/personal.env" || return 2
    _flavor_load_env "$HUI_PRIVATE_DIR/build.env" || return 2
  else
    node "$FLAVOR_ROOT/scripts/flavor-guard.mjs" --env || return 1
  fi
  echo "flavor: $FLAVOR (private overlay: $([ "$FLAVOR" = personal ] && echo "$HUI_PRIVATE_DIR" || echo 'not used'))"
}

# Load only build.env (hosts etc. of the build machine) – also for hermes builds of the maintainer. It never
# feeds into the app bundle (no EXPO_PUBLIC_* allowed there).
flavor_load_build_env() {
  local f="$HUI_PRIVATE_DIR/build.env"
  [ -f "$f" ] || return 0
  if grep -q '^EXPO_PUBLIC_' "$f"; then echo "$f must not contain EXPO_PUBLIC_* values" >&2; return 2; fi
  _flavor_load_env "$f"
}

# Right before Metro runs (build-web.sh / build-apk.sh inner mode): refuse a TMPDIR that is not this flavor's own, so
# the transform cache ($TMPDIR/metro-cache) is never shared between flavors (docs/BUILD.md "Flavor mark + Metro cache").
flavor_require_tmpdir() {
  [ "${TMPDIR:-}" = "/var/tmp/hiui-tmp-$FLAVOR" ] && [ -d "$TMPDIR" ] && return 0
  echo "TMPDIR=${TMPDIR:-<unset>} is not the FLAVOR=$FLAVOR build's own /var/tmp/hiui-tmp-$FLAVOR: Metro would share its" \
    "transform cache with the other flavor. Run the build script itself (flavor_init sets it)." >&2
  return 1
}

# Every artifact (APK / AAB / IPA / zipped .app, web dir, web tarball) must carry exactly the flavor mark of $FLAVOR
# (app/src/flavor.ts FLAVOR_MARK, scripts/verify-flavor-artifact.mjs); call it before the artifact is copied or published.
flavor_verify_artifact() { node "$FLAVOR_ROOT/scripts/verify-flavor-artifact.mjs" "$1" "${2:-$FLAVOR}"; }

flavor_guard_tree() { [ "$FLAVOR" = hermes ] || return 0; node "$FLAVOR_ROOT/scripts/flavor-guard.mjs" --tree "$1" "${@:2}"; }
flavor_guard_output() { [ "$FLAVOR" = hermes ] || return 0; node "$FLAVOR_ROOT/scripts/flavor-guard.mjs" --output "$1"; }

# Release gate (scripts/scan-artifact.sh: leak-guard incl. the private denylist + gitleaks) for hermes output BEFORE
# it is promoted to a served / shared location. A contributor without the private overlay gets the --public gate
# (generic patterns + gitleaks); with an overlay the denylist is mandatory. personal builds are private: no gate.
release_gate() {
  [ "$FLAVOR" = hermes ] || return 0
  if [ -e "$HUI_PRIVATE_DIR/leak-denylist.txt" ]; then
    HUI_PRIVATE_DIR="$HUI_PRIVATE_DIR" "$FLAVOR_ROOT/scripts/scan-artifact.sh" "$1"
  else
    HUI_PRIVATE_DIR="$HUI_PRIVATE_DIR" "$FLAVOR_ROOT/scripts/scan-artifact.sh" --public "$1"
  fi
}

FLAVOR_ROOT="${FLAVOR_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
# official identity (BRAND_* from app/brand/identity.json)
# shellcheck source=brand.sh
. "$FLAVOR_ROOT/scripts/lib/brand.sh"
