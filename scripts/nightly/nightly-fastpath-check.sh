#!/usr/bin/env bash
# Nightly safety check of the JS fast path (docs/BUILD.md "Nightly cross-check").
# For the newest commit of the private main branch: build the x86_64 hermes-flavor test APK with scripts/build-apk-fast.sh and
# with scripts/build-apk.sh, compare both entry by entry (scripts/lib/nightly-crosscheck.mjs) and write a result file; on a
# mismatch or failure also ALERT-<date>.md. Installed by scripts/nightly/install.sh, started by hui-nightly-fastpath.timer.
#
# Usage: nightly-fastpath-check.sh [--now]     (--now: no waiting for a quiet host longer than HUI_NIGHTLY_WAIT_MIN)
# Environment (all optional):
#   HUI_PRIVATE_DIR          private dir; results go to $HUI_PRIVATE_DIR/reports/nightly [~/work/hermesiui-private]
#   HUI_NIGHTLY_HOME         clone, runs, counter [~/builds/nightly]
#   HUI_NIGHTLY_REMOTES      "primary fallback" git URLs; default: remotes.env next to this script (written by install.sh), else
#                            remote "origin" and "forgejo" of the repo this script lives in. URLs never carry credentials.
#   HUI_NIGHTLY_BRANCH       branch to test [main]
#   HUI_NIGHTLY_WAIT_MIN     give up (skip the night, no alert) after this many minutes of a busy host [60]
#   HUI_NIGHTLY_KEEP         runs to keep [3]
#   MIN_AVAIL_GB=8 MEM_MAX=7G MEM_HIGH=6G   caps handed to the builds (these are the defaults here)
# Never uses pkill/pgrep -f. Read-only fetch only (the clone has no push URL). Credentials come from git's credential helper
# and are never printed.
set -Eeuo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# helper module: flat next to this script when installed, scripts/lib/ in the repo
CROSS="$SELF_DIR/nightly-crosscheck.mjs"; [ -f "$CROSS" ] || CROSS="$SELF_DIR/../lib/nightly-crosscheck.mjs"
PRIVATE="${HUI_PRIVATE_DIR:-$HOME/work/hermesiui-private}"
NIGHTLY_HOME="${HUI_NIGHTLY_HOME:-$HOME/builds/nightly}"
REPORTS="$PRIVATE/reports/nightly"
BRANCH="${HUI_NIGHTLY_BRANCH:-main}"
WAIT_MIN="${HUI_NIGHTLY_WAIT_MIN:-60}"
KEEP="${HUI_NIGHTLY_KEEP:-3}"
POLL_S="${HUI_NIGHTLY_POLL_S:-30}"
BUILD_LOCK="$HOME/builds/.hermes-build.lock"
CHECK_LOCK="/tmp/hui-check.lock"
E2E_LOCK="/tmp/hui-e2e.lock"
# the cross-check compares two builds of ONE host: never the Mac lane (scripts/lib/lane-choose.sh)
export HUI_ANDROID_LANE=local
export MIN_AVAIL_GB="${MIN_AVAIL_GB:-8}" MEM_MAX="${MEM_MAX:-7G}" MEM_HIGH="${MEM_HIGH:-6G}"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=/run/user/$(id -u)/bus}"

log() { echo "[$(date +%H:%M:%S)] $*"; }

