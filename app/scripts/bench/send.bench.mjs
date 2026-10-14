// Send-side latencies that are decided in JS: attachment preparation → tray/upload start, and read-aloud start
// while an answer streams. Run from app/: scripts/bench/run.sh send
//
// Native work is simulated with timers (image decode + resize + JPEG per photo: HUI_BENCH_PREP_MS, default 60 ms
// here = 1/10 of a typical ~600 ms on a mid-range phone for a 12 MP photo; ratios carry over, absolute numbers
// scale ×10). Streaming arrives at HUI_BENCH_CPS characters per second (default 300 ≈ a fast model).
import { prepareEach } from '../../src/attachments/prepareEach.ts';
import { createLiveReader } from '../../src/voice/streamRead.ts';
import { header } from './lib.mjs';
import { longAnswer } from './fixtures.mjs';

const PREP_MS = Number(process.env.HUI_BENCH_PREP_MS ?? 60);
const CPS = Number(process.env.HUI_BENCH_CPS ?? 300);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => performance.now();
const att = (id) => ({ id, kind: 'image', name: `${id}.jpg`, mimeType: 'image/jpeg', size: 1, uri: `file:///${id}.jpg`, status: 'ready' });

header(`photo pick → first photo in the tray / its upload started (prep ${PREP_MS} ms per photo simulated)`);
for (const n of [1, 3, 6]) {
  const ids = Array.from({ length: n }, (_, i) => `p${i}`);
  const t0 = now();
  let first = -1;
  const r = await prepareEach(
    ids,
    async (id) => {
      await sleep(PREP_MS);
      return att(id);
    },
    { onPrepared: () => (first < 0 ? (first = now() - t0) : undefined), fallbackError: () => ({ key: 'attachments.picker.imageFailed' }) },
  );
  const all = now() - t0;
  console.log(
    `  ${n} photo(s): whole pick handed over at the end (before) ${all.toFixed(0).padStart(5)} ms | first photo handed out (after) ${first.toFixed(0).padStart(5)} ms  (${r.attachments.length} ready)`,
  );
}

header(`auto read-aloud: answer start → first text handed to TTS (stream ${CPS} chars/s, UI updates every 50 ms)`);
// realistic prose (capitalised sentence starts) and the bench fixture (lower-case "sentences": only paragraph ends count)
const PROSE = Array.from({ length: 12 }, (_, i) =>
  `Option ${i + 1} is the cheapest one in the area. It opens at nine and closes late in the evening. Delivery takes about two days, and returns are free.`,
).join('\n\n');
for (const [label, answer] of [['prose', PROSE], ['fixture 1 section', longAnswer(1)], ['fixture 3 sections', longAnswer(3)]]) {
  // before: the whole answer was read once it had finished streaming
  const fullMs = (answer.length / CPS) * 1000;
  // after: the live reader gets every throttled UI update; the first update that yields text starts the speaker
  const reader = createLiveReader();
  const step = Math.max(1, Math.round((CPS * 50) / 1000));
  let firstMs = null;
  let pieces = 0;
  for (let i = step; ; i += step) {
    const n = Math.min(i, answer.length);
    const out = reader.push({ text: answer.slice(0, n), status: n === answer.length ? 'done' : 'streaming' });
    if (out.length && firstMs === null) firstMs = (n / CPS) * 1000;
    pieces += out.length;
    if (n === answer.length) break;
  }
  console.log(
    `  ${label.padEnd(18)} ${String(answer.length).padStart(5)} chars: finished answer (before) ${fullMs.toFixed(0).padStart(6)} ms | first stable text (after) ${String(firstMs?.toFixed(0)).padStart(6)} ms  (${pieces} pieces)`,
  );
}
{
  const answer = longAnswer(3);
  const reader = createLiveReader();
  const steps = [];
  for (let i = 15; i < answer.length; i += 15) steps.push(answer.slice(0, i));
  const t0 = now();
  for (const s of steps) reader.push({ text: s, status: 'streaming' });
  const ms = now() - t0;
  console.log(`  live reader cost: ${steps.length} updates of a ${answer.length}-char answer, ${((ms / steps.length) * 1000).toFixed(1)} µs per update`);
}
