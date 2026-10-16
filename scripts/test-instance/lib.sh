# shellcheck shell=bash
# Shared settings and helpers of the throwaway Hermes test instance (sourced by the other scripts, runs on the test host).
# Everything binds to 127.0.0.1; an Android emulator on the same host reaches it as 10.0.2.2.
#
# Two flavors, one script set (picked from the OS, override with TI_FLAVOR=docker|native):
#   docker  Linux host: official image pinned by digest, systemd --user unit for the bridge, cgroup memory caps.
#   native  macOS host (no Docker): Hermes from a pinned git checkout in its own venv, plain background processes with
#           pid files (tracked pids only, never name matching) and an RSS watchdog as the memory cap.
# Runs on the Mac too, so: bash 3.2 compatible (no associative arrays, no ${x,,}, no mapfile).
set -euo pipefail

if [ -z "${TI_FLAVOR:-}" ]; then
  if [ "$(uname -s)" = Darwin ]; then TI_FLAVOR=native; else TI_FLAVOR=docker; fi
fi
case "$TI_FLAVOR" in docker|native) ;; *) echo "[test-instance] ERROR: TI_FLAVOR must be docker or native" >&2; exit 1 ;; esac
# non-login ssh shells on the Mac have no Homebrew in PATH (node, python3.14)
[ "$TI_FLAVOR" = native ] && export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

if [ "$TI_FLAVOR" = native ]; then
  TI_NAME="${TI_NAME:-mac}"
  TI_DIR="${TI_DIR:-$HOME/hermes-test-mac}"
  _d_api=28642; _d_plugin=28646; _d_bridge=28790   # other ports than the Linux instance: both can be tunneled at once
else
  TI_NAME="${TI_NAME:-linux}"
  TI_DIR="${TI_DIR:-$HOME/hermes-test}"
  _d_api=18642; _d_plugin=18646; _d_bridge=18790
fi
TI_DATA="$TI_DIR/data"                              # HERMES_HOME (docker: mounted as /opt/data in the container)
TI_SECRETS="$TI_DIR/secrets"                        # anthropic.env, api_server_key (all 0600)
TI_SRC="$TI_DIR/src"                                # copies of bridge/ and hermes-plugin/ from the repo
TI_BRIDGE_ENV="$TI_DIR/bridge.env"
TI_BRIDGE_STATE="$TI_DIR/bridge-state"
TI_RUN="$TI_DIR/run"                                # native: pid files and process logs

TI_API_PORT="${TI_API_PORT:-$_d_api}"               # Hermes API server (default profile + /p/<profile>/)
TI_PLUGIN_PORT="${TI_PLUGIN_PORT:-$_d_plugin}"      # hermes-ui-plus plugin listener
TI_BRIDGE_PORT="${TI_BRIDGE_PORT:-$_d_bridge}"      # UI bridge

TI_MODEL="${TI_MODEL:-claude-haiku-5-5}"                     # default profile
TI_WRITER_MODEL="${TI_WRITER_MODEL:-claude-haiku-4-5-20251001}" # profile "writer"
TI_QUICK_MODEL="${TI_QUICK_MODEL:-claude-haiku-5-5}"          # auxiliary.hui_quick

if [ "$TI_FLAVOR" = docker ]; then
  # Hermes Agent v0.22.0, pinned by the amd64 image digest
  TI_IMAGE="${TI_IMAGE:-nousresearch/hermes-agent:v0.22.0@sha256:c50eef7ccc91db06cdfe729008f45267a7208d899c73dd257c19eb4a30450c7d}"
  TI_CONTAINER="${TI_CONTAINER:-hui-hermes-test}"
  TI_MEM="${TI_MEM:-3g}"                            # hard cap, no swap (--memory-swap = --memory)
  TI_BRIDGE_UNIT="${TI_BRIDGE_UNIT:-hui-test-bridge}" # systemd --user unit of the bridge
  TI_BRIDGE_MEM="${TI_BRIDGE_MEM:-512M}"
  TI_MIN_AVAIL_GB="${TI_MIN_AVAIL_GB:-3}"
