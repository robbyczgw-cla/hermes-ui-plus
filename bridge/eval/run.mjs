#!/usr/bin/env node
// Router eval: accuracy, confusion matrix, latency p50/p95 per backend.
//
//   node eval/run.mjs --backend heuristic
//   BRIDGE_ROUTER_BASE_URL=https://api.groq.com/openai/v1 BRIDGE_ROUTER_API_KEY=... \
//     BRIDGE_ROUTER_MODEL=openai/gpt-oss-20b node eval/run.mjs --backend heuristic,openai
//   node eval/run.mjs --backend openai --models modelA,modelB   (same endpoint, several models)
//   TYPESAFE_API_KEY=... node eval/run.mjs --backend jev
//   NACE_API_KEY=... node eval/run.mjs --backend nace --models drex-v1.5,drex-v2.0   (default: NACE_MODEL or drex-v2.0)
//   ANTHROPIC_API_KEY=... node eval/run.mjs --backend heuristic,anthropic
//     default matrix: claude-haiku-5-5 low/adaptive, medium/adaptive, low/disabled (latency baseline)
//     custom: --anthropic claude-haiku-5-5:low:adaptive,claude-sonnet-5-5:low:between_tools
// Re-score a saved --json run offline (no API calls): --replay <run.json> (its model results replay per case id).
// Every model backend also reports heuristic-first (ROUTER_BACKEND=heuristic,<model>) via the real router.
// Options: --cases <file[,file]> --sample <n> --concurrency <n> --rpm <n> (pace request starts; hosted rate limits) --budget <ms> --fastpath <conf|0> --json <out.json> --only <tag> --skip <tag> --verbose
// Never prints API keys. Prompts are printed only for misclassified cases (they are test data).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { routingContext } from '../src/router/context.mjs';
import { createRouter } from '../src/router/router.mjs';
import { ROUTE_FORMATS, normalizeDecision } from '../src/router/taxonomy.mjs';
import { classifyHeuristic } from '../src/router/backends/heuristic.mjs';
import { createAnthropicBackend, createHeuristicBackend, createJevBackend, createNaceBackend, createOpenAIBackend } from '../src/router/backends/index.mjs';

function args(argv) {
  const o = { backend: 'heuristic', cases: fileURLToPath(new URL('./cases.jsonl', import.meta.url)), concurrency: 4, budget: 2000, json: '', only: '', skip: '', models: '', sample: '', anthropic: 'claude-haiku-5-5:low:adaptive,claude-haiku-5-5:medium:adaptive,claude-haiku-5-5:low:disabled', verbose: false, timeout: 15000, fastpath: 0.85, rpm: 0, replay: '' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const key = a.replace(/^--/, '');
    if (key === 'verbose') o.verbose = true;
    else if (key in o) o[key] = argv[++i];
    else throw new Error(`unknown option ${a}`);
  }
  o.concurrency = Number(o.concurrency);
  o.budget = Number(o.budget);
  o.timeout = Number(o.timeout);
  o.fastpath = Number(o.fastpath);
  o.rpm = Number(o.rpm);
  return o;
}

// USD per 1M input tokens (Jev and Drex bill input only; docs.typesafe.ai/models, drex.nace.ai/docs reference/pricing, 2026-10-16). Cost estimate only.
const INPUT_PRICE_PER_M = { 'jev-latest': 0.042, 'drex-v1.0': 0.04, 'drex-v1.5': 0.05, 'drex-v2.0': 0.06, 'drex-latest': 0.06 };

const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : 'n/a');
function quantile(xs, q) {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)];
}

