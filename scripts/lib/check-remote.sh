#!/usr/bin/env bash
# scripts/check.sh all --host HOST [--worktree | --committed]: the full gate on another Linux machine over ssh, for
# machines too small (or with the wrong file system) to run `check.sh all` themselves.
#   1. ships the committed tree of HEAD into a fresh run dir on HOST: ~/$HUI_CHECK_REMOTE_DIR/runs/<id>/src (default
#      .cache/hui-check-remote; one dir per run, parallel runs never share one). The link can be slow (a relay), so only
#      git objects HOST lacks travel: HOST keeps a bare repo with the trees of earlier runs (refs/trees/<tree>), this
#      side packs the objects of the new tree minus those trees (the first run sends the whole tree once, later runs
#      kilobytes), and the run dir is a checkout of that tree with one commit (some tests use `git ls-files`)
#   2. runs scripts/lib/check-remote-run.sh from that tree there: Node 22 with TypeScript stripping (the host's own node,
#      else a cached official nodejs.org tarball, SHA-256 checked), node_modules per package from a cache keyed by the lockfile hashes (npm ci only when they changed), then the
#      normal capped `scripts/check.sh all` (its per-step lock queues parallel runs from several agents)
#   3. streams the output, prints one summary line, exits with the remote exit code (255 = ssh failure) and always
#      removes the run dir (trap; an interrupted run also stops the remote process group it started)
# HOST: `linux` = LINUX_HOST (environment, then $HUI_PRIVATE_DIR/build.env); anything else is used as the ssh alias.
# Tree: a dirty working tree is refused; --worktree ships HEAD plus the working-tree changes (staged, unstaged and
# untracked, not ignored), --committed ships HEAD and only warns.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PRIV="${HUI_PRIVATE_DIR:-$HOME/work/hermesiui-private}"
usage() { echo "usage: scripts/check.sh all --host HOST [--worktree | --committed]   (HOST: linux = LINUX_HOST, or an ssh alias)"; }

HOST_ARG="" MODE=clean
while [ $# -gt 0 ]; do
  case "$1" in
    --host)      [ $# -ge 2 ] || { usage >&2; exit 2; }; HOST_ARG=$2; shift 2 ;;
    --host=*)    HOST_ARG=${1#--host=}; shift ;;
    --worktree)  [ "$MODE" = clean ] || { echo "--worktree and --committed exclude each other" >&2; exit 2; }; MODE=worktree; shift ;;
    --committed) [ "$MODE" = clean ] || { echo "--worktree and --committed exclude each other" >&2; exit 2; }; MODE=committed; shift ;;
    -h|--help)   usage; exit 0 ;;
    *)           echo "check.sh all: unknown argument '$1'" >&2; usage >&2; exit 2 ;;
  esac
done

from_file() { # FILE VAR -> value of VAR in FILE (sourced in a subshell), empty when missing
  [ -f "$1" ] || return 0
  ( set +u; . "$1" >/dev/null 2>&1; eval "printf '%s' \"\${$2:-}\"" )
}
case "$HOST_ARG" in
  linux) HOST="${LINUX_HOST:-$(from_file "$PRIV/build.env" LINUX_HOST)}"
         [ -n "$HOST" ] || { echo "check.sh all --host linux: LINUX_HOST is not set (environment or $PRIV/build.env)" >&2; exit 2; } ;;
  "")    usage >&2; exit 2 ;;
  *)     HOST=$HOST_ARG ;;
esac
# an ssh destination, never an option or something the remote shell would interpret
[[ "$HOST" =~ ^[A-Za-z0-9_][A-Za-z0-9._@:-]*$ ]] || { echo "check.sh all: invalid host '$HOST'" >&2; exit 2; }
BASE="${HUI_CHECK_REMOTE_DIR:-.cache/hui-check-remote}"   # on HOST, relative to its home unless absolute
[[ "$BASE" =~ ^[A-Za-z0-9_./-]+$ && "$BASE" != *..* ]] || { echo "check.sh all: invalid HUI_CHECK_REMOTE_DIR '$BASE'" >&2; exit 2; }
# temp files of the run on HOST: default its run dir (on disk; the host's /tmp may be a small, full tmpfs), or
# HUI_CHECK_REMOTE_TMPDIR/hui-check-<id> (an absolute path on HOST); removed with the run either way
RTMP="${HUI_CHECK_REMOTE_TMPDIR:-}"
[ -z "$RTMP" ] || [[ "$RTMP" =~ ^/[A-Za-z0-9_./-]*$ && "$RTMP" != *..* ]] || { echo "check.sh all: HUI_CHECK_REMOTE_TMPDIR must be an absolute plain path, not '$RTMP'" >&2; exit 2; }

cd "$ROOT"
git rev-parse --verify -q HEAD >/dev/null || { echo "check.sh all --host: no commit in this tree" >&2; exit 2; }
SHA=$(git rev-parse --short=12 HEAD)
DIRTY=$(git status --porcelain --untracked-files=normal)
TREE=HEAD LABEL=$SHA
if [ -n "$DIRTY" ]; then
  case "$MODE" in
    clean)
      echo "check.sh all --host: the working tree has changes the run would not see:" >&2
      printf '%s\n' "$DIRTY" | head -n 10 | sed 's/^/  /' >&2
      echo "commit them, or use --worktree to include them, or --committed to check HEAD as committed" >&2
      exit 2 ;;
    committed) echo "check.sh all --host: working tree changes are NOT included (--committed): checking $SHA" >&2 ;;
    worktree)
      # a throwaway index: HEAD + every change in the working tree, without touching the real index
      TMPIDX=$(mktemp)
      cp "$(git rev-parse --git-path index)" "$TMPIDX"
      GIT_INDEX_FILE="$TMPIDX" git add -A
      TREE=$(GIT_INDEX_FILE="$TMPIDX" git write-tree)
      rm -f "$TMPIDX"
      LABEL="$SHA+worktree" ;;
  esac
