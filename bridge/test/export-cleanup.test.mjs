import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const exportScript = new URL('../../scripts/export-public.sh', import.meta.url);
for (const mode of ['--worktree', '--ref']) for (const failure of ['', 'all', 'test']) {
  test(`public export ${mode} removes dependency symlinks on ${failure ? `failed ${failure} checks` : 'success'}`, { skip: !fs.existsSync(exportScript) }, (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-export-test-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const source = path.join(root, 'source');
    const output = path.join(root, 'export');
    const put = (file, text, mode) => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text, { mode });
    };
    put(path.join(source, 'scripts/export-public.sh'), fs.readFileSync(exportScript), 0o755);
    put(path.join(source, 'scripts/public-export.mjs'), '// Test fixture: no transforms required.\n');
    put(path.join(source, 'scripts/public-export.manifest'), '');
    put(path.join(source, 'scripts/leak-guard.mjs'), '// Test fixture: no private content.\n');
    put(path.join(source, '.gitignore'), 'node_modules\n');
    put(path.join(source, 'scripts/check.sh'), `#!/usr/bin/env bash
set -eu
root="$(cd "$(dirname "$0")/.." && pwd)"
for d in app bridge desktop; do test -L "$root/$d/node_modules"; done
[ "$1" != "\${TEST_FAIL_AT:-}" ]
`, 0o755);
    for (const dir of ['app', 'bridge', 'desktop']) {
      put(path.join(source, dir, 'package.json'), '{}');
      put(path.join(source, dir, 'node_modules', 'test-sentinel'), 'fixture');
    }
    // Avoid depending on a locally installed optional scanner; leak scans are exercised by their own tests.
    const bin = path.join(root, 'bin');
    put(path.join(bin, 'gitleaks'), '#!/usr/bin/env bash\nexit 0\n', 0o755);
    assert.equal(spawnSync('git', ['init', '-q', source]).status, 0);
    assert.equal(spawnSync('git', ['-C', source, 'add', '-A']).status, 0);
    assert.equal(spawnSync('git', ['-C', source, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-qm', 'test fixture']).status, 0);
    const result = spawnSync('bash', [path.join(source, 'scripts/export-public.sh'), ...(mode === '--ref' ? ['--ref', 'HEAD'] : [mode]), '--out', output], {
      encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, HUI_PRIVATE_DIR: path.join(root, 'private'), TEST_FAIL_AT: failure },
    });
    assert.equal(result.status, failure ? 1 : 0, result.stdout + result.stderr);
    for (const dir of ['app', 'bridge', 'desktop']) {
      assert.equal(fs.existsSync(path.join(output, dir, 'node_modules')), false, 'export must not retain links to checkout dependencies');
      assert.equal(fs.existsSync(path.join(source, dir, 'node_modules', 'test-sentinel')), true, 'source dependencies untouched');
    }
  });
}
