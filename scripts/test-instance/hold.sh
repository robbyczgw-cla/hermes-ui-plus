#!/usr/bin/env bash
# Run CMD against the instance and put the instance directory back exactly as it was: lock, back up, CMD, stop, restore,
# prove it. Replaces the hand-written "cp -a, hash, rm -rf, mv, hash" scripts, whose before/after hashes once differed
# (same file count, nothing explained) because the "before" was taken from the LIVE tree after the copy.
#   scripts/test-instance/hold.sh [--wait S] [--label N] [--lease S] [--start] -- CMD [ARGS...]
# 1. classic flock (Linux) + instance lease; the instance must be stopped
# 2. backup = `cp -a` of TI_DIR to TI_DIR.hold-backup; live tree and backup are both proved; if they differ, a writer
#    touched the tree during the copy (e.g. a `sync` on the host): the paths are printed and the copy is repeated (3x)
# 3. optional --start (start.sh), CMD (TI_LOCK_OWNED=1: CMD may call start.sh / stop.sh)
# 4. on every exit path: stop.sh, then restore by renaming (TI_DIR -> TI_DIR.hold-after, backup -> TI_DIR), and prove the
#    restored tree against the manifest taken from the BACKUP (not from the live tree); only then delete the "after" copy.
#    A mismatch keeps both trees, prints the differing paths and exits 6.
# Exit: status of CMD; 3 lock busy; 4 start failed; 5 stop left something; 6 restore does not match; 7 backup unstable.
# The proof (tree-proof.py) covers path, mode, owner, hard links and content; mtimes are not part of it.
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$here/lib.sh"
wait_s=0; label="hold"; lease_s=7200; do_start=0
while [ $# -gt 0 ]; do
  case "$1" in
    --wait) wait_s="$2"; shift 2 ;;
    --label) label="$2"; shift 2 ;;
    --lease) lease_s="$2"; shift 2 ;;
    --start) do_start=1; shift ;;
    --) shift; break ;;
    *) break ;;
  esac
done
[ $# -gt 0 ] || { echo "usage: hold.sh [--wait S] [--label NAME] [--lease S] [--start] -- CMD [ARGS...]" >&2; exit 2; }
proof="${TI_PROOF_SCRIPT:-$here/tree-proof.py}"
backup="$TI_DIR.hold-backup"; after="$TI_DIR.hold-after"; work="$(mktemp -d "${TMPDIR:-/tmp}/ti-hold.XXXXXX")"
[ -d "$TI_DIR" ] || die "no instance directory $TI_DIR"
[ ! -e "$backup" ] && [ ! -e "$after" ] || die "$backup or $after exists from an earlier run: look at it, then remove it"

if [ -n "$TI_FLOCK_FILE" ] && command -v flock >/dev/null 2>&1; then
  exec 9>"$TI_FLOCK_FILE"
  if [ "$wait_s" -gt 0 ]; then flock -w "$wait_s" 9; else flock -n 9; fi || { say "instance flock $TI_FLOCK_FILE is held by someone else"; exit 3; }
fi
tilock_acquire "$label" "$wait_s" "$$" "$lease_s" || exit 3
export TI_LOCK_OWNED=1
child=""
finish() {
  local rc=$?
  trap - EXIT INT TERM HUP
  set +e
  [ -n "$child" ] && kill "$child" 2>/dev/null
  bash "${TI_STOP_SCRIPT:-$here/stop.sh}" || rc=5
  if [ -d "$backup" ] && [ -f "$work/backup.manifest" ]; then
    if mv "$TI_DIR" "$after" && mv "$backup" "$TI_DIR"; then
      python3 "$proof" manifest "$TI_DIR" > "$work/restored.manifest"
      if python3 "$proof" diff "$work/backup.manifest" "$work/restored.manifest" > "$work/restore.diff"; then
        say "restored: $(python3 "$proof" digest "$TI_DIR"), identical to the backup"
        rm -rf "$after"
      else
        say "ERROR: the restored tree differs from the backup; kept $after:"; cat "$work/restore.diff" >&2; rc=6
      fi
    else
      say "ERROR: could not swap the backup in; trees kept: $TI_DIR, $after, $backup"; rc=6
    fi
  fi
  tilock_release
  rm -rf "$work"
  exit "$rc"
}
trap finish EXIT
trap 'exit 130' INT TERM HUP

bash "${TI_STOP_SCRIPT:-$here/stop.sh}" || die "the instance is not stopped (stop.sh failed): hold.sh backs up a stopped instance"

ok=0
for attempt in 1 2 3; do
  rm -rf "$backup"
  cp -a "$TI_DIR" "$backup" || die "backup copy failed"
  python3 "$proof" manifest "$TI_DIR" > "$work/live.manifest"
  python3 "$proof" manifest "$backup" > "$work/backup.manifest"
  if python3 "$proof" diff "$work/live.manifest" "$work/backup.manifest" > "$work/backup.diff"; then ok=1; break; fi
  say "backup attempt $attempt: live tree and copy differ (something writes to $TI_DIR):"; head -20 "$work/backup.diff" >&2
done
if [ "$ok" != 1 ]; then rm -rf "$backup"; rm -f "$work/backup.manifest"; exit 7; fi
say "backup: $(python3 "$proof" digest "$backup")"

if [ "$do_start" = 1 ]; then bash "${TI_START_SCRIPT:-$here/start.sh}" || exit 4; fi
"$@" &
child=$!
rc=0
wait "$child" || rc=$?
child=""
exit "$rc"
