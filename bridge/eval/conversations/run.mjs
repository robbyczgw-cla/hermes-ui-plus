#!/usr/bin/env node
// Live conversation test against a running UI bridge + Hermes (docs/CHAT-REGRESSION.md, live layer): the QA journeys
// (scenarios.mjs) sent exactly the way the app sends them (the app's own buildRequest, SSE parser and event mapping),
// every answer drawn by the app's real components (app/src/testkit/answerView.ts) and judged with the same checks as
// the recorded-transcript tests (app/src/regression/userChecks.ts). Taps in a scenario press the drawn controls and send
// what the app would send.
//
// Pre-release step (docs/RELEASING.md), on the throwaway test instance with the DEFAULT bridge configuration:
//   scripts/test-instance/ti.sh --host linux|mac conversation-test [--max-tokens N] [--scenario a,b]
//   (runs this file on YOUR machine through a tunnel, the instance inside a session on the host; needs npm ci in app/)
// Directly against any bridge (token from the environment, never printed):
//   HUI_CONV_TOKEN=… node bridge/eval/conversations/run.mjs --bridge http://127.0.0.1:8790 [--scenario id] [--out DIR]
//
// Budget (fixed, the run stops cleanly when it is spent; the rest is reported as not run):
//   --max-turns N      default 80        --max-tokens N   default 2000000 (prompt + completion as Hermes reports them)
// Other options: --scenario a,b (only these), --scenarios FILE (own SCENARIOS module), --repeat N (every scenario N
// times, each in a new session: how often does a model-content rule still break?), --time-zone Europe/Vienna,
// --turn-timeout MS, --out DIR, --model-label NAME (the model the instance runs, for the report; Hermes streams
// "hermes-agent").
// Exit 0 = all answers pass, 1 = a renderer or honesty check failed, 2 = could not run (bridge unreachable, no token),
// 3 = only environment failures (HTTP errors, timeouts, upstream errors: nothing about the app could be judged there).
// Report: OUT/conversation-report.{md,json} (full answers in the JSON; OUT is private, never the repo).
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkAnswer } from './check.mjs';
import { SCENARIOS as DEFAULT_SCENARIOS } from './scenarios.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const argv = process.argv.slice(2);
const opt = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const TI = argv.includes('--ti');
const TI_DIR = process.env.TI_DIR || '';
const MAC = process.platform === 'darwin';
const BRIDGE = (opt('--bridge', TI ? `http://127.0.0.1:${process.env.TI_BRIDGE_PORT || (MAC ? 28790 : 18790)}` : process.env.HUI_CONV_BRIDGE || '')).replace(/\/+$/, '');
const TURN_TIMEOUT_MS = Number(opt('--turn-timeout', process.env.HUI_CONV_TURN_TIMEOUT_MS || 300000));
const MAX_TURNS = Number(opt('--max-turns', 80));
const MAX_TOKENS = Number(opt('--max-tokens', 2000000));
const ZONE = opt('--time-zone', 'Europe/Vienna');
const only = opt('--scenario', '')?.split(',').filter(Boolean) ?? [];
// --scenarios FILE: another module exporting SCENARIOS (same shape as scenarios.mjs), e.g. a new case being written
const scenFile = opt('--scenarios', '');
const SCENARIOS = scenFile ? (await import(pathToFileURL(resolve(scenFile)).href)).SCENARIOS : DEFAULT_SCENARIOS;
// --repeat N: every scenario N times, each in a new session (how often does a model-content rule still break?)
const REPEAT = Math.max(1, Math.min(20, Number(opt('--repeat', '1')) || 1));
const run = new Date().toISOString().replace(/[:.]/g, '-');
const OUT = opt('--out', TI && TI_DIR ? join(TI_DIR, 'reports', `conv-${run}`) : '');

function token() {
  const file = opt('--token-file', '');
  if (file) return readFileSync(file, 'utf8').trim();
  if (TI && TI_DIR) return JSON.parse(readFileSync(join(TI_DIR, 'bridge-state', 'state.json'), 'utf8')).token;
  return process.env.HUI_CONV_TOKEN || '';
}

