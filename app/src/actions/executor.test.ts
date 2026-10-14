import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeT } from '../i18n/core.ts';
import type { CalendarOutcome } from './calendar.ts';
import { executeAction, type ExecEnv } from './executor.ts';
import { createListBus, type ListBusEvent } from './listBus.ts';
import type { AppendResult } from './lists.ts';
import type { ScheduleResult } from './notifications.ts';
import type { ActionI18n, ValidAction } from './types.ts';
import { validateAction } from './validate.ts';

const NOW = new Date(2026, 9, 10, 12, 0, 0);
const DE: ActionI18n = { t: makeT('de', 'de-DE'), locale: 'de-DE' };
const EN: ActionI18n = { t: makeT('en', 'en-US'), locale: 'en-US' };
const run = (a: ValidAction, e: ExecEnv, i18n: ActionI18n = DE) => executeAction(a, e, i18n);

function v(raw: unknown): ValidAction {
  const r = validateAction(raw, DE, NOW.getTime());
  if (!r.ok) throw new Error(r.error);
  return r.action;
}

function env(over: Partial<ExecEnv> & { failUrls?: (u: string) => boolean } = {}) {
  const opened: string[] = [];
  const copied: string[] = [];
  const sent: string[] = [];
  const bus = createListBus();
  const events: ListBusEvent[] = [];
  bus.subscribe((e) => events.push(e));
  const { failUrls, ...rest } = over;
  const e: ExecEnv = {
    os: 'android',
    now: () => NOW,
    openUrl: async (u) => {
      if (failUrls?.(u)) throw new Error('no handler');
      opened.push(u);
    },
    copy: async (t) => void copied.push(t),
    send: (t) => void sent.push(t),
    addCalendarEvent: async (): Promise<CalendarOutcome> => ({ ok: true, via: 'direct', calendarTitle: 'Privat' }),
    scheduleNotification: async (): Promise<ScheduleResult> => ({ ok: true, id: 'n1' }),
    startTimer: async (o) => ({ timer: { id: 't', label: o.label, totalMs: o.seconds * 1000, status: 'running', endsAt: 1, remainingMs: 1, createdAt: 0, notificationId: 'n' }, notified: true }),
    appendToList: async (): Promise<AppendResult> => ({ status: 'appended', key: 'm:n', messageId: 'm', nodeId: 'n', added: ['Milch'], reopened: [], skipped: [] }),
    listBus: bus,
    conversationId: 'c1',
    ...rest,
  };
  return { e, opened, copied, sent, events };
}

test('copy / send / open_url pass through', async () => {
  const x = env();
  assert.deepEqual(await run(v({ type: 'copy', text: 'abc' }), x.e), { ok: true, status: 'done', message: 'Kopiert' });
  assert.deepEqual(x.copied, ['abc']);
  await run(v({ type: 'send', text: 'Hallo' }), x.e);
  assert.deepEqual(x.sent, ['Hallo']);
  await run(v({ type: 'open_url', url: 'https://example.com' }), x.e);
  assert.deepEqual(x.opened, ['https://example.com']);
  const noSend = env({ send: undefined });
  assert.equal((await run(v({ type: 'send', text: 'x' }), noSend.e)).ok, false);
});

test('send refused by the chat (turn running) is not "done" – a waiting form stays editable', async () => {
  const busy = env({ send: () => false });
  const r = await run(v({ type: 'send', text: 'x' }), busy.e);
  assert.equal(r.ok, false);
  assert.equal(r.ok ? '' : r.error, 'Bitte warten, bis die Antwort fertig ist');
  assert.deepEqual(await run(v({ type: 'send', text: 'x' }), env({ send: () => true }).e), { ok: true, status: 'done' });
});

test('call / email / sms open the right URLs', async () => {
  const x = env();
  await run(v({ type: 'call', phone: '+49 151 234567' }), x.e);
  await run(v({ type: 'email', to: 'a@x.de', subject: 'Hi' }), x.e);
  await run(v({ type: 'sms', to: '0151 99', body: 'Yo' }), x.e);
  assert.deepEqual(x.opened, ['tel:+49151234567', 'mailto:a@x.de?subject=Hi', 'sms:015199?body=Yo']);
});

test('missing handler apps produce German errors', async () => {
  const x = env({ failUrls: () => true });
  assert.deepEqual(await run(v({ type: 'call', phone: '112' }), x.e), { ok: false, error: 'Die Telefon-App ist auf diesem Gerät nicht verfügbar.' });
  assert.match((await run(v({ type: 'email', to: 'a@x.de' }), x.e) as { error: string }).error, /Mail/);
  assert.match((await run(v({ type: 'sms', to: '112' }), x.e) as { error: string }).error, /Nachrichten/);
  assert.match((await run(v({ type: 'maps', query: 'x' }), x.e) as { error: string }).error, /Karten/);
});

test('maps falls back to the web URL when no geo: handler exists', async () => {
  const x = env({ failUrls: (u) => u.startsWith('geo:') });
  const r = await run(v({ type: 'maps', lat: 48.1, lng: 11.5 }), x.e);
  assert.equal(r.ok, true);
  assert.deepEqual(x.opened, ['https://www.google.com/maps/search/?api=1&query=48.1%2C11.5']);
});

