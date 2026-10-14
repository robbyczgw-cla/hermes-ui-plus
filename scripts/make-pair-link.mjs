#!/usr/bin/env -S node --no-warnings
// Print pair links (app + web app) for a Hermes profile.
//
//   node scripts/make-pair-link.mjs --app https://<host>.<tailnet>.ts.net/ --url /v1 --token <TOKEN> \
//        --model <model>
//
// --url may be relative (/v1) or omitted for a web app served from the same origin as the API.
//
// FLAVOR=hermes (default): links for the official app (`hermesuiplus://`, app/brand/identity.json).
// FLAVOR=personal: links for the personal app (`hermesui://`).
// --preset NAME: defaults from $HUI_PRIVATE_DIR/pair-links.json ({"NAME": {"app": …, "url": …, "model": …, "name": …}};
//   default dir ~/work/hermesiui-private). Tokens never go there;
//   command-line options win over the preset.
// The output contains the token: send it only over a private channel (or show it as QR code locally).
// Self-contained (runs from the staging folder without the app repo): the link building and validation below are
// vendored from app/src/onboarding/pairLink.ts + url.ts. scripts/make-pair-link.test.mjs (node --test) compares the
// output with the app's own code, so changes there must be mirrored here.

// ---- vendored from app/src/onboarding/{pairLink,url}.ts (minimal: build + validate what this script prints) ----
const FLAVOR = (process.env.FLAVOR || process.env.EXPO_PUBLIC_FLAVOR || 'hermes').trim().toLowerCase();
if (FLAVOR !== 'hermes' && FLAVOR !== 'personal') {
  console.error(`FLAVOR must be hermes or personal (got ${FLAVOR})`);
  process.exit(2);
}
const PAIR_SCHEME = FLAVOR === 'personal' ? 'hermesui' : 'hermesuiplus'; // test: = app/brand/identity.json scheme
const MAX_PAIR_LINK_LENGTH = 4096;
const MAX_TOKEN_LENGTH = 1024;
const MAX_MODEL_LENGTH = 200;
const MAX_URL_LENGTH = 2048;
const ENDPOINT_SUFFIX = /\/(chat\/completions|completions|models|responses|health(\/detailed)?)$/i;

function pairQuery(p) {
  const parts = [`u=${encodeURIComponent(p.url)}`];
  if (p.token) parts.push(`t=${encodeURIComponent(p.token)}`);
  if (p.name) parts.push(`n=${encodeURIComponent(p.name)}`);
  if (p.model) parts.push(`m=${encodeURIComponent(p.model)}`);
  return parts.join('&');
}
const buildPairLink = (p) => `${PAIR_SCHEME}://pair?${pairQuery(p)}`;
const buildWebPairLink = (appUrl, p) => `${appUrl.replace(/#.*$/, '')}#pair?${pairQuery(p)}`;

