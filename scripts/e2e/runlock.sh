# shellcheck shell=bash
# One smoke run per host (scripts/e2e/smoke.sh): take the run lock on fd 9, which the caller opened on LOCKFILE.
# WAIT_S = 0 refuses at once (exit status 3); otherwise waits up to WAIT_S seconds for the other run to finish, so
# `--wait MIN` also covers a smoke run of another session, not only a busy emulator / Gradle.
#   run_lock WAIT_S LOCKFILE
run_lock() {
  local wait_s=$1 file=$2
  flock -n 9 && return 0
  if [ "$wait_s" -le 0 ]; then
    echo "another smoke run holds $file" >&2
    return 3
  fi
  echo "$(date +%T) another smoke run holds $file, waiting up to $(( (wait_s + 59) / 60 )) min"
  flock -w "$wait_s" 9 && return 0
  echo "another smoke run still holds $file, refusing" >&2
  return 3
}
