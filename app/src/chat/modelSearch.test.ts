/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRequest } from '../hermes/stream.ts';
import { modelCapsFor, parseModelOptions, providerModelId, sanitizeChatOptions, splitProviderModel, usableProviders } from '../hermes/capabilities.ts';
import { makeT } from '../i18n/core.ts';
import { HERMES_MODEL_OPTIONS } from '../hermes/modelOptions.fixtures.ts';
import { failedWithPickedModel, modelEntries, modelLabel, overrideFor } from './models.ts';
import {
  buildRows,
  dedupeEntries,
  EMPTY_PREFS,
  formatContext,
  lastModel,
  nextModelRow,
  parsePrefs,
  pushRecent,
  rankEntries,
  scoreEntry,
  toggleFavorite,
  tokenScore,
  type ModelEntry,
} from './modelSearch.ts';

const t = makeT('de', 'de-DE');
const titles = { favorites: 'Favoriten', recents: 'Zuletzt', other: 'Weitere' };
const E = (id: string, label = id, group?: string): ModelEntry => ({ id, label, group });

const LIST: ModelEntry[] = [
  E('openai/gpt-5.5', 'OpenAI: GPT-5.5', 'openai'),
  E('openai/gpt-5-mini', 'OpenAI: GPT-5 Mini', 'openai'),
  E('anthropic/claude-haiku-5.5', 'Anthropic: Claude Haiku 5.5', 'anthropic'),
  E('anthropic/claude-opus-5.5', 'Anthropic: Claude Opus 5.5', 'anthropic'),
  E('google/gemini-3-pro', 'Google: Gemini 3 Pro', 'google'),
  E('meta/llama-5-405b', 'Meta: Llama 5 405B', 'meta'),
];

// ── search / ranking ─────────────────────────────────────────────────────────────────────────────

test('tokenScore: exact > prefix > word start > in-word > fuzzy > none', () => {
  const exact = tokenScore('gpt', 'gpt');
  const prefix = tokenScore('gpt', 'gpt-5.5');
  const word = tokenScore('haiku', 'anthropic/claude-haiku-5.5');
  const inword = tokenScore('aiku', 'anthropic/claude-haiku-5.5');
  const fuzzy = tokenScore('gpt5m', 'openai/gpt-5-mini');
  assert.ok(exact > prefix && prefix > word && word > inword && inword > fuzzy && fuzzy > 0, `${exact} ${prefix} ${word} ${inword} ${fuzzy}`);
  assert.equal(tokenScore('xyz', 'openai/gpt-5'), 0);
});

test('scoreEntry: all tokens must match id, label or group; accents/case ignored', () => {
  assert.notEqual(scoreEntry(E('anthropic/claude-opus-5.5', 'Anthropic: Claude Opus 5.5', 'anthropic'), 'claude opus'), null);
  assert.equal(scoreEntry(E('anthropic/claude-opus-5.5'), 'claude gemini'), null);
  assert.notEqual(scoreEntry(E('x', 'Modèle Été'), 'modele ete'), null);
  assert.equal(scoreEntry(E('x'), '   '), 0);
});

test('rankEntries: best match first, favorites break ties, disabled sink', () => {
  assert.deepEqual(rankEntries(LIST, 'gpt').map((e) => e.id), ['openai/gpt-5.5', 'openai/gpt-5-mini']);
  assert.equal(rankEntries(LIST, 'opus')[0].id, 'anthropic/claude-opus-5.5');
  assert.equal(rankEntries(LIST, 'g3pro')[0].id, 'google/gemini-3-pro');
  assert.equal(rankEntries(LIST, 'anthropic', ['anthropic/claude-opus-5.5'])[0].id, 'anthropic/claude-opus-5.5');
  const withDisabled = [...LIST, { ...E('openai/gpt'), disabled: true }];
  assert.equal(rankEntries(withDisabled, 'gpt')[0].id, 'openai/gpt-5.5');
  // 450 models stay fast
  const many = Array.from({ length: 450 }, (_, i) => E(`vendor${i % 30}/model-${i}`, `Vendor ${i % 30}: Model ${i}`, `vendor${i % 30}`));
  const t0 = Date.now();
  for (let i = 0; i < 20; i++) rankEntries(many, 'mod 12');
  assert.ok(Date.now() - t0 < 1000);
});