else
  # Hermes Agent v0.22.2 (the version production runs), pinned by the commit the release tag points to
  TI_HERMES_REPO="${TI_HERMES_REPO:-https://github.com/NousResearch/hermes-agent}"
  TI_HERMES_TAG="${TI_HERMES_TAG:-v0.22.2}"
  TI_HERMES_COMMIT="${TI_HERMES_COMMIT:-d923a5eb487a17c0a68801bba9ef0f56c81040a8}"
  TI_HERMES_SRC="$TI_DIR/hermes-agent"
  TI_VENV="$TI_DIR/venv"
  TI_PY3="$TI_VENV/bin/python"                       # interpreter for the plugin installer (the system python3 is old)
  TI_HERMES_EXTRAS="${TI_HERMES_EXTRAS:-anthropic,cron,pty,mcp,uvloop}"
  TI_GATEWAY_MAX_MB="${TI_GATEWAY_MAX_MB:-2048}"    # watchdog caps (RSS of the whole process tree)
  TI_BRIDGE_MAX_MB="${TI_BRIDGE_MAX_MB:-512}"
  TI_MIN_AVAIL_GB="${TI_MIN_AVAIL_GB:-3}"
  TI_MAC_LOCK_LIB="${TI_MAC_LOCK_LIB:-$HOME/hui-lane/maclock.sh}"   # shared "one heavy job at a time" lock of the Mac lane
  TI_MAC_LOCK_DIR="${HUI_MAC_LOCK_DIR:-/tmp/hui-mac-heavy.lock}"
fi
export TI_DIR TI_API_PORT TI_PLUGIN_PORT TI_BRIDGE_PORT
TI_LOCK_DIR="${TI_LOCK_DIR:-/tmp/hui-testinst-$TI_NAME.lock}"   # exclusive start -> tests -> stop session lock
TI_LEASE_S="${TI_LEASE_S:-7200}"
# The Linux host's agents already serialize on `flock /tmp/hui-testinst.lock` around start -> tests -> stop; session.sh
# takes that flock as well (docker flavor), so old and new users exclude each other. Empty = no flock.
if [ "$TI_FLAVOR" = docker ]; then TI_FLOCK_FILE="${TI_FLOCK_FILE-/tmp/hui-testinst.lock}"; else TI_FLOCK_FILE="${TI_FLOCK_FILE-}"; fi

say() { printf '[test-instance] %s\n' "$*" >&2; }
die() { say "ERROR: $*"; exit 1; }

# ---------------------------------------------------------------------------------------------------------------------
# host facts

mem_avail_gb() {
  if [ "$(uname -s)" = Darwin ]; then
    # free + inactive + speculative + purgeable pages (what the system can hand out without swapping)
    vm_stat | awk '/page size of/ { ps = $8 } /^Pages (free|inactive|speculative|purgeable):/ { gsub("\\.", "", $NF); n += $NF } END { printf "%d", n * ps / 1073741824 }'
  else
    awk '/MemAvailable/ {printf "%d", $2/1048576}' /proc/meminfo
  fi
}

# Emulator / Gradle running? (never install or build next to them on this host). Matched on process fields like
# scripts/e2e/smoke.sh, not with pgrep -f (earlyoom's argument list names qemu and gradle).
heavy_running() {
  ps -axo comm= 2>/dev/null | awk '{ n = split($0, p, "/"); if (p[n] ~ /^(qemu-system|emulator)/) f = 1 } END { exit !f }' && return 0
  ps -axo args= 2>/dev/null | awk '$1 ~ /(^|\/)java$/ && /(GradleDaemon|GradleWrapperMain|org\.gradle\.launcher|gradle-launcher)/ { f = 1 } END { exit !f }'
}

# systemctl --user needs the user bus, also from a non-login ssh session (docker flavor)
user_bus() {
  [ "$TI_FLAVOR" = docker ] || return 0
  export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
  export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"
}

# "addr:port" of every listener on one of the instance's ports
instance_listeners() {
  if [ "$(uname -s)" = Darwin ]; then
    lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | awk -v a="$TI_API_PORT" -v p="$TI_PLUGIN_PORT" -v b="$TI_BRIDGE_PORT" \
      'NR > 1 { n = split($(NF-1), x, ":"); if (x[n] == a || x[n] == p || x[n] == b) print $(NF-1) }' | sort -u
  else
    ss -Hltn 2>/dev/null | awk -v a="$TI_API_PORT" -v p="$TI_PLUGIN_PORT" -v b="$TI_BRIDGE_PORT" \
      '{n=split($4,x,":"); if (x[n]==a || x[n]==p || x[n]==b) print $4}'
  fi
}

