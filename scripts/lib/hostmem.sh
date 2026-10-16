# shellcheck shell=bash
# Memory helpers shared by scripts/build-apk.sh and scripts/e2e/smoke.sh (Linux: /proc; macOS: vm_stat + a process-tree
# watchdog instead of a systemd scope). bash 3.2 compatible (they run on the build Mac).
#   host_avail_kb          memory the host can still hand out, in kB
#   sha256_stdin           sha256 of stdin (sha256sum, or shasum on macOS)
#   mem_kb 7G|512M|bytes   size -> kB
#   tree_rss PID           "<rss kB> <pid> <pid> …" of PID and all its descendants
#   kill_tree PID          TERM, 5 s, KILL: PID and its descendants, by pid (never by name)
host_avail_kb() {
  if [ "$(uname -s)" = Darwin ]; then
    vm_stat | awk '/page size of/ { ps = $8 } /^Pages (free|inactive|speculative|purgeable):/ { gsub("\\.", "", $NF); n += $NF } END { printf "%d", n * ps / 1024 }'
  else
    awk '/^MemAvailable:/{print $2}' /proc/meminfo
  fi
}

sha256_stdin() { if command -v sha256sum >/dev/null 2>&1; then sha256sum; else shasum -a 256; fi; }

mem_kb() { case "$1" in *[Gg]) echo $(( ${1%?} * 1048576 ));; *[Mm]) echo $(( ${1%?} * 1024 ));; *) echo $(( $1 / 1024 ));; esac; }

tree_rss() {
  ps -axo pid=,ppid=,rss= | awk -v root="$1" '
    { par[$1] = $2; rss[$1] = $3; ids[NR] = $1 }
    END { inset[root] = 1; ch = 1
      while (ch) { ch = 0; for (i in ids) { d = ids[i]; if (!(d in inset) && (par[d] in inset)) { inset[d] = 1; ch = 1 } } }
      for (k in inset) { sum += rss[k]; list = list " " k }
      printf "%d%s\n", sum, list }'
}

kill_tree() {
  local pids; pids="$(tree_rss "$1" | cut -d' ' -f2-)"
  # shellcheck disable=SC2086
  kill $pids 2>/dev/null || true; sleep 5
  # shellcheck disable=SC2086
  kill -9 $pids 2>/dev/null || true
}
