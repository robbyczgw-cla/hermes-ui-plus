// Pure synthetic workloads; no network or React Native runtime. Run from app:
// node scripts/benchmark-chat.mjs. Timings are Node measurements, not device frame times.
import { performance } from 'node:perf_hooks';
import { reconcileTranscript } from '../src/conversations/remoteSync.ts';
import { processHtml } from '../src/sandbox/partialHtml.ts';
import { parseInline } from '../src/chat/markdown.ts';

function medianMs(run) {
  run();
  const times = [];
  for (let i = 0; i < 7; i++) {
    const start = performance.now();
    run();
    times.push(performance.now() - start);
  }
  return times.sort((a, b) => a - b)[3].toFixed(2);
}

const message = (id, role, text) => ({ id, role, text, status: 'done', createdAt: 1, tools: [] });
const prompt = (i) => `Question ${i}: ` + 'Example prompt words with whitespace. '.repeat(25);
const local = Array.from({ length: 150 }, (_, i) => [
  message(`test-u-${i}`, 'user', prompt(i)), message(`test-a-${i}`, 'assistant', `Answer ${i}`),
]).flat();
const aligned = local.map((m) => ({ ...m, id: `test-remote-${m.id}` }));
const overlap = Array.from({ length: 150 }, (_, i) => [
  message(`test-remote-u-${i}`, 'user', prompt(i < 75 ? i + 1000 : i)),
  message(`test-remote-a-${i}`, 'assistant', `Answer ${i}`),
]).flat();
console.log(`Reconcile 300 messages: aligned ${medianMs(() => reconcileTranscript(local, aligned))} ms; partial overlap ${medianMs(() => reconcileTranscript(local, overlap))} ms`);

const html = '<style>.card {padding: 10px}</style><main>'
  + '<article><h2>Example</h2><p>Streaming answer content &amp; more.</p></article>'.repeat(1600) + '</main>';
const ticks = Array.from({ length: 240 }, (_, i) => html.slice(0, Math.floor(html.length * (i + 1) / 240)));
console.log(`HTML ${html.length} chars, 40 updates/s over 6s: every tick (240 parses) ${medianMs(() => {
  for (const text of ticks) processHtml(text, false);
})} ms; at 100ms flushes (60 parses) ${medianMs(() => {
  for (let i = 3; i < ticks.length; i += 4) processHtml(ticks[i], false);
})} ms`);

const prose = 'This is a long answer with ordinary prose for a streaming performance check. '.repeat(160);
const proseTicks = Array.from({ length: 400 }, (_, i) => prose.slice(0, Math.floor(prose.length * (i + 1) / 400)));
console.log(`Plain prose ${prose.length} chars, 400 growing updates: ${medianMs(() => {
  for (const text of proseTicks) parseInline(text, { partial: true });
})} ms`);
