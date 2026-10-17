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

## Streaming render path (live text store)

A streaming tick that only grows the answer's text or reasoning does not touch the list state: `useHermesChat` puts
the answer's newest state into `hermes/liveMessages.ts` (keyed by message id), and only the answer's live part
(`LiveAnswer` in `chat/MessageItem.tsx`: tool timeline, interim notes, reasoning, waiting row, status line, segments,
route skeleton) re-renders through `chat/useLiveMessage.ts`. ChatView, the message list and the answer frame
re-render when the list is committed (`liveOnlyTick`): every change that is not text / reasoning (start, tools,
approvals, status / route / connection notes, finish, error, stop), the first text and reasoning, every ``` fence (code
and interactive blocks), a replaced text, and at least once per second (partial persistence, find, auto-read join).
For the perf answer that is about 60 commits (45 checkpoints, 14 fences, the first text; replayed in node) instead
of one per tick (~600 on the emulator).

- The frame runs the text pipeline only for a finished answer and shares its incremental parser state with the live
  part; the final render feeds only the last tail.
- The subscription is a plain state update, not `useSyncExternalStore`. A `useSyncExternalStore` version was measured
  first (series ab1): less JS CPU and allocation, but twice the long JS frames (real: 10 -> 21, blocked +68 %),
  because those updates render at sync priority in a microtask inside the throttle's animation frame. A state update
  from the frame callback renders at default priority in its own task, as the list commit did.
- Auto-read while streaming reads the live ticks too (`voice/useAutoRead.ts`).

A/B on the emulator (ab2, 3 alternating runs per build, median with range):

| scenario | metric | before | after |
|---|---|---|---|
| real (13k chars, 46 s) | JS thread CPU | 10.1 s (10.0–10.5) | 9.2 s (8.8–9.3) |
| | Hermes allocation | 216 MB (216–217) | 146 MB (146–148) |
| | flush -> commit lag p50 | 9.6 ms (9.3–9.7) | 7.7 ms (7.5–7.8) |
| | dropped JS frames | 107 (93–108) | 87 (86–89) |
| history (answer in a 300-message chat) | JS thread CPU | 12.7 s (12.6–13.3) | 10.7 s (10.6–10.9) |
| | Hermes allocation | 316 MB (314–324) | 173 MB (172–174) |
| | flush -> commit lag p50 | 11.8 ms (11.6–12.3) | 8.9 ms (8.7–9.0) |
| huge (39k chars, stress rate) | JS thread CPU | 7.5 s (7.5–7.6) | 7.3 s (7.3–7.4) |
| | dropped JS frames | 140 (132–144) | 114 (108–123) |

Long JS frames (>= 50 ms) and the scroll scenario stay within noise.

Where the render time went (level 2, React Profiler sums per real-rate answer, 2 runs each; a Profiler also counts
the nested updates below it): ChatView subtree 3.8 s -> 2.7 s (-29 %; 300-message chat 4.3 s -> 3.1 s), of which
ChatView's own part ~0.6 s -> ~0.17 s and MessageList's own part ~0.78 s -> ~0.15 s; the Composer rendered 604 times
per answer before, 76 after. The answer itself (live part + segments) stays at ~2.4 s: that is the text work every tick
needs.
