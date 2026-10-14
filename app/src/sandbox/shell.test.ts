import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASE_CSS, buildShellDocument, buildCsp, sanitizeThemeCss, shellLabels, SHELL_RUNTIME_JS } from './shell.ts';
import { IDIOMORPH_JS } from './idiomorph.ts';

const LABELS = shellLabels((key) => key); // translation stub: the shell gets the keys
const doc = buildShellDocument({ themeCss: '--h-bg:#fff;color-scheme:light;', scheme: 'light', idiomorphJs: IDIOMORPH_JS, labels: LABELS });

test('CSP is the first thing after charset and locks the network down', () => {
  assert.ok(doc.indexOf('Content-Security-Policy') < doc.indexOf('<style'));
  const csp = buildCsp();
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /connect-src https:\/\/cdn\.jsdelivr\.net https:\/\/unpkg\.com https:\/\/cdnjs\.cloudflare\.com https:\/\/esm\.sh;/);
  assert.match(csp, /frame-src 'none'/);
  assert.match(csp, /form-action 'none'/);
  assert.match(csp, /base-uri 'none'/);
  assert.ok(!/\*\s*;|'self'|https:\s|http:\s/.test(csp), 'no wildcard / self / scheme-wide sources');
  assert.ok(!csp.includes('"'), 'must fit in a double-quoted attribute');
});

test('inline scripts contain no sequence that would end the <script> element early', () => {
  for (const js of [IDIOMORPH_JS, SHELL_RUNTIME_JS]) {
    assert.ok(!/<\/script/i.test(js));
    assert.ok(!/<!--/.test(js));
  }
  assert.equal((doc.match(/<script>/g) || []).length, 2);
});

test('shell runtime parses as JavaScript', () => {
  assert.doesNotThrow(() => new Function(SHELL_RUNTIME_JS));
  assert.doesNotThrow(() => new Function(IDIOMORPH_JS));
});

test('theme css cannot break out of its style element', () => {
  assert.equal(sanitizeThemeCss('--h-bg:red}</style><script>x</script>'), '--h-bg:red/stylescriptx/script');
  const d = buildShellDocument({ themeCss: '--a:1;}</style><script>alert(1)</script>', scheme: 'dark', idiomorphJs: '', labels: LABELS });
  assert.equal((d.match(/<script>/g) || []).length, 2);
  assert.match(d, /data-scheme="dark"/);
});