async function mapLimit(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

function buildBackends(o) {
  const env = process.env;
  const list = [];
  if (o.replay) {
    // Saved results keyed by case id; decide() is not used, evalBackend reads `replay` directly.
    for (const r of JSON.parse(readFileSync(o.replay, 'utf8'))) {
      if (r.backend === 'heuristic') list.push(createHeuristicBackend());
      else list.push({ id: r.backend, model: r.model, replay: new Map(r.results.map((x) => [x.id, x])), decide: async () => { throw new Error('replay only'); } });
    }
    return list;
  }
  for (const name of o.backend.split(',').map((s) => s.trim()).filter(Boolean)) {
    if (name === 'heuristic') list.push(createHeuristicBackend());
    else if (name === 'openai') {
      if (!env.BRIDGE_ROUTER_BASE_URL) throw new Error('openai backend: set BRIDGE_ROUTER_BASE_URL, BRIDGE_ROUTER_API_KEY, BRIDGE_ROUTER_MODEL');
      const models = (o.models || env.BRIDGE_ROUTER_MODEL || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (!models.length) throw new Error('openai backend: set BRIDGE_ROUTER_MODEL or --models');
      let extraBody;
      if (env.BRIDGE_ROUTER_EXTRA_BODY) extraBody = JSON.parse(env.BRIDGE_ROUTER_EXTRA_BODY);
      for (const model of models) {
        list.push(createOpenAIBackend({ baseUrl: env.BRIDGE_ROUTER_BASE_URL, apiKey: env.BRIDGE_ROUTER_API_KEY, model, jsonMode: /** @type {any} */ (env.BRIDGE_ROUTER_JSON_MODE || 'schema'), extraBody }));
      }
    } else if (name === 'anthropic') {
      if (!env.ANTHROPIC_API_KEY) throw new Error('anthropic backend: set ANTHROPIC_API_KEY');
      for (const spec of o.anthropic.split(',').map((s) => s.trim()).filter(Boolean)) {
        const [model, effort = 'low', thinking = 'adaptive'] = spec.split(':');
        list.push(createAnthropicBackend({ model, effort: /** @type {any} */ (effort), thinking: /** @type {any} */ (thinking) }));
      }
    } else if (name === 'jev') list.push(createJevBackend({ apiKey: env.TYPESAFE_API_KEY ?? '', model: env.JEV_MODEL }));
    else if (name === 'nace') {
      for (const model of (o.models || env.NACE_MODEL || 'drex-v2.0').split(',').map((s) => s.trim()).filter(Boolean)) {
        list.push(createNaceBackend({ apiKey: env.NACE_API_KEY ?? '', model, baseUrl: env.NACE_BASE_URL || undefined }));
      }
    }
    else throw new Error(`unknown backend ${name}`);
  }
  return list;
}

async function evalBackend(backend, cases, o) {
  // --rpm: space request starts evenly (e.g. Drex free tier: 120 RPM, 8 in flight -> --rpm 100 --concurrency 4).
  let nextStart = 0;
  const pace = async () => {
    if (!o.rpm || backend.id === 'heuristic') return;
    const now = Date.now();
    const at = Math.max(now, nextStart);
    nextStart = at + 60_000 / o.rpm;
    if (at > now) await new Promise((ok) => setTimeout(ok, at - now));
  };
  const results = await mapLimit(cases, backend.id === 'heuristic' ? 1 : o.concurrency, async (k) => {
    const turns = routingContext(k.messages);
    await pace();
    const t0 = performance.now();
    let d = null;
    let error = '';
    let inputTokens = 0;
    let ms;
    if (backend.replay) {
      const x = backend.replay.get(k.id);
      if (!x) throw new Error(`replay: no result for ${k.id}`);
      if (x.got) d = normalizeDecision({ format: x.got, component: x.component, confidence: x.confidence ?? 0.5, reason: 'replay' }, { model: backend.model, ms: x.ms });
      else error = x.error ?? 'replay: no decision';
      ms = x.ms;
    } else {
      try {
        const raw = await backend.decide(turns, { signal: AbortSignal.timeout(o.timeout) });
        inputTokens = raw?.usage?.inputTokens ?? 0;
        d = normalizeDecision(raw, { model: backend.model, ms: performance.now() - t0 });
      } catch (err) {
        error = String(/** @type {any} */ (err)?.message ?? err).slice(0, 120);
      }
      ms = performance.now() - t0;
    }
    const overBudget = backend.id !== 'heuristic' && ms > o.budget;
    // What the bridge would actually emit, through the real router: a stub replays this case's model answer (or its
    // error / budget overrun). Model-first = fast path (heuristic conf >= --fastpath) else model; heuristic-first =
    // ROUTER_BACKEND=heuristic,<model>. Both fall back to the heuristic on errors, as in the bridge.
    const h = classifyHeuristic(turns);
    let effective = h, effMs = 0, fast = false, hf = null, hfMs = 0, hfAsked = false;
    if (backend.id !== 'heuristic') {
      const replayed = async (mode) => {
        let asked = false;
        const stub = { id: backend.id, model: backend.model, decide: async () => { asked = true; if (!d || overBudget) throw new Error(error || 'over budget'); return d; } };
        const out = await createRouter({ backend: stub, mode, fastPathMin: o.fastpath, cache: null, timeoutMs: o.budget }).route(turns);
        return { out, asked, addedMs: asked ? Math.min(ms, o.budget) : 0 };
      };
      const mf = await replayed('model-first');
      ({ out: effective, addedMs: effMs } = mf);
      fast = !mf.asked;
      ({ out: hf, asked: hfAsked, addedMs: hfMs } = await replayed('heuristic-first'));
    }
    return { k, d, error, ms, overBudget, effective, effMs, fast, inputTokens, hf, hfMs, hfAsked };
  });

  const n = results.length;
  let hfLenient = 0;
  let strict = 0, lenient = 0, effLenient = 0, compTotal = 0, compOk = 0, falseVisual = 0, missedVisual = 0, errors = 0, over = 0;
  const confusion = Object.fromEntries(ROUTE_FORMATS.map((f) => [f, Object.fromEntries([...ROUTE_FORMATS, 'ERR'].map((g) => [g, 0]))]));
  const byTag = {};
  const misses = [];
  for (const r of results) {
    const pred = r.d?.format ?? 'ERR';
    const ok = [r.k.expected, ...(r.k.accept ?? [])];
    confusion[r.k.expected][pred]++;
    if (!r.d) errors++;
    if (r.overBudget) over++;
    if (pred === r.k.expected) strict++;
    const len = ok.includes(pred);
    if (len) lenient++;
    if (ok.includes(r.effective.format)) effLenient++;
    if (r.hf && ok.includes(r.hf.format)) hfLenient++;
    if (r.k.component && pred === r.k.expected) {
      compTotal++;
      if (r.d?.component === r.k.component) compOk++;
    }
    if (!len && r.d) {
      if (!ok.includes('text') && pred === 'text') missedVisual++;
      if (ok.includes('text') || r.k.expected === 'text') { if (pred !== 'text') falseVisual++; }
      misses.push(r);
    } else if (!r.d) misses.push(r);
    for (const t of r.k.tags ?? []) {
      byTag[t] ??= { n: 0, ok: 0 };
      byTag[t].n++;
      if (len) byTag[t].ok++;
    }
  }
  const lat = results.map((r) => r.ms);
  const effLat = results.map((r) => r.effMs);
  const fastCount = results.filter((r) => r.fast).length;
  const hfAskedCount = results.filter((r) => r.hfAsked).length;
  const hfLat = results.map((r) => r.hfMs);
  const inputTokens = results.reduce((a, r) => a + r.inputTokens, 0);
  const price = INPUT_PRICE_PER_M[backend.label ?? backend.model];
  return {
    hfLenient, hfAskedCount, hfP50: quantile(hfLat, 0.5), hfP95: quantile(hfLat, 0.95), hfMean: hfLat.reduce((a, b) => a + b, 0) / (n || 1),
    inputTokens, costUsd: price === undefined ? undefined : (inputTokens * price) / 1e6,
    backend: backend.id, model: backend.label ?? backend.model, n,
    strict, lenient, effLenient, compTotal, compOk, falseVisual, missedVisual, errors, over,
    p50: quantile(lat, 0.5), p95: quantile(lat, 0.95), max: Math.max(...lat),
    effP50: quantile(effLat, 0.5), effP95: quantile(effLat, 0.95), fastCount,
    confusion, byTag, misses, results,
  };
}

function printReport(r, o) {
  const line = '-'.repeat(78);
  console.log(`\n${line}\nBackend: ${r.backend}  model: ${r.model}  cases: ${r.n}`);
  console.log(`Accuracy strict:  ${r.strict}/${r.n} = ${pct(r.strict, r.n)}`);
  console.log(`Accuracy lenient: ${r.lenient}/${r.n} = ${pct(r.lenient, r.n)}   (expected or an accepted alternative)`);
  if (r.backend !== 'heuristic') {
    console.log(`Effective in bridge (fast path >= ${o.fastpath}: ${r.fastCount}, heuristic fallback on error / >${o.budget} ms): ${pct(r.effLenient, r.n)}   errors: ${r.errors}  over budget: ${r.over}`);
    console.log(`Effective routing latency added (ms): p50 ${r.effP50.toFixed(0)}  p95 ${r.effP95.toFixed(0)}`);
    console.log(`Heuristic-first (heuristic,${r.backend}): ${pct(r.hfLenient, r.n)}   model asked ${r.hfAskedCount}/${r.n}   added ms p50 ${r.hfP50.toFixed(0)}  p95 ${r.hfP95.toFixed(0)}  mean ${r.hfMean.toFixed(0)}`);
  }
  console.log(`Component hint accuracy (when format right): ${r.compOk}/${r.compTotal} = ${pct(r.compOk, r.compTotal)}`);
  console.log(`Unwanted visual (expected text): ${r.falseVisual}   Missed visual (predicted text): ${r.missedVisual}`);
  console.log(`Latency ms: p50 ${r.p50.toFixed(1)}  p95 ${r.p95.toFixed(1)}  max ${r.max.toFixed(1)}`);
  if (r.inputTokens) console.log(`Input tokens: ${r.inputTokens} (${(r.inputTokens / r.n).toFixed(0)}/call)${r.costUsd === undefined ? '' : `  cost ~$${r.costUsd.toFixed(5)} (~$${((1000 * r.costUsd) / r.n).toFixed(4)} per 1000 calls)`}`);

  const cols = [...ROUTE_FORMATS, 'ERR'].filter((g) => ROUTE_FORMATS.some((f) => r.confusion[f][g]));
  const abbr = (s) => s.slice(0, 5);
  console.log('\nConfusion matrix (rows = expected, cols = predicted):');
  console.log(`${'exp\\pred'.padEnd(12)}${cols.map((c) => abbr(c).padStart(6)).join('')}`);
  for (const f of ROUTE_FORMATS) {
    const row = r.confusion[f];
    if (!Object.values(row).some(Boolean)) continue;
    console.log(`${f.padEnd(12)}${cols.map((c) => String(row[c] || '.').padStart(6)).join('')}`);
  }
  console.log('\nLenient accuracy by tag:');
  console.log(Object.entries(r.byTag).sort().map(([t, v]) => `${t} ${v.ok}/${v.n}`).join('  |  '));
  if (r.misses.length) {
    console.log(`\nMisclassified (${r.misses.length}):`);
    for (const m of r.misses) {
      const last = m.k.messages.at(-1).content.replace(/\s+/g, ' ').slice(0, 70);
      const accept = m.k.accept?.length ? `/${m.k.accept.join('/')}` : '';
      console.log(`  ${m.k.id.padEnd(6)} exp ${(m.k.expected + accept).padEnd(18)} got ${(m.d ? m.d.format + (m.d.component ? `:${m.d.component}` : '') : `ERR ${m.error}`).padEnd(16)} ${o.verbose && m.d ? `(${m.d.reason}) ` : ''}"${last}"`);
    }
  }
}

async function main() {
  const o = args(process.argv);
  let cases = o.cases.split(',').flatMap((f) => readFileSync(f.trim(), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)));
  if (o.only) cases = cases.filter((k) => k.tags?.includes(o.only));
  if (o.skip) cases = cases.filter((k) => !k.tags?.includes(o.skip));
  // Deterministic, evenly spread subset (keeps paid eval runs small and comparable).
  if (o.sample && Number(o.sample) < cases.length) {
    const n = Number(o.sample);
    const all = cases;
    cases = Array.from({ length: n }, (_, i) => all[Math.floor((i * all.length) / n)]);
  }
  console.log(`cases: ${cases.length} (${o.cases}${o.sample ? `, sample ${o.sample}` : ''})`);
  const backends = buildBackends(o);
  const reports = [];
  for (const b of backends) {
    const r = await evalBackend(b, cases, o);
    printReport(r, o);
    reports.push(r);
  }
  if (reports.length > 1) {
    console.log('\nSummary');
    console.log(`${'backend/model'.padEnd(40)}${'strict'.padStart(8)}${'lenient'.padStart(9)}${'effect.'.padStart(9)}${'h-first'.padStart(9)}${'p50'.padStart(8)}${'p95'.padStart(8)}`);
    for (const r of reports) {
      console.log(`${`${r.backend}/${r.model}`.slice(0, 39).padEnd(40)}${pct(r.strict, r.n).padStart(8)}${pct(r.lenient, r.n).padStart(9)}${pct(r.effLenient, r.n).padStart(9)}${(r.backend === 'heuristic' ? '-' : pct(r.hfLenient, r.n)).padStart(9)}${r.p50.toFixed(0).padStart(8)}${r.p95.toFixed(0).padStart(8)}`);
    }
  }
  if (o.json) {
    writeFileSync(o.json, JSON.stringify(reports.map((r) => ({ ...r, misses: r.misses.map((m) => ({ id: m.k.id, expected: m.k.expected, got: m.d, error: m.error, ms: m.ms })), results: r.results.map((x) => ({ id: x.k.id, expected: x.k.expected, accept: x.k.accept, got: x.d?.format, component: x.d?.component, confidence: x.d?.confidence, ms: Math.round(x.ms), fast: x.fast, error: x.error || undefined, hf: x.hf ? x.hf.format : undefined, hfAsked: x.hfAsked || undefined })) })), null, 2));
    console.log(`\nwrote ${o.json}`);
  }
}

main().catch((err) => {
  console.error(String(err?.message ?? err));
  process.exit(1);
});