test('calendar outcomes', async () => {
  const a = v({ type: 'calendar', title: 'Zahnarzt', start: '2026-10-14T10:00' });
  assert.deepEqual(await run(a, env().e), { ok: true, status: 'done', message: 'Termin eingetragen (Privat)' });
  const ui = await run(a, env({ addCalendarEvent: async () => ({ ok: true, via: 'ui', saved: null }) }).e);
  assert.equal(ui.ok && ui.message, 'Kalender geöffnet – dort speichern');
  const cancelled = await run(a, env({ addCalendarEvent: async () => ({ ok: true, via: 'ui', saved: false }) }).e);
  assert.deepEqual(cancelled, { ok: true, status: 'cancelled', message: 'Termin nicht gespeichert' });
  const bad = await run(a, env({ addCalendarEvent: async () => ({ ok: false, reason: 'error' }) }).e);
  assert.equal(bad.ok, false);
  const thrown = await run(a, env({ addCalendarEvent: async () => { throw new Error('native'); } }).e);
  assert.deepEqual(thrown, { ok: false, error: 'Das hat leider nicht geklappt.' });
});

test('reminder: schedules a notification, explains a denied permission', async () => {
  const seen: { title: string; body?: string; at: Date }[] = [];
  const a = v({ type: 'reminder', title: 'Müll rausstellen', at: '2026-10-11T08:00' });
  const ok = await run(a, env({ scheduleNotification: async (o) => (seen.push(o), { ok: true, id: 'x' }) }).e);
  assert.equal(ok.ok && ok.message, 'Erinnerung gesetzt: So 11. Okt, 08:00');
  assert.equal(seen[0].body, 'Müll rausstellen');
  assert.equal(seen[0].at.getDate(), 11);
  const denied = await run(a, env({ scheduleNotification: async () => ({ ok: false, reason: 'denied' }) }).e);
  assert.match((denied as { error: string }).error, /Benachrichtigungen sind nicht erlaubt/);
});

test('timer: starts and reports notification state', async () => {
  const started: { label: string; seconds: number }[] = [];
  const x = env({ startTimer: async (o) => (started.push(o), { timer: {} as never, notified: true }) });
  const r = await run(v({ type: 'timer', seconds: 600, label: 'Nudeln' }), x.e);
  assert.deepEqual(started, [{ label: 'Nudeln', seconds: 600 }]);
  assert.equal(r.ok && r.message, 'Timer gestartet: 10:00 · Nudeln');
  const quiet = await run(v({ type: 'timer', seconds: 60 }), env({ startTimer: async () => ({ timer: {} as never, notified: false }) }).e);
  assert.equal(quiet.ok && quiet.message, 'Timer gestartet: 01:00 (ohne Benachrichtigung)');
});

test('add_to_list: appended / duplicates / create fallback', async () => {
  const a = v({ type: 'add_to_list', items: ['Milch', 'Eier'] });
  const one = await run(a, env().e);
  assert.equal(one.ok && one.message, 'Zur Liste hinzugefügt');
  const none = await run(a, env({ appendToList: async () => ({ status: 'appended', key: 'k', messageId: 'm', nodeId: 'n', added: [], reopened: [], skipped: ['Milch', 'Eier'] }) }).e);
  assert.equal(none.ok && none.message, 'Steht schon auf der Liste');
  const many = await run(a, env({ appendToList: async () => ({ status: 'appended', key: 'k', messageId: 'm', nodeId: 'n', added: ['A', 'B', 'C'], reopened: [], skipped: ['D'] }) }).e);
  assert.equal(many.ok && many.message, '3 Einträge zur Liste hinzugefügt (1 schon vorhanden)');

  const x = env({ appendToList: async (_c, items) => ({ status: 'no_checklist', listTitle: 'Einkaufsliste', items }) });
  const created = await run(a, x.e);
  assert.equal(created.ok && created.message, 'Einkaufsliste angelegt');
  assert.deepEqual(x.events, [{ type: 'create_list', conversationId: 'c1', title: 'Einkaufsliste', kind: 'shopping', items: ['Milch', 'Eier'] }]);
});

test('add_to_list without a conversation asks the UI to create a list', async () => {
  const x = env({ conversationId: undefined });
  await run(v({ type: 'add_to_list', items: ['A'], listTitle: 'Packliste' }), x.e);
  assert.deepEqual(x.events, [{ type: 'create_list', title: 'Packliste', kind: 'shopping', items: ['A'] }]);
});

test('toast texts follow the active language', async () => {
  const x = env();
  assert.deepEqual(await run(v({ type: 'copy', text: 'abc' }), x.e, EN), { ok: true, status: 'done', message: 'Copied' });
  const timer = await run(v({ type: 'timer', seconds: 600, label: 'Pasta' }), x.e, EN);
  assert.equal(timer.ok && timer.message, 'Timer started: 10:00 · Pasta');
  const list = env({ appendToList: async () => ({ status: 'appended', key: 'k', messageId: 'm', nodeId: 'n', added: ['A', 'B'], reopened: [], skipped: ['C'] }) });
  const r = await run(v({ type: 'add_to_list', items: ['A', 'B', 'C'] }), list.e, EN);
  assert.equal(r.ok && r.message, '2 items added to the list (1 already there)');
});

test('executor refuses URLs outside the allow-list even if a builder were buggy', async () => {
  const x = env();
  const r = await run({ type: 'open_url', url: 'javascript:alert(1)' }, x.e);
  assert.equal(r.ok, false);
  assert.deepEqual(x.opened, []);
});
