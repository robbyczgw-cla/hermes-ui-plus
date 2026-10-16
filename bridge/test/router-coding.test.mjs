import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyHeuristic } from '../src/router/backends/heuristic.mjs';
import { ROUTE_FORMATS, RENDERER, DEFINITIONS, COMPONENTS, normalizeDecision } from '../src/router/taxonomy.mjs';
import { ROUTER_SYSTEM_PROMPT, ROUTE_JSON_SCHEMA, PROMPT_VERSION } from '../src/router/prompt.mjs';
import { buildHint } from '../src/router/hint.mjs';

const f = (t) => classifyHeuristic([{ role: 'user', content: t }]);
const CODING = ['diff', 'terminal', 'changes'];

test('coding formats: native hui, defined, in prompt and strict schema', () => {
  assert.equal(PROMPT_VERSION, 'r7');
  for (const fmt of CODING) {
    assert.ok(ROUTE_FORMATS.includes(fmt), fmt);
    assert.equal(RENDERER[fmt], 'hui', fmt);
    assert.ok(DEFINITIONS[fmt].length > 80, fmt);
    assert.equal(COMPONENTS[fmt], null, fmt);
    assert.ok(ROUTER_SYSTEM_PROMPT.includes(`- ${fmt}: `), fmt);
    assert.ok(ROUTE_JSON_SCHEMA.schema.properties.format.enum.includes(fmt), fmt);
    assert.equal(normalizeDecision({ format: fmt, confidence: 0.8, reason: 'r' }, { model: 'm', ms: 1 }).format, fmt);
  }
  assert.match(DEFINITIONS.diff, /patch/);
  assert.match(DEFINITIONS.terminal, /RUN/);
  assert.match(DEFINITIONS.changes, /SEVERAL files/);
  assert.match(DEFINITIONS.text, /without running commands or showing changes/);
  assert.match(ROUTER_SYSTEM_PROMPT, /\n13\. Coding views/);
  assert.match(ROUTER_SYSTEM_PROMPT, /\n14\. Prefer text/);
  assert.ok(ROUTER_SYSTEM_PROMPT.length < 24000, 'prompt stays compact');
});

test('coding hint: plain format line, no data=live (content comes from tool runs, not from search)', () => {
  for (const fmt of CODING) assert.equal(buildHint({ format: fmt, confidence: 0.85 }), `UI-ROUTER-HINT: format=${fmt} confidence=0.9`);
});

test('diff heuristic: de/en/es cues', () => {
  for (const t of [
    'Zeig mir den Diff für die Änderung an user.ts',
    'Show me the diff',
    'Give me a patch for user.ts',
    'git diff',
    'Show me what would change in this file',
    'Was würde sich in dieser Datei ändern?',
    'Zeig mir vorher/nachher von der Config',
    'Muestra el diff de los cambios',
    '¿Qué cambiaría en este archivo?',
  ]) assert.equal(f(t).format, 'diff', t);
});

test('terminal heuristic: de/en/es cues', () => {
  for (const t of [
    'Run the tests',
    'Run npm test and tell me what fails',
    'Führ die Tests aus',
    'Lass die Tests laufen',
    'Zeig mir die Ausgabe von npm test',
    'Show me the output of git log',
    'ejecuta git status',
    'Ejecuta las pruebas',
    'Show me the build log',
  ]) assert.equal(f(t).format, 'terminal', t);
});

test('changes heuristic: de/en/es cues', () => {
  for (const t of [
    'Welche Dateien hast du geändert?',
    'Which files did you touch in that refactor?',
    'What did you change?',
    'git status',
    '¿Qué archivos cambiaste?',
    'Show me the changed files',
    'Zeig mir die Zusammenfassung deiner Änderungen',
  ]) assert.equal(f(t).format, 'changes', t);
  assert.ok(f('What did you change?').confidence < f('Welche Dateien hast du geändert?').confidence, 'generic phrasing is weaker');
});

test('coding heuristic keeps code help, explanations and unrelated asks as text/other', () => {
  for (const t of [
    'Schreib eine Python-Funktion, die Dateien sortiert',
    'Was macht git rebase?',
    'Wie funktioniert git diff?',
    'How do I run the tests in this repo?',
    'Wie führe ich die Tests aus?',
    'Schreib ein Skript, das die Tests ausführt',
    'Write a script that runs the tests',
    'Bau mir einen Diff-Algorithmus in Python',
    'Fix this Dockerfile: COPY failed: file not found in build context',
    'Was hast du am Wochenende geändert?',
    'Erkläre mir den Unterschied zwischen git merge und rebase',
  ]) assert.equal(f(t).format, 'text', t);
  assert.notEqual(f('Run a marathon training plan').format, 'terminal');
  assert.notEqual(f('Start docker compose tutorial').format, 'terminal');
  // named products compared are products (component compare) since r7, never a coding format
  assert.equal(f('Vergleiche iPhone 17 und Pixel 11').format, 'products');
  assert.equal(f('Kubernetes vs Nomad').format, 'compare');
});

test('follow-up after a diff answer keeps the format', () => {
  const r = classifyHeuristic([
    { role: 'user', content: 'Zeig mir die Änderung an user.ts' },
    { role: 'assistant', content: 'So:\n```hui\n{"type":"diff","files":[{"path":"user.ts","status":"modified","patch":"@@ -1 +1 @@\\n-a\\n+b"}]}\n```' },
    { role: 'user', content: 'und für index.ts?' },
  ]);
  assert.equal(r.format, 'diff');
});
