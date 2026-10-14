import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http2 from 'node:http2';
import test from 'node:test';

import { apnsJwt, apnsPayload, createApnsSender } from '../src/apns.mjs';
import { createFcmSender, fcmMessage, serviceAccountAssertion, loadServiceAccount } from '../src/fcm.mjs';
import { fromB64url, p256PrivateKeyFromRaw, p256RawPublic, verifyJwt } from '../src/jwt.mjs';
import { allowedPushEndpoint, createWebPushSender, decryptPayload, encryptPayload, generateVapidKeys, vapidAuthorization, validSubscription } from '../src/webpush.mjs';

const B = (s) => Buffer.from(s, 'base64url');

// RFC 8291 Appendix A (all values base64url)
const V = {
  plaintext: 'When I grow up, I want to be a watermelon',
  asPriv: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  asPub: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  uaPriv: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  uaPub: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg', // gitleaks:allow (published RFC 8291 test vector)
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  ecdh: 'kyrL1jIIOHEzg3sM2ZWRHDRB62YACZhhSlknJ672kSs',
  prkKey: 'Snr3JMxaHVDXHWJn5wdC52WjpCtd2EIEGBykDcZW32k', // gitleaks:allow (published RFC 8291 test vector)
  ikm: 'S4lYMb_L0FxCeq0WhDx813KgSYqU26kOyzWUdsXYyrg',
  prk: '09_eUZGrsvxChDCGRCdkLiDXrReGOEVeSCdCcPBSJSc',
  cek: 'oIhVW04MRdy2XN9CiKLxTg',
  nonce: '4h_95klXJ5E_qnoN',
  body:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

test('RFC 8291 test vector: every intermediate value and the final body', () => {
  const r = encryptPayload(V.plaintext, { p256dh: V.uaPub, auth: V.auth }, { salt: B(V.salt), asPrivate: B(V.asPriv) });
  assert.equal(r.asPublic.toString('base64url'), V.asPub);
  assert.equal(r.ecdhSecret.toString('base64url'), V.ecdh);
  assert.equal(r.prkKey.toString('base64url'), V.prkKey);
  assert.equal(r.ikm.toString('base64url'), V.ikm);
  assert.equal(r.prk.toString('base64url'), V.prk);
  assert.equal(r.cek.toString('base64url'), V.cek);
  assert.equal(r.nonce.toString('base64url'), V.nonce);
  assert.equal(r.body.toString('base64url'), V.body);
});

test('RFC 8291 vector decrypts with the user-agent key; random encryption round-trips', () => {
  assert.equal(decryptPayload(B(V.body), B(V.uaPriv), V.auth).toString('utf8'), V.plaintext);
  const ua = crypto.createECDH('prime256v1');
  ua.generateKeys();
  const auth = crypto.randomBytes(16).toString('base64url');
  const msg = JSON.stringify({ title: 'Ada', body: 'Grüße 👋' });
  const r = encryptPayload(msg, { p256dh: ua.getPublicKey().toString('base64url'), auth }, { padding: 7 });
  assert.equal(r.body.readUInt32BE(16), 4096);
  assert.equal(r.body[20], 65);
  assert.equal(decryptPayload(r.body, ua.getPrivateKey(), auth).toString('utf8'), msg);
  assert.throws(() => encryptPayload('x'.repeat(5000), { p256dh: ua.getPublicKey().toString('base64url'), auth }), /too large/);
});

test('VAPID: ES256 JWT verifies with the advertised key; aud = push service origin; exp <= 24h', () => {
  const keys = generateVapidKeys();
  assert.equal(B(keys.publicKey).length, 65);
  assert.equal(B(keys.privateKey).length, 32);
  const now = 1_800_000_000;
  const h = vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc:def', { ...keys, subject: 'mailto:me@example.org' }, now);
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(h);
  assert.ok(m);
  assert.equal(m[2], keys.publicKey);
  const pub = crypto.createPublicKey(p256PrivateKeyFromRaw(keys.privateKey, keys.publicKey));
  const claims = verifyJwt(m[1], pub);
  assert.deepEqual(claims, { aud: 'https://fcm.googleapis.com', exp: now + 12 * 3600, sub: 'mailto:me@example.org' });
  // the private key alone derives the same public key
  assert.equal(p256RawPublic(p256PrivateKeyFromRaw(keys.privateKey)).toString('base64url'), keys.publicKey);
  // tampered signature fails
  const bad = m[1].slice(0, -3) + (m[1].endsWith('AAA') ? 'BBB' : 'AAA');
  assert.equal(verifyJwt(bad, pub), null);
});

test('Web Push sender: request shape, Topic sanitizing, 410 = gone', async () => {
  const keys = generateVapidKeys();
  const ua = crypto.createECDH('prime256v1');
  ua.generateKeys();
  const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/123', keys: { p256dh: ua.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') } };
  assert.ok(validSubscription(sub));
  assert.ok(!validSubscription({ ...sub, endpoint: 'http://fcm.googleapis.com/x' }));
  const calls = [];
  let status = 201;
  const sender = createWebPushSender({ ...keys, subject: 'mailto:a@b.c', fetch: async (url, init) => (calls.push({ url, init }), new Response(null, { status })) });
  const r = await sender.send(sub, { title: 'Hermes', body: 'hi' }, { topic: 'hui+abc/def==', ttl: 60 });
  assert.equal(r.ok, true);
  const { init } = calls[0];
  assert.equal(init.headers['Content-Encoding'], 'aes128gcm');
  assert.equal(init.headers.TTL, '60');
  assert.equal(init.headers.Topic, 'huiabcdef');
  assert.match(init.headers.Authorization, /^vapid t=/);
  assert.deepEqual(JSON.parse(decryptPayload(init.body, ua.getPrivateKey(), sub.keys.auth).toString()), { title: 'Hermes', body: 'hi' });
  status = 410;
  const g = await sender.send(sub, { title: 't' });
  assert.equal(g.gone, true);
});

