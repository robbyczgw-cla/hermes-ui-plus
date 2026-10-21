#!/usr/bin/env bash
# Shared checks: app typecheck (tsc), app unit tests, scripts' tests, the bridge suite, the push module,
# and the Hermes plugin.
# tsc steps first remove the stale generated app/.expo/types (scripts/lib/clean-route-types.sh); a green `all` on a clean
# tree leaves a stamp keyed by the tree hash (scripts/lib/gate-stamp.sh) that release.sh reuses.
# Usage: scripts/check.sh tsc | tsc-test | test [node --test args...] | leak | scripts | bridge | bridge-security | all
#                         | quick [--base REF] | all --host HOST [--worktree|--committed]
#   all --host  the full gate on another Linux machine over ssh (scripts/lib/check-remote.sh): ships the committed tree
#            of HEAD, runs `check.sh all` there with cached Node and node_modules, streams the output, returns its exit code
#   leak     scripts/leak-guard.test.mjs        scripts  every scripts/*.test.mjs + scripts/e2e/*.test.mjs (guards, web-finalize, sw, build libs, E2E mock)
#   quick    inner loop, NOT a merge gate: only what the change since merge-base(HEAD, main or REF) can affect, working
#            tree and untracked files included. scripts/lib/related-tests.mjs maps changed files to related tests (import
#            graph + path mentions) and falls back to an area's full suite when unsure (config, helpers, >30 % of the
#            tests); tsc is incremental (cache in ${XDG_CACHE_HOME:-~/.cache}/hui-check/) and skipped when nothing it
#            sees changed; leak-guard scans the working tree changes. Fewer, shorter locked steps than `all`.
# The full bridge and push suites are separate: `cd bridge && npm test`, `cd push && npm test` (CI runs all of them,
# .github/workflows/ci.yml).
#
# Two modes:
# - capped (default on Linux with a systemd user session): for a shared build machine without swap where several
#   agents run checks in parallel. Each step is serialized via flock and runs in a 3 GB `systemd-run --user --scope`,
#   inside the aggregate slice of scripts/lib/heavy.sh that the APK / web builds share.
# - plain: runs the same commands directly. Used automatically when systemd-run, flock or the user session is missing
#   (macOS, containers) and in CI (CI=true); force it with HUI_CHECK_PLAIN=1.
set -euo pipefail
cd "$(dirname "$0")/../app"
PLAIN="${HUI_CHECK_PLAIN:-}"
if [ -z "$PLAIN" ]; then
  if [ -n "${CI:-}" ] || ! command -v systemd-run >/dev/null 2>&1 || ! command -v flock >/dev/null 2>&1 \
    || [ ! -d "/run/user/$(id -u)" ]; then PLAIN=1; else PLAIN=0; fi
fi
if [ "$PLAIN" = 1 ]; then
  run() { "$@"; }
else
  export XDG_RUNTIME_DIR="/run/user/$(id -u)" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$(id -u)/bus"
  # shellcheck source=lib/heavy.sh
  . ../scripts/lib/heavy.sh
  heavy_slice_init 2>/dev/null || true
  # Never wrap this script in `flock /tmp/hui-check.lock` yourself: it takes the lock per step (nested = deadlock).
  # -w 900: give up after 15 min instead of waiting forever if something holds the lock.
  run() { flock -w 900 -E 75 /tmp/hui-check.lock systemd-run --user --scope -q "${HEAVY_SLICE[@]}" -p MemoryMax=3G -p MemorySwapMax=0 "$@"; }
