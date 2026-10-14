/// <reference types="node" />
// Startup import graph of the app (review part 5, finding 17). Walks STATIC imports and re-exports (`import x from`,
// `export … from`, side-effect imports) from every route file, i.e. what Metro puts on the startup path, and fails when
// a non-Hermes backend module or the Anthropic SDK is reachable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';

const SRC = new URL('.', import.meta.url).pathname;
// static imports/re-exports; `import type` / `export type` are erased and do not count; dynamic import() is lazy
const STATIC = /(?:^|\n)\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g;

function resolveSpec(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(from), spec);
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) if (/\.tsx?$/.test(c) && existsSync(c)) return c;
  return null;
}

/** every file statically reachable from `roots` (path → first importer) */
export function staticClosure(roots: string[]): Map<string, string | null> {
  const seen = new Map<string, string | null>();
  const walk = (f: string, parent: string | null) => {
    if (seen.has(f)) return;
    seen.set(f, parent);
    for (const m of readFileSync(f, 'utf8').matchAll(STATIC)) {
      const r = resolveSpec(f, m[1]);
      if (r) walk(r, f);
    }
  };
  for (const r of roots) walk(r, null);
  return seen;
}

const routeFiles = readdirSync(join(SRC, 'app')).filter((f) => /\.tsx?$/.test(f)).map((f) => join(SRC, 'app', f));
const closure = staticClosure(routeFiles);
const rel = (f: string) => relative(SRC, f);

const PURE_DATA = new Set<string>();

function isBackendModule(r: string): boolean {
  return /^chat\/\w+Session\.tsx$/.test(r) && !/^chat\/(Hermes|Demo)Session/.test(r); // no other backends in this build
}

test('the static startup graph reaches no backend client, auth, OAuth, token or session module outside the lazy chunk', () => {
  const offenders: string[] = [];
  for (const [f, parent] of closure) {
    const r = rel(f);
    if (isBackendModule(r) && !PURE_DATA.has(r)) offenders.push(`${r} <- ${parent ? rel(parent) : '-'}`);
    else if ([...readFileSync(f, 'utf8').matchAll(STATIC)].some((m) => m[1].startsWith('@anthropic-ai/'))) offenders.push(`${r} imports the Anthropic SDK`);
  }
  assert.deepEqual(offenders, []);
});

test('the walk really covers the startup surface (settings editor, voice, onboarding, chat)', () => {
  const have = new Set([...closure.keys()].map(rel));
  for (const f of ['settings/ProfileEditor.tsx', 'settings/SettingsScreen.tsx', 'voice/speaker.ts', 'voice/useDictation.ts', 'onboarding/OnboardingHost.tsx', 'chat/ChatView.tsx', 'compliance/ConsentHost.tsx']) {
    assert.ok(have.has(f), `${f} should be reachable`);
  }
  assert.ok(closure.size > 200);
});

test('the walker sees static imports, re-exports and side-effect imports but not import() or type-only imports', () => {
  const dir = mkdtempSync(join(tmpdir(), 'graph-'));
  const w = (n: string, code: string) => writeFileSync(join(dir, n), code);
  mkdirSync(join(dir, 'sub'));
  w('root.ts', `import a from './a';\nexport { b } from './b';\nimport './c';\nconst l = () => import('./lazy');\nimport type { T } from './typeonly';\nexport type { U } from './typeonly2';\nimport {\n  d,\n} from './sub';\n`);
  for (const n of ['a', 'b', 'c', 'lazy', 'typeonly', 'typeonly2']) w(`${n}.ts`, 'export const x = 1;');
  w('sub/index.ts', 'export const d = 1;');
  const got = [...staticClosure([join(dir, 'root.ts')]).keys()].map((f) => relative(dir, f)).sort();
  assert.deepEqual(got, ['a.ts', 'b.ts', 'c.ts', 'root.ts', 'sub/index.ts']);
});
