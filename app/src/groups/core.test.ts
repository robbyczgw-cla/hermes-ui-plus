// Bot groups (groups/core.ts, groups/text.ts): parsing the bridge's answers, @-autocomplete, the create draft, the texts
// of notes and hand-overs, and that every state of the screen says something (no blank group, no silent gap).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeT } from '../i18n/core.ts';
import {
  addressedBy, draftProblems, failureOf, insertMention, mentionOptions, mentionQuery, mergeEntries, parseGroupSessionId,
  parseGroupsList, parseGroupState, suggestName, toApprovalRequest, toggleMember, type GroupEntry,
} from './core.ts';
import { failureText, noteText, reasonText } from './text.ts';

const tr = makeT('de', 'de-DE');
const MEMBERS = [{ key: 'default', label: 'Hermes' }, { key: 'scout', label: 'Scout' }, { key: 'writer', label: 'Quill Writer' }];
const nameOf = (k: string) => MEMBERS.find((m) => m.key === k)?.label ?? k;

test('the list: config, groups, approvals; anything we do not understand is null or left out', () => {
  assert.equal(parseGroupsList(null), null);
  assert.equal(parseGroupsList({ groups: [] }), null, 'no enabled flag: an older bridge');
  const off = parseGroupsList({ enabled: false, reason: 'owner_off', admin: true, groups: [] })!;
  assert.deepEqual(off.config, { enabled: false, reason: 'owner_off', admin: true, limits: { minMembers: 2, maxMembers: 6, perRound: 8 } });
  const l = parseGroupsList({
    enabled: true, admin: false, limits: { minMembers: 2, maxMembers: 4, perRound: 8 },
    groups: [
      { id: 'gabcdefghij', name: 'Reise', members: ['default', 'scout', 'Bad Name'], createdAt: 1, updatedAt: 2, running: true, last: { kind: 'bot', bot: 'scout', text: 'Ab 39 €', at: 2 } },
      { id: '../x', name: 'evil' },
    ],
    approvals: [{ groupId: 'gabcdefghij', groupName: 'Reise', bot: 'scout', runId: 'run_1', requestId: 'req_1', command: 'rm -rf /tmp/x', choices: ['once', 'always', 'deny', 7], at: 5 }, { bot: 'scout' }],
  })!;
  assert.equal(l.config.limits.maxMembers, 4);
  assert.deepEqual(l.groups.map((g) => [g.id, g.members, g.running, g.last?.text]), [['gabcdefghij', ['default', 'scout'], true, 'Ab 39 €']]);
  assert.deepEqual(l.approvals.map((a) => [a.bot, a.requestId, a.choices]), [['scout', 'req_1', ['once', 'always', 'deny']]]);
});

test('the state: entries of known kinds, the round, merge by seq', () => {
  assert.equal(parseGroupState({ group: { id: 'nope' } }), null);
  const st = parseGroupState({
    group: { id: 'gabcdefghij', name: 'Reise', members: ['default', 'scout'] }, seq: 6,
    entries: [
      { seq: 1, at: 1, kind: 'user', text: 'Hallo' },
      { seq: 2, at: 2, kind: 'bot', bot: 'default', text: '@scout?' },
      { seq: 3, at: 2, kind: 'handoff', bot: 'default', to: 'scout', text: '?' },
      { seq: 4, at: 3, kind: 'note', note: 'approval', bot: 'scout', runId: 'r', requestId: 'q' },
      { seq: 5, at: 3, kind: 'poll', text: 'from a newer bridge' },
      { seq: 6, at: 3, kind: 'note', note: 'capped', waiting: ['scout'] },
    ],
    round: { turns: 3, max: 8, speaker: 'scout', partial: 'Ich', queue: [], waiting: [{ bot: 'scout', runId: 'r', requestId: 'q' }] },
  })!;
  assert.deepEqual(st.entries.map((e) => e.seq), [1, 2, 3, 4, 6]);
  assert.deepEqual([st.round?.speaker, st.round?.turns, st.round?.waiting.length], ['scout', 3, 1]);
  assert.equal(parseGroupState({ group: { id: 'gabcdefghij' }, entries: [] })!.round, null);
  const merged = mergeEntries(st.entries.slice(0, 2), [st.entries[1], st.entries[2], st.entries[0]]);
  assert.deepEqual(merged.map((e) => e.seq), [1, 2, 3]);
});

