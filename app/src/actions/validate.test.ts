import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseIso } from './dates.ts';
import { makeT } from '../i18n/core.ts';
import { isValidEmail, normalizePhone, validateAction as validate, validateUrl } from './validate.ts';

const NOW = new Date(2026, 9, 10, 12, 0, 0).getTime(); // 10 Oct 2026 12:00 local
const DE = { t: makeT('de', 'de-DE'), locale: 'de-DE' };
const EN = { t: makeT('en', 'en-US'), locale: 'en-US' };
const validateAction = (raw: unknown, now: number) => validate(raw, DE, now);

function okAction(raw: unknown) {
  const r = validateAction(raw, NOW);
  assert.equal(r.ok, true, JSON.stringify(r));
  return (r as Extract<ReturnType<typeof validateAction>, { ok: true }>).action;
}
function err(raw: unknown): string {
  const r = validateAction(raw, NOW);
  assert.equal(r.ok, false, 'expected failure for ' + JSON.stringify(raw));
  return (r as { ok: false; error: string }).error;
}

test('parseIso: local date-times, date-only, offsets, impossible dates', () => {
  const a = parseIso('2026-10-14T10:00')!;
  assert.deepEqual([a.date.getFullYear(), a.date.getMonth(), a.date.getDate(), a.date.getHours(), a.date.getMinutes()], [2026, 9, 14, 10, 0]);
  assert.equal(a.dateOnly, false);
  const b = parseIso('2026-10-14')!;
  assert.equal(b.dateOnly, true);
  assert.equal(b.date.getHours(), 0);
  assert.equal(parseIso('2026-10-14T10:00:00Z')!.date.toISOString(), '2026-10-14T10:00:00.000Z');
  assert.equal(parseIso('2026-10-14T10:00:00+02:00')!.date.toISOString(), '2026-10-14T08:00:00.000Z');
  assert.equal(parseIso('2026-10-14 10:00')!.dateOnly, false);
  for (const bad of ['2026-02-30', '2026-13-01', '2026-10-14T25:00', 'morgen', '', 42, null, '14.10.2026']) assert.equal(parseIso(bad), null, String(bad));
});

test('calendar: normal event, default end = +1h, trims, optional fields', () => {
  const a = okAction({ type: 'calendar', title: '  Zahnarzt ', start: '2026-10-14T10:00', location: 'Praxis Müller', notes: '' });
  assert.equal(a.type, 'calendar');
  if (a.type !== 'calendar') return;
  assert.equal(a.title, 'Zahnarzt');
  assert.equal(a.end.getTime() - a.start.getTime(), 3600000);
  assert.equal(a.allDay, false);
  assert.equal(a.location, 'Praxis Müller');
  assert.ok(!('notes' in a));
});

test('calendar: date-only start implies all-day with inclusive end', () => {
  const a = okAction({ type: 'calendar', title: 'Urlaub', start: '2026-10-14', end: '2026-10-16' });
  if (a.type !== 'calendar') throw new Error();
  assert.equal(a.allDay, true);
  assert.equal(a.start.getDate(), 14);
  assert.equal(a.end.getDate(), 16);
  const single = okAction({ type: 'calendar', title: 'Feiertag', start: '2026-10-14', allDay: true });
  if (single.type !== 'calendar') throw new Error();
  assert.equal(single.end.getDate(), 14);
});

test('calendar: invalid inputs', () => {
  assert.match(err({ type: 'calendar', start: '2026-10-14T10:00' }), /Titel/);
  assert.match(err({ type: 'calendar', title: 'x', start: 'morgen' }), /Beginn/);
  assert.match(err({ type: 'calendar', title: 'x', start: '2026-10-14T10:00', end: 'bald' }), /Ende/);
  assert.match(err({ type: 'calendar', title: 'x', start: '2026-10-14T10:00', end: '2026-10-14T09:00' }), /Ende liegt vor/);
  assert.match(err({ type: 'calendar', title: 'x', start: '2026-10-14T10:00', end: '2026-10-14T10:00' }), /Ende liegt vor/);
  assert.match(err({ type: 'calendar', title: 'x', start: '2026-10-14', end: '2026-10-12' }), /Ende liegt vor/);
});

test('reminder: must be in the future; date-only → 09:00', () => {
  const a = okAction({ type: 'reminder', title: 'Müll rausstellen', at: '2026-10-11' });
  if (a.type !== 'reminder') throw new Error();
  assert.equal(a.at.getHours(), 9);
  assert.match(err({ type: 'reminder', title: 'x', at: '2026-10-09T10:00' }), /Vergangenheit/);
  assert.match(err({ type: 'reminder', title: 'x', at: 'nope' }), /ungültig/);
  assert.match(err({ type: 'reminder', title: ' ', at: '2026-10-11T10:00' }), /Titel/);
});

test('maps: query or coordinates, ranges, mode', () => {
  assert.deepEqual(okAction({ type: 'maps', query: 'Hauptbahnhof München' }), { type: 'maps', query: 'Hauptbahnhof München' });
  assert.deepEqual(okAction({ type: 'maps', lat: 48.14, lng: 11.56, mode: 'walking' }), { type: 'maps', lat: 48.14, lng: 11.56, mode: 'walking' });
  assert.deepEqual(okAction({ type: 'maps', lat: '48.1', lng: '11.5' }), { type: 'maps', lat: 48.1, lng: 11.5 });
  err({ type: 'maps' });
  err({ type: 'maps', lat: 91, lng: 0 });
  err({ type: 'maps', lat: 10 });
  err({ type: 'maps', lat: 10, lng: 181 });
  err({ type: 'maps', query: 'x', mode: 'flying' });
  err({ type: 'maps', lat: NaN, lng: 1 });
});

