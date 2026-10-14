import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calendarLayout,
  cleanSeries3,
  dayToIso,
  gaugeAngle,
  gaugeFraction,
  gaugeRange,
  hbarPath,
  arcStroke,
  heatDomain,
  heatLevel,
  heatRamp,
  heatWeight,
  isoDay,
  linearScale,
  looseTicks,
  mixHex,
  nearestPoint,
  polygonPath,
  radarAnchor,
  radarAngle,
  radarMax,
  radarPolygon,
  sparklinePath,
  sparkValues,
  stackSeries,
  waterfallBars,
  waterfallExtent,
  weekdayMon0,
  wrapLabel,
} from './chartMath3.ts';

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('cleanSeries3 keeps v3 fields and tolerates partial data', () => {
  const s = cleanSeries3([
    { name: 'A', data: [{ x: 3, y: 2, label: 'P' }, { x: 'Mo', y2: 'W1', y: '4' }, { x: 'T', y: 9, total: true }, { x: 'z' }, null, [5, 6]] },
    'junk',
    { data: [] },
  ]);
  assert.equal(s.length, 2);
  assert.deepEqual(s[0].points, [
    { x: '3', xn: 3, y: 2, label: 'P' },
    { x: 'Mo', y: 4, y2: 'W1' },
    { x: 'T', y: 9, total: true },
    { x: '5', xn: 5, y: 6 },
  ]);
  assert.equal(s[1].name, '#3');
  assert.deepEqual(cleanSeries3(null), []);
});

test('scatter scales: linearScale + looseTicks + nearestPoint', () => {
  const sx = linearScale(10, 20, 0, 100);
  assert.equal(sx(10), 0);
  assert.equal(sx(15), 50);
  assert.equal(sx(20), 100);
  const sy = linearScale(0, 10, 200, 0); // inverted (screen y)
  assert.equal(sy(10), 0);
  assert.equal(linearScale(5, 5, 0, 100)(5), 50);
  const ticks = looseTicks(153, 187, 4);
  assert.ok(ticks[0] <= 153 && ticks[ticks.length - 1] >= 187);
  assert.ok(ticks[0] > 0, 'loose ticks do not force zero');
  assert.deepEqual(looseTicks(0, 1, 4), [0, 0.25, 0.5, 0.75, 1]);
  assert.ok(looseTicks(5, 5).length >= 2);
  const pts = [{ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 52, y: 49 }];
  assert.equal(nearestPoint(pts, 51, 50), 1);
  assert.equal(nearestPoint(pts, 200, 200), null);
});

test('stackSeries stacks positives up, negatives down, honours hidden', () => {
  const series = [
    { points: [{ x: 'a', y: 2 }, { x: 'b', y: -1 }] },
    { points: [{ x: 'a', y: 3 }, { x: 'b', y: 4 }] },
  ];
  const r = stackSeries(series, ['a', 'b']);
  assert.deepEqual(r.stacks[0], [{ si: 0, y0: 0, y1: 2, v: 2 }, { si: 1, y0: 2, y1: 5, v: 3 }]);
  assert.deepEqual(r.stacks[1], [{ si: 0, y0: 0, y1: -1, v: -1 }, { si: 1, y0: 0, y1: 4, v: 4 }]);
  assert.equal(r.max, 5);
  assert.equal(r.min, -1);
  assert.deepEqual(r.totals, [5, 3]);
  const h = stackSeries(series, ['a', 'b'], new Set([0]));
  assert.deepEqual(h.stacks[0], [{ si: 1, y0: 0, y1: 3, v: 3 }]);
  assert.equal(h.min, 0);
});

test('radar polygon coordinates', () => {
  assert.equal(radarAngle(0, 4), 0);
  near(radarAngle(1, 4), Math.PI / 2);
  // 4 axes, max 10, center (100,100), r 50
  const pts = radarPolygon([10, 5, 10, 0], 10, 100, 100, 50);
  near(pts[0].x, 100);
  near(pts[0].y, 50); // top, full
  near(pts[1].x, 125);
  near(pts[1].y, 100); // right, half
  near(pts[2].x, 100);
  near(pts[2].y, 150); // bottom, full
  near(pts[3].x, 100);
  near(pts[3].y, 100); // left, zero → center
  // clamped above max, missing → 0, entrance scale
  const c = radarPolygon([20, undefined, 10], 10, 0, 0, 10, 0.5);
  near(c[0].y, -5);
  near(c[1].x, 0);
  assert.ok(polygonPath(pts).startsWith('M100,50L125,100'));
  assert.ok(polygonPath(pts).endsWith('Z'));
  assert.equal(radarMax([3, 7.2]), 10);
  assert.equal(radarMax([3, 7.2], 8), 8);
  assert.equal(radarMax([0]), 1);
  assert.equal(radarAnchor(0), 'middle');
  assert.equal(radarAnchor(Math.PI / 2), 'start');
  assert.equal(radarAnchor(-Math.PI / 2), 'end');
});

