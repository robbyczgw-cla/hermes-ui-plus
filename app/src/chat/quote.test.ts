import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChatMessage } from '../hermes/types.ts';
import { splitTurnExtras, withContextSeed, withTurnNote } from '../hermes/turnOverride.ts';
import { sameUserText } from '../hermes/sessionMapping.ts';
import { withLiveTrailer } from '../live/trailer.ts';
import { addQuote, clipExcerpt, MAX_QUOTES, messagePlainText, QUOTE_MAX_CHARS, quoteOf, resolveQuote, splitQuotes, stripQuotes, withQuotes, type Quote } from './quote.ts';

const msg = (id: string, role: 'user' | 'assistant', text: string): ChatMessage => ({ id, role, text, tools: [], status: 'done', createdAt: 0 });

test('wire form: quote blocks in order in front of the typed text, readable as a Markdown quote', () => {
  const qs: Quote[] = [
    { ref: 'a1', role: 'assistant', text: 'Die Fähre fährt um 9:40 ab Piräus.' },
    { ref: 'u0', role: 'user', text: 'Wir sind zu zweit' },
  ];
  const wire = withQuotes('Gibt es eine frühere?', qs);
  assert.equal(
    wire,
    '[hui:quote ref=a1 from=assistant]\n> Die Fähre fährt um 9:40 ab Piräus.\n[/hui:quote]\n[hui:quote ref=u0 from=user]\n> Wir sind zu zweit\n[/hui:quote]\n\nGibt es eine frühere?',
  );
  assert.deepEqual(splitQuotes(wire), { quotes: qs, text: 'Gibt es eine frühere?' });
  assert.equal(withQuotes('Hallo', []), 'Hallo');
  assert.equal(withQuotes('Hallo', undefined), 'Hallo');
});

test('splitQuotes: ordinary and malformed texts stay as typed', () => {
  assert.deepEqual(splitQuotes('Hallo'), { quotes: [], text: 'Hallo' });
  // unterminated
  assert.deepEqual(splitQuotes('[hui:quote from=assistant]\n> abc'), { quotes: [], text: '[hui:quote from=assistant]\n> abc' });
  // not a quote head
  const odd = '[hui:quotes]\n> x\n[/hui:quote]\nrest';
  assert.deepEqual(splitQuotes(odd), { quotes: [], text: odd });
  // a bad ref is dropped, the quote stays; unknown role reads as the assistant
  assert.deepEqual(splitQuotes('[hui:quote ref=a<b from=bot]\n> x y\n[/hui:quote]\n\nok'), { quotes: [{ role: 'assistant', text: 'x y' }], text: 'ok' });
  assert.equal(stripQuotes(withQuotes('frage', [{ role: 'assistant', text: 'q' }])), 'frage');
});

test('an excerpt containing the closing tag survives the round trip', () => {
  const q: Quote = { role: 'assistant', text: 'Tag [/hui:quote] im Text' };
  assert.deepEqual(splitQuotes(withQuotes('x', [q])), { quotes: [q], text: 'x' });
});

test('with the other app markers: context seed in front, note and live trailer behind', () => {
  const typed = withQuotes('Und morgen?', [{ ref: 'a1', role: 'assistant', text: 'Heute 21 °C' }]);
  const wire = withLiveTrailer(withTurnNote(withContextSeed('Früher: …', typed), 'kurz'), { einkauf: { v: 2, ops: [{ check: 'milch' }] } });
  const split = splitTurnExtras(wire);
  assert.equal(split.text, typed);
  assert.deepEqual(splitQuotes(split.text).quotes, [{ ref: 'a1', role: 'assistant', text: 'Heute 21 °C' }]);
  // the stored Hermes turn still lines up with the local message
  assert.ok(sameUserText(typed, wire));
});

test('clipExcerpt: one line, cut at a word boundary', () => {
  assert.equal(clipExcerpt('  a\n\nb  c '), 'a b c');
  const long = 'Wort '.repeat(100);
  const c = clipExcerpt(long);
  assert.ok(c.length <= QUOTE_MAX_CHARS, String(c.length));
  assert.ok(c.endsWith('Wort…'), c);
});

