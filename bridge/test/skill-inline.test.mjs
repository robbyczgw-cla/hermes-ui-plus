// Skill core inline (src/skillInline.mjs, ADR 0001 decision 5 addendum): position, determinism, switches, scope.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SKILL_INLINE_MARKER, buildSkillMessage, loadSkillInline, stripFrontMatter } from '../src/skillInline.mjs';
import { applySystemMessages } from '../src/router/hint.mjs';
import { loadConfig } from '../src/config.mjs';
import { createServer } from '../src/server.mjs';
import { featureSummary } from '../src/cli.mjs';
import { silentLogger } from '../src/log.mjs';

const REPO_SKILL = new URL('../../hermes-skill/hermes-ui/SKILL.md', import.meta.url).pathname;
const REPO_BOOT = new URL('../../hermes-skill/bootstrap-system-message.txt', import.meta.url).pathname;
const tmp = () => mkdtempSync(join(tmpdir(), 'hui-skill-inline-'));
const BASE = { HERMES_BASE_URL: 'http://h', BRIDGE_TOKEN: 't' };
const u = (content) => ({ role: 'user', content });
const BOOT = '[hermes-ui-app] Client: app';
const SKILL = `${SKILL_INLINE_MARKER} core\n\n# Protocol`;

test('front matter is stripped, the body kept, line endings normalised', () => {
  assert.equal(stripFrontMatter('---\nname: x\nmetadata:\n  a: [b]\n---\n\n# Title\r\nBody\n'), '# Title\nBody');
  assert.equal(stripFrontMatter('# No front matter\n'), '# No front matter');
  assert.equal(buildSkillMessage('---\nname: x\n---\n   \n'), null, 'empty body: nothing to inject');
});

test('repo SKILL.md: one message, marker first, no front matter, ~2k tokens, byte-identical on every load', () => {
  const a = loadSkillInline({}, { bootstrap: 'b', candidates: [REPO_SKILL] });
  const b = loadSkillInline({}, { bootstrap: 'b', candidates: [REPO_SKILL] });
  assert.equal(a.skillInlineFile, REPO_SKILL);
  assert.equal(a.skillInline, b.skillInline);
  assert.ok(a.skillInline.startsWith(`${SKILL_INLINE_MARKER} `));
  assert.match(a.skillInline, /skill_view\("hermes-ui", file_path="references\/<ref>\.md"\)/);
  assert.match(a.skillInline, /\n\n# Hermes UI presentation protocol\n/);
  assert.doesNotMatch(a.skillInline, /^name: hermes-ui$|session_platforms/m);
  assert.ok(!a.skillInline.includes('[hermes-ui-app] Client:'), 'never mistaken for the bootstrap message');
  // the skill keeps working as a normal skill for other clients: its front matter is untouched
  assert.match(readFileSync(REPO_SKILL, 'utf8'), /^---\nname: hermes-ui\n/);
  assert.ok(a.skillInline.length < 12_000, `about 2k tokens, got ${a.skillInline.length} chars`);
});

test('config: default next to the bootstrap / repo; BRIDGE_SKILL_FILE override; off switch; bootstrap off = none', () => {
  const on = loadConfig({ ...BASE, BRIDGE_BOOTSTRAP_FILE: REPO_BOOT });
  assert.equal(on.skillInlineFile, REPO_SKILL);
  assert.ok(on.skillInline);

  const dir = tmp();
  const own = join(dir, 'SKILL.md');
  writeFileSync(own, '---\nname: hermes-ui\n---\n# Own skill\n');
  const custom = loadConfig({ ...BASE, BRIDGE_SKILL_FILE: own });
  assert.equal(custom.skillInline, buildSkillMessage('# Own skill'));

  const off = loadConfig({ ...BASE, BRIDGE_SKILL_INLINE: 'off' });
  assert.ok(off.bootstrap);
  assert.deepEqual([off.skillInline, off.skillInlineMissing], [null, '']);
  assert.match(Object.fromEntries(featureSummary(off, {})).skill, /skill core inline off/);

  const noBoot = loadConfig({ ...BASE, BRIDGE_BOOTSTRAP: 'off' });
  assert.deepEqual([noBoot.skillInline, noBoot.skillInlineMissing], [null, '']);
});

test('missing SKILL.md: startup warning, feature line, no injection', () => {
  const lines = [];
  const logger = { debug() {}, info() {}, error() {}, warn: (msg, f) => lines.push({ msg, ...f }), enabled: () => true };
  const missing = join(tmp(), 'nope', 'SKILL.md');
  const { config } = createServer({ ...BASE, BRIDGE_SKILL_FILE: missing }, { logger });
  assert.ok(config.bootstrap);
  assert.deepEqual([config.skillInline, config.skillInlineMissing], [null, missing]);
  assert.equal(lines.length, 1);
  assert.match(lines[0].msg, /SKILL\.md not found/);
  assert.equal(lines[0].file, missing);
  assert.match(Object.fromEntries(featureSummary(config, {})).skill, /skill core inline MISSING/);
  const out = applySystemMessages([u('hi')], { bootstrap: config.bootstrap, skill: config.skillInline });
  assert.deepEqual(out.map((m) => m.role), ['system', 'user']);
});

test('applySystemMessages: bootstrap, skill, client system, hint; after a client bootstrap; once; never without bootstrap', () => {
  const hint = 'UI-ROUTER-HINT: format=compare confidence=0.9';
  const out = applySystemMessages([{ role: 'system', content: 'client sys' }, u('hi')], { bootstrap: BOOT, skill: SKILL, hint });
  assert.deepEqual(out.map((m) => m.content), [BOOT, SKILL, 'client sys', hint, 'hi']);
  // client already sent its own bootstrap (not first): the skill goes right after it
  const own = applySystemMessages([{ role: 'system', content: 'client sys' }, { role: 'system', content: `${BOOT} own` }, u('hi')], { bootstrap: BOOT, skill: SKILL, hint: null });
  assert.deepEqual(own.map((m) => m.content), ['client sys', `${BOOT} own`, SKILL, 'hi']);
  // already present: not added twice
  const again = applySystemMessages(out.filter((m) => m.content !== hint), { bootstrap: BOOT, skill: SKILL, hint: null });
  assert.equal(again.filter((m) => m.content === SKILL).length, 1);
  // bootstrap off (non-app): untouched
  const plain = [u('hi')];
  assert.deepEqual(applySystemMessages(plain, { bootstrap: null, skill: SKILL, hint: null }), plain);
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
    const raw = Buffer.concat(chunks);
    let body = null;
    try { body = JSON.parse(raw.toString()); } catch { /* invalid on purpose */ }
    seen.push({ raw, body });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"choices":[{"message":{"role":"assistant","content":"ok"}}]}');
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  upstreamUrl = `http://127.0.0.1:${upstream.address().port}/v1`;
});
after(() => { upstream.close(); upstream.closeAllConnections(); });

