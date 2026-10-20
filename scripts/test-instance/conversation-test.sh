#!/usr/bin/env bash
# Live conversation test against a test instance, run from YOUR machine (ti.sh … conversation-test):
#   scripts/test-instance/conversation-test.sh --host mac|linux|<alias> [--out DIR] [run.mjs args…]
# The instance runs inside an exclusive session on the host (lock, start, stop, release: session.sh); the runner
# (bridge/eval/conversations/run.mjs, which uses the app's parser from this checkout) runs here and reaches the
# instance's bridge through its own ssh tunnel. The bridge token goes host → a 600 temp file here, never printed,
# deleted at the end. Report: --out DIR, default $HUI_PRIVATE_DIR/reports/conversations/<time> (outside the repo).
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
# shellcheck source=host.sh
. "$here/host.sh"
name=""
[ "${1:-}" = "--host" ] && { name="${2:?--host needs mac|linux|<alias>}"; shift 2; }
out=""
[ "${1:-}" = "--out" ] && { out="${2:?--out needs a directory}"; shift 2; }
host="$(ti_resolve_host "$name")"
rel="$(ti_remote_rel "$host")"
rdir="\$HOME/$rel/repo/scripts/test-instance"
out="${out:-$ti_priv/reports/conversations/$(date +%Y%m%d-%H%M%S)}"
bport="$(ti_ssh "$host" "bash -c '. \"\$0/lib.sh\"; echo \$TI_BRIDGE_PORT' $rdir")"
lport="$(node -e 'const s=require("net").createServer().listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')"
tag="conv-$$-$RANDOM"
flag="\$HOME/$rel/run/$tag.done"
work="$(mktemp -d)"; chmod 700 "$work"
sock="$work/tunnel.sock"
slog="$work/session.log"
spid=""

cleanup() {
  ti_ssh "$host" "mkdir -p \$HOME/$rel/run && touch $flag" 2>/dev/null || true
  [ -n "$spid" ] && wait "$spid" 2>/dev/null || true
  ssh -S "$sock" -O exit "$host" >/dev/null 2>&1 || true
  [ -f "$slog" ] && grep -E 'stopped|released|ERROR' "$slog" >&2 || true
  rm -rf "$work"
}
trap cleanup EXIT

# 1) exclusive session on the host; its command just waits until this script is done
ti_ssh "$host" "mkdir -p \$HOME/$rel/run && rm -f $flag && bash $rdir/session.sh --wait 900 --label conversation-test -- bash -c 'while [ ! -e $flag ]; do sleep 3; done; rm -f $flag'" > "$slog" 2>&1 &
spid=$!
# 2) wait for OUR session to be ready (never test another session's instance that happens to be up)
until grep -q 'ready: bridge' "$slog"; do
  kill -0 "$spid" 2>/dev/null || { echo "session did not start:" >&2; tail -5 "$slog" >&2; exit 2; }
  sleep 3
done
# 3) tunnel to the bridge port only, own control socket
ssh -o BatchMode=yes -o ExitOnForwardFailure=yes -o ControlMaster=yes -o ControlPersist=no -S "$sock" -fN -L "$lport:127.0.0.1:$bport" "$host"
# 4) token: host → 600 file here
umask 077
ti_ssh "$host" "cat \$HOME/$rel/bridge-state/state.json" | node -e 'let s="";process.stdin.on("data",(d)=>(s+=d)).on("end",()=>process.stdout.write(JSON.parse(s).token))' > "$work/token"
# 5) the conversations
set +e
node "$repo/bridge/eval/conversations/run.mjs" --bridge "http://127.0.0.1:$lport" --token-file "$work/token" --out "$out" "$@"
rc=$?
set -e
exit "$rc"