const TOKEN = token();
const short = (s, n = 160) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const auth = (h = {}) => ({ authorization: `Bearer ${TOKEN}`, ...h });

async function getJson(path) {
  const r = await fetch(BRIDGE + path, { headers: auth() });
  let json = null;
  try {
    json = await r.json();
  } catch {
    /* not JSON */
  }
  return { status: r.status, json };
}

// the app's own request builder, SSE parser and event mapping (TypeScript, stripped by Node)
const app = await import('../../../app/src/hermes/stream.ts');
const { createSseParser, createUtf8Decoder } = await import('../../../app/src/hermes/sse.ts');
const { mapFrame } = await import('../../../app/src/hermes/events.ts');
const { userTimeZoneMessage } = await import('../../../app/src/hermes/timeZone.ts');
const checks = await import('../../../app/src/regression/userChecks.ts');
// the real components (needs app/node_modules); without them only the parser check (check.mjs) runs
let av = null;
let renderNote = 'app components (react-native-web in Node)';
try {
  av = await (await import('../../../app/src/testkit/answerView.ts')).loadAnswerView();
} catch (e) {
  renderNote = `parser only (components could not load: ${short(e?.message ?? e, 120)})`;
}

/** One app turn: buildRequest exactly as the app (bridge connection, live cards on, the phone's time zone line). */
async function turn(sessionId, content, n) {
  const t0 = performance.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TURN_TIMEOUT_MS);
  const out = { status: 0, text: '', route: null, done: false, ms: 0, error: null, upstreamError: null, tools: [], usage: null, model: null, statusLines: [] };
  const conn = { baseUrl: `${BRIDGE}/v1`, apiKey: TOKEN, bridge: true };
  const req = app.buildRequest(conn, content, sessionId, undefined, true, `conv-${sessionId}-${n}`, true, undefined, userTimeZoneMessage(Date.now(), ZONE));
  try {
    const r = await fetch(req.url, { method: 'POST', headers: req.headers, body: req.body, signal: ctrl.signal });
    out.status = r.status;
    try {
      out.route = JSON.parse(r.headers.get('x-hermes-ui-route') || 'null');
    } catch {
      /* no route header */
    }
    if (!r.ok) {
      out.error = `HTTP ${r.status}: ${short(await r.text(), 200)}`;
      return out;
    }
    const sse = createSseParser();
    const dec = createUtf8Decoder();
    const tools = new Map();
    const apply = (frames) => {
      for (const f of frames) {
        for (const ev of mapFrame(f)) {
          if (ev.type === 'text') out.text += ev.text;
          else if (ev.type === 'textReplace') out.text = ev.text;
          else if (ev.type === 'tool') tools.set(ev.callId, { id: ev.callId, name: ev.name, status: ev.status, textAt: out.text.length });
          else if (ev.type === 'start') out.model = ev.model ?? out.model;
          else if (ev.type === 'route') out.route = ev.route;
          else if (ev.type === 'status') out.statusLines.push(ev.text);
          else if (ev.type === 'finish') {
            out.usage = ev.usage ?? out.usage;
            if (ev.error) out.upstreamError = `${ev.errorCode ?? 'error'}: ${short(ev.error, 160)}`;
          } else if (ev.type === 'error') out.upstreamError = `${ev.code ?? 'error'}: ${short(ev.message, 160)}`;
          else if (ev.type === 'done') out.done = true;
        }
      }
    };
    for await (const part of r.body) apply(sse.push(dec.decode(part)));
    apply(sse.push(dec.flush?.() ?? ''));
    apply(sse.flush());
    out.tools = [...tools.values()];
  } catch (e) {
    out.error = e?.name === 'AbortError' ? `timeout after ${TURN_TIMEOUT_MS} ms` : short(e?.message ?? e, 200);
  } finally {
    clearTimeout(timer);
    out.ms = Math.round(performance.now() - t0);
  }
  return out;
}

