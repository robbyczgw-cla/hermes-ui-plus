import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  agendaReply,
  calendarActionFor,
  dragToMinutes,
  formatClock,
  formatHourLabel,
  formatShortClock,
  kindPaletteIndex,
  layoutOverlaps,
  moveBlock,
  nowMinuteIfToday,
  readBlocks,
  readIsoDate,
  resizeBlockEnd,
  samePlan,
  snapMinutes,
  suggestNewStart,
  visibleRange,
  type AgendaBlock,
} from './agendaModel.ts';
import {
  conditionKey,
  conditionParts,
  convertTemp,
  convertWind,
  dayKind,
  formatPercent,
  formatTemp,
  hourCondition,
  precipLabel,
  rangeBar,
  readWeather,
  scalePos,
  tempColor,
  tempScale,
  toCondition,
  withDaypart,
} from './weatherModel.ts';
import { HUI_WEATHER_CONDITIONS } from '../../../../protocol/types.ts';

const B = (id: string, s: string, e: string, extra: Partial<AgendaBlock> = {}): AgendaBlock => {
  const [sh, sm] = s.split(':').map(Number);
  const [eh, em] = e.split(':').map(Number);
  return { id, start: sh * 60 + sm, end: eh * 60 + em, title: id, ...extra };
};

/* ───────── agenda: parsing ───────── */

test('readBlocks: HH:MM, ISO, invalid end, sorting, caps, dup ids', () => {
  const blocks = readBlocks([
    { id: 'x', start: '10:00', end: '11:30', title: 'B', kind: 'work' },
    { start: '2026-10-11T08:15:00', end: '2026-10-11T09:00', title: 'A', kind: 'nope' },
    { id: 'x', start: '12:00', end: '11:00', title: 'C' }, // end before start → +60
    { start: '25:00', end: '26:00', title: 'bad' },
    { start: '09:00', title: '' },
    'garbage',
  ]);
  assert.deepEqual(
    blocks.map((b) => [b.title, b.start, b.end, b.kind]),
    [
      ['A', 495, 540, undefined],
      ['B', 600, 690, 'work'],
      ['C', 720, 780, undefined],
    ],
  );
  assert.equal(new Set(blocks.map((b) => b.id)).size, 3);
  assert.equal(readBlocks(Array.from({ length: 40 }, (_, i) => ({ start: '08:00', end: '09:00', title: `t${i}` }))).length, 30);
  assert.deepEqual(readBlocks(undefined), []);
  // 23:30 start without end → capped at 23:59
  assert.equal(readBlocks([{ start: '23:30', title: 'late' }])[0].end, 23 * 60 + 59);
});

/* ───────── agenda: snapping / time math ───────── */

test('snapMinutes + dragToMinutes', () => {
  assert.equal(snapMinutes(7), 0);
  assert.equal(snapMinutes(8), 15);
  assert.equal(snapMinutes(52), 45);
  assert.equal(snapMinutes(53), 60);
  // 60 px per hour → 15 px per step
  assert.equal(dragToMinutes(0, 60), 0);
  assert.equal(dragToMinutes(7, 60), 0);
  assert.equal(dragToMinutes(8, 60), 15);
  assert.equal(dragToMinutes(-31, 60), -30);
  assert.equal(Object.is(dragToMinutes(-3, 60), -0), false);
  assert.equal(dragToMinutes(100, 0), 0);
});

test('moveBlock keeps duration, snaps and clamps to the day', () => {
  const b = B('a', '09:10', '10:10');
  assert.deepEqual([moveBlock(b, 15).start, moveBlock(b, 15).end], [9 * 60 + 30, 10 * 60 + 30]); // 9:25 → snaps 9:30
  assert.deepEqual([moveBlock(b, -600).start, moveBlock(b, -600).end], [0, 60]);
  const late = moveBlock(B('b', '22:00', '23:30'), 180);
  assert.deepEqual([late.start, late.end], [22 * 60 + 30, 24 * 60]);
});

test('resizeBlockEnd: snap, min 15 min, max 24:00', () => {
  const b = B('a', '09:00', '10:00');
  assert.equal(resizeBlockEnd(b, 20).end, 10 * 60 + 15);
  assert.equal(resizeBlockEnd(b, -120).end, 9 * 60 + 15);
  assert.equal(resizeBlockEnd(B('c', '23:00', '23:45'), 120).end, 24 * 60);
});