test('@-autocomplete: query at the caret, options, insertion; mail addresses do not open it', () => {
  assert.deepEqual(mentionQuery('Hallo @sc', 9), { start: 6, query: 'sc' });
  assert.deepEqual(mentionQuery('@', 1), { start: 0, query: '' });
  assert.equal(mentionQuery('a@scout.example.com', 10), null);
  assert.equal(mentionQuery('Hallo @sc und', 13), null, 'caret after the word');
  assert.deepEqual(mentionOptions('', MEMBERS, 'Alle').map((o) => o.tag), ['hermes', 'scout', 'writer', 'alle']);
  assert.deepEqual(mentionOptions('qu', MEMBERS, 'Alle').map((o) => o.tag), ['writer'], 'any word of the label');
  assert.deepEqual(mentionOptions('al', MEMBERS, 'Alle').map((o) => o.tag), ['alle']);
  assert.deepEqual(insertMention('Hallo @sc', 6, 9, 'scout'), { text: 'Hallo @scout ', caret: 13 });
  assert.deepEqual(insertMention('@wr bitte', 0, 3, 'writer'), { text: '@writer bitte', caret: 8 });
  assert.deepEqual(addressedBy('@writer und @Scout', MEMBERS), { keys: ['writer', 'scout'], everyone: false });
  assert.deepEqual(addressedBy('@alle', MEMBERS), { keys: [], everyone: true });
  assert.deepEqual(addressedBy('mail an a@scout.example.com', MEMBERS), { keys: [], everyone: false });
});

test('create: 2 to 6 bots, the first picked leads, a proposed name', () => {
  let d = { name: '', members: [] as string[] };
  assert.deepEqual(draftProblems(d), ['few']);
  d = toggleMember(d, 'scout');
  d = toggleMember(d, 'default');
  assert.deepEqual(d.members, ['scout', 'default']);
  assert.deepEqual(draftProblems(d), []);
  assert.deepEqual(toggleMember(d, 'scout').members, ['default']);
  const full = { name: '', members: ['a', 'b', 'c', 'd', 'e', 'f'] };
  assert.equal(toggleMember(full, 'g'), full, 'at most six');
  assert.deepEqual(draftProblems({ name: 'x'.repeat(61), members: ['a', 'b'] }), ['name']);
  assert.equal(suggestName(['Scout', 'Quill', 'Hermes'], 'und'), 'Scout, Quill und Hermes');
  assert.equal(suggestName([], 'und'), '');
});

test('approvals from a group become cards of the bot\'s own chat, named after the group', () => {
  const r = toApprovalRequest({ groupId: 'gabcdefghij', groupName: 'Reise', bot: 'scout', runId: 'run_1', requestId: 'req_1', command: 'rm -rf /tmp/x', description: 'delete in root path', choices: ['once', 'session', 'always', 'deny', 'bogus'], at: 1_700_000_000_000, expiresAt: 1_700_000_300_000 }, (g) => tr('groups.approval.from', { group: g }));
  assert.equal(r.description, 'Aus der Gruppe „Reise“ · delete in root path');
  assert.deepEqual(r.choices, ['once', 'session', 'always', 'deny']);
  assert.deepEqual([r.runId, r.requestId, r.timestamp, r.deadlineAt], ['run_1', 'req_1', 1_700_000_000, 1_700_000_300_000]);
  assert.equal(toApprovalRequest({ groupId: 'g', groupName: '', bot: 'scout', runId: 'r', requestId: 'q', command: 'x', at: 1 }, (g) => g).description, 'g');
  assert.deepEqual(parseGroupSessionId('huigroup-gabcdefghij-scout'), { groupId: 'gabcdefghij', bot: 'scout' });
  assert.equal(parseGroupSessionId('api_1'), null);
});