# Listeners of the instance; anything not on 127.0.0.1 is an error
check_listeners() {
  local bad=0 line
  while read -r line; do
    [ -n "$line" ] || continue
    printf '  %s\n' "$line" >&2
    case "$line" in 127.0.0.1:*) ;; *) bad=1 ;; esac
  done < <(instance_listeners)
  return "$bad"
}

any_listener() { [ -n "$(instance_listeners)" ]; }

# ---------------------------------------------------------------------------------------------------------------------
# process tracking (native flavor): pid file = "<pid>|<start time>"; a pid whose start time changed is someone else's

proc_started() { ps -o lstart= -p "$1" 2>/dev/null | sed 's/^ *//; s/  */ /g'; }

pid_record() { # NAME PID
  mkdir -p "$TI_RUN"
  printf '%s|%s\n' "$2" "$(proc_started "$2")" > "$TI_RUN/$1.pid"
}

pid_of() { # NAME -> pid when the recorded process is still the same one, else empty
  local f="$TI_RUN/$1.pid" pid ls
  [ -s "$f" ] || return 0
  pid="$(cut -d'|' -f1 "$f")"; ls="$(cut -d'|' -f2- "$f")"
  case "$pid" in ''|*[!0-9]*) return 0 ;; esac
  kill -0 "$pid" 2>/dev/null || return 0
  [ "$(proc_started "$pid")" = "$ls" ] || return 0
  printf '%s' "$pid"
}

# "<rss kB> <pid> <pid> ..." of a pid and all its descendants
tree_rss() {
  ps -axo pid=,ppid=,rss= | awk -v root="$1" '
    { par[$1] = $2; rss[$1] = $3; ids[NR] = $1 }
    END { inset[root] = 1; ch = 1
      while (ch) { ch = 0; for (i in ids) { d = ids[i]; if (!(d in inset) && (par[d] in inset)) { inset[d] = 1; ch = 1 } } }
      for (k in inset) { sum += rss[k]; list = list " " k }
      printf "%d%s\n", sum, list }'
}

# TERM, wait, KILL: a tracked pid and its descendants, by pid
kill_tree() {
  local pids i
  pids="$(tree_rss "$1" | cut -d' ' -f2-)"
  # shellcheck disable=SC2086
  kill $pids 2>/dev/null || true
  for i in 1 2 3 4 5 6 7 8 9 10; do
    kill -0 "$1" 2>/dev/null || break
    sleep 1
  done
  # shellcheck disable=SC2086
  kill -9 $pids 2>/dev/null || true
}

stop_tracked() { # NAME
  local pid; pid="$(pid_of "$1")"
  [ -n "$pid" ] && kill_tree "$pid"
  rm -f "$TI_RUN/$1.pid"
  return 0
}

# Memory cap for the native flavor (macOS has no cgroups): every TI_WATCHDOG_S (5) seconds, RSS of the gateway tree and the bridge tree
# against the caps; a tree over its cap is killed by pid and the event logged to $TI_RUN/watchdog.log.
watchdog_loop() {
  local name cap pid rss
  while :; do
    for name in gateway bridge; do
      case "$name" in gateway) cap=$((TI_GATEWAY_MAX_MB * 1024)) ;; *) cap=$((TI_BRIDGE_MAX_MB * 1024)) ;; esac
      pid="$(pid_of "$name")"
      [ -n "$pid" ] || continue
      rss="$(tree_rss "$pid" | cut -d' ' -f1)"
      if [ "${rss:-0}" -gt "$cap" ]; then
        printf '%s %s tree %s kB over the cap of %s kB, killed\n' "$(date +%FT%T)" "$name" "$rss" "$cap" >> "$TI_RUN/watchdog.log"
        kill_tree "$pid"
      fi
    done
    sleep "${TI_WATCHDOG_S:-5}"
  done
}

# ---------------------------------------------------------------------------------------------------------------------
# Hermes gateway and bridge, per flavor