test('formatClock: 24 h for de/es, Intl for en', () => {
  assert.equal(formatClock(9 * 60 + 5, 'de-DE', 'de'), '09:05');
  assert.equal(formatClock(21 * 60, 'es-ES', 'es'), '21:00');
  assert.equal(formatClock(24 * 60, 'de-DE', 'de'), '24:00');
  assert.match(formatClock(21 * 60 + 30, 'en-US', 'en'), /^9:30\s?PM$/);
  assert.equal(formatClock(21 * 60 + 30, 'en-GB', 'en'), '21:30');
  assert.equal(formatHourLabel(7, 'de-DE', 'de'), '07');
  assert.match(formatHourLabel(13, 'en-US', 'en'), /^1\s?PM$/);
});

test('formatShortClock: full hours drop ":00" only in 12 h locales (weather hour row)', () => {
  assert.match(formatShortClock(12 * 60, 'en-US', 'en'), /^12\s?PM$/);
  assert.match(formatShortClock(14 * 60 + 30, 'en-US', 'en'), /^2:30\s?PM$/);
  assert.equal(formatShortClock(14 * 60, 'en-GB', 'en'), '14:00');
  assert.equal(formatShortClock(14 * 60, 'de-DE', 'de'), '14:00');
  assert.equal(formatShortClock(24 * 60, 'de-DE', 'de'), '24:00');
});

/* ───────── agenda: overlap layout ───────── */

test('layoutOverlaps: no overlap → one column each', () => {
  const l = layoutOverlaps([B('a', '09:00', '10:00'), B('b', '10:00', '11:00')]);
  assert.deepEqual(l, { a: { col: 0, cols: 1 }, b: { col: 0, cols: 1 } });
});

test('layoutOverlaps: pairs, triples, column reuse and separate clusters', () => {
  const l = layoutOverlaps([
    B('a', '09:00', '11:00'),
    B('b', '09:30', '10:00'),
    B('c', '10:00', '10:30'), // b ended → reuses column 1
    B('d', '10:15', '10:45'), // overlaps a + c → column 2
    B('e', '12:00', '13:00'), // new cluster
  ]);
  assert.deepEqual(l.a, { col: 0, cols: 3 });
  assert.deepEqual(l.b, { col: 1, cols: 3 });
  assert.deepEqual(l.c, { col: 1, cols: 3 });
  assert.deepEqual(l.d, { col: 2, cols: 3 });
  assert.deepEqual(l.e, { col: 0, cols: 1 });
});

test('layoutOverlaps: chain stays one cluster while it overlaps transitively', () => {
  const l = layoutOverlaps([B('a', '08:00', '09:00'), B('b', '08:30', '09:30'), B('c', '09:15', '10:00')]);
  assert.deepEqual([l.a.col, l.b.col, l.c.col], [0, 1, 0]);
  assert.ok([l.a, l.b, l.c].every((x) => x.cols === 2));
});

/* ───────── agenda: range, dates, reply, calendar ───────── */

test('visibleRange', () => {
  assert.deepEqual(visibleRange([B('a', '09:15', '10:00'), B('b', '13:00', '14:30')]), { startH: 9, endH: 15 });
  assert.deepEqual(visibleRange([B('a', '09:00', '10:00')]), { startH: 9, endH: 13 }); // min span 4
  assert.deepEqual(visibleRange([B('a', '09:00', '10:00')], { now: 7 * 60 + 40 }), { startH: 7, endH: 11 });
  assert.deepEqual(visibleRange([B('a', '22:00', '24:00')], { pad: 1 }), { startH: 20, endH: 24 });
  assert.deepEqual(visibleRange([]), { startH: 8, endH: 18 });
});

test('dates: readIsoDate + nowMinuteIfToday', () => {
  assert.equal(readIsoDate('2026-10-11'), '2026-10-11');
  assert.equal(readIsoDate('2026-02-30'), undefined);
  assert.equal(readIsoDate(3), undefined);
  const now = new Date(2026, 9, 11, 14, 7);
  assert.equal(nowMinuteIfToday('2026-10-11', now), 14 * 60 + 7);
  assert.equal(nowMinuteIfToday('2026-10-12', now), null);
  assert.equal(nowMinuteIfToday(undefined, now), null);
});

