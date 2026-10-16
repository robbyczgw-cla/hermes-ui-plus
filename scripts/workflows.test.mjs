// Policy tests for .github/: pinned actions, least privilege, no publishing, secrets only where documented.
// A cheap guard so a later edit cannot quietly weaken the CI of the public repository. Also tests the release
// version gate (scripts/release-version-check.mjs) and the runner mode of scripts/build-web.sh.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, readVersions } from './release-version-check.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GH = join(ROOT, '.github');
const WORKFLOWS = readdirSync(join(GH, 'workflows')).filter((f) => /\.ya?ml$/.test(f));
const ACTIONS = existsSync(join(GH, 'actions'))
  ? readdirSync(join(GH, 'actions')).map((d) => `actions/${d}/action.yml`)
  : [];
const read = (rel) => readFileSync(join(GH, rel), 'utf8');
/** Lines with the trailing comment and pure comment lines removed. */
const code = (text) => text.split('\n').map((l) => l.replace(/(^|\s)#.*$/, '')).filter((l) => l.trim());

test('workflows: ci.yml and release.yml exist', () => {
  assert.ok(WORKFLOWS.includes('ci.yml'));
  assert.ok(WORKFLOWS.includes('release.yml'));
});

test('workflows: every action is pinned to a full commit SHA with a version comment (local actions excepted)', () => {
  for (const f of [...WORKFLOWS.map((w) => `workflows/${w}`), ...ACTIONS]) {
    for (const line of read(f).split('\n')) {
      const m = /^\s*(?:-\s+)?uses:\s*(\S+)(.*)$/.exec(line);
      if (!m || m[1].startsWith('./')) continue;
      assert.match(m[1], /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/, `${f}: not pinned by SHA: ${line.trim()}`);
      assert.match(m[2], /#\s*v\d/, `${f}: missing "# vX.Y.Z" comment: ${line.trim()}`);
    }
  }
});

test('workflows: top-level permissions are declared and read-only; no write grants anywhere', () => {
  for (const w of WORKFLOWS) {
    const text = read(`workflows/${w}`);
    assert.match(text, /^permissions:\n {2}contents: read\n/m, `${w}: needs top-level "permissions: contents: read"`);
    assert.doesNotMatch(code(text).join('\n'), /:\s*write\b/, `${w}: grants a write permission`);
  }
});

test('workflows: no pull_request_target / workflow_run triggers, every workflow has a concurrency group and timeouts', () => {
  for (const w of WORKFLOWS) {
    const text = read(`workflows/${w}`);
    assert.doesNotMatch(code(text).join('\n'), /pull_request_target|workflow_run/, `${w}: privileged trigger`);
    assert.match(text, /^concurrency:\n {2}group:/m, `${w}: no concurrency group`);
    const jobs = (text.split(/^jobs:\n/m)[1] ?? '').split(/^ {2}(?=[\w-]+:\n)/m).filter(Boolean);
    assert.ok(jobs.length > 0, `${w}: no jobs`);
    for (const j of jobs) assert.match(j, /^ {4}timeout-minutes: \d+$/m, `${w}: job without timeout-minutes: ${j.split('\n')[0]}`);
  }
});

test('workflows: expressions are never interpolated into shell scripts (pass them through env:)', () => {
  for (const w of WORKFLOWS) {
    const lines = read(`workflows/${w}`).split('\n');
    for (let i = 0; i < lines.length; i++) {
      const m = /^(\s*)(?:-\s+)?run:\s*(.*)$/.exec(lines[i]);
      if (!m) continue;
      const body = [m[2]];
      if (/^[|>][-+]?$/.test(m[2])) {
        body.length = 0;
        for (let j = i + 1; j < lines.length && (lines[j].trim() === '' || lines[j].search(/\S/) > m[1].length); j++) body.push(lines[j]);
      }
      assert.doesNotMatch(body.join('\n'), /\$\{\{/, `${w}:${i + 1}: \${{ }} inside run: (script injection); use env:`);
    }
  }
});

test('ci.yml: needs no secrets (fork pull requests run it unchanged)', () => {
  const text = code(read('workflows/ci.yml')).join('\n');
  assert.doesNotMatch(text, /secrets\./);
  assert.doesNotMatch(text, /vars\./);
  assert.match(text, /pull_request:/);
});

test('composite actions: no secrets', () => {
  for (const a of ACTIONS) assert.doesNotMatch(code(read(a)).join('\n'), /secrets\./, a);
});

test('release.yml: never publishes; secrets only in the gated environment jobs', () => {
  const text = read('workflows/release.yml');
  const src = code(text).join('\n');
  assert.doesNotMatch(src, /npm publish|gh release|gh api|git push|git tag|--tag latest|altool|fastlane|vercel|upload-release|create-release/i);
  const jobs = text.split(/^jobs:\n/m)[1].split(/^ {2}(?=[\w-]+:\n)/m).filter(Boolean);
  const byName = Object.fromEntries(jobs.map((j) => [j.split(':')[0], j]));
  for (const [name, body] of Object.entries(byName)) {
    const secretLines = code(body).filter((l) => /secrets\./.test(l));
    if (name === 'android-signed' || name === 'ios-signed') {
      assert.match(body, /^ {4}environment: release-signing$/m, `${name}: needs the protected environment`);
      assert.match(body, /HUI_RELEASE_SIGNING/, `${name}: needs the repository-variable gate`);
      assert.match(body, /^ {4}if: .*workflow_dispatch.*inputs\./m, `${name}: must be opt-in by input`);
    } else {
      assert.equal(secretLines.length, 0, `${name}: uses secrets`);
    }
  }
  assert.deepEqual(Object.keys(byName).sort(), ['android-signed', 'bridge', 'ios-signed', 'verify', 'web']);
  // both optional inputs default to off
  assert.match(text, /android_signed:[\s\S]*?default: false/);
  assert.match(text, /ios_signed:[\s\S]*?default: false/);
});

test('release.yml: the web job uses the runner mode that scripts/build-web.sh implements', () => {
  assert.match(read('workflows/release.yml'), /HUI_BUILD_PLAIN: "1"/);
  const build = readFileSync(join(ROOT, 'scripts/build-web.sh'), 'utf8');
  assert.match(build, /PLAIN="\$\{HUI_BUILD_PLAIN:-0\}"/);
  // the default path keeps its safety net: lock, memory check and the capped systemd scope
  const defaultPath = build.split('if [ "$PLAIN" != 1 ]; then')[1];
  assert.match(defaultPath, /flock -n 9/);
  assert.match(defaultPath, /MemAvailable/);
  assert.match(build, /else\n\s+heavy_slice_init[\s\S]*systemd-run --user --scope --quiet --unit=/);
});

test('release-version-check: this repository is consistent', () => {
  const r = check({
    refType: 'branch', refName: 'main', versions: readVersions(), changelog: readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8'),
  });
  assert.deepEqual(r.problems, []);
});

test('release-version-check: disagreeing versions, wrong tag, undated changelog', () => {
  const versions = {
    'app/package.json': '1.2.3', 'app/app.json': '1.2.3', 'bridge/package.json': '1.2.3',
    'desktop/package.json': '1.2.3', 'desktop/src-tauri/tauri.conf.json': '1.2.3', 'desktop/src-tauri/Cargo.toml': '1.2.3',
  };
  const dated = '# Changelog\n\n## 1.2.3 - 2026-01-02\n- x\n';
  assert.deepEqual(check({ refType: 'tag', refName: 'v1.2.3', versions, changelog: dated }).problems, []);
  assert.deepEqual(check({ refType: 'branch', refName: 'main', versions, changelog: '## 1.2.3 - unreleased\n' }).problems, []);
  assert.match(check({ refType: 'tag', refName: 'v1.2.3', versions, changelog: '## 1.2.3 - unreleased\n' }).problems.join(), /date it before tagging/);
  assert.match(check({ refType: 'tag', refName: 'v1.2.4', versions, changelog: dated }).problems.join(), /is not v1\.2\.3/);
  assert.match(check({ refType: 'tag', refName: 'v1.2.3', versions: { ...versions, 'app/app.json': '1.2.2' }, changelog: dated }).problems.join(), /app\/app\.json has version 1\.2\.2/);
  assert.match(check({ refType: 'branch', refName: 'main', versions, changelog: '## 1.2.30 - 2026-01-02\n' }).problems.join(), /no "## 1\.2\.3 - <date>" section/);
  assert.match(check({ refType: 'branch', refName: 'main', versions: { ...versions, 'bridge/package.json': '1.2.3 --x' }, changelog: dated }).problems.join(), /bad version/);
});
