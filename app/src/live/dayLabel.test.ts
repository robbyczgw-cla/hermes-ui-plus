// R4-06 (0.3 real-user round 4, 0.2.0): the model labelled the Salzburg trip "Freitag 24." / "Samstag 25." / "Sonntag 26."
// (October 2026: 24 = Saturday). Tab labels below are verbatim from that payload; the dates are what an explicit ISO date
// on the day's agenda would add. With a date the weekday is derived from it, without a date nothing is guessed.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dayLabelForDate, weekdayOfIso } from './dayLabel.ts';
import { fullFromNode } from './nodes.ts';
import type { HuiTabs } from '../protocol/types.ts';

test('weekdayOfIso: real dates only', () => {
  assert.equal(weekdayOfIso('2026-10-24'), 6);
  assert.equal(weekdayOfIso('2026-10-25'), 0);
  assert.equal(weekdayOfIso('2026-10-26'), 1);
  assert.equal(weekdayOfIso('2026-02-30'), undefined);
  assert.equal(weekdayOfIso('24.10.2026'), undefined);
  assert.equal(weekdayOfIso(undefined), undefined);
});

test('the weekday follows the date, in the label\'s own language and length', () => {
  assert.equal(dayLabelForDate('Freitag 24.', '2026-10-24'), 'Samstag 24.');
  assert.equal(dayLabelForDate('Samstag 25. (Regen)', '2026-10-25'), 'Sonntag 25. (Regen)');
  assert.equal(dayLabelForDate('Sonntag 26.', '2026-10-26'), 'Montag 26.');
  assert.equal(dayLabelForDate('Fr 24.', '2026-10-24'), 'Sa 24.');
  assert.equal(dayLabelForDate('Fri, Oct 24', '2026-10-24'), 'Sat, Oct 24');
  assert.equal(dayLabelForDate('Viernes 24', '2026-10-24'), 'sábado 24');
});

test('nothing changes when they agree, when there is no date or no weekday word', () => {
  assert.equal(dayLabelForDate('Samstag 24.', '2026-10-24'), 'Samstag 24.');
  assert.equal(dayLabelForDate('Freitag 24.', undefined), 'Freitag 24.');
  assert.equal(dayLabelForDate('Anreise', '2026-10-24'), 'Anreise');
  assert.equal(dayLabelForDate('Tag 1', '2026-10-24'), 'Tag 1');
  assert.equal(dayLabelForDate('Mittwochs-Markt', '2026-10-24'), 'Mittwochs-Markt');
});

const trip = (dates: (string | undefined)[]): Partial<HuiTabs> =>
  ({
    type: 'tabs',
    id: 'salzburg_trip',
    live: true,
    title: 'Salzburg, 24.–26. Oktober',
    tabs: ['Freitag 24.', 'Samstag 25. (Regen)', 'Sonntag 26.'].map((label, i) => ({
      id: ['fr24', 'sa25', 'so26'][i],
      label,
      children: [{ type: 'agenda', id: `d${i}`, ...(dates[i] ? { date: dates[i] } : {}), blocks: [{ id: `b${i}`, start: '10:00', end: '11:00', title: 'x' }] }],
    })),
  }) as unknown as Partial<HuiTabs>;

test('live trip: with dates the day labels agree with them; as sent (no dates) they stay as the model wrote them', () => {
  const dated = fullFromNode(trip(['2026-10-24', '2026-10-25', '2026-10-26']));
  assert.deepEqual(dated?.meta.days?.map((d) => d.label), ['Samstag 24.', 'Sonntag 25. (Regen)', 'Montag 26.']);
  const plain = fullFromNode(trip([undefined, undefined, undefined]));
  assert.deepEqual(plain?.meta.days?.map((d) => d.label), ['Freitag 24.', 'Samstag 25. (Regen)', 'Sonntag 26.']);
});
