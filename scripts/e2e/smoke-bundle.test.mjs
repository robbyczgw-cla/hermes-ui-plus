// `smoke.sh --host` copies a small bundle: everything the mock imports from the bridge must be in it, or the mock doesn't start.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('smoke.sh copies the bridge sources the mock imports, with what they import', () => {
  assert.match(read('./mock.mjs'), /from '\.\.\/\.\.\/bridge\/src\/groups\.mjs'/);
  assert.match(read('./smoke.sh'), /rsync -a "\$ROOT\/bridge\/src\/" "\$HOST:\$RDIR\/bridge\/src\/"/);
  // no npm packages behind them: the bundle has no node_modules
  for (const f of ['groups', 'replay', 'log', 'atomic-write', 'sse', 'paths', 'profiles', 'cors']) {
    const src = read(`../../bridge/src/${f}.mjs`);
    for (const m of src.matchAll(/^import .* from '([^']+)'/gm)) assert.match(m[1], /^(\.|node:)/, `${f}: ${m[1]}`);
  }
});
