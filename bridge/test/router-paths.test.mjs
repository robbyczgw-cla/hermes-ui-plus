import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyHeuristic } from '../src/router/backends/heuristic.mjs';
import { ROUTE_FORMATS, RENDERER, DEFINITIONS, COMPONENTS, normalizeDecision } from '../src/router/taxonomy.mjs';
import { ROUTER_SYSTEM_PROMPT, ROUTE_JSON_SCHEMA } from '../src/router/prompt.mjs';

const f = (t) => classifyHeuristic([{ role: 'user', content: t }]);

test('paths: native hui format, defined, in prompt and strict schema', () => {
  assert.ok(ROUTE_FORMATS.includes('paths'));
  assert.equal(RENDERER.paths, 'hui');
  assert.ok(DEFINITIONS.paths.includes('verdict'));
  assert.equal(COMPONENTS.paths, null);
  assert.ok(ROUTER_SYSTEM_PROMPT.includes('- paths: '));
  assert.ok(ROUTER_SYSTEM_PROMPT.includes('"[paths:id] …"'));
  assert.ok(ROUTE_JSON_SCHEMA.schema.properties.format.enum.includes('paths'));
  assert.equal(normalizeDecision({ format: 'paths', confidence: 0.8, reason: 'r' }, { model: 'm', ms: 1 }).format, 'paths');
  assert.ok(ROUTER_SYSTEM_PROMPT.length < 24000, 'prompt stays compact');
});

test('paths heuristic: clear de/en/es cues only', () => {
  for (const t of [
    'Wo sollen die Dateien meiner VM liegen: im Mac, in der VM-Disk oder im geteilten Ordner?',
    'Where should my project files live, on the Mac or inside the VM?',
    '¿Dónde deberían estar los archivos, en el Mac o en la VM?',
    'Welche Backup-Wege gibt es für meinen Mac?',
    'Docker vs VM vs bare metal für Hermes?',
  ]) assert.equal(f(t).format, 'paths', t);
});

test('paths heuristic does not steal from compare / steps / text', () => {
  assert.equal(f('Vergleiche Lissabon und Porto').format, 'compare');
  assert.equal(f('Was ist der Unterschied zwischen Wetter und Klima?').format, 'compare');
  assert.equal(f('Vergleiche Docker und Podman').format, 'compare');
  assert.notEqual(f('Docker oder VM für Home Assistant?').format, 'paths', 'two-way choice is not paths');
  assert.notEqual(f('Wo liegen meine Dateien?').format, 'paths', 'no alternatives named');
  assert.equal(f('Wie installiere ich Docker auf Ubuntu 24.04?').format, 'steps');
  const r = f('[paths:backup-route] Time Machine to the NAS');
  assert.equal(r.format, 'text');
  assert.ok(r.confidence < 0.5);
});