# Native: Hermes also keeps a host-wide gateway lock in $XDG_STATE_HOME/hermes and caches under XDG_*; point all of it
# into the instance directory so nothing lands in the user's own ~/.local or ~/.hermes.
native_hermes_env() {
  mkdir -p "$TI_DIR/xdg/state" "$TI_DIR/xdg/cache" "$TI_DIR/xdg/data" "$TI_DIR/xdg/config" "$TI_DIR/gateway-locks"
  printf '%s\n' "HERMES_HOME=$TI_DATA" "HERMES_GATEWAY_LOCK_DIR=$TI_DIR/gateway-locks" "XDG_STATE_HOME=$TI_DIR/xdg/state" \
    "XDG_CACHE_HOME=$TI_DIR/xdg/cache" "XDG_DATA_HOME=$TI_DIR/xdg/data" "XDG_CONFIG_HOME=$TI_DIR/xdg/config"
}

# Run a one-off Hermes command against the instance's HERMES_HOME.
hermes_oneoff() {
  if [ "$TI_FLAVOR" = docker ]; then
    docker run --rm --network host --memory "$TI_MEM" --memory-swap "$TI_MEM" --pids-limit 512 \
      -e HERMES_UID="$(id -u)" -e HERMES_GID="$(id -g)" -v "$TI_DATA:/opt/data" "$TI_IMAGE" "$@"
  else
    # shellcheck disable=SC2046
    env $(native_hermes_env) "$TI_VENV/bin/hermes" "$@"
  fi
}

container_running() { [ "$(docker inspect -f '{{.State.Running}}' "$TI_CONTAINER" 2>/dev/null || echo false)" = true ]; }

gateway_running() {
  if [ "$TI_FLAVOR" = docker ]; then container_running; else [ -n "$(pid_of gateway)" ]; fi
}

gateway_start() {
  if [ "$TI_FLAVOR" = docker ]; then
    docker rm -f "$TI_CONTAINER" >/dev/null 2>&1 || true
    # --network host: the API server and the plugin bind 127.0.0.1 of the host; nothing is published.
    docker run -d --name "$TI_CONTAINER" --network host --restart no \
      --memory "$TI_MEM" --memory-swap "$TI_MEM" --pids-limit 1024 \
      -e HERMES_UID="$(id -u)" -e HERMES_GID="$(id -g)" \
      -v "$TI_DATA:/opt/data" "$TI_IMAGE" gateway run >/dev/null
    say "container $TI_CONTAINER started"
  else
    mkdir -p "$TI_RUN"
    : >> "$TI_RUN/gateway.log"; chmod 600 "$TI_RUN/gateway.log"
    # the background job must be the process itself ($! = its pid), not a subshell around a `cd && …` list
    native_hermes_env > /dev/null  # creates the directories
    ( cd "$TI_DIR"
      export HERMES_HOME="$TI_DATA" HERMES_GATEWAY_LOCK_DIR="$TI_DIR/gateway-locks" XDG_STATE_HOME="$TI_DIR/xdg/state" \
        XDG_CACHE_HOME="$TI_DIR/xdg/cache" XDG_DATA_HOME="$TI_DIR/xdg/data" XDG_CONFIG_HOME="$TI_DIR/xdg/config"
      nohup "$TI_VENV/bin/hermes" gateway run </dev/null >> "$TI_RUN/gateway.log" 2>&1 &
      pid_record gateway "$!" )
    say "gateway started (pid $(pid_of gateway), log $TI_RUN/gateway.log)"
  fi
}

gateway_stop() {
  if [ "$TI_FLAVOR" = docker ]; then
    if docker inspect "$TI_CONTAINER" >/dev/null 2>&1; then
      docker stop -t 20 "$TI_CONTAINER" >/dev/null || true
      docker rm "$TI_CONTAINER" >/dev/null || true
    fi
  else
    stop_tracked gateway
  fi
}

gateway_restart() {
  if [ "$TI_FLAVOR" = docker ]; then
    docker restart -t 20 "$TI_CONTAINER" >/dev/null
  else
    stop_tracked gateway
    gateway_start
  fi
}

bridge_running() {
  if [ "$TI_FLAVOR" = docker ]; then systemctl --user is-active --quiet "$TI_BRIDGE_UNIT"; else [ -n "$(pid_of bridge)" ]; fi
}

