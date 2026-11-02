// 0.3 trustworthy live cards: every state a user's edit can be in (pending, sent, applied, changed back by Hermes,
// not applied, sent again), the round trip through the send path, a turn that breaks off, an app restart and a second
// device that only knows Hermes' stored history. The rule under test: an edit is never lost and never applied twice,
// whether Hermes stored the broken-off turn or not, and every device folds the same history to the same card.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ChatMessage } from '../hermes/types.ts';
import { mapRemoteMessages } from '../hermes/sessionMapping.ts';
import type { RemoteMessage } from '../hermes/sessions.ts';
import { parseMessage } from '../protocol/streamParser.ts';
import { reconcileTranscript } from '../conversations/remoteSync.ts';
import { deriveCards, type LiveCardModel } from './derive.ts';
import { answerTurnState, batchTurns, liveEventsOf, LOST_BATCH_MS, turnOfBatch } from './extract.ts';
import { EMPTY_RECORD, parseRecord, type LiveLocalRecord } from './localStore.ts';
import { foldLive, headOf, type LiveFold, type LiveOp, type UserBatch } from './model.ts';
import { addPendingOp, afterAccepted, returnInflight, settleInflight, type PendingCard } from './pending.ts';
import { batchOutcome, messageOutcomes, nearText, openUndone } from './receipts.ts';
import { acceptSend, planSend, settleRecord } from './sendPlan.ts';
import { decodeBatches, MAX_RESENT, splitLiveTrailer, withLiveTrailer } from './trailer.ts';

const parse = (m: ChatMessage) => parseMessage(m.text);
const user = (id: string, text: string, at: number, live?: Record<string, UserBatch>): ChatMessage => ({ id, role: 'user', text, tools: [], status: 'done', createdAt: at, ...(live ? { live } : {}) });
const answer = (id: string, text: string, at: number, extra: Partial<ChatMessage> = {}): ChatMessage => ({ id, role: 'assistant', text, tools: [], status: 'done', createdAt: at, metrics: { endedAt: at + 1 }, ...extra });
const card = (items: { id: string; text: string; checked?: boolean }[], title = 'Einkauf') =>
  '```hui\n' + JSON.stringify({ type: 'checklist', id: 'einkauf', live: true, title, items }) + '\n```';
const V1 = [
  { id: 'milch', text: 'Milch' },
  { id: 'brot', text: 'Brot' },
  { id: 'tomaten', text: 'Tomaten' },
];
const START: ChatMessage[] = [user('hu-1', 'Mach mir eine Einkaufsliste für Samstag', 100), answer('ha-2', `Hier ist deine Liste.\n\n${card(V1)}`, 110)];