fi
# quick: the plan (cheap, before any lock), then at most two locked steps (tsc, tests) and leak-guard (no lock).
# Each step prints its wall time and the time inside the lock (the difference is lock wait + scope start).
ms() { local t=${1//[.,]/}; echo $((10#$t / 1000)); }   # $EPOCHREALTIME -> ms
secs() { local d=$(($1 / 100)); echo "$((d / 10)).$((d % 10))s"; }   # ms -> 1.2s
q_tsc() { # app and/or test project, incremental (the build info lives outside the repo and node_modules)
  ../scripts/lib/clean-route-types.sh >&2
  if [ "$Q_TSC_APP" = 1 ]; then npx tsc --noEmit --incremental --tsBuildInfoFile "$Q_CACHE/app.tsbuildinfo" || return; fi
  if [ "$Q_TSC_TEST" = 1 ]; then npx tsc --noEmit -p tsconfig.test.json --incremental --tsBuildInfoFile "$Q_CACHE/test.tsbuildinfo"; fi
}
q_tests() { # app tests (all = `npm test`, else explicit files in chunks against ARG_MAX), then scripts + bridge tests
  local rc=0 files=() i
  . "$Q_LISTS"
  if [ "$Q_APP_MODE" = full ]; then npm test --silent || rc=1
  elif [ "$Q_APP_MODE" = related ]; then
    files=("${Q_APP_TESTS[@]#app/}")
    for ((i = 0; i < ${#files[@]}; i += 500)); do node --test "${files[@]:i:500}" || rc=1; done
  fi
  files=()
  if [ "$Q_SCRIPTS_MODE" = full ]; then files+=(../scripts/*.test.mjs ../scripts/e2e/*.test.mjs)
  elif [ "$Q_SCRIPTS_MODE" = related ]; then files+=("${Q_SCRIPTS_TESTS[@]/#/../}"); fi
  if [ "$Q_BRIDGE_MODE" = full ]; then files+=(../bridge/test/security-*.test.mjs)
  elif [ "$Q_BRIDGE_MODE" = related ]; then files+=("${Q_BRIDGE_TESTS[@]/#/../}"); fi
  if [ ${#files[@]} -gt 0 ]; then node --test "${files[@]}" || rc=1; fi
  return $rc
}
q_step() { # q_step NAME FUNCTION: one run() (same lock + scope as the other modes), timed outside and inside the lock
  local name=$1 t0=$EPOCHREALTIME tf rc=0 inner='?'
  tf=$(mktemp)
  run bash -c 't=$EPOCHREALTIME; "$1"; r=$?; echo "$t $EPOCHREALTIME" > "$0"; exit $r' "$tf" "$2" || rc=$?
  if read -r a b < "$tf" 2>/dev/null && [ -n "$b" ]; then
    inner=$(($(ms "$b") - $(ms "$a"))); Q_LOCKED=$((Q_LOCKED + inner)); inner=$(secs $inner)
  fi
  rm -f "$tf"
  echo "quick: step $name $(secs $(($(ms "$EPOCHREALTIME") - $(ms "$t0")))) (in lock $inner)$([ $rc = 0 ] || echo ", FAILED ($rc)")" >&2
  return $rc
}
quick() {
  local t0=$EPOCHREALTIME plan fail=0 lockout=0 tsc_s leak_s rc tmpidx
  Q_LOCKED=0
  plan="$(node ../scripts/lib/related-tests.mjs --sh "$@")" || exit $?
  eval "$plan"
  export Q_TSC_APP Q_TSC_TEST Q_CACHE Q_APP_MODE Q_SCRIPTS_MODE Q_BRIDGE_MODE
  export -f q_tsc q_tests
  tsc_s=skipped
  if [ "$Q_TSC_APP" = 1 ] || [ "$Q_TSC_TEST" = 1 ]; then
    mkdir -p "$Q_CACHE"
    rc=0; q_step tsc q_tsc || rc=$?
    if [ $rc = 0 ]; then tsc_s=ok; else tsc_s=FAILED; fail=1; [ $rc = 75 ] && lockout=1; fi
  fi
  if [ "$Q_APP_MODE$Q_SCRIPTS_MODE$Q_BRIDGE_MODE" != nonenonenone ]; then
    # arrays cannot be exported: hand them over as a sourced file
    Q_LISTS=$(mktemp); declare -p Q_APP_TESTS Q_SCRIPTS_TESTS Q_BRIDGE_TESTS > "$Q_LISTS"; export Q_LISTS
    rc=0; q_step tests q_tests || rc=$?
    rm -f "$Q_LISTS"
    if [ $rc != 0 ]; then fail=1; [ $rc = 75 ] && lockout=1; fi
  fi
  # leak-guard on everything changed in the working tree (staged, unstaged, untracked) via a throwaway index copy;
  # commits since merge-base passed the pre-commit hook. Cheap: no lock.
  tmpidx=$(mktemp)
  if cp "$(git rev-parse --git-path index)" "$tmpidx" && GIT_INDEX_FILE="$tmpidx" git -C .. add -A \
    && (cd .. && GIT_INDEX_FILE="$tmpidx" node scripts/leak-guard.mjs --staged --quiet); then leak_s=ok; else leak_s=FAILED; fail=1; fi
  rm -f "$tmpidx"
  local wall=$(secs $(($(ms "$EPOCHREALTIME") - $(ms "$t0")))) locked=$(secs $Q_LOCKED)
  local counts="${#Q_APP_TESTS[@]}/$Q_APP_TOTAL app tests, ${#Q_SCRIPTS_TESTS[@]}/$Q_SCRIPTS_TOTAL script tests, ${#Q_BRIDGE_TESTS[@]}/$Q_BRIDGE_TOTAL bridge-security tests"
  echo "quick: tsc $tsc_s, $counts, leak-guard $leak_s (mode $Q_MODE) in $wall ($locked in lock)$([ $fail = 0 ] || echo ' - FAILED')"
  echo "quick: not a merge gate; run scripts/check.sh all before merging."
  [ $lockout = 1 ] && exit 75
  exit $fail
}
# the bridge's own suite (bridge/package.json "test"); it needs bridge/node_modules, so say so instead of a module error
BRIDGE_TESTS='cd ../bridge && if [ ! -d node_modules ]; then echo "check.sh: bridge/node_modules missing: run npm ci in bridge/" >&2; exit 1; fi && npm test --silent'
# all: every step runs (a failing step does not hide the later ones; a lock timeout stops the run), output streamed and
# kept per step for the closing summary line: "check: tsc ok, ..., app tests 1234 pass/0 fail, ... - all green in 6m2s".
a_step() { # a_step NAME KIND CMD...: KIND tsc (counts "error TS"), node (node --test pass/fail), py (unittest)
  local name=$1 kind=$2 out rc p f; shift 2
  out=$(mktemp)
  set +e; run "$@" 2>&1 | tee "$out"; rc=${PIPESTATUS[0]}; set -e
  case $kind in
    tsc)  if [ $rc = 0 ]; then p=ok; else p="FAILED ($(grep -c 'error TS' "$out" || true) errors)"; fi ;;
    node) p=$(sed -nE 's/^(# |ℹ )pass ([0-9]+)$/\2/p' "$out" | awk '{s+=$1} END {print s+0}')
          f=$(sed -nE 's/^(# |ℹ )fail ([0-9]+)$/\2/p' "$out" | awk '{s+=$1} END {print s+0}')
          p="$p pass/$f fail$([ $rc = 0 ] || echo ' FAILED')" ;;
    py)   p=$(sed -nE 's/^Ran ([0-9]+) tests?.*/\1/p' "$out" | tail -1)
          p="${p:-0} ran$(sed -nE 's/^FAILED \((.*)\)$/, \1/p' "$out" | tail -1)$([ $rc = 0 ] || echo ' FAILED')" ;;
  esac
  rm -f "$out"
  [ $rc = 75 ] && p="lock timeout"
  A_SUM+=("$name $p")
  if [ $rc != 0 ]; then A_FAILED+=("$name"); [ $rc = 75 ] && A_LOCKOUT=1; fi
  return 0
}
all() {
  local s sum=""
  SECONDS=0   # not $EPOCHREALTIME: macOS bash 3.2 runs this mode too
  if [ $# -gt 0 ]; then
    case " $* " in *" --host "*|*" --host="*) exec bash ../scripts/lib/check-remote.sh "$@" ;; esac
    echo "usage: $0 all [--host HOST [--worktree|--committed]]" >&2; exit 2
  fi
  A_SUM=() A_FAILED=() A_LOCKOUT=0
  ../scripts/lib/clean-route-types.sh >&2   # stale generated expo-router types fail tsc; Expo rewrites them on demand
  a_step tsc tsc npx tsc --noEmit
  [ $A_LOCKOUT = 1 ] || a_step tsc-test tsc npx tsc --noEmit -p tsconfig.test.json
  [ $A_LOCKOUT = 1 ] || a_step 'app tests' node npm test --silent
  # the scripts' tests drive the Linux build host's tools (flock, systemd-run, the lane and instance scripts); on a
  # Mac (heavy checks moved to the build Mac) they run separately on the Linux host: scripts/check.sh scripts
  if [ $A_LOCKOUT = 1 ]; then :
  elif [ "$(uname -s)" = Linux ]; then a_step scripts node node --test ../scripts/*.test.mjs ../scripts/e2e/*.test.mjs
  else echo "check.sh all: scripts' tests skipped on $(uname -s); run 'scripts/check.sh scripts' on the Linux host" >&2
       A_SUM+=("scripts skipped"); fi
  # the whole bridge suite (router, routes, jobs, push, … and the security corpus), not only security-*: router
  # regressions surfaced only in the public export's bridge run before
  [ $A_LOCKOUT = 1 ] || a_step bridge node bash -c "$BRIDGE_TESTS"
  # the shared push module has its own suite
  [ $A_LOCKOUT = 1 ] || a_step push node bash -c 'cd ../push && npm test --silent'
  # the Hermes plugin's tests also run the skill example validator (SKILL.md budget, examples vs the app schema)
  [ $A_LOCKOUT = 1 ] || a_step hermes-plugin py bash -c 'cd ../hermes-plugin && python3 -m unittest discover -s tests -q'
  for s in "${A_SUM[@]}"; do sum+="${sum:+, }$s"; done
  echo "check: $sum - $([ ${#A_FAILED[@]} = 0 ] && echo 'all green' || echo "FAILED: ${A_FAILED[*]}") in $((SECONDS / 60))m$((SECONDS % 60))s"
  [ $A_LOCKOUT = 1 ] && exit 75
  [ ${#A_FAILED[@]} = 0 ] || exit 1
  # green: remember the tree (clean checkouts only) so release.sh can reuse the result for the very same tree
  if [ -z "$(git status --porcelain --untracked-files=no)" ]; then
    . ../scripts/lib/gate-stamp.sh; gate_stamp_write "$(git rev-parse 'HEAD^{tree}')" || true
  fi
}
case "${1:-all}" in
  tsc)      ../scripts/lib/clean-route-types.sh >&2; run npx tsc --noEmit ;;
  tsc-test) ../scripts/lib/clean-route-types.sh >&2; run npx tsc --noEmit -p tsconfig.test.json ;;
  test)     shift; if [ $# -gt 0 ]; then run node --test "$@"; else run npm test --silent; fi ;;
  leak)     run node --test ../scripts/leak-guard.test.mjs ;;
  scripts)  run node --test ../scripts/*.test.mjs ../scripts/e2e/*.test.mjs ;;
  bridge)   run bash -c "$BRIDGE_TESTS" ;;
  bridge-security) run node --test ../bridge/test/security-*.test.mjs ;;
  all)      shift $(($# > 0)); all "$@" ;;
  quick)    shift; quick "$@" ;;
  *) echo "usage: $0 tsc|tsc-test|test [files]|leak|scripts|bridge|bridge-security|all [--host HOST]|quick [--base REF]" >&2; exit 2 ;;
esac