test('wrapLabel wraps axis labels (hyphens, long compounds, max lines)', () => {
  assert.deepEqual(wrapLabel('Akku', 10), ['Akku']);
  assert.deepEqual(wrapLabel('sehr gute Kamera', 10), ['sehr gute', 'Kamera']);
  assert.deepEqual(wrapLabel('Preis-Leistungs-Verhältnis', 10, 3), ['Preis-', 'Leistungs-', 'Verhältnis']);
  assert.deepEqual(wrapLabel('Akkulaufzeit', 9), ['Akkulauf-', 'zeit']);
  assert.deepEqual(wrapLabel('Preis Leistung Verhältnis Extra', 10, 2), ['Preis', 'Leistung…']);
  assert.deepEqual(wrapLabel('Bildschirmqualitätsbewertung', 8, 2), ['Bildsch-', 'irmqual…']);
});

test('gauge angles and range', () => {
  assert.deepEqual(gaugeRange(), { min: 0, max: 100 });
  assert.deepEqual(gaugeRange(10, 5), { min: 10, max: 11 });
  assert.deepEqual(gaugeRange(50), { min: 50, max: 100 });
  assert.deepEqual(gaugeRange(150), { min: 150, max: 250 });
  near(gaugeAngle(0, 0, 100), -Math.PI / 2);
  near(gaugeAngle(50, 0, 100), 0);
  near(gaugeAngle(100, 0, 100), Math.PI / 2);
  near(gaugeAngle(150, 0, 100), Math.PI / 2); // clamped
  near(gaugeAngle(-5, 0, 100), -Math.PI / 2);
  near(gaugeAngle(25, 20, 30), 0);
  assert.equal(gaugeFraction(7, 5, 5), 0);
});

test('heatmap: ISO days and week bucketing (Monday rows)', () => {
  assert.equal(isoDay('1970-01-01'), 0);
  assert.equal(isoDay('2026-02-30'), undefined);
  assert.equal(isoDay('nope'), undefined);
  assert.equal(weekdayMon0(0), 3); // Thursday
  assert.equal(weekdayMon0(isoDay('2026-10-12')!), 0); // Monday
  assert.equal(weekdayMon0(isoDay('2026-10-11')!), 6); // Sunday
  const lay = calendarLayout([
    { x: '2026-10-07', y: 2 }, // Wed
    { x: '2026-10-11', y: 1 }, // Sun
    { x: '2026-10-12', y: 5 }, // Mon (next week)
    { x: '2026-10-12', y: 1 }, // duplicate summed
    { x: 'bad', y: 9 },
  ])!;
  assert.equal(lay.weeks, 2);
  assert.equal(lay.cells.length, 6); // Wed..Mon inclusive
  const first = lay.cells[0];
  assert.deepEqual([first.col, first.row, first.value], [0, 2, 2]);
  const sun = lay.cells.find((c) => dayToIso(c.day) === '2026-10-11')!;
  assert.deepEqual([sun.col, sun.row], [0, 6]);
  const mon = lay.cells.find((c) => dayToIso(c.day) === '2026-10-12')!;
  assert.deepEqual([mon.col, mon.row, mon.value], [1, 0, 6]);
  assert.equal(lay.cells.find((c) => dayToIso(c.day) === '2026-10-08')!.value, undefined);
  assert.equal(calendarLayout([{ x: 'x', y: 1 }]), null);
});