/** One device: its transcript and its local record, folded like LiveProvider does. */
interface Device {
  messages: ChatMessage[];
  rec: LiveLocalRecord;
}
function look(d: Device): { fold: LiveFold; cards: Map<string, LiveCardModel> } {
  const skip = new Set(Object.values(d.rec.pending).flatMap((p) => p.resend ?? []));
  const fold = foldLive(liveEventsOf(d.messages, parse), { skip });
  return { fold, cards: new Map(deriveCards(fold, d.rec, d.messages).map((c) => [c.id, c])) };
}
const items = (m: LiveCardModel | undefined) => (m?.view.state.items ?? []).map((it) => `${it.text}${it.checked ? ' ✓' : ''}`);
const headItems = (f: LiveFold, id = 'einkauf') => headOf(f.cards.get(id)!).state.items.map((it) => `${it.text}${it.checked ? ' ✓' : ''}`);
function edit(d: Device, op: LiveOp): void {
  const { fold } = look(d);
  d.rec = { ...d.rec, pending: { ...d.rec.pending, einkauf: addPendingOp(d.rec.pending.einkauf, op, headOf(fold.cards.get('einkauf')!).n) } };
}
/** Send `text` from the device: plan, the user message (+ the answer placeholder), Hermes takes it. Returns the plan. */
function send(d: Device, id: string, text: string, at: number) {
  const plan = planSend({ rec: d.rec, models: Array.from(look(d).cards.values()), focus: null, text, messages: d.messages, now: at });
  d.messages = [...d.messages, user(id, text, at, plan && Object.keys(plan.batches).length ? plan.batches : undefined), answer(`${id}-a`, '', at + 1, { status: 'streaming', metrics: undefined })];
  if (plan) d.rec = acceptSend(d.rec, plan);
  d.rec = settleRecord(d.rec, d.messages, at + 2);
  return plan;
}
/** The running answer ends: done with `text`, or broken off (error / user stop). */
function finish(d: Device, text: string, how: 'done' | 'error' | 'stopped' = 'done'): void {
  const last = d.messages[d.messages.length - 1];
  d.messages = [...d.messages.slice(0, -1), { ...last, text, status: how, metrics: { endedAt: last.createdAt + 5 } }];
  d.rec = settleRecord(d.rec, d.messages, last.createdAt + 6);
}
/** What another device gets from Hermes' stored session: the user texts with their `[hui:live]` trailers. */
function storedHistory(messages: readonly ChatMessage[], opts: { drop?: readonly string[] } = {}): ChatMessage[] {
  const rows: RemoteMessage[] = [];
  let n = 1;
  for (const m of messages) {
    if (opts.drop?.includes(m.id)) continue;
    if (m.role === 'user') rows.push({ id: String(n++), role: 'user', content: withLiveTrailer(m.text, m.live), timestamp: m.createdAt });
    else if (m.text) rows.push({ id: String(n++), role: 'assistant', content: m.text, timestamp: m.createdAt, finishReason: 'stop' });
  }
  return mapRemoteMessages(rows);
}

// ---- trailer ----------------------------------------------------------------------------------------------------

test('trailer: `re` goes along and back, capped, junk dropped; a batch with only `re` survives decoding', () => {
  const text = withLiveTrailer('Danke', { einkauf: { v: 2, ops: [{ check: 'milch' }], bid: 'b-2', re: ['b-1'] } });
  assert.deepEqual(splitLiveTrailer(text).batches, { einkauf: { v: 2, ops: [{ check: 'milch' }], bid: 'b-2', re: ['b-1'] } });
  const many = Array.from({ length: 12 }, (_, i) => `b-${i}`);
  const d = decodeBatches({ einkauf: { v: 1, ops: [{ check: 'milch' }], re: [...many, 7, '', 'x'.repeat(41)] } })!;
  assert.equal(d.einkauf.re!.length, MAX_RESENT);
  assert.deepEqual(d.einkauf.re, many.slice(0, MAX_RESENT));
  // the user undid what was sent again: only the old batch is named, so every device skips it
  assert.deepEqual(decodeBatches({ einkauf: { v: 1, ops: [], bid: 'b-3', re: ['b-1'] } }), { einkauf: { v: 1, ops: [], bid: 'b-3', re: ['b-1'] } });
  assert.equal(decodeBatches({ einkauf: { v: 1, ops: [], bid: 'b-3' } }), undefined);
});

// ---- turn states ------------------------------------------------------------------------------------------------

test('answerTurnState: streaming or being recovered = running, done, error and a user stop = failed', () => {
  const a = (extra: Partial<ChatMessage>) => answer('a', 'x', 1, extra);
  assert.equal(answerTurnState(a({ status: 'streaming' }), true), 'running');
  assert.equal(answerTurnState(a({}), true), 'done');
  assert.equal(answerTurnState(a({ status: 'error' }), true), 'failed');
  assert.equal(answerTurnState(a({ status: 'stopped' }), true), 'failed', 'stop pressed: it has an end time');
  assert.equal(answerTurnState(a({ status: 'stopped', interrupted: 5 }), true), 'running', 'stream lost, being recovered');
  assert.equal(answerTurnState(a({ status: 'stopped', metrics: undefined }), true), 'running', 'persisted mid-stream (app killed)');
  assert.equal(answerTurnState(a({ status: 'error', interrupted: 5 }), true), 'failed', 'recovery gave up');
  assert.equal(answerTurnState(undefined, true), 'running', 'the user message is the last one: its answer comes');
  assert.equal(answerTurnState(undefined, false), 'failed', 'another user message follows without an answer');
});