// ── rows / sections ──────────────────────────────────────────────────────────────────────────────

test('buildRows: pinned, favorites, recents (minus favorites), then provider groups', () => {
  const entries: ModelEntry[] = [{ id: undefined, label: 'Standard', pinned: true }, ...LIST];
  const prefs = { favorites: ['google/gemini-3-pro'], recents: ['google/gemini-3-pro', 'meta/llama-5-405b', 'gone/model'] };
  const rows = buildRows(entries, '', prefs, titles);
  const shape = rows.map((r) => (r.type === 'header' ? `# ${r.title}` : (r.entry.id ?? 'default')));
  assert.deepEqual(shape, [
    'default',
    '# Favoriten',
    'google/gemini-3-pro',
    '# Zuletzt',
    'meta/llama-5-405b',
    '# openai',
    'openai/gpt-5.5',
    'openai/gpt-5-mini',
    '# anthropic',
    'anthropic/claude-haiku-5.5',
    'anthropic/claude-opus-5.5',
    '# google',
    'google/gemini-3-pro',
    '# meta',
    'meta/llama-5-405b',
  ]);
  assert.equal(new Set(rows.map((r) => r.key)).size, rows.length, 'unique keys');
  const fav = rows.find((r) => r.type === 'model' && r.entry.id === 'google/gemini-3-pro');
  assert.equal(fav?.type === 'model' && fav.favorite, true);
});

test('buildRows: ungrouped list without prefs has no headers; query gives one ranked list', () => {
  const plain = [E('a'), E('b')];
  assert.ok(buildRows(plain, '', EMPTY_PREFS, titles).every((r) => r.type === 'model'));
  const q = buildRows(LIST, 'haiku', EMPTY_PREFS, titles);
  // search keeps the provider header
  assert.deepEqual(q.map((r) => (r.type === 'model' ? r.entry.id : `# ${r.title}`)), ['# anthropic', 'anthropic/claude-haiku-5.5']);
});

test('search rows: group headers kept, groups ordered by best hit, pinned first without header', () => {
  const entries: ModelEntry[] = [{ id: undefined, label: 'Standard', pinned: true }, ...LIST];
  const rows = buildRows(entries, 'claude', EMPTY_PREFS, titles);
  assert.deepEqual(rows.map((r) => (r.type === 'model' ? r.entry.id : `# ${r.title} ${r.count}`)), ['# anthropic 2', 'anthropic/claude-opus-5.5', 'anthropic/claude-haiku-5.5']);
  const std = buildRows(entries, 'standard', EMPTY_PREFS, titles);
  assert.deepEqual(std.map((r) => r.type), ['model']);
  const keys = buildRows(entries, 'a', EMPTY_PREFS, titles).map((r) => r.key);
  assert.equal(new Set(keys).size, keys.length);
});

test('dedupeEntries: identical id within a provider collapses, same id under another provider stays with its provider shown', () => {
  const dupe = [E('p1::gpt-5', 'gpt-5', 'Alpha'), E('p1::gpt-5', 'gpt-5', 'Alpha'), E('p2::gpt-5', 'gpt-5', 'Beta')];
  assert.equal(dedupeEntries(dupe).length, 2);
  assert.deepEqual(dedupeEntries([E('x', 'x', 'g'), E('x', 'x', 'g'), E('x', 'x', 'h')]).map((e) => e.group), ['g', 'h']);
  const rows = buildRows([E('a::m', 'm', 'Alpha'), E('a::m', 'm', 'Alpha'), E('b::m', 'm', 'Beta')], 'm', EMPTY_PREFS, titles);
  const models = rows.filter((r) => r.type === 'model');
  assert.equal(models.length, 2);
  assert.deepEqual(rows.filter((r) => r.type === 'header').map((r) => r.type === 'header' && r.title), ['Alpha', 'Beta']);
  assert.ok(models.every((r) => r.type === 'model' && /Alpha|Beta/.test(r.entry.detail ?? '')), 'provider shown for repeated names');
});

