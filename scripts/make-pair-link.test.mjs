// Guards the vendored copy in make-pair-link.mjs against drift from the app's pairLink.ts.
// (The reference strips an empty `u=` only; the old script stripped `u=` even when a URL was given, which made
// every explicit --url without --app fail with missing-url. Vendored version validates correctly.)
//   node --test scripts/make-pair-link.test.mjs      (needs the app repo; the script itself does not)
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildPairLink, buildWebPairLink, parsePairLink } from '../app/src/onboarding/pairLink.ts';

const script = fileURLToPath(new URL('./make-pair-link.mjs', import.meta.url));
const run = (flavor, ...args) =>
  spawnSync(process.execPath, ['--no-warnings', script, ...args], { encoding: 'utf8', env: { ...process.env, FLAVOR: flavor, HUI_PRIVATE_DIR: '/nonexistent' } });
const SCHEME = { hermes: JSON.parse(readFileSync(new URL('../app/brand/identity.json', import.meta.url), 'utf8')).scheme, personal: 'hermesui' };
// the app module builds links with this bundle's scheme; map them to the flavor under test
const withScheme = (link, flavor) => link.replace(/^hermes(?:uiplus|i?ui):/, `${SCHEME[flavor]}:`);

/** Output the script had when it imported the app code directly. */
function reference(a, flavor) {
  const input = { url: a.url ?? '', token: a.token, name: a.name, model: a.model };
  const origin = a.app ? new URL(a.app).origin : null;
  const check = parsePairLink(buildPairLink({ ...input, url: input.url || '' }).replace(/^(hermes(?:uiplus|i?ui)):\/\/pair\?u=(?=&|$)&?/, '$1://pair?'), { origin, flavor });
  if (!check.ok) return { status: 1, err: `invalid pair link: ${check.error}\n` };
  const strip = (link) => (input.url ? link : link.replace(/([?#]pair\?)u=&?/, '$1'));
  let out = '';
  if (input.url && /^https?:/i.test(input.url)) out += `App (QR / iOS-Android app):\n  ${withScheme(buildPairLink(input), flavor)}\n\n`;
  if (a.app) out += `Web app (open in Safari on the iPhone):\n  ${strip(buildWebPairLink(a.app, input))}\n\n`;
  out += `Resolved API base: ${check.pair.baseUrl}  kind=${check.pair.kind}${check.pair.model ? ` model=${check.pair.model}` : ''}\n`;
  return { status: 0, out };
}

const cli = (a) =>
  Object.entries(a).flatMap(([k, v]) => (v === true ? [`--${k}`] : [`--${k}`, String(v)]));

const cases = [
  { app: 'https://agents.example.ts.net:10443/', url: '/v1', token: 'tok_test+/=123', model: 'kiwi' },
  { url: 'https://agents.example.ts.net:10443/v1', token: 'tok', model: 'agent-1', name: 'Ada Ü' },
  { url: 'http://192.168.1.5:8645', token: 'x' },
  { url: 'agents.example.org/hermes/v1/models', kind: 'hermes' },
  { app: 'https://host.example/app/', model: 'm1' },
  // invalid
  { url: 'ftp://x.example', token: 't' },
  { url: 'https://user:pw@x.example.com' },
  { url: 'https://x.example', token: 'has space' },
  { url: 'https://x.example:99999' },
  { url: 'https://x.example', model: 'bad model' },
  { kind: 'hermes' },
];

for (const flavor of ['hermes', 'personal']) for (const c of cases) {
  test(`make-pair-link (${flavor}) output identical to app pairLink.ts: ${JSON.stringify(c).slice(0, 80)}`, () => {
    const exp = reference(c, flavor);
    const got = run(flavor, ...cli(c));
    assert.equal(got.status, exp.status, exp.err);
    if (exp.status === 0) assert.equal(got.stdout, exp.out);
    else assert.equal(got.stderr, exp.err);
  });
}

test('script has no import of the app repo', async () => {
  const { readFileSync } = await import('node:fs');
  assert.doesNotMatch(readFileSync(script, 'utf8'), /^\s*import\s.*\.\.\/app/m);
});

  test('--preset reads the private overlay (never tokens)', async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'hui-pl-'));
  try {
    writeFileSync(join(dir, 'pair-links.json'), JSON.stringify({ p: { url: 'https://h.example/v1', model: 'agent' } }));
    const r = spawnSync(process.execPath, ['--no-warnings', script, '--preset', 'p', '--token', 'tok'], { encoding: 'utf8', env: { ...process.env, FLAVOR: 'personal', HUI_PRIVATE_DIR: dir } });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /hermesui:\/\/pair\?u=https%3A%2F%2Fh\.example%2Fv1&t=tok&m=agent\n/);
    writeFileSync(join(dir, 'pair-links.json'), JSON.stringify({ p: { url: 'https://h.example', token: 'secret' } }));
    const bad = spawnSync(process.execPath, ['--no-warnings', script, '--preset', 'p'], { encoding: 'utf8', env: { ...process.env, FLAVOR: 'personal', HUI_PRIVATE_DIR: dir } });
    assert.equal(bad.status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
