#!/usr/bin/env bash
# Green-gate stamps: `check.sh all` (local or --host) records the git tree hash it passed on, so release.sh can reuse a
# green result for exactly the same tree instead of running the gate again. Keyed by tree hash (content), not by commit.
# A stamp never covers a dirty tree: writers pass the tree they really checked.
#   . scripts/lib/gate-stamp.sh; gate_stamp_write <tree>; gate_stamp_has <tree>
gate_stamp_dir() { printf '%s' "${HUI_GATE_STAMPS:-${XDG_CACHE_HOME:-$HOME/.cache}/hui-check/gate-green}"; }
gate_stamp_valid() { [[ "${1:-}" =~ ^[0-9a-f]{40,64}$ ]]; }
gate_stamp_write() { # TREE
  gate_stamp_valid "${1:-}" || return 1
  mkdir -p "$(gate_stamp_dir)" && date -u +%FT%TZ > "$(gate_stamp_dir)/$1"
}
gate_stamp_has() { gate_stamp_valid "${1:-}" && [ -f "$(gate_stamp_dir)/$1" ]; }
