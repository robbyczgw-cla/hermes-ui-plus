import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXCERPT_MAX,
  MAX_REPORTS,
  REPORTS_STORAGE_KEY,
  addReport,
  buildReportMailto,
  findReport,
  isHidden,
  makeReport,
  parseReports,
  readReports,
  removeReport,
  reportExcerpt,
  writeReports,
  type ReportStorage,
} from './reports.ts';

function mem(): ReportStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: async (k) => data.get(k) ?? null, setItem: async (k, v) => void data.set(k, v) };
}

test('makeReport trims the comment, drops empty values', () => {
  assert.deepEqual(makeReport({ messageId: 'm1', reason: 'wrong', comment: '  ' }, 5), { messageId: 'm1', conversationId: undefined, reason: 'wrong', comment: undefined, at: 5 });
  assert.equal(makeReport({ messageId: 'm1', reason: 'other', comment: 'x'.repeat(5000) }).comment?.length, 1000);
});

test('parseReports skips invalid entries', () => {
  assert.deepEqual(parseReports(null), []);
  assert.deepEqual(parseReports('{"a":1}'), []);
  const raw = JSON.stringify([{ messageId: 'a', reason: 'offensive', at: 1 }, { messageId: '', reason: 'wrong' }, { messageId: 'b', reason: 'bogus' }, null]);
  assert.deepEqual(parseReports(raw), [{ messageId: 'a', conversationId: undefined, reason: 'offensive', comment: undefined, at: 1 }]);
});

test('add replaces the report of the same answer and caps the list', () => {
  let list = addReport([], makeReport({ messageId: 'a', reason: 'wrong' }, 1));
  list = addReport(list, makeReport({ messageId: 'a', reason: 'legal' }, 2));
  assert.equal(list.length, 1);
  assert.equal(findReport(list, 'a')?.reason, 'legal');
  for (let i = 0; i < MAX_REPORTS + 10; i++) list = addReport(list, makeReport({ messageId: `m${i}`, reason: 'other' }, i));
  assert.equal(list.length, MAX_REPORTS);
  assert.equal(findReport(list, 'a'), undefined);
  assert.ok(findReport(list, `m${MAX_REPORTS + 9}`));
});

test('reported answers are hidden until revealed; withdrawing shows them again', () => {
  const list = addReport([], makeReport({ messageId: 'a', reason: 'offensive' }));
  assert.equal(isHidden(list, 'a', new Set()), true);
  assert.equal(isHidden(list, 'a', new Set(['a'])), false);
  assert.equal(isHidden(list, 'b', new Set()), false);
  assert.equal(isHidden(removeReport(list, 'a'), 'a', new Set()), false);
});

test('storage round trip (local only)', async () => {
  const s = mem();
  assert.deepEqual(await readReports(s), []);
  const list = addReport([], makeReport({ messageId: 'a', conversationId: 'c1', reason: 'legal', comment: 'hm' }, 7));
  await writeReports(s, list);
  assert.deepEqual([...s.data.keys()], [REPORTS_STORAGE_KEY]);
  assert.deepEqual(await readReports(s), list);
});

test('reportExcerpt: ≤ 500 chars incl. ellipsis, whitespace collapsed', () => {
  assert.equal(reportExcerpt('  a\n\n b  '), 'a b');
  const long = reportExcerpt('word '.repeat(400));
  assert.ok(long.length <= EXCERPT_MAX);
  assert.ok(long.endsWith('…'));
});

test('mailto: reason + version, excerpt only when given, CRLF and percent-encoding', () => {
  const base = {
    to: 'support@example.com',
    subject: 'Gemeldete KI-Antwort (Hermes UI+)',
    intro: 'Intro',
    labels: { reason: 'Grund', version: 'App-Version', comment: 'Kommentar', excerpt: 'Auszug' },
    reason: 'offensive' as const,
    reasonLabel: 'Anstößig/Gefährlich',
    appVersion: '1.0.0',
    platform: 'android',
  };
  const url = buildReportMailto(base);
  assert.ok(url.startsWith('mailto:support@example.com?subject=Gemeldete%20KI-Antwort%20(Hermes%20UI%2B)&body='));
  const body = decodeURIComponent(url.split('&body=')[1]);
  assert.ok(body.includes('Grund: Anstößig/Gefährlich (offensive)\r\nApp-Version: 1.0.0 (android)'));
  assert.ok(!body.includes('Auszug'));
  assert.ok(!body.includes('Kommentar'));
  const withExcerpt = decodeURIComponent(buildReportMailto({ ...base, comment: 'c & d', excerpt: 'x'.repeat(2000) }).split('&body=')[1]);
  assert.ok(withExcerpt.includes('Kommentar:\r\nc & d'));
  const ex = withExcerpt.split('Auszug:\r\n')[1];
  assert.ok(ex.length <= EXCERPT_MAX);
});