test('quoteOf: visible text of an answer, no Markdown / hui JSON; a selection wins', () => {
  const a = msg('a1', 'assistant', '## Fähren\n\n**Blue Star** fährt um *9:40* ab [Piräus](https://example.com).\n\n```hui\n{"type":"table","title":"Fahrplan","rows":[["9:40","Paros"]]}\n```');
  const q = quoteOf(a);
  assert.ok(q);
  assert.equal(q.role, 'assistant');
  assert.equal(q.ref, 'a1');
  assert.match(q.text, /^Fähren Blue Star fährt um 9:40 ab Piräus\./);
  assert.ok(!q.text.includes('{'), q.text);
  assert.deepEqual(quoteOf(a, ' nur das '), { ref: 'a1', role: 'assistant', text: 'nur das' });
  // a user message quoted: without its own quotes
  const u = msg('u2', 'user', withQuotes('meine Frage', [{ role: 'assistant', text: 'alt' }]));
  assert.equal(quoteOf(u)?.text, 'meine Frage');
  assert.equal(quoteOf(msg('a2', 'assistant', '  \n')), null);
});

test('messagePlainText: tables read as rows', () => {
  assert.equal(messagePlainText(msg('a', 'assistant', '| A | B |\n|---|---|\n| 1 | 2 |')), 'A · B\n1 · 2');
});

test('addQuote: order kept, duplicates once, at most MAX_QUOTES', () => {
  let list: Quote[] = [];
  for (let i = 0; i < MAX_QUOTES; i++) list = addQuote(list, { ref: `m${i}`, role: 'assistant', text: `t${i}` })!;
  assert.deepEqual(list.map((q) => q.ref), ['m0', 'm1', 'm2']);
  assert.equal(addQuote(list, { ref: 'm9', role: 'assistant', text: 'x' }), null);
  assert.equal(addQuote(list, { ref: 'm1', role: 'assistant', text: 't1' })?.length, MAX_QUOTES);
});

test('resolveQuote: by id, else by excerpt (other device), never a newer message; gone = null', () => {
  const messages = [
    msg('u1', 'user', 'Fähren nach Paros?'),
    msg('a1', 'assistant', 'Die **Blue Star** fährt um 9:40 ab Piräus, Ankunft 13:15.'),
    msg('u2', 'user', 'Und zurück?'),
    msg('a2', 'assistant', 'Zurück um 17:00.'),
    msg('u3', 'user', withQuotes('Früher?', [{ ref: 'a1', role: 'assistant', text: 'Die Blue Star fährt um 9:40' }])),
  ];
  assert.equal(resolveQuote(messages, { ref: 'a1', role: 'assistant', text: 'x' }, 'u3'), 'a1');
  // another device: unknown ref, the excerpt (accents / case folded, cut with "…") finds the answer
  assert.equal(resolveQuote(messages, { ref: 'zz', role: 'assistant', text: 'die blue star fahrt um 9:40 ab…' }, 'u3'), 'a1');
  // the cited message must be older than the quoting one
  assert.equal(resolveQuote(messages, { role: 'assistant', text: 'Zurück um 17:00' }, 'u2'), null);
  assert.equal(resolveQuote(messages, { role: 'assistant', text: 'Zurück um 17:00' }, 'u3'), 'a2');
  // deleted / dropped from the stored history
  assert.equal(resolveQuote(messages, { ref: 'gone', role: 'assistant', text: 'nicht mehr da' }), null);
  // the role is a preference, not a must (a quote of a user line that the bot repeated)
  assert.equal(resolveQuote(messages, { role: 'assistant', text: 'Und zurück?' }), 'u2');
});

test('a quoted job delivery is labelled as an answer, not as the user ("Du"), and still finds its message', () => {
  const delivery = { id: 'm-d1', role: 'user' as const, text: '[Cronjob "[bot:scout] Preis-Check" output — scheduled job, not the user.]\n\nKopfhörer: 289 €' };
  const q = quoteOf(delivery);
  assert.ok(q);
  assert.equal(q.role, 'assistant');
  assert.equal(q.text, 'Preis-Check: Kopfhörer: 289 €');
  assert.equal(resolveQuote([delivery], { ...q, ref: undefined }), 'm-d1');
  // a message the user typed stays theirs
  assert.equal(quoteOf({ id: 'm-u1', role: 'user', text: 'Wann fährt die Fähre?' })?.role, 'user');
});