test('modelEntries (Hermes): repeated provider models do not duplicate', () => {
  const cat = parseModelOptions({ providers: [{ slug: 'a', name: 'Alpha', models: ['m', 'm', 'n'], authenticated: true }, { slug: 'b', name: 'Beta', models: ['m'], authenticated: true }] });
  const ids = modelEntries({ kind: 'hermes', t, current: undefined, serverIds: [], hermes: cat }).map((e) => e.id);
  assert.deepEqual(ids, [undefined, 'a::m', 'a::n', 'b::m']);
});

test('nextModelRow: skips headers and disabled rows, stops at the ends', () => {
  const rows = buildRows([E('a', 'a', 'g'), { ...E('b', 'b', 'g'), disabled: true }, E('c', 'c', 'g')], '', EMPTY_PREFS, titles);
  assert.equal(rows[0].type, 'header');
  assert.equal(nextModelRow(rows, -1, 1), 1);
  assert.equal(nextModelRow(rows, 1, 1), 3);
  assert.equal(nextModelRow(rows, 3, 1), 3);
  assert.equal(nextModelRow(rows, 3, -1), 1);
});

// ── favorites / recents ──────────────────────────────────────────────────────────────────────────

test('favorites toggle, recents are unique + capped, "Standard" not recorded, prefs parse defensively', () => {
  let p = toggleFavorite(EMPTY_PREFS, 'a');
  p = toggleFavorite(p, 'b');
  assert.deepEqual(p.favorites, ['b', 'a']);
  p = toggleFavorite(p, 'a');
  assert.deepEqual(p.favorites, ['b']);
  for (const id of ['1', '2', '3', '2', '4', '5', '6', '7']) p = pushRecent(p, id);
  assert.deepEqual(p.recents, ['7', '6', '5', '4', '2', '3']);
  assert.equal(lastModel(p), '7');
  assert.equal(pushRecent(p, undefined), p);
  assert.equal(pushRecent(p, '7'), p);
  assert.deepEqual(parsePrefs(JSON.stringify(p)), p);
  assert.deepEqual(parsePrefs('{"favorites":[1,"x","x"],"recents":"nope"}'), { favorites: ['x'], recents: [] });
  assert.deepEqual(parsePrefs('garbage'), EMPTY_PREFS);
  assert.deepEqual(parsePrefs(null), EMPTY_PREFS);
});

test('formatContext', () => {
  assert.equal(formatContext(undefined), '');
  assert.equal(formatContext(8192), '8K');
  assert.equal(formatContext(200000), '200K');
  assert.equal(formatContext(1000000), '1M');
  assert.equal(formatContext(1048576), '1M');
  assert.equal(formatContext(1500000), '1.5M');
});

// ── entries per kind ─────────────────────────────────────────────────────────────────────────────



// ── Hermes: provider models from /api/model/options ──────────────────────────────────────────────

test('Hermes options payload: authenticated providers only, fixture has no secrets', () => {
  const raw = JSON.stringify(HERMES_MODEL_OPTIONS);
  assert.doesNotMatch(raw, /sk-|Bearer|api_key|token/i);
  const cat = parseModelOptions(HERMES_MODEL_OPTIONS)!;
  assert.equal(cat.providers.length, 3);
  assert.deepEqual(usableProviders(cat).map((p) => p.slug), ['moonshot', 'openrouter']);
  // older servers without `authenticated` keep everything
  assert.equal(usableProviders(parseModelOptions({ providers: [{ slug: 'a', models: ['m'] }] })).length, 1);
});

