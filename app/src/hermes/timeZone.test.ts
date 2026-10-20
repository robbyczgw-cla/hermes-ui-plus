/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { userTimeZoneMessage, zoneOffsetMinutes } from './timeZone.ts';
import { buildRequest } from './stream.ts';

const SUMMER = Date.parse('2026-07-01T10:00:00Z');
const WINTER = Date.parse('2026-12-01T10:00:00Z');

test('zoneOffsetMinutes: DST, half hours, west of UTC', () => {
  assert.equal(zoneOffsetMinutes('Europe/Vienna', SUMMER), 120);
  assert.equal(zoneOffsetMinutes('Europe/Vienna', WINTER), 60);
  assert.equal(zoneOffsetMinutes('America/New_York', SUMMER), -240);
  assert.equal(zoneOffsetMinutes('Asia/Kolkata', SUMMER), 330);
  assert.equal(zoneOffsetMinutes('America/St_Johns', WINTER), -210);
  assert.equal(zoneOffsetMinutes('UTC', SUMMER), 0);
  assert.equal(zoneOffsetMinutes('Not/AZone', SUMMER), null);
});

test('userTimeZoneMessage: zone, offset and the date in that zone', () => {
  assert.equal(userTimeZoneMessage(SUMMER, 'Europe/Vienna'), '[hermes-ui-app] User time zone: Europe/Vienna (UTC+02:00), date there 2026-07-01 (Wed).');
  assert.equal(userTimeZoneMessage(WINTER, 'America/St_Johns'), '[hermes-ui-app] User time zone: America/St_Johns (UTC-03:30), date there 2026-12-01 (Tue).');
  // 23:30 UTC is already the next day in Vienna and still the same day in New York
  const late = Date.parse('2026-10-20T23:30:00Z');
  assert.match(userTimeZoneMessage(late, 'Europe/Vienna'), /\(UTC\+02:00\), date there 2026-10-21 \(Wed\)\.$/);
  assert.match(userTimeZoneMessage(late, 'America/New_York'), /\(UTC-04:00\), date there 2026-10-20 \(Tue\)\.$/);
  // unknown zone: name only, never a wrong offset
  assert.equal(userTimeZoneMessage(SUMMER, 'Not/AZone'), '[hermes-ui-app] User time zone: Not/AZone.');
});

test('userTimeZoneMessage: byte-identical within a day (prompt cache), new text the next day', () => {
  const a = userTimeZoneMessage(Date.parse('2026-10-20T06:00:00Z'), 'Europe/Vienna');
  assert.equal(userTimeZoneMessage(Date.parse('2026-10-20T21:59:00Z'), 'Europe/Vienna'), a);
  assert.notEqual(userTimeZoneMessage(Date.parse('2026-10-20T22:01:00Z'), 'Europe/Vienna'), a);
});

test('buildRequest: the time zone line goes right before the user message, bridge and direct alike', () => {
  const line = userTimeZoneMessage(SUMMER, 'Europe/Vienna');
  for (const conn of [{ baseUrl: 'http://h/v1', apiKey: 'k' }, { baseUrl: 'http://h/v1', apiKey: 'k', bridge: true, bootstrap: false }]) {
    const msgs = JSON.parse(buildRequest(conn, 'Erinnere mich morgen um 9', 's', undefined, true, undefined, false, undefined, line).body).messages;
    assert.deepEqual(msgs.at(-2), { role: 'system', content: line });
    assert.deepEqual(msgs.at(-1), { role: 'user', content: 'Erinnere mich morgen um 9' });
  }
  // not passed: nothing added (older callers, prepared requests)
  assert.equal(JSON.parse(buildRequest({ baseUrl: 'http://h/v1', apiKey: 'k', bootstrap: false }, 'hi', 's').body).messages.length, 1);
});