test('every note, hand-over and failure has a visible text (no empty line in the room)', () => {
  const notes: GroupEntry[] = [
    { seq: 1, at: 0, kind: 'note', note: 'approval', bot: 'scout', requestId: 'q' },
    { seq: 2, at: 0, kind: 'note', note: 'error', bot: 'scout', code: 'not_connected' },
    { seq: 3, at: 0, kind: 'note', note: 'error', code: 'bridge_error' },
    { seq: 4, at: 0, kind: 'note', note: 'capped', waiting: ['writer'] },
    { seq: 5, at: 0, kind: 'note', note: 'capped' },
    { seq: 6, at: 0, kind: 'note', note: 'stopped' },
    { seq: 7, at: 0, kind: 'note', note: 'quiet' },
    { seq: 8, at: 0, kind: 'note', note: 'interrupted' },
    { seq: 9, at: 0, kind: 'handoff', bot: 'default', to: 'scout', text: 'such Zugpreise' },
    { seq: 10, at: 0, kind: 'handoff', bot: 'default', to: 'scout', text: '' },
  ];
  const texts = notes.map((e) => noteText(e as Extract<GroupEntry, { kind: 'note' | 'handoff' }>, nameOf, tr, { max: 8 }));
  for (const [i, s] of texts.entries()) assert.ok(s && !/[{}]/.test(s), `note ${i}: ${s}`);
  assert.equal(texts[0], 'Scout hat in seinem Chat um eine Freigabe gebeten');
  assert.equal(noteText(notes[0] as never, nameOf, tr, { waitingNow: true }), 'Scout wartet auf eine Freigabe in seinem Chat');
  assert.equal(texts[1], 'Scout konnte nicht antworten: nicht mit dem Server verbunden');
  assert.equal(texts[3], '8 Beiträge erreicht. Noch offen: Quill Writer. Die Gruppe wartet auf dich.');
  assert.equal(texts[6], 'Niemand hatte etwas hinzuzufügen.');
  assert.equal(texts[8], 'Hermes an Scout: such Zugpreise');
  assert.equal(texts[9], 'Hermes an Scout');
  for (const c of ['not_connected', 'unknown_bot', 'busy', 'timeout', 'upstream_error', 'bridge_error', undefined, 'new_code']) assert.ok(reasonText(c, tr));
  for (const f of ['offline', 'off', 'members', 'running', 'busy', 'gone', 'tooLong', 'unknown', 'limit', 'server'] as const) assert.ok(failureText(f, tr));
  assert.equal(failureOf(0, null), 'offline');
  assert.equal(failureOf(404, { error: { code: 'groups_off' } }), 'off');
  assert.equal(failureOf(409, { error: { code: 'round_running' } }), 'running');
  assert.equal(failureOf(500, { error: { code: 'weird' } }), 'server');
});

test('the group screen says something in every state (loading, off, gone, no bridge, error, empty room)', () => {
  const src = fs.readFileSync(new URL('./GroupChatScreen.tsx', import.meta.url), 'utf8');
  for (const needle of ["tr('groups.chat.loading')", "tr('groups.chat.off')", "tr('groups.chat.gone')", "tr('groups.chat.noConnection')", 'failureText(load.failure, tr)', "tr('groups.chat.emptyBody'", 'testID="group-empty"', "tr('groups.chat.backToChats')"]) {
    assert.ok(src.includes(needle), needle);
  }
  // the Bots tab offers groups only when the owner switched them on, never in the demo
  const sec = fs.readFileSync(new URL('./GroupsSection.tsx', import.meta.url), 'utf8');
  assert.match(sec, /const offer = !tab\.demo && !!groups\.list\?\.config\.enabled/);
});
