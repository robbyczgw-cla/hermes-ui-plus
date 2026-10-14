import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adviceForError, adviceForSuccess, compareVersions, detectedItems, diagnose, isOldHermes, MIN_HERMES_VERSION, type DiagContext } from './diagnose.ts';
import { classifyFetchError, classifyStatus, isTailnetHost, type ConnError } from './errors.ts';
import { NO_FEATURES, type Features } from './features.ts';
import type { ProbeResult } from './probe.ts';
import { diagnosticsSummary, fillTroubleshootPrompt } from './troubleshoot.ts';
import { agentPromptText } from './agentPrompts.ts';
import { normalizeServerUrl, type NormalizedUrl } from './url.ts';
import { makeT } from '../i18n/core.ts';
import { de } from '../i18n/de.ts';

function u(s: string): NormalizedUrl {
  const r = normalizeServerUrl(s);
  assert.ok(r.ok);
  return r;
}
const ctx = (url: string, platform: DiagContext['platform'] = 'android', bridge = false): DiagContext => ({ platform, url: u(url), bridge });

test('tailnet unreachable → "Ist Tailscale an?" with an open-Tailscale button on phones', () => {
  const url = u('https://box.example.ts.net');
  const err = classifyFetchError(new TypeError('Network request failed'), { platform: 'android', url });
  const a = adviceForError(err, { platform: 'android', url, bridge: false });
  assert.equal(a.id, 'tailscale');
  assert.deepEqual(a.actions, ['openTailscale', 'retry']);
  // also CGNAT IPs and DNS failures for MagicDNS names; on the web no app button
  assert.equal(adviceForError({ kind: 'dns', host: 'box.example.ts.net' }, ctx('https://box.example.ts.net', 'web')).actions.includes('openTailscale'), false);
  assert.equal(adviceForError({ kind: 'timeout', host: '100.100.100.100' }, ctx('http://100.100.100.100:8645')).id, 'tailscale');
  assert.ok(isTailnetHost('100.100.100.100') && isTailnetHost('Box.Example.ts.net.') && !isTailnetHost('100.128.0.1') && !isTailnetHost('example.org'));
});

test('DNS for a normal host → check the address', () => {
  assert.equal(adviceForError({ kind: 'dns', host: 'hermes.example.org' }, ctx('https://hermes.example.org')).id, 'dns');
});

test('TLS: private https host gets "use http" as fix, public host only the prompt', () => {
  const lan = adviceForError({ kind: 'tls', host: '192.168.1.20' }, ctx('https://192.168.1.20:8645'));
  assert.equal(lan.id, 'tls');
  assert.ok(lan.actions.includes('useHttp'));
  const pub = adviceForError({ kind: 'tls', host: 'hermes.example.org' }, ctx('https://hermes.example.org'));
  assert.ok(!pub.actions.includes('useHttp'));
  // generic RN network error with https+IP suspect → TLS
  const err = classifyFetchError(new TypeError('Network request failed'), { platform: 'ios', url: u('https://192.168.1.20') });
  assert.equal(adviceForError(err, ctx('https://192.168.1.20', 'ios')).id, 'tls');
});

test('plain http blocked / mixed content → use https', () => {
  assert.equal(adviceForError({ kind: 'cleartext' }, ctx('http://hermes.example.org')).id, 'cleartext');
  const m = adviceForError({ kind: 'mixedContent' }, ctx('http://hermes.example.org', 'web'));
  assert.equal(m.id, 'mixedContent');
  assert.deepEqual(m.actions, ['useHttps']);
});

test('401: wrong Hermes key vs. wrong bridge token vs. missing key', () => {
  const s = classifyStatus(401, { hasKey: true });
  assert.equal(adviceForError(s, ctx('http://10.0.0.5:8645')).id, 'unauthorized');
  assert.equal(adviceForError(s, ctx('https://bridge.example.org', 'android', true)).id, 'bridgeToken');
  assert.equal(adviceForError(classifyStatus(401, { hasKey: false }), ctx('http://10.0.0.5:8645')).id, 'keyMissing');
  assert.ok(adviceForError(s, ctx('http://10.0.0.5:8645')).actions.includes('editKey'));
});

test('Hermes API disabled: connection refused; bridge up but Hermes down: 502 from the bridge', () => {
  assert.equal(adviceForError({ kind: 'refused', host: '10.0.0.5' }, ctx('http://10.0.0.5:8645')).id, 'apiDisabled');
  const e502: ConnError = classifyStatus(502, { hasKey: true });
  assert.equal(adviceForError(e502, ctx('https://bridge.example.org', 'android', true)).id, 'hermesDown');
  assert.equal(adviceForError(e502, ctx('https://hermes.example.org')).id, 'server');
});

test('CORS on the web: direct Hermes vs. bridge', () => {
  const url = u('https://hermes.example.org');
  const err = classifyFetchError(new TypeError('Failed to fetch'), { platform: 'web', url, pageProtocol: 'https:' });
  assert.equal(err.kind, 'cors');
  assert.equal(adviceForError(err, { platform: 'web', url, bridge: false }).id, 'cors');
  assert.equal(adviceForError(err, { platform: 'web', url, bridge: true }).id, 'corsBridge');
});