test('agendaReply: 24 h machine format, sorted, location', () => {
  const r = agendaReply('tag', [B('Mittag', '12:00', '13:00', { location: 'Kantine' }), B('Fokus', '09:00', '10:00')]);
  assert.equal(r, '[agenda:tag] 09:00–10:00 Fokus · 12:00–13:00 Mittag @ Kantine');
  assert.equal(agendaReply('x', []), '[agenda:x] –');
  assert.equal(agendaReply('x', [B('Spät', '23:00', '24:00')]), '[agenda:x] 23:00–24:00 Spät');
});

test('calendarActionFor: local ISO, 24:00 → 23:59, optional fields', () => {
  assert.deepEqual(calendarActionFor(B('Call', '09:30', '10:00', { location: 'Zoom', note: 'Agenda' }), '2026-10-11'), {
    type: 'calendar',
    title: 'Call',
    start: '2026-10-11T09:30:00',
    end: '2026-10-11T10:00:00',
    location: 'Zoom',
    notes: 'Agenda',
  });
  const a = calendarActionFor(B('Spät', '23:00', '24:00'), '2026-10-11');
  assert.equal(a.end, '2026-10-11T23:59:00');
  assert.equal('location' in a, false);
});

test('samePlan, suggestNewStart, kindPaletteIndex', () => {
  const p = [B('a', '09:00', '10:00'), B('b', '10:00', '11:00')];
  assert.ok(samePlan(p, [...p].reverse()));
  assert.ok(!samePlan(p, [p[0], { ...p[1], end: 11 * 60 + 15 }]));
  assert.ok(!samePlan(p, [p[0]]));
  assert.equal(suggestNewStart(p), 11 * 60);
  assert.equal(suggestNewStart([]), 9 * 60);
  assert.equal(suggestNewStart([B('z', '23:00', '24:00')]), 24 * 60 - 15);
  assert.equal(kindPaletteIndex('work', 8), 0);
  assert.equal(kindPaletteIndex('focus', 8), 6);
  assert.equal(kindPaletteIndex(undefined, 8), 7);
  assert.equal(kindPaletteIndex('focus', 4), 2);
});

/* ───────── weather: scale math ───────── */

test('tempScale: shared min..max across days (+ extra), min span', () => {
  assert.deepEqual(tempScale([{ min: 4.4, max: 12.2 }, { min: 6, max: 15.5 }]), { lo: 4, hi: 16 });
  assert.deepEqual(tempScale([{ min: 4, max: 6 }], [3]), { lo: 2, hi: 7 }); // span 3 → padded to ≥ 4
  assert.deepEqual(tempScale([{ min: 10, max: 10 }]), { lo: 8, hi: 12 });
  assert.equal(tempScale([]), null);
  assert.deepEqual(tempScale([], [5, NaN]), { lo: 3, hi: 7 });
});

test('scalePos + rangeBar', () => {
  const s = { lo: 0, hi: 20 };
  assert.equal(scalePos(5, s), 0.25);
  assert.equal(scalePos(-5, s), 0);
  assert.equal(scalePos(30, s), 1);
  assert.equal(scalePos(3, { lo: 3, hi: 3 }), 0.5);
  assert.deepEqual(rangeBar(5, 15, s), { left: 0.25, width: 0.5 });
  const tiny = rangeBar(10, 10, s);
  assert.ok(Math.abs(tiny.width - 0.06) < 1e-9);
  assert.ok(Math.abs(tiny.left - 0.47) < 1e-9);
  const edge = rangeBar(20, 20, s);
  assert.ok(edge.left + edge.width <= 1 + 1e-9);
  assert.ok(Math.abs(edge.width - 0.06) < 1e-9);
});

test('units + formatting', () => {
  assert.equal(convertTemp(100, 'C', 'F'), 212);
  assert.equal(convertTemp(32, 'F', 'C'), 0);
  assert.equal(convertTemp(21, 'C', 'C'), 21);
  assert.ok(Math.abs(convertWind(16.09344, 'C', 'F') - 10) < 1e-9);
  assert.ok(Math.abs(convertWind(10, 'F', 'C') - 16.09344) < 1e-9);
  assert.equal(formatTemp(-0.4), '0°');
  assert.equal(formatTemp(-3.6), '−4°');
  assert.equal(formatTemp(21.5, 'C'), '22°C');
  assert.equal(formatPercent(40, 'en'), '40%');
  assert.equal(formatPercent(40, 'de'), '40 %');
  assert.equal(precipLabel(5, 'en'), null);
  assert.equal(precipLabel(43, 'en'), '45%');
  assert.equal(precipLabel(undefined), null);
});