test('turnOfBatch: from the transcript; a batch it lacks only fails once nothing runs and it is clearly lost', () => {
  const msgs = [...START, user('hu-3', 'Danke', 200, { einkauf: { v: 1, ops: [{ check: 'milch' }], bid: 'b-1' } }), answer('ha-4', 'Gern.', 210)];
  const turns = batchTurns(msgs);
  assert.equal(turnOfBatch(turns, msgs, 'b-1'), 'done');
  // the chat is not loaded yet (start-up): nothing is decided
  assert.equal(turnOfBatch(new Map(), [], 'b-9', 150, 10_000_000), 'none');
  // not in the transcript, but a turn is running: wait
  const running = [...msgs, user('hu-5', 'Noch was', 300)];
  assert.equal(turnOfBatch(batchTurns(running), running, 'b-9', 290, 10_000_000), 'none');
  // accepted at 205, the transcript lacks it and has a newer message: the app stopped before it saved the turn
  assert.equal(turnOfBatch(turns, msgs, 'b-9', 205, 206), 'failed');
  // accepted after everything in the transcript: wait a while, then count it as lost (never "Hermes antwortet" for good)
  assert.equal(turnOfBatch(turns, msgs, 'b-9', 400, 401), 'none');
  assert.equal(turnOfBatch(turns, msgs, 'b-9', 400, 400 + LOST_BATCH_MS), 'failed');
  // kept by 0.2 (no acceptance time) and still missing
  assert.equal(turnOfBatch(turns, msgs, 'b-9', undefined, 401), 'failed');
});

// ---- pending: in flight, back to pending -------------------------------------------------------------------------

test('settleInflight: done drops, broken off gives back with `re`, running and unknown wait', () => {
  const p: PendingCard = { base: 2, ops: [{ add: { id: 'u-2', text: 'Eier' } }], bid: 'b-2', inflight: { bid: 'b-1', base: 1, ops: [{ check: 'milch' }], at: 5 } };
  assert.deepEqual(settleInflight(p, () => 'done'), { base: 2, ops: [{ add: { id: 'u-2', text: 'Eier' } }], bid: 'b-2' });
  assert.equal(settleInflight(p, () => 'running'), p);
  assert.equal(settleInflight(p, () => 'none'), p);
  // the sent ops come first again, from their old base; the next batch names b-1
  assert.deepEqual(settleInflight(p, () => 'failed'), { base: 1, ops: [{ check: 'milch' }, { add: { id: 'u-2', text: 'Eier' } }], bid: 'b-2', resend: ['b-1'] });
  // nothing else pending: the whole record goes once done
  assert.equal(settleInflight({ ...p, ops: [] }, () => 'done'), undefined);
});

test('returnInflight: "Hermes fragen" without edits just goes; a card made here is sent again whole; failures add up', () => {
  assert.deepEqual(returnInflight({ base: 1, ops: [], bid: 'b-2', inflight: { bid: 'b-1', base: 1, ops: [] } }), { base: 1, ops: [], bid: 'b-2' });
  const created: PendingCard = {
    base: 1,
    ops: [],
    bid: 'b-2',
    create: { type: 'checklist', state: { title: 'Packliste', items: [{ id: 'u-1', text: 'Pass' }] }, at: 1, bid: 'b-1', sent: true },
    inflight: { bid: 'b-1', base: 1, ops: [] },
  };
  const back = returnInflight(created);
  assert.equal(back.create?.sent, false);
  assert.equal(back.create?.bid, 'b-2', 'the next send makes the card under the next batch id');
  assert.deepEqual(back.resend, ['b-1']);
  // b-2 (re: b-1) broke off too: the third send names both
  let q: PendingCard = { base: 1, ops: [{ check: 'milch' }], bid: 'b-1' };
  for (let i = 1; i <= 10; i++) {
    q = afterAccepted(q, { bid: q.bid, count: q.ops.length, at: i }, 1, () => `b-${i + 1}`)!;
    q = returnInflight(q);
  }
  assert.deepEqual(q.ops, [{ check: 'milch' }], 'the same op once, not ten times');
  assert.equal(q.resend!.length, MAX_RESENT);
  assert.deepEqual(q.resend!.slice(-2), ['b-9', 'b-10'], 'the newest are named');
});

