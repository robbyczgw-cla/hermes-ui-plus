#!/usr/bin/env node
// Skill-language eval: sends every prompt of cases.mjs as a new app chat through a UI bridge (which adds the bootstrap,
// the inline skill core and the router hint, like for the app) and scores the cards: visible text in the prompt's
// language, and for underspecified requests a default card instead of a question in prose.
//
//   node eval/skill-language/run.mjs --bridge http://127.0.0.1:18790 --token-file <bridge-state>/state.json --out run.json
//   node eval/skill-language/run.mjs --replay run.json          re-score saved answers (no model calls)
// Options: --label <name> --concurrency <n> (default 3) --timeout <ms> (default 240000) --only <id,id>
// Runs against the throwaway test instance (scripts/test-instance), never against a production Hermes.
// Never prints the token. Answers are test output and are kept in --out for the hand review.
import { readFileSync, writeFileSync } from 'node:fs';
import { CASES } from './cases.mjs';
import { scoreAnswer } from './score.mjs';

function args(argv) {
  const o = { bridge: '', 'token-file': '', out: '', replay: '', label: '', concurrency: '3', timeout: '240000', only: '' };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i].replace(/^--/, '');
    if (!(k in o)) throw new Error(`unknown option ${argv[i]}`);
    o[k] = argv[++i];
  }
  return o;
}

async function chat(o, token, c, run) {
  const t0 = Date.now();
  const out = { status: 0, text: '', ms: 0, error: '' };
  try {
    const r = await fetch(`${o.bridge}/v1/chat/completions`, {
      method: 'POST',
      signal: AbortSignal.timeout(Number(o.timeout)),
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'text/event-stream', 'x-hermes-session-id': `hui-skilllang-${run}-${c.id}` },
      body: JSON.stringify({ model: 'hermes-agent', stream: true, messages: [{ role: 'user', content: c.prompt }] }),
    });
    out.status = r.status;
    if (!r.ok) { out.error = (await r.text()).slice(0, 200); return out; }
    const dec = new TextDecoder();
    let buf = '';
    for await (const part of r.body) {
      buf += dec.decode(part, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        for (const line of block.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') continue;
          let j; try { j = JSON.parse(data); } catch { continue; }
          const d = j.choices?.[0]?.delta?.content;
          if (typeof d === 'string') out.text += d;
        }
      }
    }
  } catch (e) {
    out.error = `${e.name}: ${String(e.message).slice(0, 120)}`;
  } finally {
    out.ms = Date.now() - t0;
  }
  return out;
}

async function mapLimit(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : 'n/a');

/** Markdown summary of scored results. */
export function summarize(results, label = '') {
  const lines = [];
  const ok = results.filter((r) => !r.error);
  const withCards = ok.filter((r) => r.score.strings > 0);
  const langOk = withCards.filter((r) => r.score.langOk);
  lines.push(`## ${label || 'run'}: ${ok.length}/${results.length} answered`);
  lines.push('');
  lines.push(`- Card text in the prompt's language: **${langOk.length}/${withCards.length}** answers with cards (${pct(langOk.length, withCards.length)}); foreign strings in total: ${withCards.reduce((s, r) => s + r.score.foreign.length, 0)}`);
  for (const l of ['en', 'es', 'fr', 'de']) {
    const w = withCards.filter((r) => r.lang === l);
    lines.push(`  - ${l}: ${w.filter((r) => r.score.langOk).length}/${w.length}`);
  }
  const prose = ok.filter((r) => r.score.proseLang);
  lines.push(`- Prose in the prompt's language: ${prose.filter((r) => r.score.proseOk).length}/${prose.length} (answers with a clear prose language)`);
  const under = ok.filter((r) => r.under);
  const count = (s) => under.filter((r) => r.score.shape === s).length;
  lines.push(`- Underspecified requests (${under.length}): default content card ${count('content-card')}, input card only ${count('input-card')}, question in prose ${count('prose-question')}, other prose ${count('prose')}`);
  const full = ok.filter((r) => !r.under);
  lines.push(`- Fully specified requests (${full.length}): with a content card ${full.filter((r) => r.score.shape === 'content-card').length}, input card ${full.filter((r) => r.score.shape === 'input-card').length}, prose ${full.filter((r) => r.score.shape.startsWith('prose')).length}`);
  const ms = ok.map((r) => r.ms).sort((a, b) => a - b);
  if (ms.length) lines.push(`- Latency p50 ${(ms[Math.floor(ms.length / 2)] / 1000).toFixed(1)} s, max ${(ms[ms.length - 1] / 1000).toFixed(1)} s`);
  lines.push('');
  lines.push('| case | cards | lang | foreign strings | prose | shape |');
  lines.push('|---|---|---|---|---|---|');
  for (const r of results) {
    if (r.error) { lines.push(`| ${r.id} | error ${r.status} ${r.error.replace(/\|/g, '/')} | | | | |`); continue; }
    const s = r.score;
    const f = s.foreign.map((x) => `"${x.text.replace(/\|/g, '/').slice(0, 60)}"`).join('; ');
    lines.push(`| ${r.id} | ${s.cards.join(' ') || '-'} | ${s.strings ? (s.langOk ? 'ok' : 'FAIL') : '-'} | ${f} | ${s.proseLang || '?'} | ${s.shape}${r.under ? ' (under)' : ''} |`);
  }
  return lines.join('\n');
}

async function main() {
  const o = args(process.argv);
  let results;
  if (o.replay) {
    const saved = JSON.parse(readFileSync(o.replay, 'utf8'));
    o.label ||= saved.label;
    results = saved.results.map((r) => ({ ...r, score: r.error ? null : scoreAnswer(r.text, r.lang) }));
  } else {
    if (!o.bridge || !o['token-file']) throw new Error('--bridge and --token-file are required (or --replay)');
    const token = JSON.parse(readFileSync(o['token-file'], 'utf8')).token;
    const only = o.only ? new Set(o.only.split(',')) : null;
    const cases = CASES.filter((c) => !only || only.has(c.id));
    const run = Date.now().toString(36);
    results = await mapLimit(cases, Number(o.concurrency), async (c) => {
      const a = await chat(o, token, c, run);
      const r = { id: c.id, lang: c.lang, under: Boolean(c.under), prompt: c.prompt, status: a.status, ms: a.ms, error: a.error || (a.text ? '' : 'empty answer'), text: a.text };
      r.score = r.error ? null : scoreAnswer(a.text, c.lang);
      process.stderr.write(`${c.id.padEnd(16)} ${r.error ? 'ERROR ' + r.error : `${r.score.cards.join(' ') || '-'} lang=${r.score.langOk ? 'ok' : 'FAIL'} ${r.score.shape}`} ${(a.ms / 1000).toFixed(1)}s\n`);
      return r;
    });
    if (o.out) writeFileSync(o.out, JSON.stringify({ label: o.label, at: new Date().toISOString(), results }, null, 1));
  }
  console.log(summarize(results, o.label));
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e.message); process.exit(1); });
