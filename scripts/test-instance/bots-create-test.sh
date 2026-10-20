#!/usr/bin/env bash
# Bots v2 slice 3 live checks on the test host: creating bots through the bridge and the hermes-ui-plus plugin
# (docs/BOTS-SERVER.md "Creating bots from the app"). Runs ON the host while the instance is up.
#   bash scripts/test-instance/bots-create-test.sh            snapshot -> checks -> cleanup (what `ti.sh bots-create-test` runs in a session)
#   bash scripts/test-instance/bots-create-test.sh snapshot   remember profiles, config checksums, devices.json, gateway pid/venv, facts.json
#   bash scripts/test-instance/bots-create-test.sh check      the HTTP checks (bots-create-test.mjs); needs a snapshot
#   bash scripts/test-instance/bots-create-test.sh cleanup    delete every profile that was not there at snapshot time
#                                                             (also bots made by hand in the app), restore devices.json,
#                                                             compare every checksum, check the gateway kept its venv
# Never prints tokens or keys.
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$here/lib.sh"
SNAP="$TI_RUN/bots-create-snapshot"
DEV="$TI_BRIDGE_STATE/devices.json"

sum() { if [ -f "$1" ]; then shasum "$1" | cut -c1-12; else echo missing; fi; }

# every file the run must leave byte-identical: default + existing profiles' config, keys, identity, memory; bridge env
checksums() {
  local f p
  for f in config.yaml .env SOUL.md memories/MEMORY.md memories/USER.md; do echo "default/$f $(sum "$TI_DATA/$f")"; done
  for p in $(cat "$SNAP/profiles"); do
    for f in config.yaml .env SOUL.md profile.yaml memories/MEMORY.md memories/USER.md; do
      echo "$p/$f $(sum "$TI_DATA/profiles/$p/$f")"
    done
  done
  echo "bridge.env $(sum "$TI_BRIDGE_ENV")"
  echo "devices.json $(sum "$DEV")"
}

live_profiles() { find "$TI_DATA/profiles" -mindepth 1 -maxdepth 1 -type d ! -name '.*' -exec basename {} \; 2>/dev/null | sort; }
facts() { find "$TI_DATA/installs" -name facts.json 2>/dev/null | sort; }

gateway_id() { # "pid venv" (native) or "container-start" (docker)
  if [ "$TI_FLAVOR" = docker ]; then
    docker inspect -f '{{.State.StartedAt}}' "$TI_CONTAINER" 2>/dev/null || echo none
  else
    local pid venv
    pid="$(pid_of gateway)"
    venv="$(lsof -p "$pid" -Fn 2>/dev/null | sed -n 's/^n\(.*\)\/lib\/python[0-9.]*\/site-packages\/.*/\1/p' | sort | uniq -c | sort -rn | head -1 | awk '{print $2}')"
    echo "${pid:-none} ${venv:-unknown}"
  fi
}

snapshot() {
  rm -rf "$SNAP"; mkdir -p "$SNAP"; chmod 700 "$SNAP"
  live_profiles > "$SNAP/profiles"
  checksums > "$SNAP/checksums"
  facts > "$SNAP/facts"
  gateway_id > "$SNAP/gateway"
  if [ -f "$DEV" ]; then cp -p "$DEV" "$SNAP/devices.json"; else : > "$SNAP/no-devices"; fi
  say "snapshot: profiles $(tr '\n' ' ' < "$SNAP/profiles"), gateway $(cat "$SNAP/gateway"), $(wc -l < "$SNAP/facts" | tr -d ' ') facts.json"
}

cleanup() {
  [ -f "$SNAP/profiles" ] || die "no snapshot ($SNAP)"
  local n bad=0
  for n in $(comm -13 "$SNAP/profiles" <(live_profiles)); do
    if hermes_oneoff profile delete -y "$n" >/dev/null 2>&1; then say "deleted profile $n"; else say "WARNING: hermes profile delete $n failed"; bad=1; fi
    rm -rf "$TI_DATA/profiles/.deleted/$n"
    [ -d "$TI_DATA/profiles/$n" ] && rmdir "$TI_DATA/profiles/$n" 2>/dev/null
    [ -e "$TI_DATA/profiles/$n" ] && { say "WARNING: $TI_DATA/profiles/$n still exists"; bad=1; }
  done
  rmdir "$TI_DATA/profiles/.deleted" 2>/dev/null || true
  if [ -f "$SNAP/devices.json" ]; then cp -p "$SNAP/devices.json" "$DEV"; else rm -f "$DEV"; fi
  if diff <(checksums) "$SNAP/checksums" >/dev/null; then say "all checked files byte-identical to the snapshot"
  else say "WARNING: files differ from the snapshot:"; diff <(checksums) "$SNAP/checksums" >&2; bad=1; fi
  if diff <(facts) "$SNAP/facts" >/dev/null; then say "installs/*/facts.json unchanged ($(wc -l < "$SNAP/facts" | tr -d ' '))"
  else say "WARNING: facts.json files changed (package manager trap):"; diff <(facts) "$SNAP/facts" >&2; bad=1; fi
  local now; now="$(gateway_id)"
  if [ "$now" = "$(cat "$SNAP/gateway")" ]; then say "gateway unchanged: $now (no restart, same venv)"
  else say "WARNING: gateway changed: before $(cat "$SNAP/gateway"), now $now"; bad=1; fi
  return $bad
}

check() {
  [ -f "$SNAP/profiles" ] || die "no snapshot ($SNAP)"
  TI_FLAVOR="$TI_FLAVOR" TI_DATA="$TI_DATA" TI_SRC="$TI_SRC" TI_BRIDGE_ENV="$TI_BRIDGE_ENV" SNAP="$SNAP" \
    GATEWAY_BEFORE="$(cat "$SNAP/gateway")" node "$here/bots-create-test.mjs" "$@"
}

case "${1:-all}" in
  snapshot) snapshot ;;
  check) shift; check "$@" ;;
  cleanup) cleanup ;;
  all) shift || true
       snapshot
       check "$@"; rc=$?
       cleanup || rc=1
       exit $rc ;;
  *) die "usage: bots-create-test.sh [all|snapshot|check|cleanup]" ;;
esac
