import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HermesError, type FetchLike } from '../hermes/stream.ts';
import { countSkills, fillLevel, fold, groupSkills, parseFeatures, parseMemory, parseSkillDoc, parseSkillList, quoteEntry, searchSkills, skillsFailure } from './model.ts';
import { libraryApplies, libraryRoute, librarySource } from './source.ts';
import { demoLibrary } from './demo.ts';

// ---- parsing ------------------------------------------------------------------------------------------

test('skill list: /v1/skills rows and the bridge projection, unknown fields and bad rows dropped', () => {
  const list = parseSkillList({
    object: 'list',
    data: [
      { name: 'pdf', description: 'PDFs', category: 'docs', path: '/home/x/.hermes/skills/docs/pdf', enabled: true, source: 'bundled' },
      { name: 'git', enabled: false, source: 'somewhere' },
      { description: 'no name' },
      'x',
      { name: 'pdf', description: 'duplicate' },
      { name: '  ' },
    ],
  });
  assert.deepEqual(list, [
    { name: 'pdf', description: 'PDFs', category: 'docs', enabled: true, source: 'bundled' },
    { name: 'git', enabled: false },
  ]);
  assert.ok(!JSON.stringify(list).includes('/home/'));
  assert.deepEqual(parseSkillList(null), []);
  assert.deepEqual(parseSkillList([{ name: 'a' }]), [{ name: 'a' }]);
  // Hermes' own list says nothing about on/off: undefined, not "on"
  assert.equal(parseSkillList({ data: [{ name: 'a' }] })[0].enabled, undefined);
});

test('SKILL.md: front matter becomes facts (name/description skipped), body stays Markdown', () => {
  const doc = parseSkillDoc({
    name: 'meal-planner',
    content: '﻿---\r\nname: meal-planner\r\ndescription: Plans meals\r\nversion: 1.2.0\r\ntags: [food, planning]\r\nmetadata:\r\n  hermes: x\r\nauthor: "Alice"\r\n---\r\n\r\n# Meal planner\r\n\r\nSteps.\r\n',
    truncated: false,
  });
  assert.ok(doc);
  assert.equal(doc.body, '# Meal planner\n\nSteps.');
  assert.deepEqual(doc.meta, [
    { key: 'version', value: '1.2.0' },
    { key: 'tags', value: 'food, planning' },
    { key: 'author', value: 'Alice' },
  ]);
  assert.equal(doc.truncated, false);
  // no front matter: everything is body
  assert.deepEqual(parseSkillDoc({ name: 'x', content: '# Hi', truncated: true }), { name: 'x', body: '# Hi', meta: [], truncated: true });
  assert.equal(parseSkillDoc({ name: 'x' }), null);
  assert.equal(parseSkillDoc(null), null);
});

test('memory: stores in a fixed order, entries trimmed and capped, dates parsed', () => {
  const m = parseMemory({
    profile: 'default',
    provider: 'honcho',
    stores: [
      { target: 'user', enabled: true, entries: ['Alice', '  ', 7, 'x'.repeat(5000)], chars: 30, limit: 1375, updated_at: '2026-10-14T08:00:00Z' },
      { target: 'memory', enabled: false, entries: [], chars: 0, limit: 2200, updated_at: null },
      { target: 'soul', entries: ['nope'] },
      { target: 'user', entries: ['second user store ignored'] },
    ],
  });
  assert.ok(m);
  assert.equal(m.provider, 'honcho');
  assert.deepEqual(
    m.stores.map((s) => s.target),
    ['memory', 'user'],
  );
  const user = m.stores[1];
  assert.equal(user.entries.length, 2);
  assert.equal(user.entries[1].length, 4000);
  assert.equal(user.updatedAt, Date.parse('2026-10-14T08:00:00Z'));
  assert.equal(m.stores[0].enabled, false);
  assert.equal(m.stores[0].updatedAt, undefined);
  assert.equal(parseMemory({}), null);
  assert.equal(parseMemory({ stores: [] })?.provider, undefined);
});