test('heatmap: month labels ≥ 3 columns apart', () => {
  const pts = [];
  for (let d = isoDay('2026-01-01')!; d <= isoDay('2026-04-30')!; d++) pts.push({ x: dayToIso(d), y: d % 5 });
  const lay = calendarLayout(pts)!;
  assert.deepEqual(lay.months.map((m) => m.month), [0, 1, 2, 3]);
  assert.equal(lay.months[0].col, 0);
  for (let i = 1; i < lay.months.length; i++) assert.ok(lay.months[i].col - lay.months[i - 1].col >= 3);
  // Feb 1 2026 is a Sunday → label on the week starting Mon Feb 2 (column 5)
  assert.equal(lay.months[1].col, 5);
  // start late in month: label dropped in favour of the next month
  const late = calendarLayout([{ x: '2026-01-29', y: 1 }, { x: '2026-03-01', y: 1 }])!;
  assert.deepEqual(late.months.map((m) => m.month), [1]);
});

test('heatmap: color scale levels + ramp', () => {
  assert.equal(heatLevel(0, 0, 10), 0);
  assert.equal(heatLevel(0.1, 0, 10), 1);
  assert.equal(heatLevel(2.5, 0, 10), 1);
  assert.equal(heatLevel(2.6, 0, 10), 2);
  assert.equal(heatLevel(10, 0, 10), 4);
  assert.equal(heatLevel(99, 0, 10), 4);
  assert.equal(heatLevel(3, 3, 3), 4);
  assert.equal(heatLevel(0, 0, 0), 0);
  assert.deepEqual(heatDomain([3, 8]), { lo: 0, hi: 8 });
  assert.deepEqual(heatDomain([-2, 8]), { lo: -2, hi: 8 });
  assert.equal(mixHex('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(mixHex('#fff', '#000', 0), '#ffffff');
  assert.equal(mixHex('rgba(0,0,0,1)', '#000', 0.5), null);
  assert.equal(heatWeight(0), 0);
  near(heatWeight(4), 1);
  const ramp = heatRamp('#ffffff', '#2563eb');
  assert.equal(ramp.length, 5);
  assert.equal(ramp[0].fill, '#ffffff');
  assert.equal(ramp[4].fill, '#2563eb');
  assert.ok(ramp.every((r) => r.opacity === 1));
  const fb = heatRamp('rgba(1,1,1,0.1)', '#2563eb');
  assert.equal(fb[4].fill, '#2563eb');
  assert.ok(fb[1].opacity < 1);
});

test('waterfall running totals', () => {
  const bars = waterfallBars([
    { x: 'Start', y: 100 },
    { x: 'Umsatz', y: 50 },
    { x: 'Kosten', y: -80 },
    { x: 'Zwischen', y: 999, total: true },
    { x: 'Steuer', y: -20 },
    { x: 'Ende', y: 0, total: true },
  ]);
  assert.deepEqual(
    bars.map((b) => [b.start, b.end, b.total]),
    [
      [0, 100, false],
      [100, 150, false],
      [150, 70, false],
      [0, 70, true],
      [70, 50, false],
      [0, 50, true],
    ],
  );
  assert.equal(bars[2].delta, -80);
  assert.deepEqual(waterfallExtent(bars), { min: 0, max: 150 });
  assert.deepEqual(waterfallExtent(waterfallBars([{ x: 'a', y: -30 }, { x: 'b', y: 10 }])), { min: -30, max: 0 });
});

test('sparkline', () => {
  assert.deepEqual(sparkValues([1]), []);
  assert.deepEqual(sparkValues([1, 'x', '2', null, 3]), [1, 2, 3]);
  assert.equal(sparkValues(Array.from({ length: 80 }, (_, i) => i)).length, 60);
  const p = sparklinePath([0, 10, 5], 100, 20, 0)!;
  assert.equal(p.d, 'M0,20L50,0L100,10');
  assert.deepEqual(p.last, { x: 100, y: 10 });
  const flat = sparklinePath([4, 4], 10, 10, 0)!;
  assert.equal(flat.last.y, 5);
  assert.equal(sparklinePath([1], 10, 10), null);
});

test('hbarPath + arcStroke', () => {
  assert.equal(hbarPath(0, 0.2, 0, 10), '');
  assert.ok(hbarPath(10, 100, 0, 10).startsWith('M10,0H96Q100,0'));
  assert.ok(hbarPath(100, 10, 0, 10).startsWith('M100,0H14Q10,0'));
  assert.equal(arcStroke(0, 0, 10, 0, 0), '');
  // gauge semicircle: 9 o'clock → 3 o'clock
  const d = arcStroke(50, 50, 40, -Math.PI / 2, Math.PI / 2);
  assert.equal(d, 'M10,50A40,40 0 0 1 90,50');
});