function serviceAccount() {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    type: 'service_account',
    project_id: 'hermes-ui-test',
    client_email: 'push@hermes-ui-test.iam.example.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    token_uri: 'https://oauth2.googleapis.com/token',
  };
}

test('FCM: RS256 service-account assertion verifies; message is data-only in expo-notifications format', () => {
  const raw = serviceAccount();
  const sa = loadServiceAccount(raw);
  const jwt = serviceAccountAssertion(sa, 1000);
  const claims = verifyJwt(jwt, crypto.createPublicKey(raw.private_key));
  assert.deepEqual(claims, { iss: raw.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: raw.token_uri, iat: 1000, exp: 4600 });
  const m = fcmMessage('tok', { title: 'Pip', body: 'Neue Nachricht', data: { sessionId: 's1', v: '1' }, collapseKey: 'huiX', channelId: 'agent-messages' });
  assert.equal(m.message.notification, undefined);
  assert.equal(m.message.data.message, 'Neue Nachricht');
  assert.deepEqual(JSON.parse(m.message.data.body), { sessionId: 's1', v: '1' });
  assert.equal(m.message.data.tag, 'huiX');
  assert.equal(m.message.android.priority, 'HIGH');
  for (const v of Object.values(m.message.data)) assert.equal(typeof v, 'string');
  assert.throws(() => loadServiceAccount({ type: 'x' }), /service-account/);
});

test('FCM sender: token exchange is cached, 401 refreshes once, UNREGISTERED marks the device gone', async () => {
  const raw = serviceAccount();
  let tokenCalls = 0;
  let sendStatus = 200;
  let first401 = false;
  const fetch = async (url, init) => {
    if (String(url).includes('oauth2')) {
      tokenCalls++;
      const form = new URLSearchParams(String(init.body));
      assert.equal(form.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
      assert.ok(verifyJwt(form.get('assertion'), crypto.createPublicKey(raw.private_key)));
      return Response.json({ access_token: `at${tokenCalls}`, expires_in: 3600 });
    }
    assert.equal(url, 'https://fcm.googleapis.com/v1/projects/hermes-ui-test/messages:send');
    if (first401) {
      first401 = false;
      return new Response('{}', { status: 401 });
    }
    if (sendStatus === 404) return Response.json({ error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }, { status: 404 });
    return Response.json({ name: 'projects/x/messages/1' });
  };
  const s = createFcmSender({ serviceAccount: raw, fetch });
  assert.equal((await s.send('t1', { title: 'a', body: 'b' })).ok, true);
  assert.equal((await s.send('t1', { title: 'a', body: 'b' })).ok, true);
  assert.equal(tokenCalls, 1);
  first401 = true;
  assert.equal((await s.send('t1', { title: 'a', body: 'b' })).ok, true);
  assert.equal(tokenCalls, 2);
  sendStatus = 404;
  const r = await s.send('t1', { title: 'a', body: 'b' });
  assert.equal(r.ok, false);
  assert.equal(r.gone, true);
});

test('APNs sender over HTTP/2: headers, ES256 provider token, BadDeviceToken falls back to sandbox, 410 gone', async (t) => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const seen = [];
  function server(name, handler) {
    const s = http2.createServer();
    s.on('stream', (stream, headers) => {
      let body = '';
      stream.on('data', (c) => (body += c));
      stream.on('end', () => {
        seen.push({ name, headers, body: JSON.parse(body) });
        handler(stream, headers);
      });
    });
    return new Promise((resolve) => s.listen(0, '127.0.0.1', () => resolve(s)));
  }
  const reply = (stream, status, reason) => {
    stream.respond({ ':status': status });
    stream.end(reason ? JSON.stringify({ reason }) : undefined);
  };
  const prod = await server('prod', (st, h) => (h[':path'].endsWith('dead') ? reply(st, 410, 'Unregistered') : h[':path'].includes('beef') ? reply(st, 400, 'BadDeviceToken') : reply(st, 200)));
  const sand = await server('sandbox', (st) => reply(st, 200));
  const sender = createApnsSender({
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    keyId: 'ABC123DEFG',
    teamId: '<TEAM_ID>',
    topic: 'ai.hermes.ui',
    origins: { production: `http://127.0.0.1:${prod.address().port}`, sandbox: `http://127.0.0.1:${sand.address().port}` },
  });
  t.after(() => {
    sender.close();
    prod.close();
    sand.close();
  });
  const tok = 'a'.repeat(64);
  const r1 = await sender.send(tok, { title: 'Ada', body: 'Hallo', data: { sessionId: 's' }, collapseKey: 'huiQ' });
  assert.deepEqual([r1.ok, r1.environment], [true, 'production']);
  const h = seen[0].headers;
  assert.equal(h[':path'], `/3/device/${tok}`);
  assert.equal(h['apns-topic'], 'ai.hermes.ui');
  assert.equal(h['apns-push-type'], 'alert');
  assert.equal(h['apns-collapse-id'], 'huiQ');
  const jwt = h.authorization.replace(/^bearer /, '');
  assert.equal(JSON.parse(fromB64url(jwt.split('.')[0])).kid, 'ABC123DEFG');
  assert.equal(verifyJwt(jwt, publicKey).iss, '<TEAM_ID>');
  assert.deepEqual(seen[0].body, { aps: { alert: { title: 'Ada', body: 'Hallo' }, sound: 'default' }, body: { sessionId: 's' } });
  const r2 = await sender.send('beef'.repeat(16), { title: 'x', body: 'y' });
  assert.deepEqual([r2.ok, r2.environment], [true, 'sandbox']);
  const r3 = await sender.send('dead'.repeat(16), { title: 'x', body: 'y' }, 'production');
  assert.deepEqual([r3.ok, r3.gone], [false, true]);
  assert.deepEqual(apnsPayload({ title: 'a', body: 'b', quiet: true }).aps['interruption-level'], 'passive');
  assert.ok(apnsJwt(privateKey, 'K', 'T').split('.').length === 3);
});

