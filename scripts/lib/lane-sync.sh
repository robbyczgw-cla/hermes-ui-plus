# shellcheck shell=bash
# Get the exact commit of this checkout onto a lane host (the build Mac) with as little traffic as possible. The link from
# the orchestrating machine to the Mac can be slow (a DERP relay, about 0.7 MB/s), so nothing is rsynced that git can send:
#   - the host keeps a bare repo ~/<lane>/repo.git; every sync stores the commit as refs/lane/<sha>
#   - HUI_LANE_GIT_URL (optional, e.g. an internal read-only git URL the host can reach): the host fetches the commit itself
#   - otherwise a `git bundle` of only the commits the host lacks (empty host: the full history once, later runs: kilobytes)
#   - the working files come out of that repo (`git archive` into ~/<lane>/src), so they are exactly the commit
#   - uncommitted changes (modified/untracked/deleted files under the synced paths) are overlaid afterwards with rsync, a
#     few files; the label then gets "-dirty"
#   lane_sync HOST LANE ROOT      sets LANE_SHA (full), LANE_LABEL (short, +"-dirty"); LANE is relative to the host's ~
# Synced paths: app/ scripts/ bridge/src/replay.mjs (what the build and the smoke suite need). bash 3.2 compatible.
LANE_PATHS=(app scripts bridge/src/replay.mjs)

lane_sync() {
  local host="$1" lane="$2" root="$3" sha state t bundle size tips="" dirty=0 list
  sha="$(git -C "$root" rev-parse HEAD)" || return 1
  ssh -o BatchMode=yes "$host" "mkdir -p '$lane/src'; [ -d '$lane/repo.git' ] || git init -q --bare '$lane/repo.git'" || return 1
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
      ssh -o BatchMode=yes "$host" "cat > '$lane/in.bundle'" < "$bundle" || { rm -f "$bundle"; return 1; }
      rm -f "$bundle"
      ssh -o BatchMode=yes "$host" "git -C '$lane/repo.git' fetch -q \"\$HOME/$lane/in.bundle\" '+HEAD:refs/lane/$sha'; rc=\$?; rm -f '$lane/in.bundle'; exit \$rc" 2>&1 \
        | sed 's/^/lane: /' ; [ "${PIPESTATUS[0]}" = 0 ] || return 1
    fi
  fi
  # the login shell on the host may be zsh (no word splitting of unquoted variables): run this part with bash
  ssh -o BatchMode=yes "$host" "bash -s" <<ARCHIVE || return 1
set -euo pipefail
cd '$lane'
rm -rf src/app src/scripts src/bridge
mkdir -p src
paths=()
for p in ${LANE_PATHS[*]}; do git -C repo.git cat-file -e '$sha':\$p 2>/dev/null && paths+=("\$p"); done
git -C repo.git archive '$sha' "\${paths[@]}" | tar -x -C src
ARCHIVE
  # uncommitted changes
  list="$(mktemp "${TMPDIR:-/tmp}/hui-lane-list.XXXXXX")"
  { git -C "$root" diff --name-only --diff-filter=d -z HEAD -- "${LANE_PATHS[@]}"
    git -C "$root" ls-files -o --exclude-standard -z -- "${LANE_PATHS[@]}"; } > "$list"
  if [ -s "$list" ]; then
    dirty=1
    rsync -a --from0 --files-from="$list" "$root/" "$host:$lane/src/" || { rm -f "$list"; return 1; }
    echo "lane: overlaid $(tr -cd '\0' < "$list" | wc -c | tr -d ' ') uncommitted file(s)"
  fi
  git -C "$root" diff --name-only --diff-filter=D -z HEAD -- "${LANE_PATHS[@]}" > "$list"
  if [ -s "$list" ]; then
    dirty=1
    ssh -o BatchMode=yes "$host" "cd '$lane/src' && xargs -0 rm -f" < "$list" || { rm -f "$list"; return 1; }
  fi
  rm -f "$list"
  LANE_SHA="$sha"; LANE_LABEL="${sha:0:7}"; [ "$dirty" = 0 ] || LANE_LABEL="${LANE_LABEL}-dirty"
  return 0
}
