#!/usr/bin/env bash
# One entry point for both test instances, run from YOUR machine (everything else runs on the test host over ssh).
#   scripts/test-instance/ti.sh --host mac|linux|<ssh alias> COMMAND [ARGS...]
#
#   sync                         copy the repo parts to the host (do this after every change of bridge/plugin/scripts)
#   copy-key --from HOST         copy the model key file from another instance; the key is never printed
#   setup [--force-config]       one-time setup on the host (re-runnable)
#   start | stop | status        manual control (stop when idle!)
#   session [--wait S] -- CMD    exclusive start -> CMD -> stop; CMD runs ON THE HOST (e.g. api-test)
#   api-test [ARGS]              scripted API checks on the host, inside an exclusive session (starts and stops it)
#   quick-off-test               like api-test: ⚡ without the plugin, inside a session
#   bots-test [--approval]       Bots v2 live checks (Bot Chat route, turns on it, per-bot always-allow), inside a session
#   bots-create-test [all|snapshot|check|cleanup]  Bots v2 slice 3: create / edit bots via bridge + plugin (session for `all`)
#   conversation-test [--out D]  live multi-turn chats through the bridge, every answer checked with the app's parser
#                                (bridge/eval/conversations/run.mjs, runs here), instance inside a session; pre-release step
#   pair | lock | remove         see README
#   tunnel start|stop|status|print           ssh tunnel to the host's 127.0.0.1 ports (same local port numbers)
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=host.sh
. "$here/host.sh"
name=""
if [ "${1:-}" = "--host" ]; then name="${2:?--host needs mac|linux|<alias>}"; shift 2; fi
cmd="${1:-}"; [ $# -gt 0 ] && shift
[ -n "$cmd" ] || { sed -n 2,15p "$0" | sed 's/^# \{0,1\}//' >&2; exit 2; }
host="$(ti_resolve_host "$name")"
rel="$(ti_remote_rel "$host")"
rdir="\$HOME/$rel/repo/scripts/test-instance"

quoted() { local a out=""; for a in "$@"; do out="$out $(printf '%q' "$a")"; done; printf '%s' "$out"; }
remote_script() { local s="$1"; shift; ti_ssh "$host" "bash $rdir/$s$(quoted "$@")"; }
# node with the host's PATH (lib.sh adds Homebrew on the Mac)
remote_node() { local s="$1"; shift; ti_ssh "$host" "bash -c '. \"\$0/lib.sh\"; exec node \"\$0/$s\" \"\$@\"' $rdir$(quoted "$@")"; }

# local/remote ports of the instance on that host (same numbers locally), from lib.sh on the host
ports() { ti_ssh "$host" "bash -c '. \"\$0/lib.sh\"; echo \$TI_API_PORT \$TI_PLUGIN_PORT \$TI_BRIDGE_PORT' $rdir"; }
sock="${TMPDIR:-/tmp}/hui-ti-tunnel-$(printf '%s' "${name:-default}" | tr -c 'A-Za-z0-9' _).sock"

case "$cmd" in
  sync) exec "$here/sync.sh" --host "${name:-$host}" ;;
  setup|start|stop|status|remove|pair|lock) remote_script "$cmd.sh" "$@" ;;
  quick-off-test)
    ti_ssh "$host" "bash $rdir/session.sh --wait 600 --label quick-off-test -- bash $rdir/quick-off-test.sh$(quoted "$@")" ;;
  session) remote_script session.sh "$@" ;;
  api-test)
    # inside an exclusive session: the instance is started for the test and stopped afterwards
    ti_ssh "$host" "bash $rdir/session.sh --wait 600 --label api-test -- bash -c '. \"\$0/lib.sh\"; exec node \"\$0/api-test.mjs\" \"\$@\"' $rdir$(quoted "$@")" ;;
  bots-test)
    ti_ssh "$host" "bash $rdir/session.sh --wait 600 --label bots-test -- bash $rdir/bots-test.sh$(quoted "$@")" ;;
  bots-create-test)
    ti_ssh "$host" "bash $rdir/session.sh --wait 600 --label bots-create-test -- bash $rdir/bots-create-test.sh$(quoted "$@")" ;;
  conversation-test)
    # session on the host, runner here (app parser of this checkout) through an own tunnel: conversation-test.sh
    exec "$here/conversation-test.sh" --host "${name:-$host}" "$@" ;;
  copy-key)
    [ "${1:-}" = "--from" ] || { echo "usage: ti.sh --host TO copy-key --from FROM_HOST" >&2; exit 2; }
    from="$(ti_resolve_host "${2:?--from needs mac|linux|<alias>}")"
    frel="$(ti_remote_rel "$from")"
    ti_ssh "$from" "cat \$HOME/$frel/secrets/anthropic.env" \
      | ti_ssh "$host" "umask 077; mkdir -p -m 700 \$HOME/$rel/secrets && cat > \$HOME/$rel/secrets/anthropic.env && chmod 600 \$HOME/$rel/secrets/anthropic.env"
    # report shape only, never the value
    ti_ssh "$host" "f=\$HOME/$rel/secrets/anthropic.env; printf 'key file: %s lines, mode %s, ANTHROPIC_API_KEY lines: %s\n' \"\$(wc -l < \$f | tr -d ' ')\" \"\$(stat -c %a \$f 2>/dev/null || stat -f %Lp \$f)\" \"\$(grep -c '^ANTHROPIC_API_KEY=.' \$f)\"" ;;
  tunnel)
    read -r api plugin bridge <<<"$(ports)"
    fwd="-L $api:127.0.0.1:$api -L $plugin:127.0.0.1:$plugin -L $bridge:127.0.0.1:$bridge"
    case "${1:-print}" in
      print) echo "ssh -N $fwd $host    # then: bridge http://127.0.0.1:$bridge, Hermes API http://127.0.0.1:$api" ;;
      start)
        if ssh -S "$sock" -O check "$host" >/dev/null 2>&1; then echo "tunnel already up ($sock)"; exit 0; fi
        # shellcheck disable=SC2086
        ssh -o BatchMode=yes -o ExitOnForwardFailure=yes -o ControlMaster=yes -o ControlPersist=no -S "$sock" -fN $fwd "$host"
        echo "tunnel up: bridge http://127.0.0.1:$bridge, Hermes API http://127.0.0.1:$api, plugin 127.0.0.1:$plugin (stop: ti.sh --host ${name:-$host} tunnel stop)" ;;
      stop) ssh -S "$sock" -O exit "$host" 2>&1 || true ;;
      status) ssh -S "$sock" -O check "$host" 2>&1 || echo "no tunnel" ;;
      *) echo "usage: tunnel start|stop|status|print" >&2; exit 2 ;;
    esac ;;
  *) echo "unknown command '$cmd' (see the header of $0)" >&2; exit 2 ;;
esac
