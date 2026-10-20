# shellcheck shell=bash
# Get the exact commit of this checkout onto a lane host (the build Mac) with as little traffic as possible. The link from
# the orchestrating machine to the Mac can be slow (a DERP relay, about 0.7 MB/s), so nothing is rsynced that git can send:
#   - the host keeps a bare repo ~/<lane>/repo.git; every sync stores the commit as refs/lane/<sha>
#   - HUI_LANE_GIT_URL (optional, e.g. an internal read-only git URL the host can reach): the host fetches the commit itself
#   - otherwise a `git bundle` of only the commits the host lacks (empty host: the full history once, later runs: kilobytes)
#   - the working files come out of that repo (`git archive`) into a run directory of their own, ~/<lane>/runs/<run id>: several
#     agents use the host at once, and with one shared checkout a sync during another run's build (or smoke) silently swapped
#     that run's sources (an APK named after commit A held B's code, a smoke ran B's suite.py)
#   - uncommitted changes (modified/untracked/deleted files under the synced paths) are overlaid afterwards with rsync, a
#     few files; the label then gets "-dirty"
#   - the run gets a stamp "<full sha> <run id>" (.lane-stamp, app/.lane-stamp): the build checks it on its copy of app/
#     (scripts/lib/lane-stamp.sh), so sources that changed under it fail the build instead of shipping
#   lane_sync HOST LANE ROOT      sets LANE_SHA (full), LANE_LABEL (short, +"-dirty"), LANE_RUN (run id), LANE_DIR (the run
#                                 directory, relative to the host's ~), LANE_STAMP; LANE is relative to the host's ~
#   lane_finish HOST DIR          after the build (+ fetch / smoke): drops the run's app/ and marks it done; scripts/ and dist/
#                                 (the APK) stay for a later `smoke.sh --apk-on-host` until the run is pruned
# Pruning (every sync, before the new run is made): done runs beyond the newest HUI_LANE_KEEP_RUNS [6] or older than
# HUI_LANE_KEEP_HOURS [24], runs that never finished after HUI_LANE_RUN_TTL_HOURS [6] (their caller is gone), and every done run
# when the disk has less than HUI_LANE_MIN_FREE_GB [10] free. A run in progress (or one a smoke run marked .lane-busy) is never
# touched.
# Synced paths: app/ scripts/ bridge/src/replay.mjs (what the build and the smoke suite need). bash 3.2 compatible.
LANE_PATHS=(app scripts bridge/src/replay.mjs)

lane_sync() {
  local host="$1" lane="$2" root="$3" sha state t bundle size tips="" dirty=0 list run rdir v
  local keep="${HUI_LANE_KEEP_RUNS:-6}" keep_h="${HUI_LANE_KEEP_HOURS:-24}" ttl_h="${HUI_LANE_RUN_TTL_HOURS:-6}" min_gb="${HUI_LANE_MIN_FREE_GB:-10}"
  for v in "$keep" "$keep_h" "$ttl_h" "$min_gb"; do
    case "$v" in ''|*[!0-9]*) echo "lane: HUI_LANE_KEEP_RUNS / _KEEP_HOURS / _RUN_TTL_HOURS / _MIN_FREE_GB must be numbers" >&2; return 2 ;; esac
  done
  sha="$(git -C "$root" rev-parse HEAD)" || return 1
  run="$(date +%Y%m%d-%H%M%S)-${sha:0:7}-$$-$RANDOM"; rdir="$lane/runs/$run"
  ssh -o BatchMode=yes "$host" "mkdir -p '$lane/runs'; [ -d '$lane/repo.git' ] || git init -q --bare '$lane/repo.git'" || return 1
  state="$(ssh -o BatchMode=yes "$host" "if git -C '$lane/repo.git' cat-file -e '$sha^{commit}' 2>/dev/null; then echo HAVE; else git -C '$lane/repo.git' for-each-ref --format='%(objectname)' refs/lane; fi")" || return 1
  if [ "$state" = HAVE ]; then
    echo "lane: host already has ${sha:0:7}"
  else
    # the host fetches the commit itself: HUI_LANE_GIT_URL (caller's choice), then its own sources in order
    # (~/<lane>/git-sources.d/NN-name.url [+ .key], written by scripts/lane-setup-git.sh: Forgejo over the LAN first, then GitHub)
    if ssh -o BatchMode=yes "$host" "bash -s" <<FETCH
cd '$lane'
extra='${HUI_LANE_GIT_URL:-}'
if [ -n "\$extra" ]; then
  s=\$(date +%s)
  if git -C repo.git fetch -q "\$extra" '+$sha:refs/lane/$sha' 2>/dev/null; then
    echo "lane: host fetched ${sha:0:7} itself from HUI_LANE_GIT_URL in \$(( \$(date +%s) - s )) s"; exit 0
  fi