test('modelEntries (Hermes): Standard (model · provider), route aliases, provider groups, caps badges', () => {
  const cat = parseModelOptions(HERMES_MODEL_OPTIONS);
  const entries = modelEntries({ kind: 'hermes', t, current: undefined, serverIds: ['hermes-agent', 'kimi-k2', 'kimi-k2-kilo'], hermes: cat });
  assert.deepEqual(entries[0], { id: undefined, label: 'Standard', detail: 'kimi-k3-fast · Moonshot', pinned: true });
  assert.deepEqual(entries.slice(1, 3).map((e) => [e.id, e.group]), [
    ['kimi-k2', 'Routen'],
    ['kimi-k2-kilo', 'Routen'],
  ]);
  const fast = entries.find((e) => e.id === 'moonshot::kimi-k3-fast')!;
  assert.equal(fast.label, 'kimi-k3-fast');
  assert.equal(fast.group, 'Moonshot');
  assert.deepEqual(fast.badges, ['reasoning', 'fast']);
  assert.ok(entries.some((e) => e.id === 'openrouter::anthropic/claude-haiku-5.5' && e.group === 'OpenRouter'));
  assert.equal(entries.some((e) => e.id?.startsWith('nous::')), false, 'unauthenticated provider hidden');
  // an unlisted pick stays visible
  const gone = modelEntries({ kind: 'hermes', t, current: 'nous::hermes-5-405b', serverIds: [], hermes: cat });
  assert.equal(gone[gone.length - 1].label, 'hermes-5-405b');
});

test('Hermes provider model: id round trip, request body model + provider, caps, header label, override', () => {
  assert.equal(providerModelId('openrouter', 'anthropic/claude-haiku-5.5'), 'openrouter::anthropic/claude-haiku-5.5');
  assert.deepEqual(splitProviderModel('openrouter::anthropic/claude-haiku-5.5'), { provider: 'openrouter', model: 'anthropic/claude-haiku-5.5' });
  assert.deepEqual(splitProviderModel('kimi-k2'), { model: 'kimi-k2' });
  assert.deepEqual(splitProviderModel('x::y'), { model: 'x::y' }, 'provider must be 2+ chars like the server check');
  const conn = { baseUrl: 'http://h/v1', apiKey: 'k' };
  const withProvider = JSON.parse(buildRequest({ ...conn, model: 'moonshot::kimi-k3' }, 'hi', 's').body);
  assert.equal(withProvider.model, 'kimi-k3');
  assert.equal(withProvider.provider, 'moonshot');
  const alias = JSON.parse(buildRequest({ ...conn, model: 'kimi-k2' }, 'hi', 's').body);
  assert.equal(alias.model, 'kimi-k2');
  assert.equal('provider' in alias, false);
  assert.equal(JSON.parse(buildRequest(conn, 'hi', 's').body).model, 'hermes-agent');
  const cat = parseModelOptions(HERMES_MODEL_OPTIONS);
  assert.equal(modelCapsFor(cat, 'moonshot::kimi-k3').canDisableReasoning, false);
  assert.equal(modelCapsFor(cat, 'moonshot::kimi-k3-fast').fast, true);
  assert.equal(modelLabel('hermes', 'openrouter::anthropic/claude-haiku-5.5'), 'anthropic/claude-haiku-5.5');
  assert.equal(overrideFor('hermes', 'moonshot::kimi-k3', undefined), 'moonshot::kimi-k3');
});

test('per-chat web option persists; failed turn with a picked model offers Standard', () => {
  assert.deepEqual(sanitizeChatOptions({ web: true, reasoning: 'high' }), { reasoning: 'high', web: true });
  assert.equal(sanitizeChatOptions({ web: 'yes' }), undefined);
  const err = [{ role: 'user' }, { role: 'assistant', status: 'error' }];
  assert.equal(failedWithPickedModel(err, 'moonshot::kimi-k3'), true);
  assert.equal(failedWithPickedModel(err, undefined), false);
  assert.equal(failedWithPickedModel([{ role: 'assistant', status: 'done' }], 'm'), false);
});
