#!/usr/bin/env bash
# Hot-path benchmarks (not part of CI / `npm test`). Usage from anywhere:
#   scripts/bench/run.sh [stream|list|misc|open|send|coding|all] [--jitless | --hermes]
#   (no flag)  Node with JIT + allocation numbers
#   --jitless  Node without JIT (interpreter only)
#   --hermes   bundle the bench with esbuild and run it on a Hermes VM, the engine of the app (no JIT, like on a
#              phone). Needs HUI_HERMES=<path to the `hermes` CLI of a facebook/hermes release> and esbuild
#              (HUI_ESBUILD=<path>, default: `npx --yes esbuild`). Timings only (no allocation numbers).
set -euo pipefail
cd "$(dirname "$0")/../.."
which="${1:-all}"
mode="${2:-}"
case "$which" in
  stream|list|misc|open|send|coding) benches=("$which") ;;
  all) benches=(stream list misc coding) ;;  # open / send use timers + simulated I/O: node only
  *) echo "usage: $0 stream|list|misc|open|send|coding|all [--jitless|--hermes]" >&2; exit 2 ;;
esac
for b in "${benches[@]}"; do
  case "$mode" in
    --hermes)
      : "${HUI_HERMES:?set HUI_HERMES to the hermes CLI binary}"
      out="$(mktemp -d)"
      # es2017: let the bundler lower newer syntax the Hermes CLI may not parse
      ${HUI_ESBUILD:-npx --yes esbuild} "scripts/bench/$b.bench.mjs" --bundle --format=iife --platform=neutral --target=es2017 \
        --log-level=warning --banner:js="var process = { env: {} };" --outfile="$out/$b.js"
      # old Hermes CLI releases lack class syntax: down-level with TypeScript (classes, generators, spread)
      node scripts/bench/es5.cjs "$out/$b.js" "$out/$b.es5.js"
      "$HUI_HERMES" -O -w "$out/$b.es5.js"
      rm -rf "$out"
      ;;
    --jitless) node --jitless --no-warnings "scripts/bench/$b.bench.mjs" ;;
    '') node --expose-gc --min-semi-space-size=512 --max-semi-space-size=512 --no-warnings "scripts/bench/$b.bench.mjs" ;;
    *) echo "unknown flag $mode" >&2; exit 2 ;;
  esac
done