// ---- the round trip ---------------------------------------------------------------------------------------------

test('round trip: pending → sending → saved; the line says which version', () => {
  const d: Device = { messages: [...START], rec: EMPTY_RECORD };
  edit(d, { check: 'milch' });
  let m = look(d).cards.get('einkauf')!;
  assert.equal(m.pendingCount, 1);
  assert.equal(m.sending, false);
  const plan = send(d, 'hu-3', 'Danke, Milch hab ich', 200)!;
  assert.deepEqual(plan.batches.einkauf.ops, [{ check: 'milch' }]);
  m = look(d).cards.get('einkauf')!;
  assert.equal(m.pendingCount, 0);
  assert.equal(m.sending, true, '"Mitgeschickt. Hermes antwortet …"');
  assert.deepEqual(messageOutcomes(look(d).fold, d.messages, 'hu-3').map((o) => o.state), ['waiting']);
  finish(d, `Super, Milch ist abgehakt.\n\n${card([{ id: 'milch', text: 'Milch', checked: true }, V1[1], V1[2]])}`);
  m = look(d).cards.get('einkauf')!;
  assert.equal(m.sending, false);
  assert.deepEqual(d.rec.pending, {}, 'nothing left in flight');
  const [o] = messageOutcomes(look(d).fold, d.messages, 'hu-3');
  assert.equal(o.state, 'saved');
  assert.equal(o.n, 2);
  assert.deepEqual(o.changes.map((c) => `${c.kind} ${c.text}`), ['checked Milch']);
});

for (const how of ['error', 'stopped'] as const) {
  test(`round trip: the answer breaks off (${how}) → the edits go again with \`re\` → one version, on every device`, () => {
    const a: Device = { messages: [...START], rec: EMPTY_RECORD };
    edit(a, { check: 'milch' });
    edit(a, { add: { id: 'u-eier', text: 'Eier' } });
    const first = send(a, 'hu-3', 'Setz bitte noch Eier auf die Einkaufsliste', 200)!;
    const b1 = first.batches.einkauf.bid!;
    finish(a, 'Ich habe', how);
    let m = look(a).cards.get('einkauf')!;
    assert.equal(m.pendingCount, 2, 'back to pending, nothing lost');
    assert.equal(m.resend, true, '"nicht bestätigt, geht noch einmal mit"');
    assert.deepEqual(items(m), ['Milch ✓', 'Brot', 'Tomaten', 'Eier'], 'the card still shows the edits');
    assert.deepEqual(headItems(look(a).fold), ['Milch', 'Brot', 'Tomaten'], 'the broken batch is skipped where it stands');
    assert.equal(messageOutcomes(look(a).fold, a.messages, 'hu-3')[0].state, 'resent');
    // the answer under the broken turn (it asked for a change) says so, not that Hermes kept the card unchanged
    assert.equal(look(a).fold.marks.get('hu-3-a')?.[0].broken, true);
    assert.equal(look(a).fold.marks.get('hu-3-a')?.[0].quiet, true);

    const second = send(a, 'hu-5', 'Hallo? Noch Butter bitte', 300)!;
    assert.deepEqual(second.batches.einkauf.re, [b1]);
    assert.deepEqual(second.batches.einkauf.ops, [{ check: 'milch' }, { add: { id: 'u-eier', text: 'Eier' } }]);
    finish(a, `Klar, Butter ist drauf.\n\n${card([{ id: 'milch', text: 'Milch', checked: true }, V1[1], V1[2], { id: 'u-eier', text: 'Eier' }, { id: 'butter', text: 'Butter' }])}`);
    const fa = look(a).fold;
    assert.deepEqual(a.rec.pending, {});
    assert.deepEqual(headItems(fa), ['Milch ✓', 'Brot', 'Tomaten', 'Eier', 'Butter']);

    // device B: Hermes stored the broken turn (user stop after it took it) or not; either way the same card
    for (const drop of [[], ['hu-3', 'hu-3-a']]) {
      const b: Device = { messages: storedHistory(a.messages, { drop }), rec: EMPTY_RECORD };
      const fb = look(b).fold;
      assert.deepEqual(headItems(fb), headItems(fa), `B, dropped ${drop.join(',') || 'nothing'}`);
      const cb = fb.cards.get('einkauf')!;
      assert.deepEqual(cb.versions.map((v) => [v.n, v.author]), [[1, 'hermes'], [2, 'user'], [3, 'hermes']], 'the edit applied once');
      assert.equal(headOf(cb).n, headOf(fa.cards.get('einkauf')!).n, 'same version number on both devices');
      const eier = cb.versions.flatMap((v) => v.ops).filter((op) => 'add' in op && op.add.text === 'Eier');
      assert.equal(eier.length, 1, 'Eier added once');
    }
  });
}

