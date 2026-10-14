#!/usr/bin/env bash
# Shared checks: app typecheck (tsc), app unit tests and the scripts' tests.
# Usage: scripts/check.sh tsc | tsc-test | test [node --test args...] | leak | scripts | all
#   leak     scripts/leak-guard.test.mjs        scripts  every scripts/*.test.mjs (guards, web-finalize, sw, build libs)
# Bridge and push tests are separate: `cd bridge && npm test`, `cd push && npm test` (CI runs all of them,
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
case "${1:-all}" in
  tsc)      run npx tsc --noEmit ;;
  tsc-test) run npx tsc --noEmit -p tsconfig.test.json ;;
  test)     shift; if [ $# -gt 0 ]; then run node --test "$@"; else run npm test --silent; fi ;;
  leak)     run node --test ../scripts/leak-guard.test.mjs ;;
  scripts)  run node --test ../scripts/*.test.mjs ;;
  all)      run npx tsc --noEmit; run npx tsc --noEmit -p tsconfig.test.json; run npm test --silent; run node --test ../scripts/*.test.mjs ;;
  *) echo "usage: $0 tsc|tsc-test|test [files]|leak|scripts|all" >&2; exit 2 ;;
esac
