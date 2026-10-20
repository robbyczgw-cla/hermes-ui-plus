#!/usr/bin/env node
// Live cards, phase 0: does the model follow the live-card rules of the hermes-ui skill (references/live.md)?
// Runs short scripted conversations against a THROWAWAY Hermes API (the test instance of scripts/test-instance, never a
// production Hermes) and scores each rule. Fake shopping content only. The API key is read from a file, never printed.
//
//   node scripts/evals/live-cards-eval.mjs --api http://127.0.0.1:18642 --key-file ~/hermes-test/secrets/api_server_key \
//     [--reps 3] [--out report.json] [--dry-run]
//
// System messages are the ones the app + bridge send on an app turn: bootstrap, skill core inline, the app's
// capability line (or none for an "old app"). The test instance has no skill_view tool, so for the conditions that
// need it the reference live.md goes in as one more system message (what a skill_view would have returned).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { buildSkillMessage } from '../../bridge/src/skillInline.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const API = opt('--api', 'http://127.0.0.1:18642');
const KEY_FILE = opt('--key-file', '');
const REPS = Number(opt('--reps', '3'));
const OUT = opt('--out', '');
const DRY = args.includes('--dry-run');
const ONLY = opt('--only', '').split(',').filter(Boolean); // scenario letters (A,B,B0,C,D); default all but B0
const OLD_SKILL_DIR = opt('--old-skill-dir', ''); // hermes-skill/ of the previous skill release (scenario B0)
const MODEL = opt('--model', 'hermes-agent');

const BOOTSTRAP = readFileSync(join(ROOT, 'hermes-skill/bootstrap-system-message.txt'), 'utf8').trim();
const SKILL = buildSkillMessage(readFileSync(join(ROOT, 'hermes-skill/hermes-ui/SKILL.md'), 'utf8'));
const LIVE_REF = refMessage(ROOT, 'live');
const PLAN_REF = refMessage(ROOT, 'plan');
const FEATURES = readFeaturesLine();
const OLD_SKILL = OLD_SKILL_DIR ? buildSkillMessage(readFileSync(join(OLD_SKILL_DIR, 'hermes-ui/SKILL.md'), 'utf8')) : null;
const OLD_PLAN_REF = OLD_SKILL_DIR ? refMessage(dirname(OLD_SKILL_DIR), 'plan', OLD_SKILL_DIR) : null;

/** What skill_view("hermes-ui", file_path="references/<ref>.md") returns, as a system message. */
function refMessage(root, ref, skillDir = join(root, 'hermes-skill')) {
  return `[hermes-ui-skill] skill_view("hermes-ui", file_path="references/${ref}.md") returned:\n\n`
    + readFileSync(join(skillDir, `hermes-ui/references/${ref}.md`), 'utf8').trim();
}

/** The app's capability line, read from the app source so the eval tests what ships. */
function readFeaturesLine() {
  const src = readFileSync(join(ROOT, 'app/src/hermes/bootstrap.ts'), 'utf8');
  const m = /HERMES_FEATURES_MESSAGE\s*=\s*'([^']+)'/.exec(src);
  if (!m) throw new Error('HERMES_FEATURES_MESSAGE not found in app/src/hermes/bootstrap.ts');
  return m[1];
}

function systemMessages(cond) {
  const out = [BOOTSTRAP, cond.old ? OLD_SKILL : SKILL];
  if (cond.plan) out.push(cond.old ? OLD_PLAN_REF : PLAN_REF);
  if (cond.ref) out.push(LIVE_REF);
  if (cond.features) out.push(FEATURES);
  return out.map((content) => ({ role: 'system', content }));
}

