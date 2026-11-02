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
import { createWebCaps, webFromToolsets, webToolsSetting, withWebCap } from '../src/webcaps.mjs';

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
/** @type {string[]} */
let probes = [];
const toolset = (name, enabled, configured, tools) => ({ name, label: name, description: '', enabled, configured, tools });
// shape of Hermes v0.22 GET /v1/toolsets (gateway/platforms/api_server.py _handle_toolsets)
const TOOLSETS_STOCK = { object: 'list', platform: 'api_server', data: [
  toolset('web', false, false, ['web_extract', 'web_search']), toolset('todo', true, true, ['todo']),
  toolset('cronjob', true, true, ['cronjob']), toolset('skills', true, true, ['skill_manage', 'skill_view', 'skills_list'])] };
const TOOLSETS_WEB = { ...TOOLSETS_STOCK, data: TOOLSETS_STOCK.data.map((t) => (t.name === 'web' ? { ...t, enabled: true, configured: true } : t)) };
before(async () => {
  upstream = http.createServer(async (req, res) => {
    // Hermes' GET /v1/toolsets (src/webcaps.mjs): the default profile like a stock install (no web keys), the
    // `research` bot with the web toolset; every probe is counted, never recorded as a turn
    const ts = /^(?:\/p\/([a-z0-9_-]+))?\/v1\/toolsets$/.exec(req.url ?? '');
    if (req.method === 'GET' && ts) {
      probes.push(ts[1] ?? 'default');
      res.writeHead(200, { 'content-type': 'application/json' });
      return void res.end(JSON.stringify(ts[1] === 'research' ? TOOLSETS_WEB : TOOLSETS_STOCK));
    }
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
  const post = async (messages, extra = {}, prefix = '') => {
    const r = await fetch(`${base}${prefix}/v1/chat/completions`, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify({ model: 'hermes-agent', stream: false, messages }) });
    await r.arrayBuffer();
  };
  const get = async (path) => (await fetch(base + path, { headers })).json();
  try { await fn(post, get); } finally { server.close(); server.closeAllConnections(); }
}

for (const [label, env, line, available] of [['no image key', {}, OFF, false], ['Serper key', { SERPER_API_KEY: SERPER }, ON, true]]) {
  test(`e2e (${label}): every app turn starts with the identical bootstrap ending in "${line} web=off"; status and images/config agree`, async () => {
    seen = [];
    probes = [];
    await withBridge(env, async (post, get) => {
      await post([u('Vergleiche Trimui Brick und Miyoo Flip')], { 'x-hermes-session-id': 's1' });
      await post([u('Fotos?')], { 'x-hermes-session-id': 's1' });
      await post([u('Hi'), { role: 'assistant', content: 'Hallo' }, u('Und jetzt?')]); // header-less multi-turn
      assert.equal((await get('/bridge/images/config')).available, available);
      assert.deepEqual((await get('/bridge/status')).caps, { image_search: available ? 'on' : 'off' });
      assert.deepEqual((await get('/bridge/status')).web, { default: 'off' });
      // client that sent its own bootstrap: nothing injected in front of it, so no caps line (documented)
      await post([{ role: 'system', content: '[hermes-ui-app] Client: own' }, u('Hallo')], { 'x-hermes-session-id': 's2' });
    });
    const firsts = seen.slice(0, 3).map((b) => b.messages[0].content);
    assert.equal(new Set(firsts).size, 1, 'byte-identical across turns');
    assert.equal(firsts[0], `${BOOT_TEXT}\n${line} web=off`);
    assert.deepEqual(probes, ['default'], 'Hermes is asked once, not per turn');
    for (const b of seen.slice(0, 3)) assert.equal(b.messages.filter(hasCapsLine).length, 1);
    assert.equal(seen[3].messages[0].content, '[hermes-ui-app] Client: own');
    assert.ok(!seen[3].messages.some(hasCapsLine));
  });
}

test('e2e: a bot with web tools gets web=on from its own /p/<name>/v1/toolsets, the default profile stays web=off', async () => {
  seen = [];
  probes = [];
  await withBridge({ BRIDGE_PROFILES: 'research' }, async (post, get) => {
    await post([u('Vergleiche iPhone 16 und Pixel 9')], { 'x-hermes-session-id': 'r1' }, '/p/research');
    await post([u('als Tabelle?')], { 'x-hermes-session-id': 'r1' }, '/p/research');
    await post([u('Vergleiche iPhone 16 und Pixel 9')], { 'x-hermes-session-id': 'd1' });
    assert.deepEqual((await get('/bridge/status')).web, { research: 'on', default: 'off' });
  });
  const lines = seen.map((b) => b.messages[0].content.split('\n').at(-1));
  assert.deepEqual(lines, [`${OFF} web=on`, `${OFF} web=on`, `${OFF} web=off`]);
  assert.deepEqual(probes, ['research', 'default']);
});

test('e2e: BRIDGE_WEB_TOOLS=on|off pins the value without asking Hermes', async () => {
  for (const v of ['on', 'off']) {
    seen = [];
    probes = [];
    await withBridge({ BRIDGE_WEB_TOOLS: v }, async (post) => { await post([u('Hallo')], { 'x-hermes-session-id': 'p1' }); });
    assert.equal(seen[0].messages[0].content, `${BOOT_TEXT}\n${OFF} web=${v}`);
    assert.deepEqual(probes, []);
  }
  assert.throws(() => loadConfig({ ...BASE, BRIDGE_WEB_TOOLS: 'maybe' }), /BRIDGE_WEB_TOOLS must be auto\|on\|off/);
  assert.equal(webToolsSetting({}), 'auto');
});

test('webFromToolsets: enabled AND configured web search / read tools only', () => {
  assert.equal(webFromToolsets(TOOLSETS_STOCK), 'off');
  assert.equal(webFromToolsets(TOOLSETS_WEB), 'on');
  // enabled without its keys: Hermes drops the tools from the model's list
  assert.equal(webFromToolsets({ data: [toolset('web', true, false, ['web_search', 'web_extract'])] }), 'off');
  // a search plugin's own toolset (Web Search Plus) and the browser toolset read the web too
  assert.equal(webFromToolsets({ data: [toolset('web-search-plus', true, true, ['web_search_plus', 'web_extract_plus'])] }), 'on');
  assert.equal(webFromToolsets({ data: [toolset('browser', true, true, ['browser_navigate', 'browser_snapshot'])] }), 'on');
  assert.equal(webFromToolsets({ data: [toolset('hound', true, true, [])] }), 'off');
  assert.equal(webFromToolsets({ data: [toolset('deep_search', true, true, [])] }), 'on');
  // tool discovery, session search and file search are not the web
  assert.equal(webFromToolsets({ data: [toolset('core', true, true, ['tool_search', 'session_search', 'search_files'])] }), 'off');
  // not the expected shape = unknown
  assert.equal(webFromToolsets({ error: 'x' }), null);
  assert.equal(webFromToolsets(null), null);
  assert.equal(webFromToolsets({ data: [] }), 'off');
});

test('withWebCap: appends to the caps line once; unknown / no caps line / already named = unchanged', () => {
  const boot = `${BOOT_TEXT}\n${OFF}`;
  assert.equal(withWebCap(boot, 'off'), `${boot} web=off`);
  assert.equal(withWebCap(boot, 'on'), `${boot} web=on`);
  assert.equal(withWebCap(boot, null), boot);
  assert.equal(withWebCap(`${boot} web=on`, 'off'), `${boot} web=on`);
  assert.equal(withWebCap(BOOT_TEXT, 'off'), BOOT_TEXT);
  assert.equal(withWebCap(null, 'off'), null);
  assert.equal(withWebCap(boot, 'off'), withWebCap(boot, 'off'), 'same bytes every time');
});

test('createWebCaps: one probe per profile, unknown on failure (no key), retried after a minute, never per turn', async () => {
  let clock = 0;
  const calls = [];
  let mode = 'fail';
  const fake = async (url, init) => {
    calls.push({ url, auth: init.headers.authorization });
    if (mode === 'fail') return new Response('not found', { status: 404 });
    if (mode === 'hang') return new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted'))));
    return new Response(JSON.stringify(TOOLSETS_STOCK), { status: 200 });
  };
  const caps = createWebCaps({ baseUrl: 'http://h:8642', apiKey: 'k_test_fake', fetch: fake, now: () => clock, timeoutMs: 20 });
  assert.equal(await caps.get(null), null);
  assert.equal(await caps.get('default'), null, 'default = unprefixed, same failure');
  assert.equal(calls.length, 1, 'no second probe within the retry window');
  assert.deepEqual(calls[0], { url: 'http://h:8642/v1/toolsets', auth: 'Bearer k_test_fake' });
  clock += 61_000;
  mode = 'hang';
  assert.equal(await caps.get(null), null, 'timeout = unknown');
  clock += 61_000;
  mode = 'ok';
  const [a, b] = await Promise.all([caps.get(null), caps.get(null)]);
  assert.deepEqual([a, b], ['off', 'off']);
  assert.equal(calls.length, 3, 'concurrent first turns share one probe');
  mode = 'fail';
  assert.equal(await caps.get(null), 'off', 'kept for the process lifetime');
  assert.equal(await caps.get('writer'), null);
  assert.equal(calls.at(-1).url, 'http://h:8642/p/writer/v1/toolsets');
  assert.deepEqual(caps.snapshot(), { default: 'off' });
  assert.equal(await createWebCaps({ baseUrl: 'http://h', setting: 'on', fetch: fake }).get('x'), 'on');
});

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
