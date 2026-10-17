// Heuristic-first router mode (ROUTER_BACKEND=heuristic,<model>) and the cheap language guess behind it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouter, heuristicFirstAsksModel } from '../src/router/router.mjs';
import { detectLanguage, isForeignToHeuristic } from '../src/router/lang.mjs';
import { classifyHeuristic } from '../src/router/backends/heuristic.mjs';
import { createBackend } from '../src/router/backends/index.mjs';
import { loadConfig } from '../src/config.mjs';

const u = (content) => [{ role: 'user', content }];
/** Backend stub that records calls. */
function stub(answer = { format: 'checklist', component: 'shopping', confidence: 0.9, reason: 'stub' }) {
  const calls = [];
  return { calls, backend: { id: 'jev', model: 'jev-latest', decide: async (turns) => { calls.push(turns); if (answer instanceof Error) throw answer; return answer; } } };
}

test('detectLanguage: clear sentences per language, unsure on short or mixed text', () => {
  const cases = {
    de: 'Wie wird das Wetter morgen in Ulm?',
    en: 'What is the weather like tomorrow in Leeds?',
    es: 'Hazme una lista de la compra para el fin de semana',
    fr: 'Fais-moi une liste de courses pour le week-end',
    it: 'Fammi una lista della spesa per il fine settimana',
    pt: 'Faz-me uma lista de compras para o fim de semana',
    nl: 'Maak een boodschappenlijst voor het weekend',
    pl: 'Zrób mi listę zakupów na weekend',
    tr: 'Hafta sonu için bir alışveriş listesi yap',
  };
  for (const [lang, text] of Object.entries(cases)) assert.equal(detectLanguage(text), lang, text);
  for (const text of ['Run the tests', 'iPhone 17 vs Pixel 11', 'Moin', '', '```js\nlet x = 1\n```']) assert.equal(detectLanguage(text), '', text);
  assert.equal(isForeignToHeuristic(cases.it), true);
  assert.equal(isForeignToHeuristic(cases.es), false);
  assert.equal(isForeignToHeuristic('Run the tests'), false);
});

test('heuristicFirstAsksModel: no rule fired, or a foreign language with a weak rule', () => {
  assert.equal(classifyHeuristic(u('Erzähl mir was über Wale')).fallthrough, true);
  assert.equal(classifyHeuristic(u('Stell einen Timer auf 7 Minuten')).fallthrough, undefined);
  const it = u('Il mio budget mensile: vorrei un grafico per capire dove vanno i soldi');
  assert.equal(heuristicFirstAsksModel(u('Erzähl mir was über Wale'), { confidence: 0.4, fallthrough: true }), true);
  assert.equal(heuristicFirstAsksModel(u('Wie hoch ist die Zugspitze?'), { confidence: 0.6 }), false);
  assert.equal(heuristicFirstAsksModel(it, { confidence: 0.7 }), true);
  assert.equal(heuristicFirstAsksModel(it, { confidence: 0.9 }), false);
});

test('heuristic-first router: a fired rule answers in-process, the model is never called', async () => {
  const s = stub();
  const r = createRouter({ backend: s.backend, mode: 'heuristic-first', fastPathMin: 0.85, cache: null });
  assert.equal(r.mode, 'heuristic-first');
  for (const text of ['Stell einen Timer auf 7 Minuten', 'Wie hoch ist die Zugspitze?', 'Danke dir!']) {
    const d = await r.route(u(text));
    assert.equal(d.model, 'heuristic-v1', text);
    assert.match(d.reason, /^heuristic first: /);
  }
  assert.equal(s.calls.length, 0);
});

test('heuristic-first router: no rule fired or foreign language -> model, with the usual fallback on errors', async () => {
  const s = stub();
  const r = createRouter({ backend: s.backend, mode: 'heuristic-first', cache: null });
  const d = await r.route(u('Maak een boodschappenlijstje voor het weekend')); // Dutch: no rule fired
  assert.deepEqual([d.format, d.component, d.model], ['checklist', 'shopping', 'jev-latest']);
  await r.route(u('Erzähl mir was über Wale'));
  assert.equal(s.calls.length, 2);
  // Italian with a rule below 0.85 (products 0.78) asks the model; a confident Italian rule (shopping list 0.88) does not
  assert.equal((await r.route(u('Mi serve un portatile leggero per lavoro, cosa mi consigli?'))).model, 'jev-latest');
  const it = await r.route(u('Fammi una lista della spesa per il fine settimana'));
  assert.deepEqual([it.format, it.component, it.model], ['checklist', 'shopping', 'heuristic-v1']);
  assert.equal(s.calls.length, 3);

  const failing = createRouter({ backend: stub(new Error('jev HTTP 429')).backend, mode: 'heuristic-first', cache: null });
  const f = await failing.route(u('Erzähl mir was über Wale'));
  assert.deepEqual([f.format, f.model, f.fallback], ['text', 'heuristic-v1', 'error']);
});

test('model-first stays the default: the model answers unless the fast path applies', async () => {
  const s = stub({ format: 'text', confidence: 0.7, reason: 'stub' });
  const r = createRouter({ backend: s.backend, fastPathMin: 0.85, cache: null });
  assert.equal(r.mode, 'model-first');
  assert.equal((await r.route(u('Wie hoch ist die Zugspitze?'))).model, 'jev-latest'); // 0.6 rule: model-first asks
  assert.equal((await r.route(u('Stell einen Timer auf 7 Minuten'))).model, 'heuristic-v1'); // 0.88 fast path
  assert.equal(s.calls.length, 1);
});

test('config: heuristic leading a chain selects heuristic-first; elsewhere it is rejected', () => {
  const base = { HERMES_BASE_URL: 'http://h:8645/v1', BRIDGE_TOKEN: 't', BRIDGE_BOOTSTRAP: 'off' };
  const c = loadConfig({ ...base, ROUTER_BACKEND: 'heuristic,jev,claude', TYPESAFE_API_KEY: 'jev_test_key', ANTHROPIC_API_KEY: 'sk-ant-test' });
  assert.deepEqual([c.router.kind, c.router.mode, c.router.chain], ['heuristic,jev,anthropic', 'heuristic-first', ['heuristic', 'jev', 'anthropic']]);
  assert.equal(createBackend(c.router).id, 'jev>anthropic');
  assert.equal(loadConfig({ ...base, ROUTER_BACKEND: 'jev' }).router.mode, 'model-first');
  assert.equal(loadConfig(base).router.mode, 'model-first');
  assert.throws(() => loadConfig({ ...base, ROUTER_BACKEND: 'jev,heuristic' }));
  assert.throws(() => loadConfig({ ...base, ROUTER_BACKEND: 'heuristic,heuristic' }));
  assert.throws(() => loadConfig({ ...base, ROUTER_BACKEND: 'heuristic,off' }));
});
