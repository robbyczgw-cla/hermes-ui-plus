// Hidden app text in stored user messages (`[hui:note]` retry note, `[hui:context]` branch context) must not show up
// when a session is loaded from Hermes' history on another device / after a reinstall.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMessages } from './sessions.ts';
import { mapRemoteMessages, sameUserTurn, splitStoredExtras } from './sessionMapping.ts';
import { branchSeedText, splitTurnExtras, stripTurnExtras, withContextSeed, withTurnNote } from './turnOverride.ts';

const history = (...content: unknown[]) =>
  parseMessages(
    {
      object: 'list',
      session_id: 'hermes-ui-test-1',
      data: content.flatMap((c, i) => [
        { id: 100 + i * 2, role: 'user', content: c, timestamp: 1791659146 + i * 10 },
        { id: 101 + i * 2, role: 'assistant', content: 'Antwort', timestamp: 1791659148 + i * 10, finish_reason: 'stop' },
      ]),
    },
    'x',
  ).messages;

const NOTE = 'Beantworte ohne Websuche/Web-Tools.';
// literal form written by the app since 0.1 (turnOverride.ts), independent of today's helper functions
const OLD_NOTE_TEXT = `Was kostet ein Flug nach Rom?\n\n[hui:note] ${NOTE}`;
const OLD_CONTEXT_TEXT = '[hui:context]\nThis chat continues an earlier conversation.\n\nUser: Hallo\nAssistant: Hi\n[/hui:context]\n\nWeiter mit Rom';

test('history of another device: a retry note is cut from the user bubble, a chip flag stays', () => {
  const [u] = mapRemoteMessages(history(OLD_NOTE_TEXT));
  assert.equal(u.role, 'user');
  assert.equal(u.text, 'Was kostet ein Flug nach Rom?');
  assert.deepEqual(u.turnExtras, { note: true });
});

test('history: the branch context block is cut, the typed first message stays', () => {
  const [u] = mapRemoteMessages(history(OLD_CONTEXT_TEXT));
  assert.equal(u.text, 'Weiter mit Rom');
  assert.deepEqual(u.turnExtras, { context: true });
});

test('history written by today\'s helpers gives the same result (context + note on one message)', () => {
  const seed = branchSeedText([
    { role: 'user', text: 'Hallo', tools: [], status: 'done' } as never,
    { role: 'assistant', text: 'Hi', tools: [], status: 'done' } as never,
  ]);
  const sent = withTurnNote(withContextSeed(seed, 'Weiter mit Rom'), NOTE);
  assert.match(sent, /\[hui:context\]/);
  const [u] = mapRemoteMessages(history(sent));
  assert.equal(u.text, 'Weiter mit Rom');
  assert.deepEqual(u.turnExtras, { context: true, note: true });
});

test('history: marker lines of images and the note order (note, then [Bild]) are handled', () => {
  const parts = [{ type: 'text', text: OLD_NOTE_TEXT }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }];
  const [u] = mapRemoteMessages(history(parts));
  assert.equal(u.text, 'Was kostet ein Flug nach Rom?\n[Bild]');
  assert.deepEqual(u.turnExtras, { note: true });
});

test('history: note after a file attachment reference (attachments are split off first)', () => {
  const file = '[Datei angehängt: plan.pdf (application/pdf, 12 KB) – Pfad auf dem Server: /srv/up/plan.pdf]';
  const [u] = mapRemoteMessages(history([{ type: 'text', text: OLD_NOTE_TEXT }, { type: 'text', text: file }]));
  assert.equal(u.text, 'Was kostet ein Flug nach Rom?');
  assert.equal(u.attachments?.length, 1);
  assert.deepEqual(u.turnExtras, { note: true });
});

test('history: a message with only a note keeps its slot, plain messages carry no flag', () => {
  const [a, , b] = mapRemoteMessages(history(`[hui:note] ${NOTE}`, 'Normale Nachricht'));
  assert.equal(a.text, '');
  assert.deepEqual(a.turnExtras, { note: true });
  assert.equal(b.text, 'Normale Nachricht');
  assert.equal('turnExtras' in b, false);
});

test('what the user wrote is kept: look-alike text in the middle or an unterminated block is not touched', () => {
  const mid = 'Schreib [hui:note] nicht ab.\nDanke';
  const open = '[hui:context]\nkein Ende\nund dann Text';
  assert.deepEqual(splitTurnExtras(mid), { text: mid });
  assert.deepEqual(splitTurnExtras(open), { text: open });
  assert.deepEqual(splitStoredExtras(mid), { text: mid });
});

test('the cut message still lines up with the local message it was sent from (transcript matching)', () => {
  const [remote] = mapRemoteMessages(history(OLD_NOTE_TEXT));
  assert.ok(sameUserTurn({ text: 'Was kostet ein Flug nach Rom?' }, remote));
  assert.ok(sameUserTurn({ text: OLD_NOTE_TEXT }, remote));
  assert.equal(stripTurnExtras(OLD_NOTE_TEXT), 'Was kostet ein Flug nach Rom?');
});

test('a retry of a loaded message does not stack notes (the note is no longer part of the text)', () => {
  const [remote] = mapRemoteMessages(history(OLD_NOTE_TEXT));
  assert.equal(withTurnNote(remote.text, NOTE), OLD_NOTE_TEXT);
});
