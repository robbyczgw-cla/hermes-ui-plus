import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  animDuration,
  isValidLatLng,
  normalizeMap,
  parseMapMessage,
  pinLanding,
  pinPose,
  seekProgress,
  segmentVisible,
  stopsSummary,
  tripFrame,
  validateMarker,
  MAX_MARKERS,
} from './mapModel.ts';
import { buildMapCsp, buildMapDocument, mapInjection, MAP_ANIM_JS, LEAFLET_JS_SRI, TILE_ORIGIN } from './mapTemplate.ts';

test('marker validation', () => {
  assert.equal(isValidLatLng(41.89, 12.49), true);
  assert.equal(isValidLatLng(91, 0), false);
  assert.equal(isValidLatLng(10, 181), false);
  assert.equal(isValidLatLng(0, 0), false); // null island = missing data
  assert.equal(isValidLatLng('41.9', '12.5'), true);
  assert.equal(isValidLatLng(NaN, 1), false);
  assert.equal(validateMarker({ lat: 41.89, lng: 12.49 }, 0), null); // no title
  assert.equal(validateMarker({ lat: 'x', lng: 12, title: 'A' }, 0), null);
  assert.deepEqual(validateMarker({ lat: 41.89, lon: 12.49, title: '  Kolosseum\n', description: 'Arena', imageQuery: 'Kolosseum' }, 0), {
    lat: 41.89,
    lng: 12.49,
    title: 'Kolosseum',
    n: 1,
    description: 'Arena',
    imageQuery: 'Kolosseum',
  });
  assert.equal(validateMarker({ lat: 1, lng: 1, title: 'x', number: 7 }, 0)?.n, 7);
  assert.equal(validateMarker({ lat: 1, lng: 1, title: 'x', number: -1 }, 2)?.n, 3);
  assert.equal(validateMarker({ lat: 1, lng: 1, title: 'x'.repeat(500) }, 0)?.title.length, 120);
});

test('normalizeMap: drops invalid markers, caps count, route/animate need ≥ 2 stops', () => {
  const m = normalizeMap({
    id: 'rom',
    markers: [{ lat: 41.89, lng: 12.49, title: 'A' }, { lat: 999, lng: 0, title: 'B' }, { lat: 41.9, lng: 12.48, title: 'C' }],
    route: true,
    animate: true,
    zoom: 40,
    center: { lat: 200, lng: 0 },
  });
  assert.equal(m.markers.length, 2);
  assert.equal(m.dropped, 1);
  assert.deepEqual(m.markers.map((x) => x.n), [1, 2]); // renumbered by valid position
  assert.equal(m.route, true);
  assert.equal(m.animate, true);
  assert.equal(m.zoom, 18);
  assert.equal(m.center, undefined);
  const one = normalizeMap({ markers: [{ lat: 1, lng: 1, title: 'x' }], route: true, animate: true });
  assert.equal(one.route, false);
  assert.equal(one.animate, false);
  const many = normalizeMap({ markers: Array.from({ length: 40 }, (_, i) => ({ lat: 1 + i / 100, lng: 1, title: `S${i}` })) });
  assert.equal(many.markers.length, MAX_MARKERS);
  assert.equal(many.dropped, 10);
  assert.equal(stopsSummary(m.markers), '1. A · 2. C');
});

test('animation: pins land one after another, segments follow, final state complete', () => {
  const n = 4;
  const f0 = tripFrame(0, n);
  assert.deepEqual([pinLanding(f0, 0), pinLanding(f0, 1)], [0, 0]);
  assert.equal(pinPose(0).opacity, 0);
  assert.ok(Math.abs(pinPose(0).dy + 18) < 1e-9);
  assert.ok(Math.abs(pinPose(0).scale - 0.72) < 1e-9);
  assert.deepEqual(pinPose(1), { opacity: 1, dy: -0, scale: 1 });
  // within a slot: lands in first 55 %
  const mid = tripFrame((1 + 0.55) / n, n);
  assert.equal(mid.pinIndex, 1);
  assert.equal(mid.pinProgress, 1);
  assert.equal(pinLanding(mid, 0), 1);
  assert.equal(pinLanding(mid, 2), 0);
  assert.equal(segmentVisible(mid, 0), true);
  assert.equal(segmentVisible(mid, 1), false);
  const end = tripFrame(1, n);
  for (let i = 0; i < n; i++) assert.equal(pinLanding(end, i), 1);
  for (let k = 0; k < n - 1; k++) assert.equal(segmentVisible(end, k), true);
  // seek target shows the stop landed
  const s = tripFrame(seekProgress(1, n), n);
  assert.equal(s.pinIndex, 1);
  assert.equal(pinLanding(s, 1), 1);
  assert.equal(seekProgress(3, n), 1);
  // spring overshoot stays small (no bounce above ~2 px)
  let minDy = 0;
  for (let l = 0; l <= 1; l += 0.01) minDy = Math.max(minDy, pinPose(l).dy);
  assert.ok(minDy < 2.5, `overshoot ${minDy}`);
  assert.equal(animDuration(3), 6000);
  assert.equal(animDuration(20), 12000);
  assert.equal(animDuration(30), 18000);
});