# ---- busy detection ------------------------------------------------------------------------------------------------
# Prints why the host is busy (and returns 0), or returns 1 when it is idle. Read-only: lock probes, /proc and cgroup files.
lock_held() { # file: true while another process holds the flock
  [ -e "$1" ] || return 1
  ( exec 7<"$1" && ! flock -n 7 ) 2>/dev/null
}
gradle_or_emulator_pid() { # name of a running Gradle daemon / emulator process, by /proc (no pgrep -f)
  local d comm cmd
  for d in /proc/[0-9]*; do
    comm="$(cat "$d/comm" 2>/dev/null)" || continue
    case "$comm" in
      qemu-system-*|emulator*) echo "emulator ($comm, pid ${d#/proc/})"; return 0 ;;
      java)
        cmd="$(tr '\0' ' ' <"$d/cmdline" 2>/dev/null)" || continue
        case "$cmd" in *GradleDaemon*|*gradle-launcher*|*GradleWrapperMain*) echo "Gradle (pid ${d#/proc/})"; return 0 ;; esac ;;
    esac
  done
  return 1
}
heavy_slice_busy() { # any process inside the shared heavy slice (builds, check.sh steps)
  local cg events key value root="${1:-/sys/fs/cgroup}"
  cg="$(systemctl --user show huiheavy.slice -p ControlGroup --value 2>/dev/null)" || return 1
  [ -n "$cg" ] || return 1
  events="$root$cg/cgroup.events"
  [ -r "$events" ] || return 1
  # cgroup.procs has stat size zero and lists only direct members. Jobs live in child scopes;
  # the kernel's populated flag covers the entire subtree, including those scopes.
  while read -r key value; do
    if [ "$key" = populated ]; then [ "$value" = 1 ]; return; fi
  done < "$events"
  return 1
}
host_busy_reason() {
  local r
  if lock_held "$BUILD_LOCK"; then echo "another build holds $BUILD_LOCK"; return 0; fi
  if lock_held "$CHECK_LOCK"; then echo "a check holds $CHECK_LOCK"; return 0; fi
  if lock_held "$E2E_LOCK"; then echo "an emulator run holds $E2E_LOCK"; return 0; fi
  if r="$(gradle_or_emulator_pid)"; then echo "$r"; return 0; fi
  if heavy_slice_busy; then echo "heavy jobs run in huiheavy.slice"; return 0; fi
  return 1
}
# Wait until the host is idle on two polls in a row (a build/check that just ended may be followed by the next one).
# Returns 0 when idle, 1 after WAIT_MIN minutes; the last busy reason stays in BUSY_REASON.
BUSY_REASON=""
wait_idle() {
  local deadline=$((SECONDS + WAIT_MIN * 60)) quiet=0
  while :; do
    if BUSY_REASON="$(host_busy_reason)"; then
      quiet=0; log "host busy: $BUSY_REASON"
    else
      BUSY_REASON=""; quiet=$((quiet + 1))
      [ "$quiet" -ge 2 ] && return 0
    fi
    [ "$SECONDS" -lt "$deadline" ] || return 1
    sleep "$POLL_S"
  done
}

# ---- source --------------------------------------------------------------------------------------------------------
# Fetch the newest commit of $BRANCH (shallow) into the nightly work tree (never the developer checkout). The fetch uses the
# URL directly, so the work tree has no remote and nothing to push to. Sets SOURCE_NAME (host label), FULL_SHA.
fetch_source() {
  local src="$NIGHTLY_HOME/src" primary fallback which url
  if [ -n "${HUI_NIGHTLY_REMOTES:-}" ]; then read -r primary fallback <<<"$HUI_NIGHTLY_REMOTES"
  elif [ -f "$SELF_DIR/remotes.env" ]; then read -r primary fallback <<<"$(sed -n 's/^HUI_NIGHTLY_REMOTES=//p' "$SELF_DIR/remotes.env" | tail -1)"
  else
    primary="$(git -C "$SELF_DIR" remote get-url origin 2>/dev/null || true)"
    fallback="$(git -C "$SELF_DIR" remote get-url github 2>/dev/null || git -C "$SELF_DIR" remote get-url forgejo 2>/dev/null || true)"
    [ "$fallback" = "$primary" ] && fallback=""
  fi
  [ -n "${primary:-}" ] || { log "no source remote (run install.sh, or set HUI_NIGHTLY_REMOTES)"; return 1; }
  [ -d "$src/.git" ] || { rm -rf "$src"; git init -q "$src"; }
  export GIT_TERMINAL_PROMPT=0
  for which in primary fallback; do
    url="${!which:-}"
    [ -n "$url" ] || continue
    if git -C "$src" fetch -q --no-tags --depth 1 "$url" "+refs/heads/$BRANCH:refs/nightly/$BRANCH" 2>"$RUN_DIR/fetch-$which.err"; then
      SOURCE_NAME="$which ($(sed -E 's#^[a-z+]+://([^@/]*@)?([^/:]+).*#\2#' <<<"$url"))"
      FULL_SHA="$(git -C "$src" rev-parse "refs/nightly/$BRANCH")"
      git -C "$src" checkout -q --detach -f "$FULL_SHA"
      git -C "$src" clean -qfdx
      return 0
    fi
    log "fetch from the $which remote failed: $(head -c 200 "$RUN_DIR/fetch-$which.err" | sed -E 's#(https?://)[^/@ ]*@#\1***@#g' | tr '\n' ' ')"
  done
  return 1
}

# ---- builds --------------------------------------------------------------------------------------------------------
json() { node -e 'process.stdout.write(JSON.stringify(Object.fromEntries(process.argv.slice(1).map((a)=>{const i=a.indexOf("=");const v=a.slice(i+1);return [a.slice(0,i), /^-?\d+$/.test(v)?Number(v):v]}))))' "$@"; }
RUN_FACTS_FAST="" RUN_FACTS_FAST2="" RUN_FACTS_FULL=""

