#!/usr/bin/env bash
# One-time setup of the git sources of a lane host (the build Mac), so that `build-apk.sh --host` / lane_sync
# (scripts/lib/lane-sync.sh) lets the host FETCH the commit itself instead of receiving a bundle over a slow link:
#   1. Forgejo (private, reachable from the host over the LAN / tailnet)   2. the private GitHub mirror
#   (3. the git bundle remains the last resort)
# Credentials are READ-ONLY deploy keys: one ed25519 key is generated ON the host (~/<lane>/git-sources.d/*.key, mode 600,
# outside any repo, never printed or copied here), only its public half travels, and it is registered as a read-only
# deploy key on both repositories through their APIs. The API tokens come from this machine's git credential helper and
# are handed to curl on stdin (not in the process list, not in the output).
#
#   scripts/lane-setup-git.sh [--host mac|<ssh host>] [--forgejo REMOTE] [--github REMOTE]
#     --forgejo REMOTE   local git remote of the Forgejo repo (default: forgejo; skipped when it does not exist)
#     --github REMOTE    local git remote of the GitHub repo (default: github, else origin when it points to github.com)
# Env: HUI_LANE_HOME [hui-lane]. Idempotent: an existing key / registration is reused.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST=mac FORGEJO_REMOTE=forgejo GITHUB_REMOTE=
while [ $# -gt 0 ]; do
  case "$1" in
    --host) HOST=$2; shift 2 ;;
    --forgejo) FORGEJO_REMOTE=$2; shift 2 ;;
    --github) GITHUB_REMOTE=$2; shift 2 ;;
    *) echo "usage: $0 [--host mac|<ssh host>] [--forgejo REMOTE] [--github REMOTE]" >&2; exit 2 ;;
  esac
done
if [ -z "$GITHUB_REMOTE" ]; then
  if git -C "$ROOT" remote get-url github >/dev/null 2>&1; then GITHUB_REMOTE=github; else GITHUB_REMOTE=origin; fi
fi
LANE="${HUI_LANE_HOME:-hui-lane}"
case "$LANE" in /*|*..*|*[!A-Za-z0-9._/-]*) echo "HUI_LANE_HOME must be a plain relative path" >&2; exit 2 ;; esac
if [ "$HOST" = mac ]; then
  # shellcheck source=lib/flavor.sh
  FLAVOR_ROOT="$ROOT"; HUI_PRIVATE_DIR="${HUI_PRIVATE_DIR:-$HOME/work/hermesiui-private}"
  # shellcheck disable=SC1091
  . "$ROOT/scripts/lib/flavor.sh" 2>/dev/null || true
  flavor_load_build_env
  HOST="${MAC_HOST:-}"; [ -n "$HOST" ] || { echo "MAC_HOST is not set (env or \$HUI_PRIVATE_DIR/build.env)" >&2; exit 2; }
fi
SSH=(ssh -o BatchMode=yes "$HOST")
KEY="$LANE/git-sources.d/hui-lane.key"

"${SSH[@]}" "bash -s" <<REMOTE
set -euo pipefail
mkdir -p '$LANE/git-sources.d' && chmod 700 '$LANE/git-sources.d'
[ -f '$KEY' ] || ssh-keygen -q -t ed25519 -N '' -C 'hui-lane read-only' -f '$KEY'
chmod 600 '$KEY'
REMOTE
PUB="$("${SSH[@]}" "cat '$KEY.pub'")"

credential_token() { # credential_token PROTOCOL HOST[:PORT] -> password/token on stdout (never logged)
  printf 'protocol=%s\nhost=%s\n\n' "$1" "$2" | git -C "$ROOT" credential fill 2>/dev/null | sed -n 's/^password=//p'
}
api() { # api METHOD URL TOKEN [JSON] -> prints the HTTP status
  local body="${4:-}"
  printf 'header = "Authorization: token %s"\n' "$3" \
    | curl -s -m 20 -o /tmp/lane-setup-api.$$ -w '%{http_code}' -K - -X "$1" -H 'Content-Type: application/json' ${body:+-d "$body"} "$2"
}
has_key() { grep -qF "$(cut -d' ' -f2 <<<"$PUB")" /tmp/lane-setup-api.$$ 2>/dev/null; }
trap 'rm -f /tmp/lane-setup-api.$$' EXIT

register() { # register NAME BASEURL(API) REPOPATH TOKEN
  local name=$1 base=$2 repo=$3 tok=$4 code
  code="$(api GET "$base/repos/$repo/keys" "$tok")"
  [ "$code" = 200 ] || { echo "$name: cannot list deploy keys (HTTP $code)" >&2; return 1; }
  if has_key; then echo "$name: deploy key already registered"; return 0; fi
  code="$(api POST "$base/repos/$repo/keys" "$tok" "{\"title\":\"hui-lane read-only\",\"key\":\"$PUB\",\"read_only\":true}")"
  [ "$code" = 201 ] || { echo "$name: registering the deploy key failed (HTTP $code)" >&2; return 1; }
  echo "$name: read-only deploy key registered"
}
write_source() { # write_source FILE_PREFIX URL
  "${SSH[@]}" "cd '$LANE/git-sources.d' && printf '%s\n' '$2' > '$1.url' && cp hui-lane.key '$1.key' && chmod 600 '$1.key'"
}

# Forgejo: the API tells the ssh clone URL the host should use
if furl="$(git -C "$ROOT" remote get-url "$FORGEJO_REMOTE" 2>/dev/null)"; then
  fhostport="$(sed -E 's#^https?://([^/]+)/.*#\1#' <<<"$furl")"; fpath="$(sed -E 's#^https?://[^/]+/(.*)\.git$#\1#' <<<"$furl")"
  ftok="$(credential_token http "$fhostport")"
  if [ -n "$ftok" ]; then
    fbase="http://$fhostport/api/v1"
    register forgejo "$fbase" "$fpath" "$ftok"
    code="$(api GET "$fbase/repos/$fpath" "$ftok")"
    sshurl="$(python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1])).get("ssh_url",""))' /tmp/lane-setup-api.$$)"
    [ -n "$sshurl" ] && { write_source 10-forgejo "$sshurl"; echo "forgejo: source written for the host"; }
  else echo "forgejo: no credential for $fhostport in the git credential helper, skipped" >&2; fi
fi
# GitHub
if gurl="$(git -C "$ROOT" remote get-url "$GITHUB_REMOTE" 2>/dev/null)" && [[ "$gurl" == https://github.com/* ]]; then
  gpath="$(sed -E 's#^https://github.com/(.*)\.git$#\1#' <<<"$gurl")"
  gtok="$(credential_token https github.com)"
  if [ -n "$gtok" ]; then
    register github "https://api.github.com" "$gpath" "$gtok"
    write_source 20-github "git@github.com:$gpath.git"
    echo "github: source written for the host"
  else echo "github: no credential in the git credential helper, skipped" >&2; fi
fi
echo "done. scripts/build-apk.sh --host … now logs which source the commit came from (forgejo, github or bundle)"