async function withBridge(env, fn) {
  const { server } = createServer({ HERMES_BASE_URL: upstreamUrl, BRIDGE_TOKEN: 'tok', BRIDGE_LOG_LEVEL: 'silent', BRIDGE_ROUTER: 'heuristic', BRIDGE_ROUTER_FASTPATH_MIN: 'off', BRIDGE_BOOTSTRAP_FILE: REPO_BOOT, ...env }, { logger: silentLogger });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (body, headers = {}) => {
    const r = await fetch(`${base}/v1/chat/completions`, { method: 'POST', headers: { authorization: 'Bearer tok', 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
    await r.arrayBuffer();
  };
  try { await fn(post); } finally { server.close(); server.closeAllConnections(); }
}

test('e2e: every app turn carries the identical skill message right after the bootstrap', async () => {
  seen = [];
  await withBridge({}, async (post) => {
    await post({ model: 'hermes-agent', stream: false, messages: [u('Vergleiche iPhone und Pixel: Vor- und Nachteile')] }, { 'x-hermes-session-id': 's1' });
    await post({ model: 'hermes-agent', stream: false, messages: [u('Danke!')] }, { 'x-hermes-session-id': 's1' });
    // header-less multi-turn client: no hint, but the same constant skill (session id stays stable)
    await post({ model: 'hermes-agent', stream: false, messages: [u('Hi'), { role: 'assistant', content: 'Hallo' }, u('Und jetzt?')] });
  });
  const bootstrap = readFileSync(REPO_BOOT, 'utf8').trim();
  const skill = loadSkillInline({}, { bootstrap, candidates: [REPO_SKILL] }).skillInline;
  for (const { body } of seen) {
    assert.equal(body.messages[0].content, bootstrap);
    assert.equal(body.messages[1].content, skill);
    assert.equal(body.messages.filter((m) => m.content === skill).length, 1);
  }
  assert.match(seen[0].body.messages[2].content, /^UI-ROUTER-HINT: format=compare/);
});

test('e2e: no skill when switched off, when the bootstrap is off, or for bodies the bridge does not touch', async () => {
  seen = [];
  await withBridge({ BRIDGE_SKILL_INLINE: 'off', BRIDGE_HINT: 'off' }, async (post) => { await post({ model: 'm', messages: [u('Hallo')] }); });
  assert.deepEqual(seen[0].body.messages.map((m) => m.content.slice(0, 16)), ['[hermes-ui-app] ', 'Hallo']);
  seen = [];
  await withBridge({ BRIDGE_BOOTSTRAP: 'off', BRIDGE_HINT: 'off' }, async (post) => {
    await post({ model: 'm', messages: [u('Hallo')] });
    await post('{not json');
  });
  assert.deepEqual(seen[0].body.messages, [u('Hallo')]);
  assert.equal(seen[1].raw.toString(), '{not json');
  seen = [];
  await withBridge({}, async (post) => { await post('{not json'); });
  assert.equal(seen[0].raw.toString(), '{not json', 'invalid body forwarded untouched even with the bootstrap on');
});