test('phone numbers', () => {
  assert.equal(normalizePhone('+49 (151) 234-567/8'), '+491512345678');
  assert.equal(normalizePhone('0151 2345678'), '01512345678');
  assert.equal(normalizePhone('112'), '112');
  for (const bad of ['', '12', '*#06#', '+49 151 abc', 'tel:+49151', '1234567890123456', null, 12345]) assert.equal(normalizePhone(bad), null, String(bad));
  assert.deepEqual(okAction({ type: 'call', phone: '+49 30 1234567' }), { type: 'call', phone: '+49301234567' });
  err({ type: 'call', phone: '*123#' });
});

test('email', () => {
  assert.ok(isValidEmail('max.muster+test@example.com'));
  for (const bad of ['max@', '@x.de', 'a b@x.de', 'max@x', 'a..b@example.com', 'a@b..de', '.a@example.com']) assert.ok(!isValidEmail(bad), bad);
  const a = okAction({ type: 'email', to: 'a@x.de, b@y.org;a@x.de', subject: ' Hi ', body: 'Zeile 1\nZeile 2' });
  if (a.type !== 'email') throw new Error();
  assert.deepEqual(a.to, ['a@x.de', 'b@y.org']);
  assert.equal(a.subject, 'Hi');
  err({ type: 'email', to: 'kaputt' });
  err({ type: 'email', to: ['a@x.de', 'nope'] });
  err({ type: 'email' });
  err({ type: 'email', to: [] });
});

test('sms', () => {
  assert.deepEqual(okAction({ type: 'sms', to: '0151 111 222', body: 'Hallo' }), { type: 'sms', to: ['0151111222'], body: 'Hallo' });
  err({ type: 'sms', to: 'abc' });
});

test('timer', () => {
  assert.deepEqual(okAction({ type: 'timer', seconds: 90, label: ' Nudeln ' }), { type: 'timer', seconds: 90, label: 'Nudeln' });
  assert.deepEqual(okAction({ type: 'timer', seconds: 10.4 }), { type: 'timer', seconds: 10, label: 'Timer' });
  err({ type: 'timer', seconds: 0 });
  err({ type: 'timer', seconds: -5 });
  err({ type: 'timer', seconds: 'abc' });
  err({ type: 'timer', seconds: 24 * 3600 + 1 });
  err({ type: 'timer', seconds: Infinity });
});

test('add_to_list: trims, de-duplicates, requires items', () => {
  assert.deepEqual(okAction({ type: 'add_to_list', items: [' Milch ', 'milch', 'Eier', '', 5], listTitle: 'Einkauf' }), {
    type: 'add_to_list',
    items: ['Milch', 'Eier'],
    listTitle: 'Einkauf',
  });
  err({ type: 'add_to_list', items: [] });
  err({ type: 'add_to_list', items: 'Milch' });
  err({ type: 'add_to_list', items: Array.from({ length: 101 }, (_, i) => `x${i}`) });
});

test('URL scheme allow-list', () => {
  assert.equal(validateUrl('https://example.com/a?b=c'), 'https://example.com/a?b=c');
  assert.equal(validateUrl('tel:+4930123'), 'tel:+4930123');
  assert.equal(validateUrl('geo:48.1,11.5?q=x'), 'geo:48.1,11.5?q=x');
  for (const bad of [
    'javascript:alert(1)',
    'data:text/html,<script>',
    'file:///etc/passwd',
    'intent://x#Intent;scheme=http;end',
    'ftp://x.de',
    'https://good.example.com@evil.example.com/',
    'https://',
    'http:///x',
    'tel:',
    'https://exa mple.com',
    'https://x.de/\u0000',
    '//example.com',
    'example.com',
    '',
    null,
    'https://' + 'a'.repeat(3000),
  ])
    assert.equal(validateUrl(bad as string), null, String(bad));
  assert.equal(validateUrl('tel:+49', ['http', 'https']), null);
});

test('open_url only accepts http/https; copy/send validate text', () => {
  okAction({ type: 'open_url', url: 'https://example.com' });
  err({ type: 'open_url', url: 'tel:+4930123' });
  err({ type: 'open_url', url: 'javascript:alert(1)' });
  okAction({ type: 'copy', text: 'hi' });
  err({ type: 'copy', text: '  ' });
  okAction({ type: 'send', text: 'Ja bitte' });
  err({ type: 'send', text: '' });
});

test('error messages follow the active language', () => {
  const r = validate({ type: 'reminder', at: '2026-10-14T08:00' }, EN, NOW);
  assert.deepEqual(r, { ok: false, error: 'The reminder is missing a title.' });
  assert.deepEqual(validate({ type: 'calendar', title: 'x', start: '2026-10-14T10:00', end: '2026-10-14T09:00' }, EN, NOW), {
    ok: false,
    error: 'The end is before the start of the event.',
  });
});

test('garbage input never throws', () => {
  for (const raw of [null, undefined, 5, 'x', [], {}, { type: 'rm -rf' }, { type: 'submit' }, { type: 'calendar', title: {}, start: [] }]) {
    const r = validateAction(raw, NOW);
    assert.equal(r.ok, false);
  }
});