# build_fast NAME: HUI_FAST_ONLY=1 so that it never silently turns into a full build. Sets FAST_STATUS FAST_APK FAST_BASE.
build_fast() {
  local name="$1" log="$RUN_DIR/$1.log" rc=0 t=$SECONDS apk
  FAST_STATUS=failed; FAST_APK=""; FAST_BASE=""; FAST_NOTE=""
  ( cd "$NIGHTLY_HOME/src" && rm -rf dist && env -u HERMES_KEYSTORE -u BUNDLE FLAVOR=hermes ABIS=x86_64 HUI_FAST_ONLY=1 \
      FAST_DIR="$NIGHTLY_HOME/fast" FAST_MIN_AVAIL_GB="$MIN_AVAIL_GB" scripts/build-apk-fast.sh release ) >"$log" 2>&1 || rc=$?
  FAST_BASE="$(sed -n 's/^base: .* (build \([0-9]*\))$/\1/p' "$log" | tail -1)"
  FAST_SECONDS=$((SECONDS - t))
  if [ "$rc" = 0 ]; then
    apk="$(sed -n 's/^APK: \(.*\.apk\) (.*$/\1/p' "$log" | tail -1)"
    if [ -n "$apk" ] && [ -f "$apk" ]; then cp "$apk" "$RUN_DIR/$name.apk"; FAST_APK="$RUN_DIR/$name.apk"; FAST_STATUS=ok
    else FAST_NOTE="build reported success but no APK line/file"; fi
  elif [ "$rc" = 4 ]; then FAST_STATUS=unavailable; FAST_NOTE="$(grep -m1 -E '^fast path not applicable' "$log" | cut -c1-200)"
  else FAST_NOTE="exit $rc: $(tail -3 "$log" | tr '\n' ' ' | cut -c1-240)"; fi
}

# build_full [NUMBER]: pins the build number of the base the fast build used, so versionCode/app.config can be equal.
# build-apk.sh refuses at once while another build runs: such an exit counts as busy and is retried within the wait budget.
build_full() {
  local log="$RUN_DIR/full.log" rc t=$SECONDS apk number="${1:-}" deadline=$((SECONDS + WAIT_MIN * 60))
  FULL_STATUS=failed; FULL_APK=""; FULL_NOTE=""
  [ -f "$NIGHTLY_HOME/build-number" ] || cp "$HOME/builds/.hermes-build-number" "$NIGHTLY_HOME/build-number" 2>/dev/null || true   # own counter, seeded
  while :; do
    rc=0
    ( cd "$NIGHTLY_HOME/src" && rm -rf dist && env -u HERMES_KEYSTORE -u BUNDLE FLAVOR=hermes ABIS=x86_64 ALLOW_DEBUG_SIGNED=1 \
        HUI_BUILD_COUNTER="$NIGHTLY_HOME/build-number" HUI_BUILD_NUMBER="$number" HUI_BUILD_SOURCE="${FULL_SHA:0:7}" \
        scripts/build-apk.sh release ) >"$log" 2>&1 || rc=$?
    if [ "$rc" != 0 ] && grep -q "another build is running" "$log" && [ "$SECONDS" -lt "$deadline" ]; then
      log "another build started meanwhile, waiting"; sleep "$POLL_S"; continue
    fi
    break
  done
  FULL_SECONDS=$((SECONDS - t))
  if [ "$rc" = 0 ]; then
    apk="$(ls -t "$NIGHTLY_HOME"/src/dist/*-release-*-x86_64-debugsigned.apk 2>/dev/null | head -1)"
    if [ -n "$apk" ]; then cp "$apk" "$RUN_DIR/full.apk"; FULL_APK="$RUN_DIR/full.apk"; FULL_STATUS=ok
    else FULL_NOTE="build reported success but no APK found"; fi
  else FULL_NOTE="exit $rc: $(tail -3 "$log" | tr '\n' ' ' | cut -c1-240)"; fi
  FULL_NUMBER="$(sed -n 's/^Build number: \([0-9]*\) .*/\1/p' "$log" | head -1)"
}

fast_json() { # status apk log seconds base note
  json "status=$1" "apk=$2" "log=$3" "seconds=$4" "baseBuild=$5" "note=$6"
}

write_run() { # writes $RUN_DIR/run.json from the RUN_* variables
  node -e '
    const [date, sha, source, fast, fast2, full] = process.argv.slice(1);
    const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== "" && v != null));
    const run = { date, sha, source, fast: clean(JSON.parse(fast)), full: clean(JSON.parse(full)) };
    if (fast2) run.fastRetry = clean(JSON.parse(fast2));
    process.stdout.write(JSON.stringify(run, null, 2) + "\n");' \
    "$DATE" "$SHORT_SHA" "$SOURCE_NAME" "$RUN_FACTS_FAST" "$RUN_FACTS_FAST2" "$RUN_FACTS_FULL" > "$RUN_DIR/run.json"
}

