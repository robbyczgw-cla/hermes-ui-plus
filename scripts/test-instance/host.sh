# shellcheck shell=bash
# Host lookup for the scripts that run on YOUR machine (ti.sh, sync.sh): which ssh alias is "mac" / "linux", and where
# the instance lives there. Aliases come from the environment or from the private files (never from this repo):
#   mac    MAC_HOST   (environment, then $HUI_PRIVATE_DIR/build.env)
#   linux  TI_HOST    (environment, then $HUI_PRIVATE_DIR/test-instance.env), else LINUX_HOST from build.env
#   other  used as the ssh alias as given
ti_priv="${HUI_PRIVATE_DIR:-$HOME/work/hermesiui-private}"

_ti_from_file() { # FILE VAR -> value of VAR in FILE (sourced in a subshell), empty when missing
  [ -f "$1" ] || return 0
  ( set +u; . "$1" >/dev/null 2>&1; eval "printf '%s' \"\${$2:-}\"" )
}

ti_resolve_host() { # NAME -> ssh alias
  local v=""
  case "${1:-}" in
    mac)   v="${MAC_HOST:-$(_ti_from_file "$ti_priv/build.env" MAC_HOST)}" ;;
    linux) v="${TI_HOST:-$(_ti_from_file "$ti_priv/test-instance.env" TI_HOST)}"
           [ -n "$v" ] || v="${LINUX_HOST:-$(_ti_from_file "$ti_priv/build.env" LINUX_HOST)}" ;;
    "")    v="${TI_HOST:-$(_ti_from_file "$ti_priv/test-instance.env" TI_HOST)}" ;;
    *)     v="$1" ;;
  esac
  [ -n "$v" ] || { echo "no host for '${1:-default}' (set MAC_HOST / TI_HOST or use the ssh alias)" >&2; return 1; }
  printf '%s' "$v"
}

ti_ssh() { local h="$1"; shift; ssh -o BatchMode=yes -o ControlMaster=no "$h" "$@"; }

# instance directory on the host, relative to $HOME: macOS = native flavor
ti_remote_rel() { # HOST
  case "$(ti_ssh "$1" uname -s)" in Darwin) printf 'hermes-test-mac' ;; *) printf 'hermes-test' ;; esac
}
