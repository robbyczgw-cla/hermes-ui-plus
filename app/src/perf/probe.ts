// On-device performance probe for the Android perf harness (scripts/perf/droid.sh, docs/PERF.md).
// Compiled out of normal builds: `EXPO_PUBLIC_HUI_PERF` is inlined at bundle time and unset, so every exported
// function is a no-op behind a constant `false` (the minifier drops the bodies). Perf builds set it:
//   1 = probe: JS frame monitor, per-turn marks and timed sections, Hermes GC/heap stats
//   2 = probe + React's profiling renderer (app/metro.config.js) so <PerfProfiler> reports render times in release
// Output: one logcat line per record, `HUIPERF {json}` (tag ReactNativeJS), parsed by scripts/perf/droid-summary.py.
//   k=turn  one streamed answer: send → first delta → first rendered text → final render, commits, JS frames, spans
//   k=open  a chat view mounted with its messages: time to the first commit with them, JS frames for 3 s after
//   k=js    JS frame stats of the last 2 s window (the harness picks the windows of its scroll gestures)
//   k=long  a JS frame gap >= 50 ms: the spans / render times / Hermes GCs since the previous frame
import { addGap, emptyFrames, framesOut, hermesDelta, round, Samples, type FrameStats } from './stats.ts';

export const PERF_LEVEL = Number(process.env.EXPO_PUBLIC_HUI_PERF || 0);
const ON = PERF_LEVEL > 0;

export const perfNow: () => number = typeof performance !== 'undefined' && performance.now ? () => performance.now() : () => Date.now();

type Span = Samples;
type Collector = { frames: FrameStats };

const collectors = new Set<Collector>();
let win: Collector = { frames: emptyFrames() };
let windowStart = 0;
let lastFrame = 0;
let frameLoop = false;

function emit(rec: Record<string, unknown>): void {
  console.log(`HUIPERF ${JSON.stringify({ ...rec, at: Date.now() })}`);
}

function hermesSnapshot(): Record<string, number> | null {
  const hi = (globalThis as { HermesInternal?: { getInstrumentedStats?: () => Record<string, number> } }).HermesInternal;
  try {
    return hi?.getInstrumentedStats?.() ?? null;
  } catch {
    return null;
  }
}

function onFrame(t: number): void {
  const gcs = hermesGcs();
  if (lastFrame > 0) {
    const gap = t - lastFrame;
    addGap(win.frames, gap);
    for (const c of collectors) addGap(c.frames, gap);
    // a long task: what ran since the previous frame (spans, Profiler render times, Hermes GCs)
    if (gap >= 50) {
      const top = Object.entries(frameSums)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([k, v]) => [k, round(v)]);
      emit({ k: 'long', gap: round(gap), turn: turn?.n ?? null, gcs: gcs[0] - lastGcs[0], gcMs: round((gcs[1] - lastGcs[1]) * 1000), top });
    }
  }
  frameSums = {};
  lastGcs = gcs;
  lastFrame = t;
  if (t - windowStart >= 2000) {
    const sums: Record<string, number> = {};
    for (const k in winSums) sums[k] = round(winSums[k]);
    emit({ k: 'js', from: Math.round(Date.now() - (t - windowStart)), js: framesOut(win.frames), sums });
    win = { frames: emptyFrames() };
    winSums = {};
    windowStart = t;
  }
  requestAnimationFrame(onFrame);
}

function startFrames(): void {
  if (frameLoop || typeof requestAnimationFrame !== 'function') return;
  frameLoop = true;
  windowStart = perfNow();
  requestAnimationFrame(onFrame);
  emit({ k: 'start', level: PERF_LEVEL, hermes: hermesSnapshot() });
}

// ── timed sections (any level) ─────────────────────────────────────────────────────────────────────────────────────
const spans = new Map<string, Span>();
/** adds `perfNow() - t0` to section `name` of the running turn (call as `if (PERF) perfSpan('x', t0)`) */
export function perfSpan(name: string, t0: number): void {
  if (ON) addSpan(name, perfNow() - t0);
}
function addSpan(name: string, ms: number): void {
  addWin(name, ms);
  if (!turn) return;
  let s = spans.get(name);
  if (!s) spans.set(name, (s = new Samples()));
  s.add(ms);
}
/** sums of spans / Profiler render times in the current 2 s window (k=js records: scroll, open) */
let winSums: Record<string, number> = {};
function addWin(name: string, ms: number): void {
  winSums[name] = (winSums[name] ?? 0) + ms;
  frameSums[name] = (frameSums[name] ?? 0) + ms;
}
/** the same since the last JS frame (k=long records) */
let frameSums: Record<string, number> = {};
let lastGcs: [number, number] = [0, 0];
/** [GC count, GC seconds] of the Hermes runtime */
function hermesGcs(): [number, number] {
  const h = hermesSnapshot();
  return h ? [h.js_numGCs ?? 0, h.js_gcTime ?? 0] : [0, 0];
}
export const PERF = ON;

// ── one streamed turn ──────────────────────────────────────────────────────────────────────────────────────────────
type Turn = Collector & {
  n: number;
  t0: number;
  firstDelta: number;
  lastDelta: number;
  firstText: number;
  final: number;
  deltas: number;
  chars: number;
  flushes: number;
  commits: number;
  pendingFlush: number;
  commitLag: Samples;
  hermes: Record<string, number> | null;
  ended: boolean;
  marks: Record<string, number>;
};
let turn: Turn | null = null;
let turns = 0;
const prof = new Map<string, Samples>();
/** layout effect time of the streaming answer in the current commit (level 2: commit.native) */
let answerLayoutAt = 0;