# ---- main ----------------------------------------------------------------------------------------------------------
main() {
  DATE="$(date +%F)"
  mkdir -p "$NIGHTLY_HOME/runs" "$REPORTS"
  exec 6>"$NIGHTLY_HOME/.lock"
  flock -n 6 || { log "another nightly check runs"; exit 0; }
  RUN_DIR="$NIGHTLY_HOME/runs/$DATE-pending"; rm -rf "$RUN_DIR"; mkdir -p "$RUN_DIR"
  exec > >(tee -a "$RUN_DIR/nightly.log") 2>&1
  log "nightly fast-path cross-check $DATE (wait up to $WAIT_MIN min for a quiet host)"

  if ! wait_idle; then
    log "host stayed busy for $WAIT_MIN min ($BUSY_REASON): skipping tonight"
    mv "$RUN_DIR" "$NIGHTLY_HOME/runs/$DATE-skipped" 2>/dev/null || { rm -rf "$NIGHTLY_HOME/runs/$DATE-skipped"; mv "$RUN_DIR" "$NIGHTLY_HOME/runs/$DATE-skipped"; }
    RUN_DIR="$NIGHTLY_HOME/runs/$DATE-skipped"
    json "date=$DATE" "busyReason=$BUSY_REASON" "waitedMinutes=$WAIT_MIN" > "$RUN_DIR/run.json"
    node "$CROSS" skip "$RUN_DIR" "$REPORTS"
    node "$CROSS" prune "$NIGHTLY_HOME/runs" "$KEEP"
    exit 0
  fi

  SOURCE_NAME=""; FULL_SHA=""
  if ! fetch_source; then
    # no source: this is a failure of the check itself, worth an alert
    SHORT_SHA="0000000"; SOURCE_NAME="none"; move_run
    RUN_FACTS_FAST="$(fast_json failed "" "" "" "" "")"
    RUN_FACTS_FULL="$(json "status=failed" "note=could not fetch $BRANCH from any remote (see fetch-*.err in the run dir)")"
    finalize
    return
  fi
  SHORT_SHA="${FULL_SHA:0:7}"; move_run
  log "testing $SHORT_SHA (from $SOURCE_NAME)"

  build_fast fast
  local first_status="$FAST_STATUS" first_apk="$FAST_APK" first_base="$FAST_BASE" first_note="$FAST_NOTE" first_secs="$FAST_SECONDS"
  local pin=""; [ "$FAST_STATUS" = ok ] && pin="$FAST_BASE"
  build_full "$pin"
  RUN_FACTS_FAST="$(fast_json "$first_status" "$first_apk" "$RUN_DIR/fast.log" "$first_secs" "$first_base" "$first_note")"
  RUN_FACTS_FULL="$(json "status=$FULL_STATUS" "apk=$FULL_APK" "log=$RUN_DIR/full.log" "seconds=$FULL_SECONDS" "note=$FULL_NOTE")"
  if [ "$first_status" = unavailable ] && [ "$FULL_STATUS" = ok ]; then
    # no base for the native fingerprint (first night, native change): the full build just registered one, check against it
    log "fast path had no base; second attempt against the base of tonight's full build"
    build_fast fast2
    RUN_FACTS_FAST2="$(fast_json "$FAST_STATUS" "$FAST_APK" "$RUN_DIR/fast2.log" "$FAST_SECONDS" "$FAST_BASE" "$FAST_NOTE")"
  fi
  finalize
}

move_run() { # name the run dir after the commit (the open log keeps working: same inode)
  local final="$NIGHTLY_HOME/runs/$DATE-$SHORT_SHA"
  rm -rf "$final"; mv "$RUN_DIR" "$final"; RUN_DIR="$final"
}

finalize() {
  local rc=0
  write_run
  HUI_NIGHTLY_SWAP="$NIGHTLY_HOME/src/scripts/lib/apk_swap.py" node "$CROSS" finish "$RUN_DIR" "$REPORTS" || rc=$?
  node "$CROSS" prune "$NIGHTLY_HOME/runs" "$KEEP"
  if [ "$rc" = 0 ]; then rm -f "$RUN_DIR"/fast*.apk "$RUN_DIR"/full.apk; fi   # a passing run keeps logs and verdict, not 2 x 60 MB
  rm -rf "$NIGHTLY_HOME/src/dist"
  log "result: $REPORTS/$DATE.md (exit $rc)"
  exit "$rc"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then main "$@"; fi