test('tempColor: endpoints clamp, interpolates between stops', () => {
  assert.equal(tempColor(-40), '#6E8BEF');
  assert.equal(tempColor(50), '#E0504A');
  assert.equal(tempColor(10), '#3FBFA3');
  assert.match(tempColor(14), /^#[0-9A-F]{6}$/);
  assert.notEqual(tempColor(14), tempColor(10));
  assert.equal(tempColor(NaN), '#3FBFA3');
});

/* ───────── weather: condition mapping ───────── */

test('toCondition: protocol values, aliases, unknown → cloudy', () => {
  for (const c of HUI_WEATHER_CONDITIONS) assert.equal(toCondition(c), c);
  assert.equal(toCondition('Partly Cloudy'), 'partly');
  assert.equal(toCondition('clear_night'), 'clear-night');
  assert.equal(toCondition('Thunderstorm'), 'thunder');
  assert.equal(toCondition('mist'), 'fog');
  assert.equal(toCondition('tornado'), 'cloudy');
  assert.equal(toCondition(undefined), 'cloudy');
});

test('conditionParts + conditionKey cover every condition', () => {
  for (const c of HUI_WEATHER_CONDITIONS) {
    const p = conditionParts(c);
    assert.ok(p.sun || p.moon || p.cloud || p.wind, `${c} has a visual`);
    assert.match(conditionKey(c), /^[a-zA-Z]+$/);
  }
  assert.deepEqual(conditionParts('sunny'), { sun: 'full' });
  assert.equal(conditionParts('clear-night').moon, 'full');
  assert.equal(conditionParts('partly-night').moon, 'small');
  assert.equal(conditionParts('rain').precip, 'rain');
  assert.equal(conditionParts('snow').precip, 'snow');
  assert.equal(conditionParts('thunder').bolt, true);
  assert.equal(conditionParts('fog').fog, true);
  assert.equal(conditionKey('clear-night'), 'clearNight');
  assert.equal(conditionKey('partly-night'), 'partlyNight');
});

test('night variants', () => {
  assert.equal(withDaypart('clear', true), 'clear-night');
  assert.equal(withDaypart('sunny', true), 'clear-night');
  assert.equal(withDaypart('partly', true), 'partly-night');
  assert.equal(withDaypart('rain', true), 'rain');
  assert.equal(withDaypart('clear-night', false), 'clear');
  assert.equal(hourCondition({ condition: 'clear', minutes: 23 * 60 }), 'clear-night');
  assert.equal(hourCondition({ condition: 'clear', minutes: 12 * 60 }), 'clear');
  assert.equal(hourCondition({ condition: 'partly-night', minutes: 13 * 60 }), 'partly');
  assert.equal(hourCondition({ condition: 'clear', minutes: null }), 'clear');
});

test('readWeather: tolerant parsing', () => {
  const w = readWeather({
    location: ' Berlin ',
    unit: '°f',
    current: { temp: '12', condition: 'Rain', humidity: 140 },
    hourly: [{ time: '14:00', temp: 11, condition: 'cloudy', precip: 30 }, { time: 'x', temp: 5 }, { time: '15:00' }],
    daily: [{ date: '2026-10-11', min: 14, max: 9, condition: 'sunny' }, { date: 'bad', min: 1, max: 2 }],
  });
  assert.equal(w.location, 'Berlin');
  assert.equal(w.unit, 'F');
  assert.deepEqual(w.current, { temp: 12, condition: 'rain', feelsLike: undefined, wind: undefined, humidity: 100, precip: undefined });
  assert.equal(w.hourly.length, 2);
  assert.equal(w.hourly[0].minutes, 14 * 60);
  assert.equal(w.hourly[1].minutes, null); // time 'x' kept as label, no clock
  assert.deepEqual(w.daily, [{ date: '2026-10-11', min: 9, max: 14, condition: 'sunny', precip: undefined }]);
  assert.equal(readWeather({}).unit, 'C');
});

test('dayKind', () => {
  assert.equal(dayKind('2026-10-11', '2026-10-11'), 'today');
  assert.equal(dayKind('2026-10-12', '2026-10-11'), 'tomorrow');
  assert.equal(dayKind('2026-10-14', '2026-10-11'), 3); // Wednesday
  assert.equal(dayKind('2026-11-01', '2026-10-31'), 'tomorrow');
});
