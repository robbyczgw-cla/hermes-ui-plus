// node --test scripts/related-tests.test.mjs: scripts/lib/related-tests.mjs (the `check.sh quick` mapping) against a
// scratch git repo in a temp dir. Never touches the real repo.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { lex } from './lib/related-tests.mjs';

const SCRIPT = fileURLToPath(new URL('./lib/related-tests.mjs', import.meta.url));
const ENV = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', XDG_CACHE_HOME: '/tmp/hui-related-test-cache' };

const BASE = {
  'app/package.json': '{"name":"fixture"}\n',
  'app/tsconfig.json': '{}\n',
  'app/src/core.ts': 'export const core = 0;\n',
  'app/src/util/leaf.ts': 'export const leaf = 1;\n',
  'app/src/util/mid.ts': "import { leaf } from './leaf.ts';\n// import { gone } from './gone.ts';  (a comment, not an import)\nexport const mid = leaf + 1;\n",
  'app/src/comp/index.tsx': 'export const x = 1;\n',
  'app/src/fixtures/data.json': '{"a":1}\n',
  'app/src/data/strings.json': '{"hello":"Hallo"}\n',
  'app/src/a.test.ts': "import { mid } from './util/mid.ts';\nimport { core } from './core.ts';\n",
  'app/src/b.test.ts': "import { core } from './core.ts';\n",
  'app/src/c.test.ts': "import './core';\n",
  'app/src/d.test.ts': "import { x } from './comp';\n",
  'app/src/e.test.ts': "import data from './fixtures/data.json' with { type: 'json' };\n",
  'scripts/build.sh': '#!/usr/bin/env bash\n. "$(dirname "$0")/lib/env.sh"\n',
  'scripts/lib/env.sh': 'X=1\n',
  'scripts/build.test.mjs': "import { spawnSync } from 'node:child_process';\nspawnSync('bash', [join(ROOT, 'scripts', 'build.sh')]);\n",
  'scripts/one.test.mjs': "import { test } from 'node:test';\n",
  'scripts/two.test.mjs': "import { test } from 'node:test';\n",
  'scripts/e2e/three.test.mjs': "import { test } from 'node:test';\n",
  'scripts/check.sh': 'echo check\n',
  'bridge/src/server.mjs': 'export const s = 1;\n',
  'bridge/test/security-helpers.mjs': 'export const h = 1;\n',
  'bridge/test/security-x.test.mjs': "import { s } from '../src/server.mjs';\nimport { h } from './security-helpers.mjs';\n",
  'docs/GUIDE.md': '# Guide\n',
};

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'hui-related-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => {
    const r = spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8', env: ENV });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  };
  const write = (p, c) => {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), c);
  };
  const remove = (p) => rmSync(join(dir, p));
  git('init', '-q', '-b', 'main');
  for (const [p, c] of Object.entries(BASE)) write(p, c);
  git('add', '-A');
  git('commit', '-qm', 'base');
  git('checkout', '-qb', 'feat');
  const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: join(dir, 'app'), encoding: 'utf8', env: ENV });
  const plan = (...args) => {
    const r = run('--json', ...args);
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  };
  return { dir, git, write, remove, run, plan };
}
const tests = (p, area) => p.areas[area].tests;

test('no change: nothing to run', (t) => {
  const p = fixture(t).plan();
  assert.equal(p.mode, 'none');
  assert.deepEqual(p.tsc, { app: false, test: false });
  assert.deepEqual(p.changed, []);
  assert.equal(p.areas.app.total, 5);
  assert.equal(p.areas.scripts.total, 4);
  assert.equal(p.areas.bridge.total, 1);
  assert.ok(p.cache.startsWith('/tmp/hui-related-test-cache/hui-check/'), p.cache);
});

