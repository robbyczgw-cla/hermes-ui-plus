import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildReport, errorCodeOf, issuesNewUrl, lastErrorCode, noteLastError, scrubReportText, type ReportInput } from './report.ts';

const NEW = 'https://github.com/example/hermes-ui-plus/issues/new';

// fake private values: every one of them must stay out of the report
const HOST = 'box.tailnet.example.net';
const HOST2 = 'nas.home.example.com';
const IP = '192.0.2.7';
const TOKEN = 'nca_user_test_token_0000000000000000';
const JWT = 'eyJfake_test_token_000000000000';
const EMAIL = 'alice@example.com';
const MESSAGE = 'please summarise my secret diary entry';
const SECRETS = [HOST, HOST2, IP, TOKEN, JWT, EMAIL, MESSAGE, 'tailnet', 'alice', 'diary', 'nca_user', 'eyJ'];

const clean: ReportInput = {
  appName: 'HUI+',
  version: '0.1.0-alpha.1',
  extra: { buildNumber: 42, buildSource: 'abc1234' },
  os: 'android',
  osVersion: 34,
  flavor: 'hermes',
  connection: 'bridge',
  hermesVersion: '0.21.0',
  bridgeVersion: '0.1.0-alpha.1',
  serverFlags: { session_resources: true, cors: false, approval_events: true },
  appFlags: { bg_service: true, update_check: true, other: false },
  lastError: { category: 'network', code: 'timeout' },
};

function assertNoSecrets(out: string, where: string) {
  for (const s of SECRETS) assert.ok(!out.includes(s), `${where} leaks ${JSON.stringify(s)}:\n${out}`);
  // URL-encoded forms too
  for (const s of SECRETS) assert.ok(!out.includes(encodeURIComponent(s)), `${where} leaks encoded ${JSON.stringify(s)}`);
}

test('clean input: the allow-listed facts, prefilled for the issue form', () => {
  const r = buildReport(clean, NEW);
  assert.deepEqual(
    r.fields.map((f) => [f.id, f.value]),
    [
      ['version', 'HUI+ 0.1.0-alpha.1 · Build 42 (abc1234)'],
      ['platform', 'Android (API 34) · flavor hermes'],
      ['connection', 'bridge'],
      ['server', 'Hermes 0.21.0, bridge 0.1.0-alpha.1'],
      ['flags', 'app: bg_service, update_check\nserver: approval_events, session_resources'],
      ['last-error', 'network/timeout'],
    ],
  );
  assert.equal(r.title, '[Bug]: network/timeout on Android (API 34)');
  const u = new URL(r.url);
  assert.equal(`${u.origin}${u.pathname}`, NEW);
  assert.equal(u.searchParams.get('template'), 'bug_report.yml');
  assert.equal(u.searchParams.get('title'), r.title);
  for (const f of r.fields) assert.equal(u.searchParams.get(f.id), f.value);
  assert.ok(r.text.startsWith(`Title: ${r.title}\n\n### App version\nHUI+ 0.1.0-alpha.1`));
});

test('a host, token or e-mail in ANY input never reaches title, text or URL', () => {
  const poisoned = [HOST, HOST2, IP, TOKEN, JWT, EMAIL, MESSAGE, `https://${HOST}/v1?key=${TOKEN}`, `1.0.0+${HOST}`, `Bearer ${TOKEN}`];
  for (const bad of poisoned) {
    const input: ReportInput = {
      appName: bad,
      version: bad,
      extra: { buildNumber: 7, buildSource: bad },
      os: bad,
      osVersion: bad,
      desktop: bad,
      flavor: bad,
      connection: bad as ReportInput['connection'],
      hermesVersion: bad,
      bridgeVersion: bad,
      serverFlags: { [bad]: true, [bad.toLowerCase().replace(/[^a-z0-9_]/g, '_')]: true, session_resources: true },
      appFlags: { [bad]: true },
      lastError: { category: 'network', code: bad },
    };
    const r = buildReport(input, NEW);
    const all = [r.title, r.text, r.url, ...r.fields.map((f) => f.value)].join('\n');
    assertNoSecrets(all, `input ${JSON.stringify(bad)}`);
    assertNoSecrets(decodeURIComponent(r.url), `decoded URL for ${JSON.stringify(bad)}`);
    assert.match(r.text, /server: session_resources, \+[12] other/, 'known flags still reported, unknown ones only counted');
  }
});