bridge_start() {
  if [ "$TI_FLAVOR" = docker ]; then
    systemctl --user reset-failed "$TI_BRIDGE_UNIT" >/dev/null 2>&1 || true
    # The plugin secret reaches the bridge as a systemd credential (works for hardened units that cannot read the
    # Hermes home); BRIDGE_PROFILES is an explicit list in bridge.env for the same reason.
    systemd-run --user --unit "$TI_BRIDGE_UNIT" --collect --quiet \
      -p MemoryMax="$TI_BRIDGE_MEM" -p MemorySwapMax=0 -p NoNewPrivileges=yes \
      -p LoadCredential="hui-plugin-secret:$TI_DATA/hermes-ui-plus/secret" \
      --setenv=HERMES_HOME=/nonexistent \
      /bin/sh -c 'export BRIDGE_HERMES_PLUGIN_SECRET_FILE="$CREDENTIALS_DIRECTORY/hui-plugin-secret"; exec node "$0" --env-file "$1"' \
      "$TI_SRC/bridge/bin/hermes-ui-bridge.mjs" "$TI_BRIDGE_ENV"
    say "bridge unit $TI_BRIDGE_UNIT started"
  else
    mkdir -p "$TI_RUN"
    : >> "$TI_RUN/bridge.log"; chmod 600 "$TI_RUN/bridge.log"
    # HERMES_HOME=/nonexistent: the bridge gets the plugin secret by file and the profile list from bridge.env, like a
    # hardened unit that cannot read the Hermes home.
    ( cd "$TI_DIR"
      HERMES_HOME=/nonexistent BRIDGE_HERMES_PLUGIN_SECRET_FILE="$TI_DATA/hermes-ui-plus/secret" \
        nohup node "$TI_SRC/bridge/bin/hermes-ui-bridge.mjs" --env-file "$TI_BRIDGE_ENV" </dev/null >> "$TI_RUN/bridge.log" 2>&1 &
      pid_record bridge "$!" )
    say "bridge started (pid $(pid_of bridge), log $TI_RUN/bridge.log)"
  fi
}

bridge_stop() {
  if [ "$TI_FLAVOR" = docker ]; then
    systemctl --user stop "$TI_BRIDGE_UNIT" >/dev/null 2>&1 || true
    systemctl --user reset-failed "$TI_BRIDGE_UNIT" >/dev/null 2>&1 || true
  else
    stop_tracked bridge
  fi
}

watchdog_start() {
  [ "$TI_FLAVOR" = native ] || return 0
  [ -z "$(pid_of watchdog)" ] || return 0
  ( cd "$TI_DIR"
    nohup bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/watchdog.sh" </dev/null >> "$TI_RUN/watchdog.log" 2>&1 &
    pid_record watchdog "$!" )
}

watchdog_stop() { [ "$TI_FLAVOR" = native ] && stop_tracked watchdog; return 0; }

# ---------------------------------------------------------------------------------------------------------------------
# exclusive session lock (mkdir is atomic on Linux and macOS; no flock on macOS)
#   owner file: pid, process start time, label, taken (epoch), lease end (epoch)
#   pid > 0 : a session (session.sh) holds it for as long as that process lives
#   pid = 0 : a lease (start.sh without a session, `lock.sh take`) holds it until the lease ends or the lock is released

_tilock_field() { sed -n "$1p" "$TI_LOCK_DIR/owner" 2>/dev/null || true; }

# 0 = held by a live owner, 1 = free or stale
tilock_live() {
  local pid ls lease now mt
  now="$(date +%s)"
  if [ ! -r "$TI_LOCK_DIR/owner" ]; then
    [ -d "$TI_LOCK_DIR" ] || return 1
    # directory without owner file: its creator is between mkdir and the write; stale after 15 s
    mt="$(stat -c %Y "$TI_LOCK_DIR" 2>/dev/null || stat -f %m "$TI_LOCK_DIR" 2>/dev/null || echo 0)"
    [ $((now - mt)) -lt 15 ] && return 0
    return 1
  fi
  pid="$(_tilock_field 1)"; ls="$(_tilock_field 2)"; lease="$(_tilock_field 5)"
  case "$pid" in ''|*[!0-9]*) return 1 ;; esac
  if [ "$pid" -gt 0 ]; then
    kill -0 "$pid" 2>/dev/null || return 1
    [ "$(proc_started "$pid")" = "$ls" ] || return 1
    return 0
  fi
  case "$lease" in ''|*[!0-9]*) return 1 ;; esac
  [ "$lease" -gt "$now" ]
}