test('every error kind maps to an advice with i18n texts (de/en/es complete)', () => {
  const kinds: ConnError['kind'][] = ['timeout', 'dns', 'refused', 'tls', 'cleartext', 'mixedContent', 'cors', 'network', 'unauthorized', 'keyMissing', 'forbidden', 'notFound', 'rateLimited', 'server', 'notHermes', 'unknown'];
  const t = makeT('de', 'de-DE');
  for (const kind of kinds) {
    for (const bridge of [false, true]) {
      const a = adviceForError({ kind, status: kind === 'server' ? 502 : undefined }, ctx('https://hermes.example.org', 'android', bridge));
      assert.equal(a.severity, 'error');
      assert.ok(a.actions.length > 0, kind);
      const advice = (de.onboarding.diag.advice as Record<string, { title: string; text: string }>)[a.id];
      assert.ok(advice?.title && advice.text, `missing de text for ${a.id}`);
      assert.ok(!t(`onboarding.diag.advice.${a.id}.title` as never).startsWith('onboarding.'));
    }
  }
});

test('versions: compare + old Hermes detection', () => {
  assert.equal(compareVersions('0.21.4', '0.21.0')! > 0, true);
  assert.equal(compareVersions('v0.20.9', MIN_HERMES_VERSION)! < 0, true);
  assert.equal(compareVersions('1.0', '0.21.0')! > 0, true);
  assert.equal(compareVersions('dev', '0.21.0'), null);
  assert.equal(isOldHermes({ hermes: true, version: '0.19.2' }), true);
  assert.equal(isOldHermes({ hermes: true, version: '0.21.4' }), false);
  // no version → /v1/capabilities missing is the signal
  assert.equal(isOldHermes({ hermes: true }, { capabilities: false }), true);
  assert.equal(isOldHermes({ hermes: false }, { capabilities: false }), false);
});

const OK: ProbeResult = { ok: true, bridge: true, hermes: true, version: '0.21.4', models: ['hermes-agent'], catalog: { models: 42, providers: 3 }, ms: 80 };
const ALL: Features = { router: true, voice: true, images: false, push: true, skill: true, capabilities: true };

test('success: detected list shows version, bridge features, catalog count', () => {
  const items = detectedItems(OK, ALL);
  const by = Object.fromEntries(items.map((i) => [i.id, i]));
  assert.deepEqual(by.hermes, { id: 'hermes', state: 'ok', value: '0.21.4' });
  assert.equal(by.bridge.state, 'ok');
  assert.equal(by.router.state, 'ok');
  assert.equal(by.images.state, 'off');
  assert.equal(by.models.value, 42);
  const d = diagnose(OK, ALL, { platform: 'android', url: u('https://bridge.example.org') });
  assert.equal(d.status, 'ok');
  assert.deepEqual(d.advice, []);
});

test('success with gaps: skill missing (bridge present) → install prompt; old Hermes → update prompt; no bridge → info', () => {
  const d = diagnose(OK, { ...ALL, skill: false }, { platform: 'android', url: u('https://bridge.example.org') });
  assert.equal(d.status, 'warning');
  assert.deepEqual(d.advice.map((a) => [a.id, a.actions[0]]), [['skillMissing', 'copySkillPrompt']]);
  const old = adviceForSuccess({ ...OK, version: '0.20.1' }, ALL);
  assert.deepEqual(old.map((a) => a.id), ['oldHermes']);
  assert.equal(old[0].actions[0], 'copyUpdatePrompt');
  const direct = diagnose({ ...OK, bridge: false }, NO_FEATURES, { platform: 'android', url: u('http://10.0.0.5:8645') });
  assert.equal(direct.status, 'ok');
  assert.deepEqual(direct.advice.map((a) => a.id), ['noBridge']);
  // no bridge: no bridge-only rows
  assert.deepEqual(direct.detected.map((i) => i.id), ['hermes', 'bridge', 'skill', 'models']);
});

test('failed probe → one error advice, nothing detected', () => {
  const d = diagnose({ ok: false, bridge: false, hermes: false, models: [], ms: 0, error: { kind: 'unauthorized', status: 401 } }, null, { platform: 'ios', url: u('http://10.0.0.5:8645') });
  assert.equal(d.status, 'error');
  assert.equal(d.advice[0].id, 'unauthorized');
  assert.deepEqual(d.detected, []);
});

test('troubleshoot prompt: error summary filled in, never the key', () => {
  const summary = diagnosticsSummary({ error: { kind: 'unauthorized', status: 401, detail: 'x  y' }, advice: 'bridgeToken', host: 'bridge.example.org', scheme: 'https', bridge: true, platform: 'android' });
  assert.match(summary, /error: unauthorized \(HTTP 401\)/);
  assert.match(summary, /bridge detected: yes/);
  assert.match(summary, /detail: x y/);
  for (const lang of ['de', 'en', 'es'] as const) {
    const filled = fillTroubleshootPrompt(agentPromptText('troubleshoot', lang), summary);
    assert.ok(filled.includes('error: unauthorized'));
    assert.ok(!filled.includes('{error}'));
  }
  assert.equal(fillTroubleshootPrompt('Help me.', 'error: dns'), 'Help me.\n\nerror: dns');
  assert.equal(fillTroubleshootPrompt('Help: {error}', ''), 'Help:');
});