test('features: only reason codes of the safe shape reach the UI', () => {
  assert.deepEqual(parseFeatures({ skills: { available: true }, memory: { available: false, reason: 'memory_not_exposed' } }), {
    skills: { available: true },
    memory: { available: false, reason: 'memory_not_exposed' },
  });
  assert.deepEqual(parseFeatures({ skills: { available: false, reason: 'Traceback: <b>' }, memory: null }), {
    skills: { available: false, reason: 'unknown' },
    memory: { available: false, reason: 'unknown' },
  });
  assert.equal(parseFeatures('x').skills.available, false);
});

test('skills failure: the Hermes 0.21.5-0.22.2 500, unsupported, auth, offline', () => {
  assert.equal(skillsFailure(new HermesError('server', 'Failed to enumerate skills', { status: 500, code: 'server_error' })), 'hermesBug');
  assert.equal(skillsFailure(new HermesError('server', 'boom', { status: 500 })), 'failed');
  assert.equal(skillsFailure(new HermesError('bad_request', 'Not found', { status: 404 })), 'unsupported');
  assert.equal(skillsFailure(new HermesError('bad_request', 'Method not allowed', { status: 405 })), 'unsupported');
  assert.equal(skillsFailure(new HermesError('auth', 'Invalid API key', { status: 401 })), 'auth');
  assert.equal(skillsFailure(new HermesError('network', 'offline')), 'offline');
  assert.equal(skillsFailure(new TypeError('x')), 'failed');
});

// ---- search, grouping, helpers ------------------------------------------------------------------------

const SK = parseSkillList({
  data: [
    { name: 'arxiv', category: 'research', description: 'Search papers' },
    { name: 'web-research', category: 'research', description: 'Compare sources' },
    { name: 'github-pr-review', category: 'software', description: 'Review a pull request', enabled: false },
    { name: 'übersetzer', description: 'Übersetzt Texte' },
  ],
});

test('search: all words must match; name beats category beats description; accents folded', () => {
  assert.deepEqual(
    searchSkills(SK, 'research').map((s) => s.name),
    ['web-research', 'arxiv'],
  );
  assert.deepEqual(
    searchSkills(SK, 'review pull').map((s) => s.name),
    ['github-pr-review'],
  );
  assert.deepEqual(
    searchSkills(SK, 'uebersetz').map((s) => s.name),
    ['übersetzer'],
  );
  assert.deepEqual(searchSkills(SK, 'research zzz'), []);
  assert.equal(searchSkills(SK, '  ').length, SK.length);
  assert.equal(fold('Ärger Çedille'), 'aerger cedille');
});

test('groups: categories sorted, uncategorized last, names sorted inside', () => {
  const g = groupSkills(SK);
  assert.deepEqual(
    g.map((x) => x.category),
    ['research', 'software', null],
  );
  assert.deepEqual(
    g[0].skills.map((s) => s.name),
    ['arxiv', 'web-research'],
  );
  assert.deepEqual(countSkills(SK), { total: 4, off: 1 });
});

test('quoteEntry and fillLevel', () => {
  assert.equal(quoteEntry('  a\n\nb  '), 'a b');
  const q = quoteEntry('x'.repeat(400));
  assert.equal(q.length, 300);
  assert.ok(q.endsWith('…'));
  assert.equal(fillLevel({ chars: 1100, limit: 2200 }), 0.5);
  assert.equal(fillLevel({ chars: 5000, limit: 2200 }), 1);
  assert.equal(fillLevel({ chars: 10, limit: 0 }), 0);
});

// ---- source --------------------------------------------------------------------------------------------

type Call = { url: string; method: string; auth?: string };