test('the user takes back an edit that broke off: the next message names the old batch, every device skips it', () => {
  const a: Device = { messages: [...START], rec: EMPTY_RECORD };
  edit(a, { check: 'milch' });
  const b1 = send(a, 'hu-3', 'Danke', 200)!.batches.einkauf.bid!;
  finish(a, '', 'stopped');
  edit(a, { uncheck: 'milch' });
  assert.equal(look(a).cards.get('einkauf')!.pendingCount, 0);
  const plan = send(a, 'hu-5', 'Was fehlt noch?', 300)!;
  assert.deepEqual(plan.batches.einkauf.re, [b1]);
  assert.deepEqual(plan.batches.einkauf.ops ?? [], []);
  finish(a, 'Noch alles offen.');
  assert.deepEqual(a.rec.pending, {});
  // Hermes stored the stopped turn with its tick: device B must not show Milch ticked
  const b: Device = { messages: storedHistory(a.messages), rec: EMPTY_RECORD };
  assert.ok(b.messages.some((m) => m.live?.einkauf?.bid === b1), 'B sees the stored tick');
  assert.deepEqual(headItems(look(b).fold), ['Milch', 'Brot', 'Tomaten']);
  assert.deepEqual(headItems(look(a).fold), ['Milch', 'Brot', 'Tomaten']);
});

test('restart: pending and in-flight edits survive in the store; a turn the app never saw settles as broken off', () => {
  const a: Device = { messages: [...START], rec: EMPTY_RECORD };
  edit(a, { check: 'brot' });
  const plan = send(a, 'hu-3', 'Brot hab ich', 200)!;
  edit(a, { add: { id: 'u-k', text: 'Käse' } });
  // the app is killed: the record went to storage, the transcript copy has no answer and no batch on the message
  const stored = parseRecord(JSON.stringify(a.rec));
  assert.deepEqual(stored, JSON.parse(JSON.stringify(a.rec)));
  assert.equal(stored.pending.einkauf.inflight?.bid, plan.batches.einkauf.bid);
  assert.equal(stored.pending.einkauf.inflight?.at, 200);
  const restarted: Device = { messages: [...START, { ...user('hu-3', 'Brot hab ich', 200) }], rec: stored };
  // the user message is the last one: its answer may still come (recovery), nothing decided
  assert.equal(settleRecord(restarted.rec, restarted.messages, 250), restarted.rec);
  // the stored session has no answer for it and a later turn exists: back to pending, sent again
  const later = [...restarted.messages, answer('ha-x', 'Fehler', 260, { status: 'error' })];
  const settled = settleRecord(restarted.rec, later, 270);
  assert.deepEqual(settled.pending.einkauf.resend, [plan.batches.einkauf.bid]);
  assert.deepEqual(settled.pending.einkauf.ops, [{ check: 'brot' }, { add: { id: 'u-k', text: 'Käse' } }]);
});

