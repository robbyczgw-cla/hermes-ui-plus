/// <reference types="node" />
// "Über <Name>", complete (slice 4): memory / skills summaries, "Immer erlaubt" list + revoke, archive / restore, the
// per-bot notification level and its push scope. Every unknown state must have a visible reason (no empty gap).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowLabelKey, manageReasonKey, memorySummary, parseAllowList, parseArchived, skillsSummary } from './about.ts';
import { fetchAllowList, parkBot, revokeAllowed } from './aboutApi.ts';
import { levelOf, levelsKey, noticeAllowed, sanitizeLevels, scopeLists, withLevel } from './notify.ts';
import type { LibraryFeatures, LibrarySkill, MemorySnapshot } from '../library/model.ts';

const ON: LibraryFeatures = { skills: { available: true }, memory: { available: true } };

test('memory summary: user entries first, count over both stores, one calm first line', () => {
  const snap: MemorySnapshot = {
    stores: [
      { target: 'memory', enabled: true, entries: ['Projekt Alpha läuft bis Mai'], chars: 10, limit: 2200 },
      { target: 'user', enabled: true, entries: ['Mag  Gangplatz,\nmax. 80 € für Kopfhörer', 'Wohnt in Graz'], chars: 20, limit: 1375 },
    ],
  };
  assert.deepEqual(memorySummary(ON, snap), { kind: 'ready', count: 3, first: 'Mag Gangplatz, max. 80 € für Kopfhörer' });
  assert.equal((memorySummary(ON, { stores: [{ target: 'user', enabled: true, entries: ['x'.repeat(300)], chars: 300, limit: 0 }] }) as { first: string }).first.length, 120);
});

test('memory summary: empty, switched off, not exposed, provider, failure, no plugin', () => {
  assert.deepEqual(memorySummary(ON, { stores: [{ target: 'memory', enabled: true, entries: [], chars: 0, limit: 0 }] }), { kind: 'empty' });
  assert.deepEqual(memorySummary(ON, { stores: [{ target: 'memory', enabled: false, entries: [], chars: 0, limit: 0 }, { target: 'user', enabled: false, entries: ['old'], chars: 3, limit: 0 }] }), { kind: 'disabled' });
  assert.deepEqual(memorySummary({ ...ON, memory: { available: false, reason: 'memory_not_exposed' } }, null), { kind: 'unavailable', reason: 'memory_not_exposed' });
  assert.deepEqual(memorySummary({ ...ON, memory: { available: false, reason: '<b>x</b>' } }, null), { kind: 'unavailable', reason: 'unknown' });
  assert.deepEqual(memorySummary(ON, { provider: 'honcho', stores: [] }), { kind: 'empty', provider: 'honcho' });
  assert.deepEqual(memorySummary(null, null), { kind: 'unavailable', reason: 'unknown' });
  assert.deepEqual(memorySummary(ON, null, true), { kind: 'failed' });
});

test('skills summary: enabled count, off count, plain list from Hermes, failure reason', () => {
  const skills: LibrarySkill[] = [
    { name: 'hermes-ui', enabled: true, source: 'local' },
    { name: 'web', enabled: false, source: 'bundled' },
    { name: 'notes', source: 'local' },
  ];
  assert.deepEqual(skillsSummary(skills, 'plugin'), { kind: 'ready', count: 2, off: 1, names: ['hermes-ui', 'notes'], full: true });
  assert.equal((skillsSummary(skills, 'api') as { full: boolean }).full, false);
  assert.deepEqual(skillsSummary([], 'plugin'), { kind: 'empty' });
  assert.deepEqual(skillsSummary(null, null, 'hermesBug'), { kind: 'failed', reason: 'hermesBug' });
});

