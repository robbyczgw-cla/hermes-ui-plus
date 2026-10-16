// Named buyable products compared side by side route to `products` with component "compare" (photos, prices,
// specs table); concepts, plans, services and places stay `compare`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyHeuristic, looksLikeProductComparison } from '../src/router/backends/heuristic.mjs';
import { COMPONENTS, DEFINITIONS, normalizeComponent, normalizeDecision } from '../src/router/taxonomy.mjs';
import { ROUTER_SYSTEM_PROMPT } from '../src/router/prompt.mjs';
import { buildHint } from '../src/router/hint.mjs';
import { createRouter } from '../src/router/router.mjs';

const u = (content) => ({ role: 'user', content });
const f = (t) => classifyHeuristic([u(t)]);

const HANDHELDS = 'Gba trimui hammer vs pocket mini v2 vs Odin 2 mini vs 35xx SP vs 28xx vs konkr advance vs rg rotate tiefer Vergleich extrem';
const PRODUCT_COMPARISONS = [
  HANDHELDS,
  'iPhone 17 vs Pixel 11',
  'Vergleiche iPhone 17 und Pixel 11',
  'Sony XM6 vs Bose QC',
  'Sony WH-1000XM6 oder Bose QuietComfort Ultra – was ist besser?',
  'Compare the Steam Deck OLED and the ROG Ally X',
  'Tesla Model 3 vs BMW i4',
  'Galaxy S26 Ultra vs iPhone 17 Pro Max',
  'Kindle vs Tolino: welcher E-Reader?',
  'Vergleich von 4 Staubsaugern mit Preisen',
  'Which is better for a beginner: Canon R50 or Sony ZV-E10?',
];
const CONCEPT_COMPARISONS = [
  'Kubernetes vs Nomad',
  'Miete vs Kauf',
  'Miete oder Kauf?',
  'Vergleiche Lissabon und Porto',
  'Apple Music vs Spotify',
  'Apple vs Google als Arbeitgeber',
  'IPv4 vs IPv6',
  'Python 3 vs Python 2',
  'Was ist der Unterschied zwischen Docker und VM?',
  'Unterschied zwischen OLED und QLED Fernseher',
  'Over-Ear oder In-Ear Kopfhörer?',
];

test('product comparisons (EN/DE) → products with component "compare"', () => {
  for (const t of PRODUCT_COMPARISONS) {
    const d = f(t);
    assert.equal(d.format, 'products', t);
    assert.equal(d.component, 'compare', t);
    assert.ok(d.confidence >= 0.5, `${t}: hint is injected`);
  }
  // the owner's real case: hint the bridge injects
  const d = normalizeDecision(f(HANDHELDS), { model: 'heuristic-v1', ms: 1 });
  assert.equal(buildHint(d), 'UI-ROUTER-HINT: format=products component=compare confidence=0.9 data=live');
});

test('concepts, plans, services and places stay compare (or text), never product cards', () => {
  for (const t of CONCEPT_COMPARISONS) {
    assert.equal(looksLikeProductComparison(t), false, t);
    assert.notEqual(f(t).format, 'products', t);
  }
  assert.equal(f('Kubernetes vs Nomad').format, 'compare');
  assert.equal(f('Miete vs Kauf').format, 'compare');
});

test('product names without a comparison and code questions are not product comparisons', () => {
  for (const t of ['Wie viel Akku hat das iPhone 17?', 'Mein Pixel 11 lädt nicht mehr', 'Write a Swift function that detects an iPhone 17 vs iPad']) {
    assert.equal(looksLikeProductComparison(t), false, t);
  }
  // a shopping question stays products without the compare component
  const d = f('Welche Kopfhörer unter 200 € soll ich kaufen?');
  assert.equal(d.format, 'products');
  assert.equal(d.component, undefined);
});

test('taxonomy + prompt: products has the compare component, definitions name the split', () => {
  assert.deepEqual(COMPONENTS.products, ['compare']);
  assert.equal(normalizeComponent('products', 'compare'), 'compare');
  assert.equal(normalizeComponent('products', 'comparison'), 'compare');
  assert.equal(normalizeComponent('products', 'carousel'), undefined);
  assert.match(DEFINITIONS.compare, /buyable products .* are products/);
  assert.match(DEFINITIONS.products, /component "compare"/);
  assert.match(ROUTER_SYSTEM_PROMPT, /- products: .* component: one of "compare"\./);
  assert.match(ROUTER_SYSTEM_PROMPT, /"Vergleiche iPhone 17 und Pixel 11" → products \(component "compare"\)/);
  assert.doesNotMatch(ROUTER_SYSTEM_PROMPT, /iPhone[^\n]*→ compare/);
});

test('router: a model that says compare for named products is upgraded to products compare', async () => {
  const backend = { id: 'fake', model: 'fake-1', decide: async () => ({ format: 'compare', component: '', confidence: 0.9, reason: 'comparison request' }) };
  const r = createRouter({ backend, timeoutMs: 200, cache: null });
  const d = await r.route([u(HANDHELDS)]);
  assert.equal(d.format, 'products');
  assert.equal(d.component, 'compare');
  assert.match(d.reason, /named products/);
  const c = await r.route([u('Kubernetes vs Nomad')]);
  assert.equal(c.format, 'compare');
  assert.equal(c.component, undefined);
});