function fakeFetch(routes: Record<string, { status: number; body: unknown }>, calls: Call[]): FetchLike {
  return async (url, init) => {
    calls.push({ url, method: init.method, auth: init.headers.Authorization });
    const r = routes[url] ?? { status: 404, body: { error: { message: 'Not found', code: 'not_found' } } };
    const text = JSON.stringify(r.body);
    return { ok: r.status >= 200 && r.status < 300, status: r.status, headers: { get: () => null }, body: null, text: async () => text };
  };
}

const BRIDGE = { id: 'p1', kind: 'hermes', baseUrl: 'https://hermes.example.com/v1', apiKey: 'nca_user_test_token_000000', bridge: true };
const DIRECT = { ...BRIDGE, bridge: false, baseUrl: 'https://hermes.example.com' };

test('source: which connections have Skills & memory at all', () => {
  assert.equal(libraryApplies(BRIDGE), true);
  assert.equal(libraryApplies({ ...BRIDGE, apiKey: '' }), false);
  assert.equal(libraryApplies({ id: 'c', kind: 'claude', baseUrl: 'https://x', apiKey: 'k' }), false);
  assert.equal(libraryApplies({ id: 'd', kind: 'demo', baseUrl: 'demo://', apiKey: '' }), true);
  assert.equal(librarySource(null, undefined, fakeFetch({}, [])), null);
});

test('source via the bridge plugin: config, list, SKILL.md and memory for the chat bot', async () => {
  const calls: Call[] = [];
  const root = 'https://hermes.example.com';
  const f = fakeFetch(
    {
      [`${root}/bridge/library/config?bot=writer`]: { status: 200, body: { bot: 'writer', skills: { available: true }, memory: { available: true } } },
      [`${root}/bridge/library/skills?bot=writer`]: { status: 200, body: { object: 'list', data: [{ name: 'pdf', enabled: false, source: 'hub' }] } },
      [`${root}/bridge/library/skills/content?bot=writer&name=pdf%2Fextract`]: { status: 200, body: { name: 'pdf/extract', content: '# PDF', truncated: false } },
      [`${root}/bridge/library/memory?bot=writer`]: { status: 200, body: { stores: [{ target: 'memory', enabled: true, entries: ['a'], chars: 1, limit: 2200, updated_at: null }] } },
    },
    calls,
  );
  const src = librarySource(BRIDGE, 'writer', f);
  assert.ok(src);
  const feats = await src.features();
  assert.deepEqual(feats, { skills: { available: true }, memory: { available: true } });
  const list = await src.skills(feats);
  assert.equal(list.via, 'plugin');
  assert.deepEqual(list.skills, [{ name: 'pdf', enabled: false, source: 'hub' }]);
  assert.equal((await src.skillDoc('pdf/extract', feats))?.body, '# PDF');
  assert.deepEqual((await src.memory(feats))?.stores[0].entries, ['a']);
  assert.ok(calls.every((c) => c.method === 'GET'), 'read-only');
  assert.ok(calls.every((c) => c.auth === `Bearer ${BRIDGE.apiKey}`));
});

test('source without the plugin: Hermes /v1/skills under the bot prefix, no SKILL.md, no memory', async () => {
  const calls: Call[] = [];
  const root = 'https://hermes.example.com';
  const f = fakeFetch(
    {
      [`${root}/bridge/library/config?bot=writer`]: { status: 200, body: { skills: { available: false, reason: 'other_bot' }, memory: { available: false, reason: 'other_bot' } } },
      [`${root}/p/writer/v1/skills`]: { status: 200, body: { object: 'list', data: [{ name: 'pdf', description: 'PDFs', category: 'docs' }] } },
    },
    calls,
  );
  const src = librarySource(BRIDGE, 'writer', f)!;
  const feats = await src.features();
  assert.equal(feats.memory.reason, 'other_bot');
  const list = await src.skills(feats);
  assert.equal(list.via, 'api');
  assert.equal(list.skills[0].name, 'pdf');
  assert.equal(await src.skillDoc('pdf', feats), null);
  assert.equal(await src.memory(feats), null);
  assert.deepEqual(
    calls.map((c) => c.url),
    [`${root}/bridge/library/config?bot=writer`, `${root}/p/writer/v1/skills`],
  );
});