test('allow-list: known fields only, duplicates and control characters dropped, manage right parsed', () => {
  const list = parseAllowList({
    entries: [{ pattern: 'delete in root path' }, 'recursive delete', { pattern: 'delete in root path' }, { pattern: 'podman *', description: 'podman *' }, { pattern: 'a\u0007b' }, { nope: 1 }, { pattern: '' }],
    manage: { allowed: false, reason: 'device_forbidden' },
    extra: '<script>',
  });
  assert.deepEqual(list, {
    entries: [{ pattern: 'delete in root path' }, { pattern: 'recursive delete' }, { pattern: 'podman *' }, { pattern: 'a b' }],
    manage: { allowed: false, reason: 'device_forbidden' },
    omitted: 0,
  });
  assert.equal(parseAllowList({ entries: [], omitted: 3 })?.omitted, 3);
  assert.equal(parseAllowList({ entries: 'x' }), null);
  assert.deepEqual(parseAllowList({ entries: [] })?.manage, { allowed: false, reason: 'unknown' });
  assert.equal(allowLabelKey({ pattern: 'delete in root path' }), 'rootDelete');
  assert.equal(allowLabelKey({ pattern: 'git force push (rewrites remote history)' }), 'gitForcePush');
  assert.equal(allowLabelKey({ pattern: 'podman *' }), null, 'a command glob is shown as written');
});

test('archived bots and the reasons a change is refused', () => {
  assert.deepEqual(parseArchived([{ name: 'scout', label: 'Scout', color: '#3F7D6E' }, { name: 'default' }, 'x']), [{ name: 'scout', label: 'Scout', color: '#3f7d6e' }]);
  assert.deepEqual(parseArchived(undefined), []);
  assert.equal(manageReasonKey('owner_off'), 'ownerOff');
  assert.equal(manageReasonKey('device_forbidden'), 'device');
  assert.equal(manageReasonKey('plugin_unreachable'), 'plugin');
  assert.equal(manageReasonKey('whatever'), 'other');
});

function fake(status: number, body: unknown, o: { throws?: boolean } = {}) {
  const calls: { url: string; method: string; body?: string }[] = [];
  const fetchImpl = (async (url: string, init: { method?: string; body?: string }) => {
    calls.push({ url, method: init.method ?? 'GET', body: init.body });
    if (o.throws) throw new Error('offline');
    return { status, text: async () => (body === null ? '' : JSON.stringify(body)) };
  }) as unknown as Parameters<typeof fetchAllowList>[0];
  return { fetchImpl, calls };
}
const conn = { baseUrl: 'https://bridge.example.com/p/scout/v1', apiKey: 'nca_user_test_token_000' };

test('api: allow-list read / revoke / archive at the server root, failures as values', async () => {
  const g = fake(200, { entries: [{ pattern: 'recursive delete' }], manage: { allowed: true } });
  assert.deepEqual(await fetchAllowList(g.fetchImpl, conn, 'scout'), { ok: true, list: { entries: [{ pattern: 'recursive delete' }], manage: { allowed: true }, omitted: 0 } });
  assert.equal(g.calls[0].url, 'https://bridge.example.com/bridge/bots/scout/allowlist');
  const d = fake(200, { entries: [] });
  await fetchAllowList(d.fetchImpl, conn, undefined);
  assert.equal(d.calls[0].url, 'https://bridge.example.com/bridge/bots/default/allowlist', 'the default bot');
  assert.deepEqual(await fetchAllowList(fake(404, { error: { code: 'not_found' } }).fetchImpl, conn, 'scout'), { ok: false, failure: 'notFound' });
  assert.deepEqual(await fetchAllowList(fake(404, { error: {} }).fetchImpl, conn, 'scout'), { ok: false, failure: 'unsupported' }, 'older bridge');
  assert.deepEqual(await fetchAllowList(fake(0, null, { throws: true }).fetchImpl, conn, 'scout'), { ok: false, failure: 'offline' });

  const r = fake(200, { entries: [], manage: { allowed: true } });
  assert.equal((await revokeAllowed(r.fetchImpl, conn, 'scout', 'recursive delete')).ok, true);
  assert.deepEqual(r.calls[0], { url: 'https://bridge.example.com/bridge/bots/scout/allowlist/revoke', method: 'POST', body: '{"pattern":"recursive delete"}' });
  assert.deepEqual(await revokeAllowed(fake(403, { error: { code: 'bots_forbidden', reason: 'device_forbidden' } }).fetchImpl, conn, 'scout', 'x'), { ok: false, failure: 'forbidden', reason: 'device_forbidden' });

  const a = fake(200, { bot: { name: 'scout', parked: true, archived: true } });
  assert.deepEqual(await parkBot(a.fetchImpl, conn, 'scout', 'archive'), { ok: true });
  assert.equal(a.calls[0].url, 'https://bridge.example.com/bridge/bots/scout/archive');
  assert.deepEqual(await parkBot(fake(409, { error: { code: 'parked_elsewhere' } }).fetchImpl, conn, 'scout', 'restore'), { ok: false, failure: 'parkedElsewhere' });
  assert.deepEqual(await parkBot(fake(200, {}).fetchImpl, conn, 'default', 'archive'), { ok: false, failure: 'forbidden' }, 'never the default bot');
});

