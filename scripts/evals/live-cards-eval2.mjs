#!/usr/bin/env node
// Live cards, phase 2: does the model follow the patch / trip / watchlist rules of the hermes-ui skill
// (references/live.md), and does a card survive Hermes' context compression when the app re-sends its full state?
// Runs scripted conversations against a THROWAWAY Hermes API (scripts/test-instance, never a production Hermes) and
// scores them with the APP's own code: answers go through the app's stream parser + validator, the conversation is
// folded by app/src/live (model.ts), the trailer is built by app/src/live/trailer.ts, and the compression case reads
// the stored transcript through the app's session mapping. Fake content only. The API key is read from a file.
//
//   node scripts/evals/live-cards-eval2.mjs --api http://127.0.0.1:28642 --key-file /tmp/key \
//     [--only P,T,W,O,L,L0] [--reps 2] [--model claude-sonnet-5-5] [--out report.json] [--dry-run]
//
// System messages per call = what app + bridge send: bootstrap, skill core inline, the app's capability line (or none
// for an "old app"), and the reference(s) as a skill_view result (the test instance has no skill_view tool).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { buildSkillMessage } from '../../bridge/src/skillInline.mjs';
import { parseMessage } from '../../app/src/protocol/streamParser.ts';
import { liveEventsOf, hermesMayHaveLost } from '../../app/src/live/extract.ts';
import { foldLive, headOf, normText } from '../../app/src/live/model.ts';
import { decodeOps } from '../../app/src/live/codec.ts';
import { budgetBatch, splitLiveTrailer, withLiveTrailer } from '../../app/src/live/trailer.ts';
import { mapRemoteMessages } from '../../app/src/hermes/sessionMapping.ts';
import { parseMessages } from '../../app/src/hermes/sessions.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const API = opt('--api', 'http://127.0.0.1:28642');
const KEY_FILE = opt('--key-file', '');
const REPS = Number(opt('--reps', '1'));
const OUT = opt('--out', '');
const DRY = args.includes('--dry-run');
const ONLY = opt('--only', 'P,T,W,O').split(',').filter(Boolean);
const MODEL = opt('--model', 'hermes-agent');
const FILLER_TURNS = Number(opt('--filler', '8'));
// the compression case's last request: `add` (new items only) or `tech` (needs to know what is on the card)
const L_REQ = opt('--lreq', 'add');

const BOOTSTRAP = readFileSync(join(ROOT, 'hermes-skill/bootstrap-system-message.txt'), 'utf8').trim();
const SKILL = buildSkillMessage(readFileSync(join(ROOT, 'hermes-skill/hermes-ui/SKILL.md'), 'utf8'));
const ref = (name) => `[hermes-ui-skill] skill_view("hermes-ui", file_path="references/${name}.md") returned:\n\n` + readFileSync(join(ROOT, `hermes-skill/hermes-ui/references/${name}.md`), 'utf8').trim();
const FEATURES = /HERMES_FEATURES_MESSAGE\s*=\s*'([^']+)'/.exec(readFileSync(join(ROOT, 'app/src/hermes/bootstrap.ts'), 'utf8'))[1];

function systemMessages(cond, extra = []) {
  const out = [BOOTSTRAP, SKILL, ...(cond.refs ?? []).map(ref)];
  if (cond.features) out.push(FEATURES);
  return [...out, ...extra].map((content) => ({ role: 'system', content }));
}

