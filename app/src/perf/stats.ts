// Pure aggregation helpers of the on-device perf probe (probe.ts). No React / RN imports: unit-tested in node.

/** one vsync at 60 Hz; the emulator and most phones the probe runs on render at 60 Hz */
export const FRAME_MS = 1000 / 60;

export type FrameStats = {
  /** JS frame callbacks seen */
  frames: number;
  /** wall time covered by the callbacks (first to last) */
  ms: number;
  /** vsyncs the JS thread missed: sum over gaps of round(gap / FRAME_MS) - 1 */
  dropped: number;
  /** gaps of >= 50 ms / >= 100 ms (a JS task blocked the thread that long) */
  long50: number;
  long100: number;
  /** longest gap */
  maxGap: number;
  /** time beyond the frame budget in gaps longer than two frames: how long the JS thread was visibly busy */
  blockedMs: number;
};

export function emptyFrames(): FrameStats {
  return { frames: 0, ms: 0, dropped: 0, long50: 0, long100: 0, maxGap: 0, blockedMs: 0 };
}

/** adds one frame-to-frame gap (ms) */
export function addGap(s: FrameStats, gap: number): void {
  s.frames++;
  s.ms += gap;
  const missed = Math.round(gap / FRAME_MS) - 1;
  if (missed > 0) s.dropped += missed;
  if (gap >= 50) s.long50++;
  if (gap >= 100) s.long100++;
  if (gap > s.maxGap) s.maxGap = gap;
  if (gap > 2 * FRAME_MS) s.blockedMs += gap - FRAME_MS;
}

export type Dist = { n: number; sum: number; max: number; p50: number; p95: number };

/** a growing sample list with a cheap summary (kept small: one value per streaming commit or timed section) */
export class Samples {
  private v: number[] = [];
  add(x: number): void {
    this.v.push(x);
  }
  get n(): number {
    return this.v.length;
  }
  summary(): Dist {
    const s = this.v.slice().sort((a, b) => a - b);
    const q = (p: number) => (s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0);
    let sum = 0;
    for (const x of s) sum += x;
    return { n: s.length, sum: round(sum), max: round(s[s.length - 1] ?? 0), p50: round(q(0.5)), p95: round(q(0.95)) };
  }
}

export const round = (x: number, d = 1): number => {
  const f = 10 ** d;
  return Math.round(x * f) / f;
};

/** frame stats with rounded floats, for the JSON line */
export function framesOut(s: FrameStats): FrameStats & { fps: number } {
  return {
    frames: s.frames,
    ms: Math.round(s.ms),
    fps: s.ms > 0 ? round((s.frames * 1000) / s.ms) : 0,
    dropped: s.dropped,
    long50: s.long50,
    long100: s.long100,
    maxGap: round(s.maxGap),
    blockedMs: Math.round(s.blockedMs),
  };
}

export type HermesStats = { gcs: number; gcMs: number; allocMB: number; heapMB: number };

/** difference of two `HermesInternal.getInstrumentedStats()` snapshots (missing fields count as 0) */
export function hermesDelta(a: Record<string, number> | null, b: Record<string, number> | null): HermesStats | null {
  if (!a || !b) return null;
  const d = (k: string) => (b[k] ?? 0) - (a[k] ?? 0);
  return {
    gcs: d('js_numGCs'),
    gcMs: round(d('js_gcTime') * 1000),
    allocMB: round(d('js_totalAllocatedBytes') / 1048576),
    heapMB: round((b.js_heapSize ?? 0) / 1048576),
  };
}