// Review L3: the endpoint used to be any https URL → blind SSRF / port scan from the server.
test('Web Push endpoints: only known push services; IP literals, ports, userinfo and lookalikes refused', async () => {
  for (const ok of ['https://fcm.googleapis.com/fcm/send/x', 'https://web.push.apple.com/abc', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://db5p.notify.windows.com/w/?token=x']) {
    assert.equal(allowedPushEndpoint(ok), true, ok);
  }
  for (const bad of ['https://127.0.0.1/x', 'https://[::1]/x', 'https://10.0.0.1:8645/api', 'https://fcm.googleapis.com:8443/x', 'https://u:p' + '@fcm.googleapis.com/x',
    'https://fcm.googleapis.com.evil.example/x', 'https://evilfcm.googleapis.com.example/x', 'https://notfcm.googleapis.co/x', 'http://fcm.googleapis.com/x', 'https://push.example.net/x', 'nonsense']) {
    assert.equal(allowedPushEndpoint(bad), false, bad);
  }
  assert.equal(allowedPushEndpoint('https://push.example.net/x', ['push.example.net']), true);
  // invalid curve point is refused at registration (used to throw in delivery)
  const ua = crypto.createECDH('prime256v1');
  ua.generateKeys();
  const pk = ua.getPublicKey();
  const broken = Buffer.from(pk);
  broken[64] ^= 1;
  const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/1', keys: { p256dh: broken.toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') } };
  assert.equal(validSubscription(sub), false);
  assert.equal(validSubscription({ ...sub, keys: { ...sub.keys, p256dh: pk.toString('base64url') } }), true);
  // a stored registration with a now-disallowed endpoint is dropped without any network call
  let called = 0;
  const sender = createWebPushSender({ ...generateVapidKeys(), subject: 'mailto:a@b.c', fetch: async () => (called++, new Response(null, { status: 201 })) });
  const r = await sender.send({ ...sub, endpoint: 'https://127.0.0.1:22/x', keys: { ...sub.keys, p256dh: pk.toString('base64url') } }, { title: 't' });
  assert.equal(r.gone, true);
  assert.equal(called, 0);
});
test('VAPID private keys are always 32 bytes; short (unpadded) keys are accepted', async () => {
  const { generateVapidKeys } = await import('../src/webpush.mjs');
  const { p256PrivateKeyFromRaw } = await import('../src/jwt.mjs');
  for (let i = 0; i < 600; i++) assert.equal(Buffer.from(generateVapidKeys().privateKey, 'base64url').length, 32);
  // a key whose first byte is 0, stored without padding (31 bytes), still works
  const crypto = await import('node:crypto');
  let d;
  do { const e = crypto.createECDH('prime256v1'); e.generateKeys(); d = e.getPrivateKey(); } while (d.length !== 32);
  d[0] = 0;
  const e2 = crypto.createECDH('prime256v1'); e2.setPrivateKey(d);
  assert.doesNotThrow(() => p256PrivateKeyFromRaw(d.subarray(1), e2.getPublicKey()));
});