let calls = 0;
const usage = { prompt: 0, completion: 0, models: new Set() };
async function turn(session, cond, text, extraSystem = []) {
  calls++;
  if (DRY) return { text: '', ms: 0 };
  const key = readFileSync(KEY_FILE, 'utf8').trim();
  const t0 = Date.now();
  const res = await fetch(`${API}/v1/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Hermes-Session-Id': session, 'X-Hermes-Session-Key': 'hermes-ui' },
    body: JSON.stringify({ model: MODEL, stream: false, messages: [...systemMessages(cond, extraSystem), { role: 'user', content: text }] }),
    signal: AbortSignal.timeout(300_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  usage.prompt += body?.usage?.prompt_tokens ?? 0;
  usage.completion += body?.usage?.completion_tokens ?? 0;
  if (body?.model) usage.models.add(body.model);
  const content = body?.choices?.[0]?.message?.content;
  return { text: typeof content === 'string' ? content : '', ms: Date.now() - t0, promptTokens: body?.usage?.prompt_tokens };
}

async function api(method, path) {
  const key = readFileSync(KEY_FILE, 'utf8').trim();
  const res = await fetch(`${API}${path}`, { method, headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(30_000) });
  return res.ok ? res.json().catch(() => ({})) : null;
}
const deleteSession = (s) => (DRY ? null : api('DELETE', `/api/sessions/${encodeURIComponent(s)}`).catch(() => null));

// ---- scoring -------------------------------------------------------------------------------------------------------
const results = {};
function score(rule, pass, note) {
  const r = (results[rule] ??= { pass: 0, total: 0, fails: [] });
  r.total++;
  if (pass) r.pass++;
  else r.fails.push(note);
}
const transcripts = [];

const FENCE = /```hui[ \t]*\n([\s\S]*?)\n```/g;
const rawBlocks = (text) => [...text.matchAll(FENCE)].map((m) => { try { return { ok: true, node: JSON.parse(m[1]) }; } catch { return { ok: false, raw: m[1] }; } });
const textFirst = (text) => { const i = text.indexOf('```hui'); return (i < 0 ? text : text.slice(0, i)).replace(/\s+/g, ' ').trim().length >= 12; };
const parse = (m) => parseMessage(m.text);
/** the item named `word`: one that starts with it first ("Vatikanische Museen", not "Anfahrt zum Vatikan") */
const has = (state, word) => state?.items.find((it) => normText(it.text).startsWith(normText(word))) ?? state?.items.find((it) => normText(it.text).includes(normText(word)));

/** One conversation as the app would hold it: messages, fold after every answer. */
class Chat {
  constructor(name, cond) {
    this.name = name;
    this.cond = cond;
    this.session = `hui-eval-${randomBytes(6).toString('hex')}`;
    this.messages = [];
    this.n = 0;
  }
  fold() { return foldLive(liveEventsOf(this.messages, parse)); }
  card(id) { return this.fold().cards.get(id ?? this.cardId); }
  state(id) { const c = this.card(id); return c ? headOf(c).state : undefined; }
  /** send `text` (+ the app's trailer for `batches`) and fold the answer */
  async say(text, { batches, types, system = [] } = {}) {
    const sent = withLiveTrailer(text, batches, types);
    const before = this.fold();
    this.n++;
    const { text: answer, ms, promptTokens } = await turn(this.session, this.cond, sent, system);
    // own ids (never the stored `hu-<row>` / `ha-<row>` ones the compression case switches to)
    const uid = `eu-${this.n}`;
    const aid = `ea-${this.n}`;
    const split = splitLiveTrailer(sent);
    this.messages.push({ id: uid, role: 'user', text: split.text, ...(split.batches ? { live: split.batches } : {}), tools: [], status: 'done', createdAt: this.n * 2 });
    this.messages.push({ id: aid, role: 'assistant', text: answer, tools: [], status: 'done', createdAt: this.n * 2 + 1 });
    const after = this.fold();
    const marks = after.marks.get(aid) ?? [];
    const segs = parseMessage(answer);
    const patches = segs.filter((s) => s.kind === 'hui' && s.node?.type === 'callout' && s.node.livePatch).map((s) => s.node);
    transcripts.push({ name: this.name, user: sent, answer, ms, promptTokens, marks });
    for (const b of rawBlocks(answer)) score('valid-json', b.ok, `${this.name}.${this.n}: ${String(b.raw).slice(0, 80)}`);
    score('no-echo', !answer.includes('[hui:live]'), `${this.name}.${this.n}: trailer echoed`);
    return { answer, before, after, marks, patches, raw: rawBlocks(answer).filter((b) => b.ok).map((b) => b.node) };
  }
  async close() { await deleteSession(this.session); }
}

const label = (c) => `${c.name}.${c.n}`;
function checkCreate(c, r, type, label_) {
  const m = r.marks.find((x) => !x.unchanged && x.n === 1);
  const card = m ? r.after.cards.get(m.card) : undefined;
  score(`create-live-${type}`, !!card && card.type === type, `${label_}: ${card ? `${card.id}:${card.type}` : 'no live card'} ${JSON.stringify(r.raw.map((n) => ({ type: n.type, id: n.id, live: n.live })))}`);
  const node = r.raw.find((n) => n.live === true);
  const items = node ? (node.items ?? node.products ?? node.blocks ?? (node.tabs ?? []).flatMap((t) => (t.children ?? []).flatMap((k) => k.blocks ?? []))) : [];
  const ids = node && items.length > 0 && items.every((it) => typeof it.id === 'string' && it.id) && (node.type !== 'tabs' || node.tabs.every((t) => typeof t.id === 'string'));
  score('item-ids', !!ids, `${label_}: ids missing`);
  score('text-first', textFirst(r.answer), label_);
  return card?.id;
}
/** an update of the card: same card, request applied, nothing else lost; patch or full is recorded */
function checkUpdate(c, r, { added = [], removed = [], keepAll = true, expectPatch, check } = {}) {
  const l = label(c);
  const m = r.marks.find((x) => x.card === c.cardId && !x.unchanged);
  score('update-same-card', !!m, `${l}: ${JSON.stringify(r.marks)} raw=${JSON.stringify(r.raw.map((n) => ({ type: n.type, id: n.id, live: n.live, card: n.livePatch?.card })))}`);
  score('no-second-card', r.after.cards.size === r.before.cards.size, `${l}: new card(s) ${[...r.after.cards.keys()].filter((k) => !r.before.cards.has(k))}`);
  const v = m ? r.after.cards.get(c.cardId).versions[m.n - 1] : undefined;
  const isPatch = !!v?.patch;
  if (expectPatch !== undefined) score(expectPatch ? 'patch-when-small' : 'full-when-asked', expectPatch ? isPatch : !!v && !isPatch, `${l}: ${v ? (isPatch ? 'patch' : 'full') : 'none'}`);
  for (const p of r.patches) {
    const rawOps = r.raw.find((n) => n.livePatch)?.livePatch?.ops ?? [];
    const decoded = decodeOps(rawOps, 100);
    score('patch-valid-ops', decoded.length === rawOps.length && p.livePatch.card === c.cardId, `${l}: ${rawOps.length} raw, ${decoded.length} decoded, card ${p.livePatch.card}`);
    const prev = headOf(r.before.cards.get(c.cardId) ?? { versions: [{ state: { items: [] } }] }).state;
    const ids = new Set(prev.items.map((it) => it.id));
    const unknown = decoded.filter((op) => !('add' in op) && !('meta' in op) && !('close' in op) && (op.set ?? op.del ?? op.check ?? op.uncheck ?? op.move) && !ids.has(op.set ?? op.del ?? op.check ?? op.uncheck ?? op.move));
    score('patch-known-ids', unknown.length === 0, `${l}: unknown ${JSON.stringify(unknown)}`);
    score('patch-readable', typeof p.text === 'string' && p.text.trim().length > 2, `${l}: callout text '${p.text}'`);
    score('patch-never-user-fields', !decoded.some((op) => 'set' in op && ('target' in op || 'userNote' in op || 'hidden' in op)), `${l}: set a user field`);
  }
  const s = r.after.cards.get(c.cardId) ? headOf(r.after.cards.get(c.cardId)).state : undefined;
  for (const w of added) score('applies-request', !!has(s, w), `${l}: ${w} not added`);
  for (const w of removed) score('applies-request', !has(s, w), `${l}: ${w} not removed`);
  if (keepAll && s) {
    const prev = headOf(r.before.cards.get(c.cardId)).state;
    const lost = prev.items.filter((it) => !removed.some((w) => normText(it.text).includes(normText(w))) && !s.items.some((x) => x.id === it.id));
    score('keeps-rest', lost.length === 0, `${l}: lost ${lost.map((x) => x.text).join(', ')}`);
  }
  if (check && s) check(s, l);
  score('text-first', textFirst(r.answer), l);
}

// ---- scenarios -----------------------------------------------------------------------------------------------------
const NEW = (refs) => ({ features: true, refs: ['live', ...refs] });
const BIG_LIST = 'Tomaten, Gurke, Paprika, Zwiebeln, Knoblauch, Kartoffeln, Äpfel, Bananen, Zitronen, Milch, Butter, Joghurt, Käse, Eier, Mozzarella, Brot, Brötchen, Nudeln, Reis, Mehl, Zucker, Kaffee, Tee, Olivenöl, Senf, Ketchup, Spülmittel';

async function scenarioP(rep) {
  const c = new Chat(`P${rep}`, NEW(['plan']));
  try {
    let r = await c.say(`Mach mir eine Einkaufsliste für die ganze Woche, die ich über die Woche weiterführe: ${BIG_LIST}.`);
    c.cardId = checkCreate(c, r, 'checklist', label(c));
    if (!c.cardId) return;
    r = await c.say('Pack noch Grillkohle dazu, und die Gurke brauch ich nicht mehr.');
    checkUpdate(c, r, { added: ['Grillkohle'], removed: ['Gurke'], expectPatch: true });
    // the user ticked two things and added their own item in the app
    const milch = has(c.state(), 'Milch')?.id ?? 'milch';
    const eier = has(c.state(), 'Eier')?.id ?? 'eier';
    r = await c.say('Ändere bei den Eiern die Menge auf 10.', { batches: { [c.cardId]: { v: headOf(c.card()).n, ops: [{ check: milch }, { add: { id: 'u-k3f9a', text: 'Brot vom Bäcker' } }], bid: `b-${rep}a` } } });
    checkUpdate(c, r, { expectPatch: true, check: (s, l) => {
      score('applies-request', String(has(s, 'Eier')?.qty ?? '') === '10', `${l}: Eier qty ${has(s, 'Eier')?.qty}`);
      score('honor-edits', has(s, 'Milch')?.checked === true && s.items.some((it) => it.id === 'u-k3f9a'), `${l}: tick or own item lost`);
    } });
    // the router asks for a full version (10 patches in a row)
    r = await c.say('Setz noch Wasser auf die Liste.', { system: [`UI-ROUTER-HINT: format=checklist card=${c.cardId} full confidence=0.9`] });
    checkUpdate(c, r, { added: ['Wasser'], expectPatch: false, check: (s, l) => score('honor-edits', has(s, 'Milch')?.checked === true && s.items.some((it) => it.id === 'u-k3f9a'), `${l}: tick or own item lost in the full version`) });
  } catch (e) {
    score('no-error', false, `${c.name}: ${e.message}`);
  } finally {
    await c.close();
  }
}

async function scenarioT(rep) {
  const c = new Chat(`T${rep}`, NEW(['places', 'plan']));
  try {
    let r = await c.say('Plane mir drei Tage Rom vom 13. bis 15. November als Reiseplan, den wir die nächsten Tage zusammen weiter anpassen. Am Samstag will ich Kolosseum, Forum Romanum und die Vatikanischen Museen am Nachmittag sehen, Sonntag das Pantheon.');
    c.cardId = checkCreate(c, r, 'trip', label(c));
    if (!c.cardId) return;
    const s1 = c.state();
    score('trip-days', (s1.days?.length ?? 0) >= 3 && s1.items.every((it) => it.day && s1.days.some((d) => d.id === it.day)), `${label(c)}: days ${JSON.stringify(s1.days)}`);
    const vat = has(s1, 'Vatikanische');
    const kol = has(s1, 'Kolosseum');
    if (!vat || !kol) { score('trip-content', false, `${label(c)}: no Vatikan/Kolosseum block`); return; }
    // the user marked the Colosseum done and wrote an own note on the Vatican block
    r = await c.say('Für Samstag ist ab Mittag Regen gemeldet. Zieh die Vatikanischen Museen auf den Vormittag vor und das Draußen-Programm auf den Nachmittag.', {
      batches: { [c.cardId]: { v: headOf(c.card()).n, ops: [{ check: kol.id }, { set: vat.id, userNote: 'Tickets online gekauft' }], bid: `b-${rep}t` } },
      types: { [c.cardId]: 'trip' },
    });
    checkUpdate(c, r, { check: (s, l) => {
      const v = s.items.find((it) => it.id === vat.id);
      score('applies-request', !!v && v.day === vat.day && v.start < vat.start && v.start < '13:00', `${l}: Vatikan ${vat.start} → ${v?.start} (${v?.day})`);
      score('honor-edits', v?.userNote === 'Tickets online gekauft' && s.items.find((it) => it.id === kol.id)?.checked === true, `${l}: userNote ${v?.userNote}, Kolosseum ${s.items.find((it) => it.id === kol.id)?.checked}`);
    } });
    const pan = has(c.state(), 'Pantheon');
    const forum = has(c.state(), 'Forum');
    r = await c.say('Verschieb das Forum Romanum auf Sonntag, nach dem Pantheon.');
    checkUpdate(c, r, { check: (s, l) => {
      const f = s.items.find((it) => it.id === forum?.id) ?? has(s, 'Forum');
      score('applies-request', !!f && !!pan && f.day === pan.day, `${l}: Forum on ${f?.day}, Pantheon on ${pan?.day}`);
      score('honor-edits', s.items.find((it) => it.id === vat.id)?.userNote === 'Tickets online gekauft', `${l}: userNote lost`);
    } });
  } catch (e) {
    score('no-error', false, `${c.name}: ${e.message}`);
  } finally {
    await c.close();
  }
}

async function scenarioW(rep) {
  const c = new Chat(`W${rep}`, NEW(['products']));
  try {
    let r = await c.say('Ich will diese Kopfhörer im Blick behalten, bis einer günstig wird. Leg mir eine Watchlist an, die du aktualisierst. Preise von heute laut Händlerseiten: Sony WH-1000XM5 269 €, Bose QuietComfort Ultra 349 €, Sennheiser Momentum 4 259 €.');
    c.cardId = checkCreate(c, r, 'products', label(c));
    if (!c.cardId) return;
    const sony = has(c.state(), 'Sony') ?? has(c.state(), 'XM5');
    if (!sony) { score('watch-content', false, `${label(c)}: no Sony`); return; }
    r = await c.say('Neue Preise laut Händlerseiten von heute: Sony 239 €, Sennheiser 279 €, Bose unverändert.', {
      batches: { [c.cardId]: { v: headOf(c.card()).n, ops: [{ set: sony.id, target: 249 }], bid: `b-${rep}w` } },
      types: { [c.cardId]: 'products' },
    });
    checkUpdate(c, r, { expectPatch: true, check: (s, l) => {
      const x = s.items.find((it) => it.id === sony.id);
      score('applies-request', x?.price === 239 && has(s, 'Sennheiser')?.price === 279, `${l}: Sony ${x?.price}, Sennheiser ${has(s, 'Sennheiser')?.price}`);
      score('honor-edits', x?.target === 249, `${l}: target ${x?.target}`);
      const lead = r.answer.split('```')[0];
      score('watch-target-first', /wunschpreis|zielpreis|unter deine/i.test(lead), `${l}: '${lead.slice(0, 120)}'`);
    } });
  } catch (e) {
    score('no-error', false, `${c.name}: ${e.message}`);
  } finally {
    await c.close();
  }
}

/** old app: no capability line, the reference loaded: never `live`, never talk about live cards */
async function scenarioO(rep) {
  const c = new Chat(`O${rep}`, { features: false, refs: ['places', 'plan'] });
  try {
    for (const text of ['Plane mir zwei Tage Rom als Reiseplan, den wir die nächsten Tage weiter anpassen.', 'Mach mir eine Einkaufsliste, die ich die Woche über weiterführe: Milch, Brot, Käse.']) {
      const r = await c.say(text);
      const live = r.raw.some((n) => n.live === true || n.livePatch);
      score('old-client-no-live', !live, `${label(c)}: ${JSON.stringify(r.raw.map((n) => ({ type: n.type, live: n.live })))}`);
      score('old-client-no-mention', !/\blive\b|live-karte|fortschreib|nicht (?:automatisch|selbst) aktualisier/i.test(r.answer.split('```')[0]), `${label(c)}: '${r.answer.split('```')[0].slice(0, 160)}'`);
      score('old-client-node', r.raw.length > 0, `${label(c)}: no node`);
    }
  } catch (e) {
    score('no-error', false, `${c.name}: ${e.message}`);
  } finally {
    await c.close();
  }
}

// long chat: a live list, then long unrelated turns until Hermes compresses its context, then an edit request with
// (L) the app's full-state trailer or (L0) only the edit, as phase 1 would have sent it
const FILLER = Array.from({ length: 40 }, (_, i) => `Absatz ${i + 1}: Die Stadtbibliothek von Beispielstadt plant für das Jahr ${2030 + (i % 7)} eine neue Leseecke mit ${12 + i} Sesseln, ${3 + (i % 5)} Lesetischen und einer kleinen Ausstellung über die Geschichte des Buchdrucks. Die Kosten werden auf ${(i + 3) * 1000} Euro geschätzt, getragen von einem Förderverein mit ${80 + i * 3} Mitgliedern, der jeden zweiten Dienstag tagt.`).join(' ');
async function scenarioL(rep, withState) {
  const c = new Chat(`${withState ? 'L' : 'L0'}${rep}`, NEW(['plan']));
  try {
    let r = await c.say('Mach mir eine Packliste für die Wanderwoche in den Alpen, die ich bis zur Abreise weiterführe: Wanderschuhe, Regenjacke, Fleecepulli, Mütze, Handschuhe, Sonnencreme, Sonnenbrille, Trinkflasche, Erste-Hilfe-Set, Stirnlampe, Ladekabel, Powerbank, Ausweis, Hüttenschlafsack.');
    c.cardId = checkCreate(c, r, 'checklist', label(c));
    if (!c.cardId) return;
    const before = c.state();
    let tokens = [];
    for (let i = 0; i < FILLER_TURNS; i++) {
      r = await c.say(`Anderes Thema. Hier ein Text aus unserem Vereinsblatt, fasse ihn in einem Satz zusammen:\n\n${FILLER}`);
      tokens.push(transcripts.at(-1).promptTokens ?? 0);
    }
    // what the app sees in the stored transcript
    const page = await api('GET', `/api/sessions/${encodeURIComponent(c.session)}/messages?order=latest&limit=500&include_compacted=true`);
    const remote = page ? mapRemoteMessages(parseMessages(page, c.session).messages) : [];
    const cut = remote.some((m) => m.contextCut);
    score('compaction-seen-by-app', cut, `${c.name}: prompt tokens ${tokens.join(',')}; ${remote.length} mapped messages`);
    // the app folds the stored transcript; the card is the same
    const fold = foldLive(liveEventsOf(remote, parse));
    const card = fold.cards.get(c.cardId);
    score('fold-from-stored', !!card && headOf(card).state.items.length === before.items.length, `${c.name}: stored fold ${card ? headOf(card).state.items.length : 'none'} vs ${before.items.length}`);
    const lost = card ? hermesMayHaveLost(remote, card) : false;
    score('app-detects-loss', lost, `${c.name}: hermesMayHaveLost false`);
    // the user ticked two items in the app; the message is an edit request (focus heuristic → snapshot if lost)
    const ops = [{ check: has(before, 'Ausweis')?.id ?? 'ausweis' }, { check: has(before, 'Sonnencreme')?.id ?? 'sonnencreme' }];
    const view = { ...before, items: before.items.map((it) => (ops.some((o) => o.check === it.id) ? { ...it, checked: true } : it)) };
    const { batch } = budgetBatch({ v: headOf(c.card()).n, ops, bid: `b-${rep}l`, snapshot: withState && lost }, view);
    c.messages = remote.length ? remote : c.messages;
    const tech = L_REQ === 'tech';
    r = await c.say(tech ? 'Ladekabel und Powerbank lasse ich zu Hause, und was sonst noch zur Technik gehört auch. Nimm das raus.' : 'Pack noch Blasenpflaster und eine Wanderkarte dazu.', { batches: { [c.cardId]: batch } });
    const rule = `${withState ? 'after-compaction-state' : 'baseline-after-compaction-ops'}${tech ? '-tech' : ''}`;
    const m = r.marks.find((x) => x.card === c.cardId && !x.unchanged);
    const s = c.state();
    const techItems = before.items.filter((it) => /technik/i.test(it.category ?? '') || /ladekabel|powerbank/i.test(it.text));
    const missing = before.items.filter((it) => !(tech && techItems.includes(it)) && !s?.items.some((x) => x.id === it.id));
    score(`${rule}-same-card`, !!m && r.after.cards.size === r.before.cards.size, `${label(c)}: ${JSON.stringify(r.marks)}`);
    score(`${rule}-keeps-all`, !!m && missing.length === 0, `${label(c)}: missing ${missing.map((x) => x.text).join(', ')}`);
    score(`${rule}-applies`, tech ? techItems.length > 0 && techItems.every((it) => !s?.items.some((x) => x.id === it.id)) : !!has(s, 'Blasenpflaster') && !!has(s, 'Wanderkarte'), `${label(c)}: request not applied (${techItems.map((x) => `${x.text}${s?.items.some((y) => y.id === x.id) ? ' still there' : ''}`).join(', ')})`);
    for (const p of r.patches) {
      const ids = new Set(before.items.map((it) => it.id));
      const unknown = p.livePatch.ops.filter((op) => !('add' in op) && (op.del ?? op.set ?? op.check) && !ids.has(op.del ?? op.set ?? op.check));
      score(`${rule}-known-ids`, unknown.length === 0, `${label(c)}: unknown ${JSON.stringify(unknown)}`);
    }
    score(`${rule}-ticks`, has(s, 'Ausweis')?.checked === true && has(s, 'Sonnencreme')?.checked === true, `${label(c)}: ticks lost`);
    transcripts.push({ name: c.name, note: 'compaction', promptTokens: tokens, cut, lost, snapshot: !!batch.state });
  } catch (e) {
    score('no-error', false, `${c.name}: ${e.message}`);
  } finally {
    await c.close();
  }
}

for (let rep = 1; rep <= REPS; rep++) {
  if (ONLY.includes('P')) await scenarioP(rep);
  if (ONLY.includes('T')) await scenarioT(rep);
  if (ONLY.includes('W')) await scenarioW(rep);
  if (ONLY.includes('O')) await scenarioO(rep);
  if (ONLY.includes('L')) await scenarioL(rep, true);
  if (ONLY.includes('L0')) await scenarioL(rep, false);
}
const table = Object.entries(results).map(([rule, r]) => ({ rule, pass: r.pass, total: r.total, rate: r.total ? Math.round((r.pass / r.total) * 100) : 0, fails: r.fails }));
const report = { model: MODEL, servedBy: [...usage.models], reps: REPS, calls, usage: { prompt: usage.prompt, completion: usage.completion }, at: new Date().toISOString(), results: table, transcripts };
if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 2));
for (const r of table) console.log(`${r.rule.padEnd(40)} ${String(r.pass).padStart(3)}/${String(r.total).padEnd(3)} ${String(r.rate).padStart(3)} %`);
console.log(`calls: ${calls}, prompt tokens ${usage.prompt}, completion ${usage.completion}, served by ${[...usage.models].join(',') || '?'}${DRY ? ' (dry run)' : ''}`);
