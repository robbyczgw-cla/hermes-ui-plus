// Capability line (src/caps.mjs): `[hermes-ui-caps] image_search=on|off` as the last line of the injected bootstrap.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CAPS_MARKER, bridgeCaps, capsLine, withCaps } from '../src/caps.mjs';
import { imageSearchAvailable } from '../src/images.mjs';
import { loadConfig } from '../src/config.mjs';
import { createServer } from '../src/server.mjs';
import { featureSummary } from '../src/cli.mjs';
import { silentLogger } from '../src/log.mjs';
import { applySystemMessages } from '../src/router/hint.mjs';

const REPO_BOOT = new URL('../../hermes-skill/bootstrap-system-message.txt', import.meta.url).pathname;
const BOOT_TEXT = readFileSync(REPO_BOOT, 'utf8').trim();
const BASE = { HERMES_BASE_URL: 'http://h', BRIDGE_TOKEN: 't', BRIDGE_BOOTSTRAP_FILE: REPO_BOOT };
const OFF = '[hermes-ui-caps] image_search=off';
const ON = '[hermes-ui-caps] image_search=on';
const SERPER = 'serper_test_key_fake_000';
const BRAVE = 'brave_test_key_fake_000';
const u = (content) => ({ role: 'user', content });
// a caps LINE (the inline skill core mentions the token mid-sentence, that does not count)
const hasCapsLine = (m) => /^\[hermes-ui-caps\] /m.test(m.content);

test('image_search follows the same rule as /bridge/images/config `available`', () => {
  assert.deepEqual(bridgeCaps({}), { image_search: 'off' });
  assert.deepEqual(bridgeCaps({ SERPER_API_KEY: SERPER }), { image_search: 'on' });
  assert.deepEqual(bridgeCaps({ BRAVE_API_KEY: BRAVE }), { image_search: 'on' });
  // a key for a provider that BRIDGE_IMAGE_PROVIDERS does not list does not count
  assert.deepEqual(bridgeCaps({ BRIDGE_IMAGE_PROVIDERS: 'brave', SERPER_API_KEY: SERPER }), { image_search: 'off' });
  assert.deepEqual(bridgeCaps({ BRIDGE_IMAGE_PROVIDERS: 'unknown', SERPER_API_KEY: SERPER }), { image_search: 'off' });
  assert.equal(imageSearchAvailable({ SERPER_API_KEY: '' }), false);
  assert.equal(capsLine({ image_search: 'off' }), OFF);
  assert.ok(OFF.startsWith(CAPS_MARKER));
});

test('config: the bootstrap carries the caps line as its last line, once; no bootstrap = no line', () => {
  const off = loadConfig(BASE);
  assert.equal(off.bootstrap, `${BOOT_TEXT}\n${OFF}`);
  assert.deepEqual(off.caps, { image_search: 'off' });
  const on = loadConfig({ ...BASE, SERPER_API_KEY: SERPER });
  assert.equal(on.bootstrap, `${BOOT_TEXT}\n${ON}`);
  assert.equal(on.bootstrap.split(CAPS_MARKER).length, 2, 'exactly one caps line');
  // byte-identical on every load (prompt cache)
  assert.equal(loadConfig(BASE).bootstrap, off.bootstrap);
  // bootstrap off: nothing is injected, caps are still reported
  const none = loadConfig({ ...BASE, BRIDGE_BOOTSTRAP: 'off' });
  assert.equal(none.bootstrap, null);
  assert.deepEqual(none.caps, { image_search: 'off' });
  // a custom bootstrap file that already has a caps line is left as is
  const dir = mkdtempSync(join(tmpdir(), 'hui-caps-'));
  const own = join(dir, 'bootstrap-system-message.txt');
  writeFileSync(own, `own bootstrap\n${ON}\n`);
  assert.equal(loadConfig({ ...BASE, BRIDGE_BOOTSTRAP_FILE: own }).bootstrap, `own bootstrap\n${ON}`);
  assert.equal(withCaps(null, { image_search: 'off' }), null);
  // startup summary names the caps
  assert.match(Object.fromEntries(featureSummary(off, {})).skill, /caps image_search=off/);
  assert.match(Object.fromEntries(featureSummary(on, {})).skill, /caps image_search=on/);
});

