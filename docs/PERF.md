# Android streaming performance harness

Measures how the release app on the Hermes engine renders long streamed answers on an Android emulator, A/B between
builds. Two parts: an in-app probe that is compiled out of normal builds, and a runner that drives the emulator
against the E2E mock (`scripts/e2e/mock.mjs`).

```bash
# 1. perf builds (x86_64, release, probe on); baseline and candidate from the same series
EXPO_PUBLIC_HUI_PERF=1 ABIS=x86_64 ALLOW_DEBUG_SIGNED=1 MIN_AVAIL_GB=8 MEM_MAX=7G MEM_HIGH=6G scripts/build-apk.sh release
# 2. alternate them on the emulator host (copies scripts + APKs there over ssh, fetches the results)
scripts/perf/droid.sh --wait 120 --runs 3 --out /tmp/perf-ab base=dist/<baseline>.apk fix=dist/<candidate>.apk
# 3. tables (also written to OUT/summary.md by the remote mode)
scripts/perf/droid-summary.py /tmp/perf-ab/results.jsonl
```

Emulator numbers are relative (swiftshader GPU, a shared host). Compare only builds of one series: same host, same
session, alternating runs, at least 3 runs each, and keep a change only when its median beats the baseline's range.

## The probe (`app/src/perf/`)

`EXPO_PUBLIC_HUI_PERF` is inlined at bundle time; unset, every hook is a no-op behind a constant (normal builds).

| level | adds |
|---|---|
| `1` | JS frame monitor (`requestAnimationFrame` gaps: missed vsyncs, gaps ≥ 50/100 ms, time beyond the frame budget), per-turn marks, timed sections, Hermes GC/heap stats (`HermesInternal.getInstrumentedStats`) |
| `2` | level 1 plus React's profiling renderer (`app/metro.config.js` resolves `ReactFabric-profiling`), so `<PerfProfiler id>` reports subtree render times in a release bundle. Costs a little itself: use it to find where time goes, level 1 for A/B numbers |

Records are logcat lines `HUIPERF {json}` (tag `ReactNativeJS`):

- `turn`: one streamed answer, times relative to the request start: `firstDelta` (first text delta in JS), `firstText`
  (first commit with text), `lastDelta`, `final` (commit of the finished answer), `renderTail`, `deltas`, `flushes`
  (throttled state updates), `commits` of the streaming answer, `commitLag` (flush → commit), `js` (frames over the
  turn + 1 s), `spans` (`stream.chunk` network chunk parse + state update, `state.update`, `segments`, `md.parse`,
  `answer.render+commit` render-to-layout-effect of the streaming answer, `save` / `save.json` mid-stream
  persistence), `prof` (level 2), `hermes` (GCs, GC ms, allocated MB, heap MB).
- `open`: a message list committed 20+ messages (chat open, transcript load): render+commit time, JS frames for 3 s.
- `js`: JS frame stats of every 2 s window (the runner picks the windows of its scroll gestures).

## The runner (`scripts/perf/droid.sh`, `droid.py`)

Host rules as in `docs/E2E.md`: it holds `/tmp/hui-e2e.lock` for the whole session (the smoke suite waits for it,
`--wait MIN` here waits for a running smoke suite), refuses while Gradle or another emulator runs, runs the emulator in
a `MemoryMax=5G` scope with its own console/adb ports, and the EXIT trap stops everything by pid/scope.

Per run: clean install, pairing through a one-time code, then the scenarios (`--scenarios real,stress,huge,history`):

| scenario | what |
|---|---|
| `real` | new chat, the ~13k-char perf answer (headings, inline marks, nested lists, two Markdown tables, Python/TS/bash code, four `hui` blocks) at ~80 tok/s (`perfreal`, ~40 s) |
| `stress` | the same answer as fast as the socket takes it (`perfstress`, a few seconds) |
| `huge` | ~39k chars (the answer three times) at the stress rate: costs that grow with the answer length |
| `history` | a 2400-row Hermes session (`POST /__e2e/seed`) opened from the drawer (the app loads the newest 500), 16 flings through it (JS windows + gfxinfo, row `scroll`), then the perfreal answer streamed into that chat |

Per scenario: the probe record, `dumpsys gfxinfo` (reset at the Send tap) + framestats, `dumpsys meminfo` after it.
Output: `OUT/results.jsonl`, raw files in `OUT/<build>-<run>/`, `OUT/meta.txt` (host load, APK hashes).

The older `scripts/perf/stream-ab.sh` (gfxinfo only, `scripts/perf/stream-mock.mjs`) still works with any build.

## Reading the numbers (emulator artifacts)

- `RenderThread` CPU (~10 s per real-rate answer) and most UI-thread stalls are the emulator's software GPU: a perfetto
  trace (`--trace`) shows the UI thread in `draw → postAndWait` on the RenderThread, which sits in
  `eglSwapBuffersWithDamageKHR → rcCreateSyncKHR` (host GPU pipe) plus first-use Skia shader compiles. In the probe they
  are JS gaps with nothing instrumented in the frame (`"?"` in the long-task table). Not app work; compare JS numbers.
- Network: on the emulator the request reaches the mock 0-450 ms after `fetch()` and the first chunk reaches JS ~250 ms
  after the mock wrote it (`req` / `chunk` columns, clock offset corrected; one run in twelve showed ~40 ms). The app's
  own part of the time to first token is the `request` mark (durable send, ~50-100 ms) plus `firstText - firstDelta`.
- Level 2 (React profiling renderer) inflates render times; Profiler counts include bail-outs (a re-rendered parent
  creates a new Profiler element), so judge by summed durations, not counts.
- Allocation per answer is dominated by the per-network-read path (expo/fetch delivers every chunk as its own event),
  not by the text concatenation (Hermes does not copy the whole string per delta: delivering the deltas coalesced, an
  experiment that was not kept, left the allocation unchanged).