let calls = 0;
async function turn(session, cond, text) {
  calls++;
  if (DRY) return { text: '', ms: 0 };
  const key = readFileSync(KEY_FILE, 'utf8').trim();
  const t0 = Date.now();
  const res = await fetch(`${API}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`, 'Content-Type': 'application/json',
      'X-Hermes-Session-Id': session, 'X-Hermes-Session-Key': 'hermes-ui',
    },
    body: JSON.stringify({ model: MODEL, stream: false, messages: [...systemMessages(cond), { role: 'user', content: text }] }),
    signal: AbortSignal.timeout(240_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  const content = body?.choices?.[0]?.message?.content;
  return { text: typeof content === 'string' ? content : '', ms: Date.now() - t0 };
}

async function deleteSession(session) {
  if (DRY) return;
  const key = readFileSync(KEY_FILE, 'utf8').trim();
  await fetch(`${API}/api/sessions/${encodeURIComponent(session)}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(30_000),
  }).catch(() => {});
}

// ---- answer parsing ---------------------------------------------------------------------------------------------
const FENCE = /```hui[ \t]*\n([\s\S]*?)\n```/g;
export function blocks(text) {
  const out = [];
  for (const m of text.matchAll(FENCE)) {
    try { out.push({ ok: true, node: JSON.parse(m[1]) }); } catch { out.push({ ok: false, raw: m[1] }); }
  }
  return out;
}
const checklists = (text) => blocks(text).filter((b) => b.ok && b.node?.type === 'checklist').map((b) => b.node);
const textFirst = (text) => {
  const i = text.indexOf('```hui');
  return (i < 0 ? text : text.slice(0, i)).replace(/\s+/g, ' ').trim().length >= 12;
};
const norm = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
const findItem = (node, word) => node?.items?.find((it) => norm(it.text).includes(norm(word)));

// ---- scoring ------------------------------------------------------------------------------------------------------
const results = {}; // rule -> {pass, total, fails: []}
function score(rule, pass, note) {
  const r = (results[rule] ??= { pass: 0, total: 0, fails: [] });
  r.total++;
  if (pass) r.pass++; else r.fails.push(note);
}
const transcripts = [];

async function conversation(name, cond, steps) {
  const session = `hui-eval-${randomBytes(6).toString('hex')}`;
  const ctx = { prev: null };
  try {
    for (const step of steps) {
      const text = typeof step.text === 'function' ? step.text(ctx) : step.text;
      const { text: answer, ms } = await turn(session, cond, text);
      transcripts.push({ name, cond, user: text, answer, ms });
      if (!DRY) step.check(answer, ctx);
    }
  } catch (err) {
    transcripts.push({ name, cond, error: String(err?.message ?? err) });
    score('no-error', false, `${name}: ${err?.message ?? err}`);
  } finally {
    await deleteSession(session);
  }
}

const CREATE = 'Mach mir eine Einkaufsliste für Samstag, die ich die Woche über weiterführe: Tomaten, Milch, Brot, Käse, Eier.';
const NEW = { features: true, ref: true };

function checkJson(answer, label) {
  for (const b of blocks(answer)) score('valid-json', b.ok, `${label}: ${String(b.raw).slice(0, 80)}`);
}
function checkCreate(answer, ctx, label) {
  checkJson(answer, label);
  const [node] = checklists(answer);
  score('create-live', !!node && node.live === true && typeof node.id === 'string' && node.id.length > 0, `${label}: ${node ? JSON.stringify({ id: node.id, live: node.live }) : 'no checklist'}`);
  score('item-ids', !!node && node.items?.length > 0 && node.items.every((it) => typeof it.id === 'string' && it.id), `${label}: ${node?.items?.filter((it) => !it.id).length ?? '?'} items without id`);
  score('text-first', textFirst(answer), `${label}`);
  ctx.prev = node ?? null;
}
function checkUpdate(answer, ctx, label, expect) {
  checkJson(answer, label);
  const prev = ctx.prev;
  const [node] = checklists(answer);
  if (!prev) { score('update-same-id', false, `${label}: no previous card`); return; }
  score('update-same-id', !!node && node.id === prev.id && node.live === true, `${label}: ${node ? `${node.id} live=${node.live}` : 'no checklist'} (prev ${prev.id})`);
  if (!node) { ctx.prev = prev; return; }
  const kept = prev.items.filter((it) => !(expect.removed ?? []).some((w) => norm(it.text).includes(norm(w))));
  const missing = kept.filter((it) => !node.items.some((n) => n.id === it.id || norm(n.text) === norm(it.text)));
  score('full-version', missing.length === 0, `${label}: missing ${missing.map((m) => m.text).join(', ')}`);
  const changedIds = kept.filter((it) => { const n = node.items.find((x) => norm(x.text) === norm(it.text)); return n && n.id !== it.id; });
  score('id-stable', changedIds.length === 0, `${label}: changed ids ${changedIds.map((c) => c.id).join(', ')}`);
  for (const w of expect.added ?? []) score('applies-request', !!findItem(node, w), `${label}: ${w} not added`);
  for (const w of expect.removed ?? []) score('applies-request', !findItem(node, w), `${label}: ${w} not removed`);
  score('text-first', textFirst(answer), label);
  ctx.prev = node;
}
const trailer = (cardId, v, ops) => `[hui:live]${JSON.stringify({ [cardId]: { v, ops } })}[/hui:live]`;
function checkHonor(answer, ctx, label, { checked = [], userAdded = [], removedByUser = [] }) {
  const prev = ctx.prev;
  const [node] = checklists(answer);
  score('no-echo', !answer.includes('[hui:live]'), `${label}: trailer echoed`);
  if (!node) { score('honor-edits', false, `${label}: no checklist`); return; }
  for (const w of checked) score('honor-edits', findItem(node, w)?.checked === true, `${label}: ${w} not checked`);
  for (const { id, text } of userAdded) score('honor-edits', node.items.some((it) => it.id === id), `${label}: ${text} (${id}) ${findItem(node, text) ? 'kept with another id' : 'dropped'}`);
  for (const w of removedByUser) score('honor-edits', !findItem(node, w), `${label}: ${w} back on the list`);
  ctx.prev = node ?? prev;
}

function idOf(ctx, word) { return findItem(ctx.prev, word)?.id ?? norm(word); }

const want = (name) => (ONLY.length ? ONLY.includes(name) : name !== 'B0');

async function run() {
  for (let rep = 1; rep <= REPS; rep++) {
    // A: create, add, user edits + request, trailer-only thanks, then a new list (new client, live.md loaded)
    if (want('A')) await conversation(`A${rep}`, NEW, [
      { text: CREATE, check: (a, c) => checkCreate(a, c, `A${rep}.1`) },
      { text: 'Pack noch Grillkohle und Senf dazu.', check: (a, c) => checkUpdate(a, c, `A${rep}.2`, { added: ['Grillkohle', 'Senf'] }) },
      {
        text: (c) => `Die Tomaten brauch ich doch nicht mehr.\n\n${trailer(c.prev?.id ?? 'einkauf', 2, [{ check: idOf(c, 'Milch') }, { add: { id: 'u-k3f9a', text: 'Brot vom Bäcker' } }, { del: idOf(c, 'Käse') }])}`,
        check: (a, c) => {
          const label = `A${rep}.3`;
          const before = c.prev;
          checkUpdate(a, c, label, { removed: ['Tomaten', 'Käse'] });
          c.prev = checklists(a)[0] ?? before;
          checkHonor(a, c, label, { checked: ['Milch'], userAdded: [{ id: 'u-k3f9a', text: 'Brot vom Bäcker' }], removedByUser: ['Käse'] });
        },
      },
      {
        text: (c) => `Danke!\n\n${trailer(c.prev?.id ?? 'einkauf', 3, [{ check: idOf(c, 'Eier') }])}`,
        check: (a, c) => {
          const label = `A${rep}.4`;
          score('no-echo', !a.includes('[hui:live]'), `${label}: trailer echoed`);
          const [node] = checklists(a);
          score('no-needless-resend', !node, `${label}: re-sent the card on a thanks`);
          if (node) { score('honor-edits', findItem(node, 'Eier')?.checked === true, `${label}: Eier not checked`); c.prev = node; }
        },
      },
      {
        text: 'Mach mir jetzt noch eine Packliste für das Wochenende in Rom.',
        check: (a, c) => {
          const label = `A${rep}.5`;
          checkJson(a, label);
          const [node] = checklists(a);
          score('new-list-new-id', !!node && node.id !== c.prev?.id, `${label}: ${node ? `id ${node.id} (shopping ${c.prev?.id})` : 'no checklist'}`);
        },
      },
    ]);
    // B: old app (no capability line): no live fields, still a checklist node. B0: the same with the previous skill
    // release (baseline). Both get references/plan.md as if loaded (the test instance has no skill_view tool).
    for (const [name, cond] of [['B', { features: false, plan: true }], ['B0', { features: false, plan: true, old: true }]]) {
      if (name === 'B0' && !OLD_SKILL) continue;
      if (!want(name)) continue;
      await conversation(`${name}-${rep}`, cond, [
        { text: CREATE, check: (a) => { checkJson(a, `${name}-${rep}.1`); const [n] = checklists(a); score(`${name === 'B0' ? 'baseline-' : ''}old-client-no-live`, !n || n.live === undefined, `${name}-${rep}.1: live=${n?.live}`); score(`${name === 'B0' ? 'baseline-' : ''}old-client-checklist`, !!n, `${name}-${rep}.1: no checklist`); } },
        { text: 'Pack noch Grillkohle dazu.', check: (a) => { checkJson(a, `${name}-${rep}.2`); const [n] = checklists(a); score(`${name === 'B0' ? 'baseline-' : ''}old-client-no-live`, !n || n.live === undefined, `${name}-${rep}.2: live=${n?.live}`); } },
      ]);
    }
    // C: one-off question list (new client): should stay plain
    if (want('C')) await conversation(`C${rep}`, NEW, [
      { text: 'Was brauche ich für Pfannkuchen? Kurz als Liste zum Einkaufen.', check: (a) => { const [n] = checklists(a); score('one-off-plain', !n || n.live !== true, `C${rep}.1: live=${n?.live}`); } },
    ]);
    // D: core only (the model did not load live.md): create, then user edits with a request
    if (want('D')) await conversation(`D${rep}`, { features: true, ref: false }, [
      { text: CREATE, check: (a, c) => checkCreate(a, c, `D${rep}.1`) },
      {
        text: (c) => `Senf noch dazu.\n\n${trailer(c.prev?.id ?? 'einkauf', 1, [{ check: idOf(c, 'Milch') }, { add: { id: 'u-p2x7q', text: 'Olivenöl' } }])}`,
        check: (a, c) => {
          const before = c.prev;
          checkUpdate(a, c, `D${rep}.2`, { added: ['Senf'] });
          checkHonor(a, { prev: before }, `D${rep}.2`, { checked: ['Milch'], userAdded: [{ id: 'u-p2x7q', text: 'Olivenöl' }] });
        },
      },
    ]);
  }
}

await run();
const table = Object.entries(results).map(([rule, r]) => ({ rule, pass: r.pass, total: r.total, rate: r.total ? Math.round((r.pass / r.total) * 100) : 0, fails: r.fails }));
const report = { model: MODEL, reps: REPS, calls, at: new Date().toISOString(), results: table, transcripts };
if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 2));
for (const r of table) console.log(`${r.rule.padEnd(20)} ${String(r.pass).padStart(3)}/${String(r.total).padEnd(3)} ${String(r.rate).padStart(3)} %`);
console.log(`calls: ${calls}${DRY ? ' (dry run)' : ''}`);