tilock_status() { # one line
  local pid label taken lease now
  if ! tilock_live; then echo "free"; return 0; fi
  [ -r "$TI_LOCK_DIR/owner" ] || { echo "taken (starting)"; return 0; }
  now="$(date +%s)"
  pid="$(_tilock_field 1)"; label="$(_tilock_field 3)"; taken="$(_tilock_field 4)"; lease="$(_tilock_field 5)"
  if [ "$pid" -gt 0 ]; then
    echo "held by session '$label' (pid $pid, $(((now - taken) / 60)) min)"
  else
    echo "held by lease '$label' ($(((now - taken) / 60)) min, ends in $(((lease - now) / 60)) min)"
  fi
}

tilock_is_session() { tilock_live && [ "$(_tilock_field 1)" -gt 0 ] 2>/dev/null; }

# tilock_acquire LABEL WAIT_S PID LEASE_S   (PID 0 = lease only). 0 = taken, 3 = held by someone else after WAIT_S
tilock_acquire() {
  local label="$1" wait_s="$2" pid="$3" lease_s="$4" deadline now last=0 stale ls=""
  deadline=$(($(date +%s) + wait_s))
  while :; do
    if mkdir "$TI_LOCK_DIR" 2>/dev/null; then
      [ "$pid" -gt 0 ] && ls="$(proc_started "$pid")"
      now="$(date +%s)"
      printf '%s\n%s\n%s\n%s\n%s\n' "$pid" "$ls" "$label" "$now" "$((now + lease_s))" > "$TI_LOCK_DIR/owner"
      say "instance lock taken ($label, $TI_LOCK_DIR)"
      return 0
    fi
    if ! tilock_live; then
      # stale: move it away first (only one of several waiters wins the rename), then retry the mkdir
      stale="$TI_LOCK_DIR.stale.$$"
      if mv "$TI_LOCK_DIR" "$stale" 2>/dev/null; then
        say "removed a stale instance lock ($(sed -n 3p "$stale/owner" 2>/dev/null || echo unknown))"
        rm -rf "$stale"
      fi
      continue
    fi
    now="$(date +%s)"
    if [ "$wait_s" -le 0 ] || [ "$now" -ge "$deadline" ]; then
      say "instance lock: $(tilock_status)"
      return 3
    fi
    if [ $((now - last)) -ge 60 ]; then say "instance lock: $(tilock_status); waiting up to $(((deadline - now + 59) / 60)) more min"; last=$now; fi
    sleep 3
  done
}

tilock_release() { # unconditional; callers decide whether they own it
  [ -d "$TI_LOCK_DIR" ] && rm -rf "$TI_LOCK_DIR" && say "instance lock released"
  return 0
}

# Native flavor on the Mac: do not start next to the Android lane. The lane's shared heavy lock (kept by
# scripts/lib/maclock.sh, installed by the lane as ~/hui-lane/maclock.sh) must be free; independent of that file, an
# emulator or Gradle process or too little free memory also refuses the start.
mac_heavy_check() {
  [ "$TI_FLAVOR" = native ] || return 0
  if [ "${TI_MAC_LOCK_MINE:-0}" = 1 ]; then
    :  # session.sh holds the heavy lock itself
  elif [ -f "$TI_MAC_LOCK_LIB" ]; then
    local st; st="$(HUI_MAC_LOCK_DIR="$TI_MAC_LOCK_DIR" bash "$TI_MAC_LOCK_LIB" status 2>/dev/null || echo free)"
    [ "$st" = free ] || die "the Mac's heavy-job lock is $st (Android lane / iOS build); not starting next to it"
  elif [ -d "$TI_MAC_LOCK_DIR" ]; then
    local hp; hp="$(sed -n 1p "$TI_MAC_LOCK_DIR/owner" 2>/dev/null || true)"
    case "$hp" in ''|*[!0-9]*) ;; *) kill -0 "$hp" 2>/dev/null && die "the Mac's heavy-job lock $TI_MAC_LOCK_DIR is held (pid $hp)" ;; esac
  fi
  heavy_running && die "an emulator or Gradle runs on this host; start when it is idle"
  return 0
}