test('source: an older bridge (404 on the config) still lists skills; a direct connection never asks the bridge', async () => {
  const calls: Call[] = [];
  const root = 'https://hermes.example.com';
  const f = fakeFetch({ [`${root}/v1/skills`]: { status: 500, body: { error: { message: 'Failed to enumerate skills', code: 'server_error' } } } }, calls);
  const old = librarySource(BRIDGE, undefined, f)!;
  const feats = await old.features();
  assert.equal(feats.skills.reason, 'bridge_too_old');
  await assert.rejects(old.skills(feats), (e: unknown) => skillsFailure(e) === 'hermesBug');

  const direct = librarySource(DIRECT, undefined, fakeFetch({}, calls))!;
  calls.length = 0;
  assert.deepEqual(await direct.features(), { skills: { available: false, reason: 'no_bridge' }, memory: { available: false, reason: 'no_bridge' } });
  assert.equal(calls.length, 0);
});

test('source: auth errors on the config surface instead of hiding the feature', async () => {
  const root = 'https://hermes.example.com';
  const src = librarySource(BRIDGE, undefined, fakeFetch({ [`${root}/bridge/library/config?bot=default`]: { status: 401, body: { error: { message: 'Invalid bridge token' } } } }, []))!;
  await assert.rejects(src.features(), (e: unknown) => skillsFailure(e) === 'auth');
});

test('demo: every listed skill has a document, memory has both stores', async () => {
  const d = demoLibrary(Date.parse('2026-10-16T12:00:00Z'));
  for (const s of d.skills) assert.ok(d.doc(s.name)?.body, s.name);
  assert.equal(d.doc('nope'), null);
  assert.deepEqual(
    d.memory.stores.map((s) => s.target),
    ['memory', 'user'],
  );
  const src = librarySource({ id: 'demo', kind: 'demo', baseUrl: 'demo://', apiKey: '' }, undefined, fakeFetch({}, []))!;
  assert.equal(src.demo, true);
  const f = await src.features();
  assert.equal((await src.skills(f)).via, 'demo');
});

test('route: Skills & memory of a bot, optionally on the Memory tab (drawer row, "remembered" chip, What\'s new)', () => {
  assert.equal(libraryRoute(undefined), '/skills');
  assert.equal(libraryRoute('default'), '/skills');
  assert.equal(libraryRoute('research'), '/skills?bot=research');
  assert.equal(libraryRoute(null, 'memory'), '/skills?tab=memory');
  assert.equal(libraryRoute('writer', 'memory'), '/skills?bot=writer&tab=memory');
  assert.equal(libraryRoute('not a bot name'), '/skills', 'invalid names fall back to the default bot');
});

test('demo: the memory follows the UI language (the demo chat lists the same entries)', () => {
  const de = demoLibrary(0, 'de').memory.stores.flatMap((s) => s.entries);
  const en = demoLibrary(0, 'en').memory.stores.flatMap((s) => s.entries);
  const es = demoLibrary(0, 'es').memory.stores.flatMap((s) => s.entries);
  assert.equal(de.length, en.length);
  assert.equal(es.length, en.length);
  assert.ok(de.some((e) => /Koriander/.test(e)) && en.some((e) => /coriander/.test(e)) && es.some((e) => /cilantro/.test(e)));
  for (const s of demoLibrary(0, 'es').memory.stores) assert.ok(s.chars > 0 && s.chars < s.limit);
  // the demo source caches per language
  const p = { id: 'demo', kind: 'demo', baseUrl: 'demo://', apiKey: '' };
  assert.notEqual(librarySource(p, undefined, fakeFetch({}, []), 'de')!.key, librarySource(p, undefined, fakeFetch({}, []), 'en')!.key);
});