test('personal flavor data goes through the same scrubber', () => {
  const r = buildReport({ ...clean, appName: 'Hermes UI', flavor: 'personal', connection: 'other', desktop: null, hermesVersion: `0.21.0-${HOST}`, serverFlags: { [HOST]: true } }, NEW);
  assertNoSecrets(r.text + r.url, 'personal');
  assert.match(r.text, /flavor personal/);
  assert.match(r.text, /### Connection\nother/);
});

test('errorCodeOf: category + code only, never the error text', () => {
  const cases: [Parameters<typeof errorCodeOf>[0], string | null][] = [
    [{ error: 'x', errorText: { key: 'backends.hermes.errors.networkDetail', params: { detail: `java.net.UnknownHostException: Unable to resolve host "${HOST}"` } } }, 'network/dns'],
    [{ error: 'x', errorText: { key: 'backends.hermes.errors.authDenied' } }, 'auth/authDenied'],
    [{ error: 'x', errorText: { key: 'backends.hermes.errors.noResponseTimeout' } }, 'timeout/noResponseTimeout'],
    [{ error: 'x', errorText: { key: 'backends.hermes.errors.agentFailed' } }, 'app/agentFailed'],
    [{ error: `TypeError: Failed to fetch https://${HOST}/v1` }, 'network/unreachable'],
    [{ error: `HTTP 502 from ${HOST}: ${MESSAGE}` }, 'server/http_502'],
    [{ error: `401 for ${EMAIL} ${TOKEN}` }, 'auth/http_401'],
    [{ error: MESSAGE }, 'app/unknown'],
    [{}, null],
  ];
  for (const [m, want] of cases) {
    const e = errorCodeOf(m);
    assert.equal(e ? `${e.category}/${e.code}` : null, want, JSON.stringify(m));
    if (e) assertNoSecrets(`${e.category}/${e.code}`, 'error code');
  }
});

test('last error memory: keeps the newest by message time, ignores null', () => {
  noteLastError({ category: 'network', code: 'dns' }, 2000);
  noteLastError(null, 3000);
  assert.deepEqual(lastErrorCode(), { category: 'network', code: 'dns' });
  noteLastError({ category: 'app', code: 'agentFailed' }, 1000); // an older card mounted later (inverted list)
  assert.deepEqual(lastErrorCode(), { category: 'network', code: 'dns' });
  noteLastError({ category: 'auth', code: 'authDenied' }, 2500);
  assert.deepEqual(lastErrorCode(), { category: 'auth', code: 'authDenied' });
});

test('scrubReportText: e-mail, credentials, URLs, IPs, hosts', () => {
  const out = scrubReportText(`mail ${EMAIL} at https://${HOST}/x token=${TOKEN} ${JWT} ${IP} ${HOST2} [fd7a:115c::1]`);
  assertNoSecrets(out, 'scrub');
  assert.equal(scrubReportText('HUI+ 0.1.0-alpha.1 · Build 42 (abc1234)'), 'HUI+ 0.1.0-alpha.1 · Build 42 (abc1234)', 'versions survive');
});

test('issuesNewUrl: only GitHub repository URLs', () => {
  assert.equal(issuesNewUrl('https://github.com/example/hermes-ui-plus'), NEW);
  assert.equal(issuesNewUrl('https://github.com/example/hermes-ui-plus/'), NEW);
  assert.equal(issuesNewUrl(null), null);
  assert.equal(issuesNewUrl(`https://${HOST}/x/y`), null);
});

test('the issue form has a field for every prefilled id (.github/ISSUE_TEMPLATE/bug_report.yml)', () => {
  const yml = readFileSync(new URL('../../../.github/ISSUE_TEMPLATE/bug_report.yml', import.meta.url), 'utf8');
  const ids = new Set([...yml.matchAll(/^\s+id:\s*([\w-]+)\s*$/gm)].map((m) => m[1]));
  for (const f of buildReport(clean, NEW).fields) assert.ok(ids.has(f.id), `bug_report.yml lacks id ${f.id}`);
});
