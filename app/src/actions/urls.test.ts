import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildMailtoUrl, buildMapsUrls, buildSmsUrl, buildTelUrl, coord } from './urls.ts';
import { validateUrl } from './validate.ts';

test('coord rounds', () => {
  assert.equal(coord(48.1371079123), '48.137108');
  assert.equal(coord(11.5), '11.5');
});

test('maps on Android: geo: for coordinates (with label), geo:0,0 for queries, web fallback', () => {
  const a = buildMapsUrls({ type: 'maps', lat: 48.137, lng: 11.575, query: 'Marienplatz' }, 'android');
  assert.equal(a[0], 'geo:48.137,11.575?q=48.137,11.575(Marienplatz)');
  assert.equal(a[1], 'https://www.google.com/maps/search/?api=1&query=48.137%2C11.575');
  assert.equal(buildMapsUrls({ type: 'maps', lat: 1, lng: 2, query: 'A) b' }, 'android')[0], 'geo:1,2?q=1,2(A%20%20b)');
  const b = buildMapsUrls({ type: 'maps', lat: 1, lng: 2 }, 'android');
  assert.equal(b[0], 'geo:1,2?q=1,2');
  const c = buildMapsUrls({ type: 'maps', query: 'Café Müller & Söhne' }, 'android');
  assert.equal(c[0], 'geo:0,0?q=Caf%C3%A9%20M%C3%BCller%20%26%20S%C3%B6hne');
});

test('maps with a mode use directions URLs', () => {
  const g = buildMapsUrls({ type: 'maps', query: 'Hauptbahnhof', mode: 'transit' }, 'android');
  assert.deepEqual(g, ['https://www.google.com/maps/dir/?api=1&destination=Hauptbahnhof&travelmode=transit']);
  const ios = buildMapsUrls({ type: 'maps', lat: 52.5, lng: 13.4, mode: 'walking' }, 'ios');
  assert.equal(ios[0], 'https://maps.apple.com/?daddr=52.5%2C13.4&dirflg=w');
  assert.equal(ios[1], 'https://www.google.com/maps/dir/?api=1&destination=52.5%2C13.4&travelmode=walking');
  assert.ok(buildMapsUrls({ type: 'maps', query: 'x', mode: 'driving' }, 'ios')[0].endsWith('dirflg=d'));
  assert.ok(buildMapsUrls({ type: 'maps', query: 'x', mode: 'transit' }, 'ios')[0].endsWith('dirflg=r'));
});

test('maps on iOS / web', () => {
  assert.equal(buildMapsUrls({ type: 'maps', query: 'Eiffelturm' }, 'ios')[0], 'https://maps.apple.com/?q=Eiffelturm');
  assert.equal(buildMapsUrls({ type: 'maps', lat: 1, lng: 2, query: 'A' }, 'ios')[0], 'https://maps.apple.com/?ll=1,2&q=A');
  assert.equal(buildMapsUrls({ type: 'maps', lat: 1, lng: 2 }, 'ios')[0], 'https://maps.apple.com/?ll=1,2&q=1%2C2');
  assert.deepEqual(buildMapsUrls({ type: 'maps', query: 'x y' }, 'web'), ['https://www.google.com/maps/search/?api=1&query=x%20y']);
});

test('every generated maps URL passes the scheme allow-list', () => {
  for (const os of ['ios', 'android', 'web']) {
    for (const mode of [undefined, 'driving', 'walking', 'transit'] as const) {
      for (const a of [
        { type: 'maps' as const, query: 'a b&c=d#e', mode },
        { type: 'maps' as const, lat: -33.86, lng: 151.2, mode },
      ])
        for (const u of buildMapsUrls(a, os)) assert.ok(validateUrl(u), u);
    }
  }
});

test('tel / mailto / sms', () => {
  assert.equal(buildTelUrl('+491512345678'), 'tel:+491512345678');
  assert.equal(buildMailtoUrl({ type: 'email', to: ['a@x.de'] }), 'mailto:a@x.de');
  assert.equal(
    buildMailtoUrl({ type: 'email', to: ['a@example.com', 'b+c@example.org'], subject: 'Hallo Welt & mehr', body: 'Zeile 1\nZeile 2 ä' }),
    'mailto:a@example.com,b%2Bc@example.org?subject=Hallo%20Welt%20%26%20mehr&body=Zeile%201%0D%0AZeile%202%20%C3%A4',
  );
  assert.equal(buildSmsUrl({ type: 'sms', to: ['+491511'] }, 'android'), 'sms:+491511');
  assert.equal(buildSmsUrl({ type: 'sms', to: ['+491511', '0152'], body: 'Hi du?' }, 'android'), 'sms:+491511,0152?body=Hi%20du%3F');
  assert.equal(buildSmsUrl({ type: 'sms', to: ['+491511'], body: 'Hi' }, 'ios'), 'sms:+491511&body=Hi');
});

test('mailto body cannot smuggle extra headers', () => {
  const u = buildMailtoUrl({ type: 'email', to: ['a@example.com'], subject: 'x&bcc=evil@example.net', body: 'y&cc=evil@example.net' });
  assert.ok(!/[?&]bcc=/.test(u) && !/[?&]cc=/.test(u));
  assert.ok(validateUrl(u));
});