test('reconnect: the server copy brings the batches the app had not saved on its message, never replaces newer ones', () => {
  const batch = { einkauf: { v: 1, ops: [{ check: 'milch' }], bid: 'b-1' } } as Record<string, UserBatch>;
  const remote = storedHistory([...START, user('hu-3', 'Danke', 200, batch), answer('ha-4', 'Gern.', 210)]);
  const local = [...START, user('hu-3', 'Danke', 200), answer('ha-4', '', 201, { status: 'stopped', interrupted: 202, metrics: undefined })];
  const merged = reconcileTranscript(local, remote);
  const u = merged.find((m) => m.role === 'user' && m.text === 'Danke')!;
  assert.deepEqual(u.live, batch);
  // a retry carried a newer batch (re: b-1) on the same message: the local one stays
  const newer = { einkauf: { v: 1, ops: [{ check: 'milch' }], bid: 'b-2', re: ['b-1'] } } as Record<string, UserBatch>;
  const local2 = [...START, user('hu-3', 'Danke', 200, newer), answer('ha-4', 'Gern.', 210)];
  const merged2 = reconcileTranscript(local2, remote);
  assert.deepEqual(merged2.find((m) => m.role === 'user' && m.text === 'Danke')!.live, newer);
});

test('two devices: the same history folds to the same identity, version and items (real trailer through the session mapping)', () => {
  const a: Device = { messages: [...START], rec: EMPTY_RECORD };
  edit(a, { check: 'milch' });
  edit(a, { add: { id: 'u-h', text: 'Hafermilch' } });
  send(a, 'hu-3', 'Hab Milch, Hafermilch kommt dazu', 200);
  finish(a, `Erledigt.\n\n${card([{ id: 'milch', text: 'Milch', checked: true }, V1[1], V1[2], { id: 'u-h', text: 'Hafermilch' }])}`);
  const b: Device = { messages: storedHistory(a.messages), rec: EMPTY_RECORD };
  const ca = look(a).cards.get('einkauf')!;
  const cb = look(b).cards.get('einkauf')!;
  assert.equal(cb.id, ca.id);
  assert.equal(cb.title, ca.title);
  assert.equal(cb.head.n, ca.head.n);
  assert.deepEqual(items(cb), items(ca));
  // B sees the same receipt for the user turn (other message ids, same outcome)
  const ub = b.messages.find((m) => m.role === 'user' && m.live)!;
  const ob = messageOutcomes(look(b).fold, b.messages, ub.id)[0];
  const oa = messageOutcomes(look(a).fold, a.messages, 'hu-3')[0];
  assert.equal(ob.state, 'saved');
  assert.equal(ob.n, oa.n);
  assert.deepEqual(ob.changes, oa.changes);
});

// ---- receipts ---------------------------------------------------------------------------------------------------

function turn(batch: UserBatch, answerText: string, userText = 'Danke', extra: Partial<ChatMessage> = {}): ChatMessage[] {
  return [...START, user('hu-3', userText, 200, { einkauf: { bid: 'b-1', ...batch } }), answer('ha-4', answerText, 210, extra)];
}
const outcome = (msgs: ChatMessage[]) => batchOutcome(foldLive(liveEventsOf(msgs, parse)), msgs, 'hu-3', 'einkauf')!;