test('applySystemMessages: a client that sent its own bootstrap marker gets no caps line (unchanged behaviour)', () => {
  const { bootstrap } = loadConfig(BASE);
  const client = { role: 'system', content: '[hermes-ui-app] Client: own' };
  const out = applySystemMessages([client, u('hi')], { bootstrap, skill: null, hint: null });
  assert.deepEqual(out, [client, u('hi')]);
  assert.ok(!out.some(hasCapsLine));
});

// --- end to end: real bridge in front of a fake Hermes
let upstream;
let upstreamUrl;
/** @type {any[]} */
let seen = [];
before(async () => {
  upstream = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    try { seen.push(JSON.parse(Buffer.concat(chunks).toString())); } catch { seen.push(null); }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"choices":[{"message":{"role":"assistant","content":"ok"}}]}');
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  upstreamUrl = `http://127.0.0.1:${upstream.address().port}/v1`;
});
after(() => { upstream.close(); upstream.closeAllConnections(); });

async function withBridge(env, fn) {
  const { server } = createServer({ HERMES_BASE_URL: upstreamUrl, BRIDGE_TOKEN: 'tok', BRIDGE_LOG_LEVEL: 'silent', BRIDGE_ROUTER: 'heuristic', BRIDGE_BOOTSTRAP_FILE: REPO_BOOT, ...env }, { logger: silentLogger, imageProviders: { serper: async () => [], brave: async () => [] } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { authorization: 'Bearer tok', 'content-type': 'application/json' };
  const post = async (messages, extra = {}) => {
    const r = await fetch(`${base}/v1/chat/completions`, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify({ model: 'hermes-agent', stream: false, messages }) });
    await r.arrayBuffer();
  };
  const get = async (path) => (await fetch(base + path, { headers })).json();
  try { await fn(post, get); } finally { server.close(); server.closeAllConnections(); }
}

for (const [label, env, line, available] of [['no image key', {}, OFF, false], ['Serper key', { SERPER_API_KEY: SERPER }, ON, true]]) {
  test(`e2e (${label}): every app turn starts with the identical bootstrap ending in "${line}"; status and images/config agree`, async () => {
    seen = [];
    await withBridge(env, async (post, get) => {
      await post([u('Vergleiche Trimui Brick und Miyoo Flip')], { 'x-hermes-session-id': 's1' });
      await post([u('Fotos?')], { 'x-hermes-session-id': 's1' });
      await post([u('Hi'), { role: 'assistant', content: 'Hallo' }, u('Und jetzt?')]); // header-less multi-turn
      assert.equal((await get('/bridge/images/config')).available, available);
      assert.deepEqual((await get('/bridge/status')).caps, { image_search: available ? 'on' : 'off' });
      // client that sent its own bootstrap: nothing injected in front of it, so no caps line (documented)
      await post([{ role: 'system', content: '[hermes-ui-app] Client: own' }, u('Hallo')], { 'x-hermes-session-id': 's2' });
    });
    const firsts = seen.slice(0, 3).map((b) => b.messages[0].content);
    assert.equal(new Set(firsts).size, 1, 'byte-identical across turns');
    assert.equal(firsts[0], `${BOOT_TEXT}\n${line}`);
    for (const b of seen.slice(0, 3)) assert.equal(b.messages.filter(hasCapsLine).length, 1);
    assert.equal(seen[3].messages[0].content, '[hermes-ui-app] Client: own');
    assert.ok(!seen[3].messages.some(hasCapsLine));
  });
}

test('skill: SKILL.md and the products reference carry the image_search=off rule', () => {
  const dir = new URL('../../hermes-skill/hermes-ui/', import.meta.url);
  const skill = readFileSync(new URL('SKILL.md', dir), 'utf8');
  const images = skill.split('\n## Images\n')[1]?.split('\n## ')[0] ?? '';
  assert.match(images, /`\[hermes-ui-caps\] image_search=off`: NO `source:"web"`; `\{url, caption\}` items/);
  assert.match(images, /else text links, no gallery/);
  assert.match(skill, /gallery \{items:\[\{query\|url, source\?:"web", caption\?\}\]/);
  const products = readFileSync(new URL('references/products.md', dir), 'utf8');
  assert.match(products, /Photos without web image search \(system line `\[hermes-ui-caps\] image_search=off`/);
  assert.match(products, /text links to the pages, no gallery/);
  // the line the skill reads is exactly what the bridge sends
  assert.ok(images.includes(`\`${OFF}\``), 'same token as capsLine()');
});
