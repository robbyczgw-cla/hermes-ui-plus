// app/patches/*.patch (patch-package, app postinstall): each patch belongs to exactly one pinned dependency version.
// A version bump fails here until its patch is re-made for the new version or deleted (e.g. fixed upstream).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..', 'app');
const pkg = JSON.parse(readFileSync(join(APP, 'package.json'), 'utf8'));
const lock = JSON.parse(readFileSync(join(APP, 'package-lock.json'), 'utf8'));
const patches = existsSync(join(APP, 'patches')) ? readdirSync(join(APP, 'patches')).filter((f) => f.endsWith('.patch')) : [];

/** `react-native-reanimated+4.5.1.patch` → name + version (scoped packages: `@scope+name+1.2.3.patch`) */
function parsePatchName(file) {
  const parts = file.slice(0, -'.patch'.length).split('+');
  const version = parts.pop();
  return { name: parts.join('/'), version };
}

test('patches are applied on every install', () => {
  if (!patches.length) return;
  assert.equal(pkg.scripts?.postinstall, 'patch-package');
  assert.ok(pkg.devDependencies?.['patch-package'], 'patch-package must be a devDependency');
});

for (const file of patches) {
  const { name, version } = parsePatchName(file);
  test(`${file} matches the pinned ${name}`, () => {
    const spec = pkg.dependencies?.[name] ?? pkg.devDependencies?.[name];
    assert.equal(spec, version, `${name} must be pinned to exactly ${version} (package.json has ${spec}); re-make or delete ${file}`);
    assert.equal(lock.packages?.[`node_modules/${name}`]?.version, version, `package-lock.json resolves ${name} to another version than ${file}`);
  });

  test(`${file} fits the installed sources`, (t) => {
    const installed = join(APP, 'node_modules', name, 'package.json');
    if (!existsSync(installed) || JSON.parse(readFileSync(installed, 'utf8')).version !== version) return t.skip('not installed');
    // per file: the installed source holds either the patch's old lines (pristine) or its new lines (patched)
    const diff = readFileSync(join(APP, 'patches', file), 'utf8');
    for (const chunk of diff.split(/^diff --git /m).slice(1)) {
      const path = /^\+\+\+ b\/(\S+)/m.exec(chunk)?.[1];
      assert.ok(path, `no target path in ${file}`);
      const src = readFileSync(join(APP, path), 'utf8');
      const lines = (sign) => chunk.split('\n').filter((l) => l.startsWith(sign) && !l.startsWith(sign.repeat(3))).map((l) => l.slice(1));
      const has = (ls) => ls.every((l) => src.includes(l));
      assert.ok(has(lines('-')) || has(lines('+')), `${path}: neither the original nor the patched lines found, re-make ${file}`);
    }
  });
}