test('a changed test runs itself; only the test project is typechecked', (t) => {
  const f = fixture(t);
  f.write('app/src/b.test.ts', "import { core } from './core.ts';\n// more\n");
  const p = f.plan();
  assert.equal(p.mode, 'related');
  assert.deepEqual(tests(p, 'app'), ['app/src/b.test.ts']);
  assert.equal(p.areas.app.why['app/src/b.test.ts'], 'changed');
  assert.deepEqual(p.tsc, { app: false, test: true });
  assert.equal(p.areas.scripts.mode, 'none');
});

test('a changed test also runs the tests that import it (shared test modules)', (t) => {
  const f = fixture(t);
  f.write('app/src/h.test.ts', "import './b.test.ts';\n");
  f.write('app/src/i.test.ts', '\n');
  f.write('app/src/j.test.ts', '\n');
  f.git('add', '-A');
  f.git('commit', '-qm', 'more tests');
  f.write('app/src/b.test.ts', "import { core } from './core.ts';\n// changed\n");
  const p = f.plan('--base', 'HEAD');
  assert.deepEqual(tests(p, 'app'), ['app/src/b.test.ts', 'app/src/h.test.ts']);
  assert.equal(p.areas.app.why['app/src/h.test.ts'], 'imports app/src/b.test.ts');
});

test('transitive import: leaf -> mid -> a.test; extensionless and /index imports resolve', (t) => {
  const f = fixture(t);
  f.write('app/src/util/leaf.ts', 'export const leaf = 2;\n');
  let p = f.plan();
  assert.deepEqual(tests(p, 'app'), ['app/src/a.test.ts']);
  assert.match(p.areas.app.why['app/src/a.test.ts'], /imports app\/src\/util\/leaf\.ts/);
  assert.deepEqual(p.tsc, { app: true, test: true });
  f.git('checkout', '--', '.');
  f.write('app/src/comp/index.tsx', 'export const x = 2;\n');
  p = f.plan();
  assert.deepEqual(tests(p, 'app'), ['app/src/d.test.ts']);
});

test('committed branch changes count (merge-base), and --base picks another base', (t) => {
  const f = fixture(t);
  f.write('app/src/util/leaf.ts', 'export const leaf = 3;\n');
  f.git('commit', '-qam', 'leaf');
  assert.deepEqual(tests(f.plan(), 'app'), ['app/src/a.test.ts']);
  assert.equal(f.plan('--base', 'HEAD').mode, 'none');
  assert.equal(f.run('--base', 'no-such-ref').status, 2);
});

test('a file most tests depend on (> 30 %) runs the full area', (t) => {
  const f = fixture(t);
  f.write('app/src/core.ts', 'export const core = 1;\n');
  const p = f.plan();
  assert.equal(p.mode, 'area-full');
  assert.equal(p.areas.app.mode, 'full');
  assert.equal(tests(p, 'app').length, 5);
  assert.match(p.areas.app.reasons.join(), /3\/5 tests depend on it/);
  assert.equal(p.areas.scripts.mode, 'none');
});

test('config, unresolvable imports and the check runner fall back to full', (t) => {
  const f = fixture(t);
  f.write('app/tsconfig.json', '{"compilerOptions":{}}\n');
  let p = f.plan();
  assert.equal(p.areas.app.mode, 'full');
  assert.match(p.areas.app.reasons.join(), /dependencies \/ config/);
  assert.deepEqual(p.tsc, { app: true, test: true });
  assert.equal(p.areas.scripts.mode, 'none');

  f.git('checkout', '--', '.');
  f.write('app/src/util/mid.ts', "import { leaf } from './leaf.ts';\nimport { gone } from './gone.ts';\n");
  p = f.plan();
  assert.equal(p.areas.app.mode, 'full');
  assert.match(p.areas.app.reasons.join(), /unresolved import \.\/gone\.ts/);

  f.git('checkout', '--', '.');
  f.write('scripts/check.sh', 'echo changed\n');
  p = f.plan();
  assert.equal(p.mode, 'full');
  for (const a of ['app', 'scripts', 'bridge']) assert.equal(p.areas[a].mode, 'full', a);
  assert.deepEqual(p.tsc, { app: true, test: true });
});