fi

RUN_ID="$(date +%Y%m%d-%H%M%S)-$$-$RANDOM"
RUN="$BASE/runs/$RUN_ID"
SSH=(ssh -o BatchMode=yes -o ControlMaster=no -o ServerAliveInterval=30 -o ServerAliveCountMax=6 "$HOST")
LOG=$(mktemp)
STARTED=0 DONE=0
cleanup() {
  local rc=$?
  trap - EXIT INT TERM HUP
  if [ "$STARTED" = 1 ]; then
    # an interrupted run: stop the process group the remote half recorded (by that pid only), then drop the run dir
    if [ "$DONE" = 0 ]; then
      "${SSH[@]}" "p=\$(cat '$RUN/pgid' 2>/dev/null) && [ -n \"\$p\" ] && kill -TERM -- -\"\$p\" 2>/dev/null; sleep 1; rm -rf '$RUN'" </dev/null || true
    else
      "${SSH[@]}" "rm -rf '$RUN'" </dev/null || true
    fi
  fi
  rm -f "$LOG"
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

SECONDS=0
TREE=$(git rev-parse "$TREE^{tree}")
echo "check.sh all --host $HOST: $LABEL (tree ${TREE:0:12}) -> $RUN"
STARTED=1
# Linux only (a macOS host needs the case-sensitive image, docs/BUILD.md); HAVE, or the trees HOST already has
STATE=$("${SSH[@]}" "set -e; [ \"\$(uname -s)\" = Linux ] || { echo 'check.sh all --host: not a Linux host' >&2; exit 3; }
cd '$BASE' 2>/dev/null || { mkdir -p '$BASE'; cd '$BASE'; }
mkdir -p 'runs/$RUN_ID' trees; [ -d repo.git ] || git init -q --bare repo.git
if git -C repo.git cat-file -e '$TREE^{tree}' 2>/dev/null; then echo HAVE; else ls trees; fi" </dev/null) || {
  rc=$?; echo "check --host $HOST: $LABEL - host not usable (exit $rc) - FAILED" >&2; exit $rc; }
SEND=0 NOT=()
if [ "$STATE" != HAVE ]; then
  SEND=1
  for t in $STATE; do
    if [[ "$t" =~ ^[0-9a-f]{40,64}$ ]] && git cat-file -e "$t^{tree}" 2>/dev/null; then NOT+=("^$t"); fi
  done
  N=$(git rev-list --objects "$TREE" ${NOT[@]+"${NOT[@]}"} | wc -l | tr -d ' ')
  echo "check.sh all --host: sending $N git objects$([ ${#NOT[@]} -gt 0 ] || echo ' (first run on this host: the whole tree)')"
fi
# pack (when needed) -> HOST's repo, then the run dir: a checkout of the tree that borrows the objects (alternates)
# in the background + wait (here and below): a TERM/INT/HUP to this shell runs the cleanup at once (bash runs traps only
# after a foreground command ends)
REMOTE_CHECKOUT="set -e; cd '$BASE'
$(if [ $SEND = 1 ]; then echo "git -C repo.git index-pack --stdin >/dev/null; git -C repo.git update-ref 'refs/trees/$TREE' '$TREE'"; fi)
touch 'trees/$TREE'
git init -q 'runs/$RUN_ID/src'
echo \"\$(cd repo.git && pwd)/objects\" > 'runs/$RUN_ID/src/.git/objects/info/alternates'
cd 'runs/$RUN_ID/src'
git read-tree -u --reset '$TREE'
git -c user.name=check -c user.email=check@example.com -c core.hooksPath=/dev/null -c commit.gpgsign=false commit -q -m 'check tree'"
set +e
if [ $SEND = 1 ]; then
  ( git rev-list --objects "$TREE" ${NOT[@]+"${NOT[@]}"} | git pack-objects --stdout -q | "${SSH[@]}" "$REMOTE_CHECKOUT"
    s=("${PIPESTATUS[@]}"); [ "${s[0]}${s[1]}" = 00 ] || exit 90; exit "${s[2]}" ) &
else
  "${SSH[@]}" "$REMOTE_CHECKOUT" </dev/null &
fi
wait $!
SHIP=$?
set -e
if [ $SHIP != 0 ]; then
  echo "check --host $HOST: $LABEL could not be shipped ($([ $SHIP = 90 ] && echo 'git pack failed' || echo "ssh exit $SHIP")) - FAILED" >&2
  exit $([ $SHIP = 90 ] && echo 1 || echo $SHIP)
fi

set +e
( "${SSH[@]}" "${RTMP:+HUI_CHECK_REMOTE_TMPDIR='$RTMP' }exec setsid --wait bash '$RUN/src/scripts/lib/check-remote-run.sh' '$RUN'" </dev/null 2>&1 | tee "$LOG"
  exit "${PIPESTATUS[0]}" ) &
wait $!
RC=$?
set -e
DONE=1

CHECK=$(sed -n 's/^check: //p' "$LOG" | tail -n 1)
SETUP=$(sed -n 's/^check-remote: setup //p' "$LOG" | tail -n 1)
case $RC in 0) VERDICT=green ;; 255) VERDICT="ssh failed" ;; 75) VERDICT="lock timeout" ;; *) VERDICT=FAILED ;; esac
echo "check --host $HOST: $LABEL ${CHECK:-no check summary (see the output above)}${SETUP:+ | setup $SETUP} | exit $RC ($VERDICT) in $((SECONDS / 60))m$((SECONDS % 60))s"
exit "$RC"