test('notification level per bot: stored sparse, scope lists, what each level lets through', () => {
  let levels = withLevel({}, 'scout', 'off');
  levels = withLevel(levels, undefined, 'needed');
  assert.deepEqual(levels, { scout: 'off', default: 'needed' });
  assert.equal(levelOf(levels, 'scout'), 'off');
  assert.equal(levelOf(levels, null), 'needed');
  assert.equal(levelOf(levels, 'writer'), 'all');
  assert.deepEqual(withLevel(levels, 'scout', 'all'), { default: 'needed' });
  assert.deepEqual(scopeLists(levels), { quietBots: ['default'], offBots: ['scout'] });
  assert.deepEqual(scopeLists({}), {});
  assert.equal(levelsKey({ b: 'off', a: 'needed' }), 'a=needed,b=off');
  assert.deepEqual(sanitizeLevels({ ok: 'off', 'Bad Key': 'off', x: 'loud', y: 'all' }), { ok: 'off' });
  assert.deepEqual(sanitizeLevels([1]), {});

  assert.equal(noticeAllowed('all', 'answer'), true);
  assert.equal(noticeAllowed('needed', 'answer'), false);
  assert.equal(noticeAllowed('needed', 'routine'), false);
  assert.equal(noticeAllowed('needed', 'approval'), true);
  assert.equal(noticeAllowed('needed', 'approvalReminder'), true);
  // "Aus": an approval still announces itself once (it would expire to "deny" unseen), but no reminder
  assert.equal(noticeAllowed('off', 'approval'), true);
  assert.equal(noticeAllowed('off', 'approvalReminder'), false);
  assert.equal(noticeAllowed('off', 'reminder'), false);
});

test('api: the three fields for "So arbeitet <Name>": read, save, name taken, never the default bot', async () => {
  const { fetchBotFields, patchBotFields } = await import('./aboutApi.ts');
  const g = fake(200, { bot: { name: 'scout', title: 'Scout', job: 'Preise im Blick', how: 'Kurz.', app: true, extra: 'x' } });
  assert.deepEqual(await fetchBotFields(g.fetchImpl, conn, 'scout'), { title: 'Scout', job: 'Preise im Blick', how: 'Kurz.', app: true });
  assert.equal(g.calls[0].url, 'https://bridge.example.com/bridge/bots/scout');
  assert.equal(await fetchBotFields(fake(403, { error: { code: 'bots_forbidden' } }).fetchImpl, conn, 'scout'), null);
  assert.equal(await fetchBotFields(fake(200, {}).fetchImpl, conn, 'default'), null);
  const p = fake(200, { bot: { name: 'scout' } });
  assert.deepEqual(await patchBotFields(p.fetchImpl, conn, 'scout', { title: 'Scout', job: 'j', how: 'h', lang: 'de' }), { ok: true, fields: null });
  assert.deepEqual(p.calls[0], { url: 'https://bridge.example.com/bridge/bots/scout', method: 'PATCH', body: '{"title":"Scout","job":"j","how":"h","lang":"de"}' });
  assert.deepEqual(await patchBotFields(fake(409, { error: { code: 'exists' } }).fetchImpl, conn, 'scout', { title: 'X', job: 'j', how: 'h' }), { ok: false, failure: 'exists', field: 'title' });
  assert.deepEqual(await patchBotFields(fake(400, { error: { code: 'invalid_field', field: 'how' } }).fetchImpl, conn, 'scout', { title: 'X', job: 'j', how: '' }), { ok: false, failure: 'invalid', field: 'how' });
});