test('test helpers and fixtures run the full area', (t) => {
  const f = fixture(t);
  f.write('app/src/fixtures/data.json', '{"a":2}\n');
  let p = f.plan();
  assert.equal(p.areas.app.mode, 'full');
  assert.match(p.areas.app.reasons.join(), /test helper \/ fixture/);
  f.git('checkout', '--', '.');
  f.write('bridge/test/security-helpers.mjs', 'export const h = 2;\n');
  p = f.plan();
  assert.equal(p.areas.bridge.mode, 'full');
  assert.equal(p.areas.app.mode, 'none');
});

test('a data file under app/src that no test imports or names (runtime-loaded) runs the full app suite', (t) => {
  const f = fixture(t);
  f.write('app/src/data/strings.json', '{"hello":"Hi"}\n');
  const p = f.plan();
  assert.equal(p.areas.app.mode, 'full');
  assert.match(p.areas.app.reasons.join(), /data file/);
});

test('docs only: no tests, no tsc', (t) => {
  const f = fixture(t);
  f.write('docs/GUIDE.md', '# Guide\n\nMore.\n');
  f.write('docs/NEW.md', '# New\n');
  const p = f.plan();
  assert.equal(p.mode, 'none');
  assert.deepEqual(p.tsc, { app: false, test: false });
  for (const a of ['app', 'scripts', 'bridge']) assert.deepEqual(tests(p, a), [], a);
  assert.deepEqual(p.changed.map((c) => c.path), ['docs/GUIDE.md', 'docs/NEW.md']);
});

test('untracked files count: a new test and a new module it imports', (t) => {
  const f = fixture(t);
  f.write('app/src/util/fresh.ts', 'export const fresh = 1;\n');
  f.write('app/src/f.test.ts', "import { fresh } from './util/fresh.ts';\n");
  const p = f.plan();
  assert.deepEqual(p.changed, [
    { path: 'app/src/f.test.ts', status: '?' },
    { path: 'app/src/util/fresh.ts', status: '?' },
  ]);
  assert.deepEqual(tests(p, 'app'), ['app/src/f.test.ts']);
  assert.equal(p.areas.app.total, 6);
});

test('deleted files count: importers left behind make their tests run; a deleted test is only noted', (t) => {
  const f = fixture(t);
  f.remove('app/src/util/leaf.ts');
  f.remove('app/src/b.test.ts');
  const p = f.plan();
  assert.deepEqual(p.changed, [
    { path: 'app/src/b.test.ts', status: 'D' },
    { path: 'app/src/util/leaf.ts', status: 'D' },
  ]);
  assert.deepEqual(tests(p, 'app'), ['app/src/a.test.ts']);
  assert.match(p.areas.app.why['app/src/a.test.ts'], /unsure: .*unresolved \.\/leaf\.ts/);
  assert.match(p.notes.join(), /app\/src\/b\.test\.ts: deleted test/);
  assert.deepEqual(p.tsc, { app: true, test: true });
});

test('renames count as delete + add', (t) => {
  const f = fixture(t);
  f.git('mv', 'app/src/util/leaf.ts', 'app/src/util/leaf2.ts');
  f.write('app/src/util/mid.ts', "import { leaf } from './leaf2.ts';\nexport const mid = leaf + 1;\n");
  const p = f.plan();
  assert.deepEqual(p.changed.map((c) => `${c.status} ${c.path}`), ['D app/src/util/leaf.ts', 'A app/src/util/leaf2.ts', 'M app/src/util/mid.ts']);
  assert.deepEqual(tests(p, 'app'), ['app/src/a.test.ts']);
});