function classifyHost(h) {
  if (!h) return null;
  if (h.startsWith('[')) {
    const inner = h.slice(1, -1);
    if (!/^[0-9a-f:.]+$/.test(inner) || !inner.includes(':') || inner.length > 45) return null;
    return { host: inner, kind: 'ipv6' };
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
    if (h.split('.').some((o) => Number(o) > 255 || (o.length > 1 && o.startsWith('0')))) return null;
    return { host: h, kind: 'ipv4' };
  }
  const name = h.replace(/\.$/, '');
  if (name.length > 253) return null;
  const labels = name.split('.');
  if (labels.some((l) => !/^[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?$/.test(l))) return null;
  if (labels.every((l) => /^\d+$/.test(l))) return null;
  if (name === 'localhost' || name.endsWith('.localhost')) return { host: name, kind: 'localhost' };
  return { host: name, kind: 'name' };
}

function normalizeServerUrl(input) {
  const raw = (input ?? '').trim();
  if (!raw) return { ok: false, error: 'empty' };
  if (raw.length > MAX_URL_LENGTH) return { ok: false, error: 'too-long' };
  if (/[\s\u0000-\u001f\u007f]/.test(raw)) return { ok: false, error: 'whitespace' };
  let rest = raw;
  let scheme = 'https';
  const m = /^([a-z][a-z0-9+.-]*):(\/\/)?/i.exec(rest);
  if (m && (m[2] || !/^\d/.test(rest.slice(m[0].length)))) {
    const s = m[1].toLowerCase();
    if ((s !== 'http' && s !== 'https') || !m[2]) return { ok: false, error: 'scheme' };
    scheme = s;
    rest = rest.slice(m[0].length);
  } else if (rest.startsWith('//')) rest = rest.slice(2);
  const cut = rest.search(/[/?#]/);
  const authority = cut === -1 ? rest : rest.slice(0, cut);
  let path = cut === -1 ? '' : rest.slice(cut);
  if (authority.includes('@')) return { ok: false, error: 'credentials' };
  if (authority.includes('\\')) return { ok: false, error: 'host' };
  let hostPart = authority;
  let portStr;
  if (hostPart.startsWith('[')) {
    const end = hostPart.indexOf(']');
    if (end === -1) return { ok: false, error: 'host' };
    const after = hostPart.slice(end + 1);
    if (after && !/^:\d*$/.test(after)) return { ok: false, error: 'host' };
    portStr = after ? after.slice(1) : undefined;
    hostPart = hostPart.slice(0, end + 1);
  } else {
    const idx = hostPart.lastIndexOf(':');
    if (idx !== -1) {
      portStr = hostPart.slice(idx + 1);
      hostPart = hostPart.slice(0, idx);
    }
  }
  let port;
  if (portStr !== undefined) {
    if (!/^\d{1,5}$/.test(portStr)) return { ok: false, error: 'port' };
    port = Number(portStr);
    if (port < 1 || port > 65535) return { ok: false, error: 'port' };
  }
  const host = classifyHost(hostPart.toLowerCase());
  if (!host) return { ok: false, error: 'host' };
  path = path.replace(/[?#].*$/, '').replace(/\/{2,}/g, '/').replace(/\/+$/, '');
  if (!/^[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/.test(path)) return { ok: false, error: 'path' };
  if (/(^|\/)\.\.?(\/|$)/.test(path) || /%2f|%5c|%00|%2e/i.test(path)) return { ok: false, error: 'path' };
  path = path.replace(ENDPOINT_SUFFIX, '');
  path = /\/v1$/i.test(path) ? path.replace(/\/v1$/i, '/v1') : `${path}/v1`;
  const defaultPort = scheme === 'https' ? 443 : 80;
  const hostOut = host.kind === 'ipv6' ? `[${host.host}]` : host.host;
  const portOut = port !== undefined && port !== defaultPort ? `:${port}` : '';
  return { ok: true, baseUrl: `${scheme}://${hostOut}${portOut}${path}` };
}

/** What parsePairLink checks for a link we built ourselves (no duplicates / bad encoding possible). */
function validatePair(input, origin) {
  const link = buildPairLink(input);
  if (link.length > MAX_PAIR_LINK_LENGTH) return { ok: false, error: 'too-long' };
  let u = input.url;
  if (origin && (!u || (u.startsWith('/') && !u.startsWith('//')))) u = `${origin}${u ?? ''}`;
  if (!u) return { ok: false, error: 'missing-url' };
  const url = normalizeServerUrl(u);
  if (!url.ok) return { ok: false, error: `url-${url.error}` };
  const token = input.token ?? '';
  if (token && !(token.length <= MAX_TOKEN_LENGTH && /^[\x21-\x7e]+$/.test(token))) return { ok: false, error: 'bad-token' };
  const kind = 'hermes'; // the only connection kind of this build
  const model = (input.model ?? '').trim();
  if (model && !(model.length <= MAX_MODEL_LENGTH && /^[\x21-\x7e]+$/.test(model))) return { ok: false, error: 'bad-model' };
  return { ok: true, pair: { baseUrl: url.baseUrl, kind, model } };
}
// ---- end vendored ----

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : undefined;
};
const flag = (name) => args.includes(`--${name}`);
if (flag('h') || flag('-help') || args.length === 0) {
  console.log('usage: [FLAVOR=hermes|personal] make-pair-link.mjs [--preset NAME] [--app <web-app-url>] [--url <api-base>] [--token T] [--name N] [--model M]');
  process.exit(args.length ? 0 : 2);
}
let preset = {};
if (opt('preset')) {
  const { readFileSync, existsSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { homedir } = await import('node:os');
  const dir = (process.env.HUI_PRIVATE_DIR || join(homedir(), 'work', 'hermesiui-private')).replace(/^~(?=\/)/, homedir());
  const file = join(dir, 'pair-links.json');
  if (!existsSync(file)) {
    console.error(`--preset needs ${file}`);
    process.exit(2);
  }
  preset = JSON.parse(readFileSync(file, 'utf8'))[opt('preset')];
  if (!preset || typeof preset !== 'object') {
    console.error(`no preset "${opt('preset')}" in ${file}`);
    process.exit(2);
  }
  if ('token' in preset) {
    console.error(`${file}: presets must not contain tokens`);
    process.exit(2);
  }
}
const input = {
  url: opt('url') ?? preset.url ?? '',
  token: opt('token'),
  name: opt('name') ?? preset.name,
  model: opt('model') ?? preset.model,
};
const app = opt('app') ?? preset.app;
const origin = app ? new URL(app).origin : null;
// validate like the app does
const check = validatePair({ ...input, url: input.url || '' }, origin);
if (!check.ok) {
  console.error(`invalid pair link: ${check.error}`);
  process.exit(1);
}
const strip = (link) => (input.url ? link : link.replace(/([?#]pair\?)u=&?/, '$1'));
if (input.url && /^https?:/i.test(input.url)) console.log(`App (QR / iOS-Android app):\n  ${buildPairLink(input)}\n`);
if (app) console.log(`Web app (open in Safari on the iPhone):\n  ${strip(buildWebPairLink(app, input))}\n`);
console.log(`Resolved API base: ${check.pair.baseUrl}  kind=${check.pair.kind}${check.pair.model ? ` model=${check.pair.model}` : ''}`);
