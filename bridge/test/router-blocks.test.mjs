import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyHeuristic } from '../src/router/backends/heuristic.mjs';
import { ROUTE_FORMATS, RENDERER, DEFINITIONS, COMPONENTS, normalizeDecision } from '../src/router/taxonomy.mjs';
import { ROUTER_SYSTEM_PROMPT, ROUTE_JSON_SCHEMA, PROMPT_VERSION } from '../src/router/prompt.mjs';

const f = (t) => classifyHeuristic([{ role: 'user', content: t }]);

test('blocks: native hui format, defined, in prompt and strict schema', () => {
  assert.ok(ROUTE_FORMATS.includes('blocks'));
  assert.equal(RENDERER.blocks, 'hui');
  assert.ok(DEFINITIONS.blocks.includes('at a glance'));
  assert.ok(DEFINITIONS.diagram.includes('blocks'), 'diagram definition points at blocks');
  assert.equal(COMPONENTS.blocks, null);
  assert.equal(PROMPT_VERSION, 'r7');
  assert.ok(ROUTER_SYSTEM_PROMPT.includes('- blocks: '));
  assert.ok(ROUTER_SYSTEM_PROMPT.includes('→ blocks'));
  assert.ok(ROUTE_JSON_SCHEMA.schema.properties.format.enum.includes('blocks'));
  assert.equal(normalizeDecision({ format: 'blocks', confidence: 0.8, reason: 'r' }, { model: 'm', ms: 1 }).format, 'blocks');
});

test('blocks heuristic: clear de/en/es cues only', () => {
  for (const t of [
    'Wie unterscheiden sich OrbStack und Parallels im Aufbau?',
    'Zeig mir die Architektur von Hermes UI+ auf einen Blick',
    'Aus welchen Bausteinen besteht mein Setup?',
    'Mach ein Blockdiagramm von meinem Homelab',
    'Show me the setup at a glance',
    'How do OrbStack and Parallels differ in architecture?',
    '¿De qué componentes se compone un ordenador?',
  ]) assert.equal(f(t).format, 'blocks', t);
});

test('blocks heuristic does not steal from compare / diagram / stats / paths / text', () => {
  assert.equal(f('Vergleiche Lissabon und Porto').format, 'compare');
  assert.equal(f('Vergleiche den Aufbau von OrbStack und Parallels').format, 'compare');
  assert.equal(f('Was ist der Unterschied zwischen Docker und VM?').format, 'compare');
  assert.equal(f('Zeichne ein Architekturdiagramm für meinen Webshop').format, 'diagram');
  assert.equal(f('Wie funktioniert die Architektur von Kafka?').format, 'diagram');
  assert.equal(f('Zeig die wichtigsten Kennzahlen auf einen Blick').format, 'stats');
  assert.equal(f('Docker vs VM vs bare metal für Hermes?').format, 'paths');
  assert.notEqual(f('Lego Bausteine für Kinder').format, 'blocks');
  assert.notEqual(f('Erkläre den Aufbau einer Zelle').format, 'blocks');
});

test('follow-up after a blocks answer keeps the format', () => {
  const r = classifyHeuristic([
    { role: 'user', content: 'Wie unterscheiden sich OrbStack und Parallels im Aufbau?' },
    { role: 'assistant', content: 'So:\n```hui\n{"type":"blocks","columns":[{"title":"OrbStack","items":[{"label":"Agent 1"}]}]}\n```' },
    { role: 'user', content: 'und mit UTM?' },
  ]);
  assert.equal(r.format, 'blocks');
});