/** What the phone gets for one image: the photo through the bridge proxy, or the placeholder (with why). */
async function resolveImage(img, imageSearch) {
  if (img.url) {
    try {
      const r = await fetch(`${BRIDGE}/bridge/img?u=${encodeURIComponent(img.url)}`, { headers: auth() });
      const type = r.headers.get('content-type') || '';
      await r.arrayBuffer().catch(() => null);
      return r.ok && type.startsWith('image/') ? { shows: 'photo', via: 'url' } : { shows: 'placeholder', via: 'url', why: `proxy HTTP ${r.status} ${type}`.trim() };
    } catch (e) {
      return { shows: 'placeholder', via: 'url', why: short(e?.message ?? e, 80) };
    }
  }
  if (img.query && img.web && imageSearch === 'off') return { shows: img.card ? 'icon' : 'placeholder', via: 'query', why: 'no image search on the bridge' };
  return { shows: 'wikipedia lookup (on the phone)', via: 'query' };
}

/** Judge one answer: renderer findings (what the app draws), agent-content findings (what the model claims), soft notes. */
async function judge(r, lang, imageSearch, web) {
  const renderer = [];
  const agent = [];
  const soft = [];
  const parsed = checkAnswer(r.text, { imageSearch, web, today: new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(new Date()) });
  // the parser check's image and source rules are about the model following the skill: agent content
  for (const f of parsed.failures) (f.includes('skill rule') ? agent : renderer).push({ code: 'parser', detail: f });
  let view = null;
  if (av) {
    view = await av.viewAnswer({ role: 'assistant', text: r.text, tools: r.tools, status: 'done' }, { lang, explore: true });
    for (const f of checks.checkDrawn(view)) renderer.push(f);
    view.segments.forEach((s, i) => {
      if (s.kind !== 'hui') return;
      for (const m of checks.missingContent(s.raw, s.type, view.explored[i])) renderer.push({ code: `dropped:${s.type}.${m.key}`, detail: `"${short(m.value, 80)}" is not on screen` });
    });
    for (const f of checks.checkPromises(r.text, view)) agent.push(f);
  }
  for (const f of checks.checkClaims(r.text, r.tools)) agent.push(f);
  for (const w of parsed.warnings) soft.push(w);
  return { renderer, agent, soft, blocks: parsed.blocks, images: parsed.images, evidence: parsed.evidence, view };
}

/** Press the controls of the previous answer; returns the message the app would send, or why not. */
async function tapAndSend(prevText, prevTools, labels, lang) {
  if (!av) return { error: 'taps need the app components' };
  const v = await av.mountAnswer({ role: 'assistant', text: prevText, tools: prevTools }, { lang });
  try {
    for (const label of labels) {
      const segs = v.segments();
      let done = false;
      for (let i = 0; i < segs.length && !done; i++) {
        if (segs[i].kind === 'markdown' && !/- \[[ x]\]/i.test(prevText)) continue; // controls live in blocks (or task lists)
        try {
          await v.tap(label, { segment: i });
          done = true;
        } catch {
          /* not in this segment */
        }
      }
      if (!done) return { error: `no control "${String(label)}" in the answer` };
      await v.wait(1700); // a single choice sends after its undo window
    }
    const sent = v.sent.map((s) => s.action).find((a) => a && typeof a === 'object' && a.type === 'send' && typeof a.text === 'string');
    return sent ? { text: sent.text } : { error: `the taps sent nothing (${JSON.stringify(v.sent).slice(0, 120)})` };
  } finally {
    await v.unmount();
  }
}