test('receipt: Hermes did the user\'s edits differently in the same answer: named, with ops that restore them', () => {
  const msgs = turn(
    { v: 1, ops: [{ check: 'milch' }, { add: { id: 'u-b', text: 'Butter' } }] },
    `Ich habe die Liste aktualisiert.\n\n${card([{ ...V1[0], checked: false }, V1[1], V1[2]])}`,
  );
  const o = outcome(msgs);
  assert.equal(o.state, 'changed');
  assert.deepEqual(o.undone.map((u) => `${u.kind} ${u.text}`), ['unchecked Milch', 'removed Butter']);
  assert.deepEqual(o.restore, [{ check: 'milch' }, { add: { id: 'u-b', text: 'Butter' } }]);
  const f = foldLive(liveEventsOf(msgs, parse));
  assert.equal(openUndone(f, msgs, 'einkauf')?.answerN, 3, 'the open card says so while that answer is the newest version');
  // a later version settles it
  const later = [...msgs, user('hu-5', 'ok', 300), answer('ha-6', `Neu.\n\n${card([V1[0], V1[1]])}`, 310)];
  assert.equal(openUndone(foldLive(liveEventsOf(later, parse)), later, 'einkauf'), undefined);
});

test('receipt: removals the user asked for and spelling fixes are not "done differently"', () => {
  const asked = turn({ v: 1, ops: [{ check: 'brot' }] }, `Brot ist raus.\n\n${card([V1[0], V1[2]])}`, 'Brot hab ich, kannst du streichen');
  assert.equal(outcome(asked).state, 'saved');
  const typo = turn({ v: 1, ops: [{ add: { id: 'u-t', text: 'Kaffe' } }] }, `Kaffee steht drauf.\n\n${card([...V1, { id: 'kaffee', text: 'Kaffee' }])}`, 'und Kaffe');
  assert.equal(outcome(typo).state, 'saved');
  assert.equal(nearText('Brto', 'Brot'), true);
  assert.equal(nearText('Tomatn', 'Tomaten'), true);
  assert.equal(nearText('Brot', 'Brie'), false);
  assert.equal(nearText('Milch', 'Hafermilch'), false);
});

test('receipt: waiting while the answer runs, nothing when the card already was so, missed items named', () => {
  assert.equal(outcome(turn({ v: 1, ops: [{ check: 'milch' }] }, '', 'Danke', { status: 'streaming', metrics: undefined })).state, 'waiting');
  // an answer without a block keeps the user's version: saved
  assert.equal(outcome(turn({ v: 1, ops: [{ check: 'milch' }] }, 'Gern!')).state, 'saved');
  // Hermes took Tomaten off before the user's tick arrived
  const msgs: ChatMessage[] = [
    ...START,
    user('hu-2b', 'Tomaten brauch ich nicht', 150),
    answer('ha-2c', `Weg damit.\n\n${card([V1[0], V1[1]])}`, 160),
    user('hu-3', 'Danke', 200, { einkauf: { v: 1, ops: [{ check: 'tomaten' }, { check: 'milch' }], bid: 'b-1' } }),
    answer('ha-4', 'Gern!', 210),
  ];
  const o = outcome(msgs);
  assert.equal(o.state, 'saved');
  assert.deepEqual(o.missed, ['Tomaten']);
  const only = msgs.slice(0, -2).concat(user('hu-3', 'Danke', 200, { einkauf: { v: 1, ops: [{ check: 'tomaten' }], bid: 'b-1' } }), answer('ha-4', 'Gern!', 210));
  const o2 = outcome(only);
  assert.equal(o2.state, 'nothing');
  assert.deepEqual(o2.missed, ['Tomaten']);
  // a tick already there: nothing to do, nothing missed
  const dup = [...turn({ v: 1, ops: [{ check: 'milch' }] }, `ok\n\n${card([{ ...V1[0], checked: true }, V1[1], V1[2]])}`), user('hu-5', 'nochmal', 300, { einkauf: { v: 2, ops: [{ check: 'milch' }], bid: 'b-2' } }), answer('ha-6', 'ok', 310)];
  const o3 = batchOutcome(foldLive(liveEventsOf(dup, parse)), dup, 'hu-5', 'einkauf')!;
  assert.equal(o3.state, 'nothing');
  assert.deepEqual(o3.missed, []);
});