fi
for u in git-sources.d/*.url; do
  [ -f "\$u" ] || continue
  name=\$(basename "\$u" .url); key="git-sources.d/\$name.key"
  if [ -f "\$key" ]; then
    export GIT_SSH_COMMAND="ssh -i \$HOME/$lane/\$key -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=8 -o UserKnownHostsFile=\$HOME/$lane/git-sources.d/known_hosts -o StrictHostKeyChecking=accept-new"
  else unset GIT_SSH_COMMAND; fi
  s=\$(date +%s)
  if git -C repo.git fetch -q "\$(cat "\$u")" '+$sha:refs/lane/$sha' 2>/dev/null; then
    echo "lane: host fetched ${sha:0:7} from \${name#*-} in \$(( \$(date +%s) - s )) s"; exit 0
  fi
  echo "lane: fetch from \${name#*-} failed, trying the next source"
done
exit 1
FETCH
    then :
    else
      for t in $state; do git -C "$root" cat-file -e "$t^{commit}" 2>/dev/null && tips="$tips ^$t"; done
      bundle="$(mktemp "${TMPDIR:-/tmp}/hui-lane.XXXXXX")"
      # shellcheck disable=SC2086  # $tips: the commits the host already has
      git -C "$root" bundle create "$bundle" HEAD $tips >/dev/null 2>&1 || { rm -f "$bundle"; echo "lane: git bundle failed" >&2; return 1; }
      size="$(wc -c < "$bundle" | tr -d ' ')"
      echo "lane: sending a bundle of ${sha:0:7} ($(( size / 1024 )) kB)"
      # one file per run: two syncs at the same time must not write into each other's bundle
      ssh -o BatchMode=yes "$host" "cat > '$lane/in-$run.bundle'" < "$bundle" || { rm -f "$bundle"; return 1; }
      rm -f "$bundle"
      ssh -o BatchMode=yes "$host" "git -C '$lane/repo.git' fetch -q \"\$HOME/$lane/in-$run.bundle\" '+HEAD:refs/lane/$sha'; rc=\$?; rm -f '$lane/in-$run.bundle'; exit \$rc" 2>&1 \
        | sed 's/^/lane: /' ; [ "${PIPESTATUS[0]}" = 0 ] || return 1
    fi
  fi
  # the login shell on the host may be zsh (no word splitting of unquoted variables): run this part with bash
  ssh -o BatchMode=yes "$host" "bash -s" <<ARCHIVE || return 1
set -euo pipefail
cd '$lane'
# prune old runs (never one in progress: those have no .lane-done and are younger than the TTL, or a smoke run marked them
# .lane-busy within the TTL)
busy() { [ -n "\$(find "\$1/.lane-busy" -mmin -$((ttl_h * 60)) 2>/dev/null)" ]; }
free_gb=\$(df -k runs | awk 'NR==2 { printf "%d", \$4 / 1048576 }'); low=0
[ "\$free_gb" -ge $min_gb ] || { low=1; echo "lane: only \$free_gb GB free on the host (< $min_gb): dropping every finished run"; }
i=0
for f in \$(ls -1t runs/*/.lane-done 2>/dev/null); do
  i=\$((i + 1)); d=\${f%/.lane-done}
  busy "\$d" && continue
  if [ \$low = 1 ] || [ \$i -gt $keep ] || [ -n "\$(find "\$f" -mmin +$((keep_h * 60)) 2>/dev/null)" ]; then rm -rf "\$d"; fi
done
for d in runs/*; do
  [ -d "\$d" ] && [ ! -f "\$d/.lane-done" ] || continue
  busy "\$d" && continue
  if [ -n "\$(find "\$d" -maxdepth 0 -mmin +$((ttl_h * 60)) 2>/dev/null)" ]; then echo "lane: removing the abandoned run \${d#runs/}"; rm -rf "\$d"; fi
done
mkdir 'runs/$run'   # no -p: the run directory is new, or this sync fails
paths=()
for p in ${LANE_PATHS[*]}; do git -C repo.git cat-file -e '$sha':\$p 2>/dev/null && paths+=("\$p"); done
git -C repo.git archive '$sha' "\${paths[@]}" | tar -x -C 'runs/$run'
ARCHIVE
  # uncommitted changes
  list="$(mktemp "${TMPDIR:-/tmp}/hui-lane-list.XXXXXX")"
  { git -C "$root" diff --name-only --diff-filter=d -z HEAD -- "${LANE_PATHS[@]}"
    git -C "$root" ls-files -o --exclude-standard -z -- "${LANE_PATHS[@]}"; } > "$list"
  if [ -s "$list" ]; then
    dirty=1
    rsync -a --from0 --files-from="$list" "$root/" "$host:$rdir/" || { rm -f "$list"; return 1; }
    echo "lane: overlaid $(tr -cd '\0' < "$list" | wc -c | tr -d ' ') uncommitted file(s)"
  fi
  git -C "$root" diff --name-only --diff-filter=D -z HEAD -- "${LANE_PATHS[@]}" > "$list"
  if [ -s "$list" ]; then
    dirty=1
    ssh -o BatchMode=yes "$host" "cd '$rdir' && xargs -0 rm -f" < "$list" || { rm -f "$list"; return 1; }
  fi
  rm -f "$list"
  # the stamp goes in last: the run's sources are complete now
  LANE_STAMP="$sha $run"
  ssh -o BatchMode=yes "$host" "printf '%s\n' '$LANE_STAMP' > '$rdir/.lane-stamp' && { [ ! -d '$rdir/app' ] || printf '%s\n' '$LANE_STAMP' > '$rdir/app/.lane-stamp'; }" || return 1
  LANE_SHA="$sha"; LANE_RUN="$run"; LANE_DIR="$rdir"; LANE_LABEL="${sha:0:7}"; [ "$dirty" = 0 ] || LANE_LABEL="${LANE_LABEL}-dirty"
  echo "lane: run directory ~/$rdir"
  return 0
}

lane_finish() { # lane_finish HOST DIR
  local host="$1" dir="$2"
  case "$dir" in */runs/*) ;; *) return 0 ;; esac
  ssh -o BatchMode=yes "$host" "rm -rf '$dir/app' && touch '$dir/.lane-done'" || echo "lane: could not mark ~/$dir as done (it is pruned after ${HUI_LANE_RUN_TTL_HOURS:-6} h)" >&2
}