/** a turn's request starts (useHermesChat run) */
export function perfTurnStart(): void {
  if (!ON) return;
  startFrames();
  if (turn) collectors.delete(turn);
  spans.clear();
  prof.clear();
  turn = {
    frames: emptyFrames(), n: ++turns, t0: perfNow(), firstDelta: 0, lastDelta: 0, firstText: 0, final: 0, deltas: 0, chars: 0,
    flushes: 0, commits: 0, pendingFlush: 0, commitLag: new Samples(), hermes: hermesSnapshot(), ended: false, marks: {},
  };
  collectors.add(turn);
}

/** a point in the running turn (time to first token split: `persisted`, `request`, `headers`); the first one counts */
export function perfMark(name: string): void {
  if (!ON || !turn || turn.marks[name] !== undefined) return;
  turn.marks[name] = Math.round(perfNow() - turn.t0);
}

/** a stream event arrived (`chars` = visible text it added) */
export function perfDelta(chars: number): void {
  if (!ON || !turn || chars <= 0) return;
  const t = perfNow();
  if (!turn.firstDelta) turn.firstDelta = t;
  turn.lastDelta = t;
  turn.deltas++;
  turn.chars += chars;
}

/** the throttle hands the stream to React state */
export function perfFlush(): void {
  if (!ON || !turn) return;
  turn.flushes++;
  if (!turn.pendingFlush) turn.pendingFlush = perfNow();
}

/** layout effect of the streaming answer: a commit of `textLen` chars is on screen (in the shadow tree) */
export function perfCommit(textLen: number, streaming: boolean, renderT0: number): void {
  if (!ON || !turn) return;
  const t = perfNow();
  turn.commits++;
  if (streaming) perfSpan('answer.render+commit', renderT0);
  if (streaming) answerLayoutAt = t;
  if (turn.pendingFlush) {
    turn.commitLag.add(t - turn.pendingFlush);
    turn.pendingFlush = 0;
  }
  if (textLen > 0 && !turn.firstText) turn.firstText = t;
  if (!streaming && turn.ended && !turn.final) {
    turn.final = t;
    finishTurn(turn);
  }
}

/** endTurn: the stream is over; the report follows the final commit (or 3 s, whatever comes first) */
export function perfTurnEnd(): void {
  if (!ON || !turn) return;
  const tr = turn;
  tr.ended = true;
  setTimeout(() => {
    if (!tr.final) {
      tr.final = perfNow();
      finishTurn(tr, 'no-final-commit');
    }
  }, 3000);
}

function finishTurn(tr: Turn, note?: string): void {
  // JS frames for one more second after the final commit: the final parse/layout of the whole answer
  setTimeout(() => {
    collectors.delete(tr);
    const rel = (x: number) => (x ? Math.round(x - tr.t0) : null);
    const sp: Record<string, unknown> = {};
    for (const [k, v] of spans) sp[k] = v.summary();
    const pr: Record<string, unknown> = {};
    for (const [k, v] of prof) pr[k] = v.summary();
    emit({
      k: 'turn', n: tr.n, note, marks: tr.marks, chars: tr.chars, deltas: tr.deltas, flushes: tr.flushes, commits: tr.commits,
      firstDelta: rel(tr.firstDelta), firstText: rel(tr.firstText), lastDelta: rel(tr.lastDelta), final: rel(tr.final),
      renderTail: tr.lastDelta && tr.final ? Math.round(tr.final - tr.lastDelta) : null,
      commitLag: tr.commitLag.summary(), js: framesOut(tr.frames), spans: sp, prof: pr, hermes: hermesDelta(tr.hermes, hermesSnapshot()),
    });
    if (turn === tr) turn = null;
  }, 1000);
}

// ── chat open ──────────────────────────────────────────────────────────────────────────────────────────────────────
let openSeen = new Set<string>();
/** a chat view committed `count` messages for `key` (first time per key and count bucket) */
export function perfOpen(key: string, count: number, t0: number): void {
  if (!ON || count < 20) return;
  startFrames();
  const id = `${key}:${count >= 100 ? Math.floor(count / 100) : count}`;
  if (openSeen.has(id)) return;
  if (openSeen.size > 200) openSeen = new Set();
  openSeen.add(id);
  const c: Collector = { frames: emptyFrames() };
  collectors.add(c);
  const commitMs = round(perfNow() - t0);
  const h = hermesSnapshot();
  setTimeout(() => {
    collectors.delete(c);
    emit({ k: 'open', count, commitMs, js: framesOut(c.frames), hermes: hermesDelta(h, hermesSnapshot()) });
  }, 3000);
}

// ── React profiling renderer (level 2, PerfProfiler.ts) ─────────────────────────────────────────────────────────────
/** `<Profiler onRender>`: render time of a subtree, aggregated per id for the running turn */
export function perfOnRender(id: string, _phase: string, actual: number, _base?: number, _start?: number, commitTime?: number): void {
  if (!ON) return;
  addWin(`prof.${id}`, actual);
  if (!turn) return;
  // React calls onRender after the children's layout effects: the streaming answer's layout effect of this commit
  // already ran → its time minus React's commit start = Fabric commit (diff, Yoga layout, text measuring) + effects
  if (id === 'ChatView' && commitTime && answerLayoutAt > commitTime) {
    addSpan('commit.native', answerLayoutAt - commitTime);
    answerLayoutAt = 0;
  }
  let s = prof.get(id);
  if (!s) prof.set(id, (s = new Samples()));
  s.add(actual);
}

/** the probe's JS frame monitor starts with the app in perf builds (idle windows for scroll measurements) */
export function perfBoot(): void {
  if (ON) startFrames();
}