function gitInfo() {
  try {
    return execFileSync('git', ['-C', REPO, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

/** turns with data nodes / source claims / chips the user sees, over the whole run */
function evidenceSummary(report) {
  const out = { turns: 0, turnsWithDataNodes: 0, turnsWithSourceClaim: 0, sourceClaims: 0, sourceProseWithoutCaveat: 0, modelKnowledgeProse: 0, chips: {} };
  for (const sc of report.scenarios) for (const t of sc.turns) {
    const e = t.evidence;
    if (!e) continue;
    out.turns++;
    if (e.chips.length) out.turnsWithDataNodes++;
    if (e.claims.length) out.turnsWithSourceClaim++;
    out.sourceClaims += e.claims.length;
    if (e.sourceProse && !e.modelProse) out.sourceProseWithoutCaveat++;
    if (e.modelProse) out.modelKnowledgeProse++;
    for (const c of e.chips) out.chips[c.chip ?? '(no chip)'] = (out.chips[c.chip ?? '(no chip)'] ?? 0) + 1;
  }
  return out;
}

function md(report) {
  const L = [
    `# Conversation test ${report.at}`,
    '',
    `App ${report.app}; Hermes ${report.bridge.hermes ?? '?'} via the UI bridge (router ${report.router ?? '?'}, image search ${report.imageSearch ?? 'unknown'}, web ${report.web ?? 'unknown'}, bootstrap ${report.bridge.bootstrap ?? '?'}); model ${report.modelLabel ?? (report.models.join(', ') || '?')} (Hermes lists: ${report.bridge.listedModels.join(', ') || '?'}); drawn with ${report.render}.`,
    `Budget: ${report.budget.turns}/${report.budget.maxTurns} turns, ${report.budget.tokens}/${report.budget.maxTokens} tokens${report.budget.stopped ? ` — stopped: ${report.budget.stopped}` : ''}.`,
    '',
    `**Result: ${report.verdict}** — renderer failures ${report.counts.renderer}, agent-content failures ${report.counts.agent}, environment failures ${report.counts.environment}, soft notes ${report.counts.soft}.`,
    '',
    '| Scenario | Turns | Renderer | Agent content | Environment | Soft |',
    '|---|---:|---:|---:|---:|---:|',
    ...report.scenarios.map((s) => `| ${s.id} | ${s.turns.length} | ${s.turns.reduce((a, t) => a + t.renderer.length, 0)} | ${s.turns.reduce((a, t) => a + t.agent.length, 0)} | ${s.turns.filter((t) => t.environment).length} | ${s.turns.reduce((a, t) => a + t.soft.length, 0)} |`),
    '',
  ];
  if (report.evidence) L.push(`Evidence: ${JSON.stringify(report.evidence)}`, '');
  for (const sc of report.scenarios) {
    L.push(`## ${sc.id}${sc.findings?.length ? ` (${sc.findings.join(', ')})` : ''}`, '');
    sc.turns.forEach((t, i) => {
      L.push(`### ${i + 1}. ${t.tapped ? `[tap ${t.tapped}] ` : ''}"${short(t.prompt, 120)}" — ${t.verdict} (${(t.ms / 1000).toFixed(1)} s${t.usage ? `, ${t.usage.totalTokens} tok` : ''})`);
      L.push(`- blocks: ${t.blocks.length ? t.blocks.map((b) => b.type + (b.fallback ? ' (fallback)' : '')).join(', ') : 'none (Markdown only)'}${t.tools.length ? `; tools: ${t.tools.map((x) => `${x.name}:${x.status}`).join(', ')}` : ''}`);
      if (t.evidence?.chips.length) L.push(`- chips the user sees: ${t.evidence.chips.map((c) => `${c.type}: ${c.chip ?? '(none)'}`).join('; ')}`);
      if (t.evidence?.claims.length) L.push(`- source claims: ${t.evidence.claims.map((c) => `${c.type} ${c.basis ?? ''} ${c.source ?? ''}`.trim()).join('; ')}`);
      if (t.evidence) L.push(`- prose: ${t.evidence.modelProse ? 'says model knowledge / unsure' : 'no model-knowledge note'}${t.evidence.sourceProse ? ', names a source / current data' : ''}`);
      if (t.environment) L.push(`- ENVIRONMENT: ${t.environment}`);
      for (const f of t.renderer) L.push(`- RENDERER: ${f.code}: ${f.detail}`);
      for (const f of t.agent) L.push(`- AGENT: ${f.code}: ${f.detail}`);
      for (const w of t.soft) L.push(`- soft: ${w}`);
      if (t.images?.length) L.push(`- images: ${t.images.map((im) => `${im.kind} ${im.via}→${im.shows}${im.why ? ` (${im.why})` : ''}`).join('; ')}`);
      L.push('', '```text', `user sees: ${short(t.seen ?? t.text, 700)}`, '```', '');
    });
  }
  if (report.notRun.length) L.push(`## Not run (budget)`, '', report.notRun.join(', '), '');
  return L.join('\n') + '\n';
}

async function main() {
  if (!BRIDGE || !TOKEN) {
    console.error('need --bridge URL and a token (HUI_CONV_TOKEN, --token-file, or --ti on the test host)');
    process.exit(2);
  }
  const status = await getJson('/bridge/status').catch((e) => ({ status: 0, error: e }));
  if (status.status !== 200) {
    console.error(`bridge not reachable or token rejected: /bridge/status → ${status.status}`);
    process.exit(2);
  }
  const imageSearch = status.json?.caps?.image_search ?? null;
  // web=on|off of the default profile: the bridge asks Hermes before the first app turn (src/webcaps.mjs), so it is
  // read again after the first answer; a bridge without it (older) stays unknown
  let web = status.json?.web?.default ?? status.json?.web?.['*'] ?? null;
  // versions for the report: Hermes' health (through the bridge), the models Hermes lists (the real one behind "hermes-agent")
  const health = (await getJson('/health').catch(() => null))?.json ?? (await getJson('/v1/health').catch(() => null))?.json ?? null;
  const models = (await getJson('/v1/models').catch(() => null))?.json?.data?.map((m) => m?.id).filter(Boolean) ?? [];
  const report = {
    at: new Date().toISOString(),
    app: gitInfo(),
    bridge: { version: status.json?.version ?? null, hermes: health?.version ?? null, listedModels: models, bootstrap: status.json?.bootstrap ?? null },
    modelLabel: opt('--model-label', process.env.HUI_CONV_MODEL || null),
    imageSearch,
    web,
    router: status.json?.router?.kind ?? null,
    render: renderNote,
    models: [],
    budget: { maxTurns: MAX_TURNS, maxTokens: MAX_TOKENS, turns: 0, tokens: 0, stopped: null },
    scenarios: [],
    notRun: [],
  };
  console.log(`bridge caps: image_search=${imageSearch ?? 'unknown'}; drawing: ${renderNote}`);
  const picked = SCENARIOS.filter((s) => !only.length || only.includes(s.id));
  for (let rep = 1; rep <= REPEAT; rep++) for (const sc of picked) {
    const id = REPEAT > 1 ? `${sc.id} #${rep}` : sc.id;
    if (report.budget.stopped) {
      report.notRun.push(id);
      continue;
    }
    const sid = `hui-conv-${sc.id}-${run}${REPEAT > 1 ? `-r${rep}` : ''}`;
    const turns = [];
    let prev = null;
    for (const [n, t] of sc.turns.entries()) {
      if (report.budget.turns >= MAX_TURNS) report.budget.stopped = `max ${MAX_TURNS} turns`;
      else if (report.budget.tokens >= MAX_TOKENS) report.budget.stopped = `max ${MAX_TOKENS} tokens`;
      if (report.budget.stopped) break;
      let prompt = t.text;
      let tapped = null;
      if (t.tap) {
        tapped = t.tap.map(String).join(' → ');
        const s = prev ? await tapAndSend(prev.text, prev.tools, t.tap, sc.lang) : { error: 'nothing to tap' };
        if (s.error) {
          turns.push({ prompt: `(tap ${tapped})`, tapped, ms: 0, verdict: 'SKIPPED', renderer: [], agent: [], soft: [`tap: ${s.error} (model chose another form)`], blocks: [], tools: [], environment: null });
          console.log(`SKIP ${sc.id} tap ${tapped}: ${s.error}`);
          continue;
        }
        prompt = s.text;
      }
      const r = await turn(sid, prompt, n);
      report.budget.turns++;
      report.budget.tokens += r.usage?.totalTokens ?? 0;
      if (r.model && !report.models.includes(r.model)) report.models.push(r.model);
      if (!web) {
        const st = await getJson('/bridge/status').catch(() => ({ json: null }));
        web = st.json?.web?.default ?? st.json?.web?.['*'] ?? null;
        report.web = web;
        if (web) console.log(`bridge caps: web=${web}`);
      }
      const environment = r.error ?? (!r.done ? 'stream ended without [DONE]' : null) ?? r.upstreamError;
      const j = environment && !r.text.trim() ? { renderer: [], agent: [], soft: [], blocks: [], images: [], evidence: null, view: null } : await judge(r, sc.lang, imageSearch, web);
      const types = new Set(j.blocks.map((b) => b.type));
      if (t.expect?.length && !t.expect.some((x) => types.has(x))) j.soft.push(`expected one of ${t.expect.join('/')}, got ${[...types].join('/') || 'Markdown only'}`);
      if (!tapped) for (const f of checks.checkLanguage(prompt, r.text)) j.soft.push(`${f.code}: ${f.detail}`);
      const images = [];
      for (const im of j.images ?? []) images.push({ kind: im.kind, ...(await resolveImage(im, imageSearch)) });
      const verdict = j.renderer.length ? 'FAIL (renderer)' : j.agent.length ? 'FAIL (agent content)' : environment ? 'ENVIRONMENT' : 'PASS';
      turns.push({ prompt, tapped, ms: r.ms, usage: r.usage, model: r.model, route: r.route, tools: r.tools, statusLines: r.statusLines, blocks: j.blocks, images, evidence: j.evidence, renderer: j.renderer, agent: j.agent, soft: j.soft, environment, verdict, text: r.text, seen: j.view?.text ?? null });
      console.log(`${verdict} ${sc.id} "${short(prompt, 60)}" ${(r.ms / 1000).toFixed(1)} s · ${j.blocks.map((b) => b.type).join(', ') || 'markdown'}${[...j.renderer, ...j.agent].length ? ` · ${[...j.renderer, ...j.agent].map((f) => f.code).join(' | ')}` : ''}${environment ? ` · ${environment}` : ''}`);
      prev = r;
      if (r.error) break; // the session is in an unknown state: stop this conversation
    }
    report.scenarios.push({ id, lang: sc.lang, findings: sc.findings, note: sc.note, sessionId: sid, turns });
  }
  const all = report.scenarios.flatMap((s) => s.turns);
  report.counts = {
    renderer: all.reduce((a, t) => a + t.renderer.length, 0),
    agent: all.reduce((a, t) => a + t.agent.length, 0),
    environment: all.filter((t) => t.environment).length,
    soft: all.reduce((a, t) => a + t.soft.length, 0),
  };
  report.verdict = report.counts.renderer || report.counts.agent ? 'FAIL' : report.counts.environment ? 'ENVIRONMENT ONLY' : 'PASS';
  report.pass = report.verdict === 'PASS';
  report.evidence = evidenceSummary(report);
  console.log(`evidence: ${JSON.stringify(report.evidence)}`);
  if (OUT) {
    mkdirSync(OUT, { recursive: true, mode: 0o700 });
    writeFileSync(join(OUT, 'conversation-report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    writeFileSync(join(OUT, 'conversation-report.md'), md(report), { mode: 0o600 });
    console.log(`report: ${join(OUT, 'conversation-report.md')}`);
  }
  console.log(`CONVERSATION TEST ${report.verdict} (${report.budget.turns} turns, ${report.budget.tokens} tokens)`);
  process.exit(report.verdict === 'PASS' ? 0 : report.verdict === 'FAIL' ? 1 : 3);
}

await main();