test('scripts tests map by path mention, also through a script they spawn (shell source)', (t) => {
  const f = fixture(t);
  f.write('scripts/build.sh', '#!/usr/bin/env bash\n. "$(dirname "$0")/lib/env.sh"\necho more\n');
  let p = f.plan();
  assert.deepEqual(tests(p, 'scripts'), ['scripts/build.test.mjs']);
  assert.match(p.areas.scripts.why['scripts/build.test.mjs'], /(reaches|mentions) scripts\/build\.sh/);
  assert.deepEqual(p.tsc, { app: false, test: false });
  f.git('checkout', '--', '.');
  f.write('scripts/lib/env.sh', 'X=2\n');
  p = f.plan();
  assert.deepEqual(tests(p, 'scripts'), ['scripts/build.test.mjs']);
  assert.equal(p.areas.app.mode, 'none');
});

test('fs reads: a template path prefix maps files below it; directory scanners map changes in dirs they name', (t) => {
  const f = fixture(t);
  f.write('mock-server/data/one.sse', 'data: 1\n');
  f.write('website/index.html', '<html></html>\n');
  f.write('app/src/g.test.ts', "const load = (n: string) => readFileSync(new URL(`../../mock-server/data/${n}`, import.meta.url));\n");
  f.write('scripts/site.test.mjs', "const names = readdirSync(join(ROOT, 'website'));\n");
  f.git('add', '-A');
  f.git('commit', '-qm', 'readers');
  f.write('mock-server/data/one.sse', 'data: 2\n');
  let p = f.plan('--base', 'HEAD'); // the readers are committed on the branch: diff against HEAD
  assert.deepEqual(tests(p, 'app'), ['app/src/g.test.ts']);
  assert.deepEqual(tests(p, 'scripts'), []);
  f.git('checkout', '--', '.');
  f.write('website/index.html', '<html><body></body></html>\n');
  p = f.plan('--base', 'HEAD');
  assert.deepEqual(tests(p, 'scripts'), ['scripts/site.test.mjs']);
  assert.match(p.areas.scripts.why['scripts/site.test.mjs'], /reads directories/);
  assert.deepEqual(tests(p, 'app'), []);
});

test('bridge security tests follow the bridge/src import graph', (t) => {
  const f = fixture(t);
  f.write('bridge/src/server.mjs', 'export const s = 2;\n');
  const p = f.plan();
  // the only bridge-security test depends on it: 1/1 > 30 % = the (tiny) full bridge suite
  assert.equal(p.areas.bridge.mode, 'full');
  assert.deepEqual(tests(p, 'bridge'), ['bridge/test/security-x.test.mjs']);
  assert.equal(p.areas.app.mode, 'none');
});

test('--sh prints eval-able assignments and the plan on stderr', (t) => {
  const f = fixture(t);
  f.write('app/src/util/leaf.ts', 'export const leaf = 4;\n');
  const r = f.run('--sh');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /quick plan: 1 changed file/);
  assert.match(r.stderr, /app: related, 1\/5 tests/);
  const sh = spawnSync('bash', ['-c', `${r.stdout}\necho "$Q_MODE $Q_TSC_APP $Q_APP_MODE \${#Q_APP_TESTS[@]} \${Q_APP_TESTS[0]} $Q_SCRIPTS_MODE"`], { encoding: 'utf8' });
  assert.equal(sh.stdout.trim(), 'related 1 related 1 app/src/a.test.ts none');
});

test('lex: comments and string contents are masked, literals kept by offset', () => {
  const src = "// import a from './x'\nconst s = 'from \"./y\"'; /* require('./z') */ const r = /['\"]/g;\nimport b from './b.ts';\nconst u = `./dir/${n}.json`;\n";
  const { code, strings } = lex(src);
  assert.equal(code.length, src.length);
  assert.doesNotMatch(code, /\.\/x|\.\/y|\.\/z/);
  const lits = [...strings.values()];
  assert.ok(lits.some((l) => l.text === './b.ts'));
  assert.ok(lits.some((l) => l.tpl && l.interp && l.head === './dir/'));
});