test('WebView animation JS is equivalent to the TS model', () => {
  const js = new Function(`${MAP_ANIM_JS}; return { tripFrame, pinLanding, pinPose, seekProgress };`)() as {
    tripFrame: typeof tripFrame;
    pinLanding: typeof pinLanding;
    pinPose: typeof pinPose;
    seekProgress: typeof seekProgress;
  };
  for (const n of [2, 3, 7, 30]) {
    for (let p = -0.1; p <= 1.1; p += 0.013) {
      const a = tripFrame(p, n);
      const b = js.tripFrame(p, n);
      assert.deepEqual(b, a);
      for (let i = 0; i < n; i++) {
        assert.equal(js.pinLanding(b, i), pinLanding(a, i));
        assert.deepEqual(js.pinPose(pinLanding(a, i)), pinPose(pinLanding(a, i)));
      }
    }
    for (let i = 0; i < n; i++) assert.equal(js.seekProgress(i, n), seekProgress(i, n));
  }
});

test('map messages are validated', () => {
  assert.deepEqual(parseMapMessage('{"t":"select","i":1}', 3), { t: 'select', i: 1 });
  assert.equal(parseMapMessage('{"t":"select","i":3}', 3), null);
  assert.equal(parseMapMessage('{"t":"select","i":1.5}', 3), null);
  assert.deepEqual(parseMapMessage({ t: 'tiles', s: 'failed' }, 3), { t: 'tiles', s: 'failed' });
  assert.equal(parseMapMessage({ t: 'tiles', s: 'boom' }, 3), null);
  assert.equal(parseMapMessage('not json', 3), null);
  assert.equal(parseMapMessage('x'.repeat(5000), 3), null);
  assert.equal(parseMapMessage({ t: 'action', action: { type: 'open_url' } }, 3), null);
  assert.deepEqual(parseMapMessage({ t: 'anim', s: 'complete' }, 3), { t: 'anim', s: 'complete' });
});

test('map document: static, tight CSP, SRI, no model data', () => {
  const csp = buildMapCsp();
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /connect-src 'none'/);
  assert.match(csp, new RegExp(`img-src data: ${TILE_ORIGIN.replace(/\./g, '\\.')}$|img-src data: ${TILE_ORIGIN.replace(/\./g, '\\.')};`));
  assert.doesNotMatch(csp, /tile\.openstreetmap\.org/);
  const doc = buildMapDocument();
  assert.equal(doc, buildMapDocument()); // referentially stable content
  assert.ok(doc.includes(`integrity="${LEAFLET_JS_SRI}"`));
  assert.ok(doc.includes('https://tile.openstreetmap.de/{z}/{x}/{y}.png'));
  assert.ok(!doc.includes('innerHTML'));
  assert.ok(!doc.includes('${')); // no unresolved template placeholders
  // the injection is a single JSON string literal (no way to break out with a title)
  const inj = mapInjection({ t: 'select', i: 2 });
  assert.equal(inj, 'window.__hui&&window.__hui.receive("{\\"t\\":\\"select\\",\\"i\\":2}");true;');
  const evil = mapInjection({ t: 'init', markers: [{ lat: 1, lng: 1, n: 1, title: '</script><img onerror=x>" ' }], route: false, animate: false, reduced: false, colors: { accent: '#000', onAccent: '#fff', text: '#000', muted: '#555', surface: '#fff', border: '#ccc', bg: '#fff' }, dark: false, durationMs: 6000 });
  let received: unknown = null;
  new Function('window', evil)({ __hui: { receive: (s: string) => (received = JSON.parse(s)) } });
  assert.equal((received as { markers: { title: string }[] }).markers[0].title, '</script><img onerror=x>" ');
});