// Design review P1-1: the loan calculator (4-column currency table) widened the single grid track at 358 px
// (390 pt minus chat padding) so the whole card scrolled sideways. Measured fix: tables scroll inside themselves,
// grid/flex children may shrink, everything is border-box.
test('base css keeps wide content inside the 390 pt chat column', () => {
  const rule = (sel: string) => new RegExp(`(^|\\})${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\{([^}]*)\\}`, 'm').exec(BASE_CSS)?.[2] ?? '';
  const table = rule('table');
  for (const d of ['display:block', 'max-width:100%', 'overflow-x:auto']) assert.ok(table.includes(d), `table: ${d}`);
  assert.ok(rule('*,*::before,*::after').includes('box-sizing:border-box'));
  assert.ok(BASE_CSS.includes(':where(#hui-root) *{min-width:0}'), 'grid/flex items may shrink (zero specificity)');
  assert.match(BASE_CSS, /img,video\{max-width:100%/);
  assert.match(rule('pre'), /overflow-x:auto/);
  assert.ok(doc.includes(':where(#hui-root) *{min-width:0}'), 'shell document carries the fix');
});

// ---------------------------------------------------------------- tap channel (web, iOS Safari)
import { TAP_CLASSIFIER_JS, SHELL_TAP_MAX_MOVE_PX, SHELL_TAP_MAX_MS, FRAME_INIT_MESSAGE } from './shell.ts';
import { TAP_MAX_MOVE_PX, TAP_MAX_MS } from './actionGate.ts';
import { parseSandboxMessage } from './messages.ts';

type Press = { trusted?: unknown; cancelled?: boolean; dist2?: number; ms?: number };
const classify = new Function(`${TAP_CLASSIFIER_JS}; return huiClassifyTap;`)() as (g: Press | null, maxMove: number, maxMs: number) => string;
const cls = (g: Press | null) => classify(g, SHELL_TAP_MAX_MOVE_PX, SHELL_TAP_MAX_MS);

test('tap classifier: short, still, trusted press is a tap', () => {
  assert.equal(cls({ trusted: true, cancelled: false, dist2: 0, ms: 90 }), 'tap');
  assert.equal(cls({ trusted: true, cancelled: false, dist2: 10 * 10, ms: 1000 }), 'tap'); // limits inclusive
});

test('tap classifier: scrolls, drags and browser-cancelled gestures are not taps', () => {
  assert.equal(cls({ trusted: true, cancelled: false, dist2: 10 * 10 + 1, ms: 120 }), 'scroll');
  assert.equal(cls({ trusted: true, cancelled: false, dist2: 300 * 300, ms: 200 }), 'scroll');
  assert.equal(cls({ trusted: true, cancelled: true, dist2: 0, ms: 80 }), 'scroll'); // pointercancel / pinch
  assert.equal(cls({ trusted: true, cancelled: false, dist2: NaN, ms: 80 }), 'scroll');
  assert.equal(cls({ trusted: true, cancelled: false, dist2: Infinity, ms: 80 }), 'scroll');
});

test('tap classifier: long presses and broken timing are not taps', () => {
  assert.equal(cls({ trusted: true, cancelled: false, dist2: 0, ms: 1001 }), 'long');
  assert.equal(cls({ trusted: true, cancelled: false, dist2: 0, ms: -5 }), 'long');
  assert.equal(cls({ trusted: true, cancelled: false, dist2: 0, ms: NaN }), 'long');
});

test('tap classifier: synthetic (isTrusted false) events never count', () => {
  for (const trusted of [false, undefined, 'true', 1]) assert.equal(cls({ trusted, cancelled: false, dist2: 0, ms: 50 }), 'untrusted');
  assert.equal(cls(null), 'untrusted');
});

test('shell tap thresholds match the host gate', () => {
  assert.equal(SHELL_TAP_MAX_MOVE_PX, TAP_MAX_MOVE_PX);
  assert.equal(SHELL_TAP_MAX_MS, TAP_MAX_MS);
});

test('tap channel: set up before any listener model code could add, and never via patchable lookups', () => {
  const js = SHELL_RUNTIME_JS;
  const initAt = js.indexOf("apply(addWin, window, ['message'");
  assert.ok(initAt > 0 && initAt < js.indexOf('window.addEventListener = wrapAdd'), 'init listener registered first');
  assert.ok(js.indexOf('var apply = Reflect.apply') < initAt);
  assert.ok(js.includes(JSON.stringify(FRAME_INIT_MESSAGE)));
  assert.ok(js.includes('apply(stopImm, e, [])'), 'init message is hidden from other listeners');
  assert.ok(!/tapPort\.postMessage|tapPort\.start/.test(js), 'port is used only through the captured postMessage');
  assert.ok(/e\.isTrusted === true/.test(js));
});

test('a "tap" on the normal window channel is not a message the host accepts', () => {
  assert.equal(parseSandboxMessage('{"t":"tap"}'), null);
  assert.equal(parseSandboxMessage('tap'), null);
  assert.equal(parseSandboxMessage({ t: 'hui-init' }), null);
});

type Key = { trusted?: unknown; repeat?: boolean; key?: string; buttonLike?: boolean };
const classifyKey = new Function(`${TAP_CLASSIFIER_JS}; return huiClassifyKey;`)() as (k: Key | null) => string;

test('key classifier (GPT security M1 / Astra F15): trusted Enter, or Space on a button, is a keyboard tap', () => {
  assert.equal(classifyKey({ trusted: true, repeat: false, key: 'Enter', buttonLike: false }), 'tap');
  assert.equal(classifyKey({ trusted: true, repeat: false, key: ' ', buttonLike: true }), 'tap');
  assert.equal(classifyKey({ trusted: true, repeat: false, key: ' ', buttonLike: false }), 'none'); // typing a space
  assert.equal(classifyKey({ trusted: true, repeat: false, key: 'a', buttonLike: true }), 'none');
  assert.equal(classifyKey({ trusted: true, repeat: true, key: 'Enter' }), 'untrusted'); // held key
  assert.equal(classifyKey({ trusted: false, repeat: false, key: 'Enter' }), 'untrusted'); // synthetic event
  assert.equal(classifyKey(null), 'untrusted');
});

// Astra F17: the skill validator (hermes-skill/examples/validate.mjs) must accept exactly the hosts the runtime CSP allows
import { readFileSync } from 'node:fs';
import { CDN_ORIGINS, IMAGE_ORIGINS } from './shell.ts';

test('skill validator host allow-list matches the sandbox CSP origins (parity)', () => {
  const src = readFileSync(new URL('../../../hermes-skill/examples/validate.mjs', import.meta.url), 'utf8');
  const m = /const ALLOWED_HOSTS = \[([^\]]*)\]/.exec(src);
  assert.ok(m, 'ALLOWED_HOSTS literal in validate.mjs');
  const validator = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
  const runtime = [...CDN_ORIGINS, ...IMAGE_ORIGINS].map((o) => o.replace(/^https:\/\//, '')).sort();
  assert.deepEqual(validator, runtime);
});
