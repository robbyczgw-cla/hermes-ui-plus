// The sandbox shell document: loaded ONCE per HtmlBlock into the WebView / iframe. Streamed
// HTML is pushed in afterwards (WebView.injectJavaScript / iframe postMessage) and morphed
// into #hui-root with idiomorph, so the view never reloads or flashes while the model writes.
// Pure string building, no RN imports (runs under `node --test`).
import type { TFn } from '../i18n/core.ts';
//
// Ideas ported from OpenIntelligentUI (MIT, (c) Atai Barkai / CopilotKit,
// refs/OpenIntelligentUI apps/app/src/components/generative-ui/open-generative-ui/frame-content.ts):
// CSP meta for the sandbox document, idiomorph body morph with enter animation, and the
// ResizeObserver → postMessage autosize.

/** CDNs model HTML may load scripts / styles / fonts from (SPEC hui-html sandbox). */
export const CDN_ORIGINS = ['https://cdn.jsdelivr.net', 'https://unpkg.com', 'https://cdnjs.cloudflare.com', 'https://esm.sh'] as const;

/**
 * Raster tile servers for Leaflet maps (images only) + Wikimedia images.
 * The sandbox document has an opaque origin and sends no Referer; tile.openstreetmap.org and
 * CARTO then serve "blocked" / "API key required" tiles, so only servers that work without a
 * Referer are listed (verified 2026-10): FOSSGIS German OSM style and OpenTopoMap.
 */
export const IMAGE_ORIGINS = [
  'https://tile.openstreetmap.de',
  'https://*.tile.opentopomap.org',
  'https://upload.wikimedia.org',
] as const;

export function buildCsp(): string {
  const cdn = CDN_ORIGINS.join(' ');
  return [
    "default-src 'none'",
    // inline is required: the shell itself and model <script> blocks are inline. eval stays
    // allowed for library compatibility; the network allow-list below is the real boundary.
    `script-src 'unsafe-inline' 'unsafe-eval' ${cdn}`,
    `style-src 'unsafe-inline' ${cdn}`,
    `font-src data: ${cdn}`,
    `img-src data: blob: ${cdn} ${IMAGE_ORIGINS.join(' ')}`,
    'media-src data: blob:',
    `connect-src ${cdn}`,
    'worker-src blob:',
    "frame-src 'none'",
    "child-src 'none'",
    "object-src 'none'",
    "manifest-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

/** Removes anything that could break out of the theme <style> element / declaration list. */
export function sanitizeThemeCss(css: string): string {
  return css.replace(/[<>{}\\]/g, '');
}

/** Base stylesheet: unstyled model HTML should already look like the app (light/dark via vars). */
export const BASE_CSS = `
:root{
  --color-background-primary:var(--h-bg);--color-background-secondary:var(--h-surface-alt,var(--h-surface));
  --color-text-primary:var(--h-text);--color-text-secondary:var(--h-muted);--color-text-tertiary:var(--h-subtle,var(--h-muted));
  --color-border-primary:var(--h-border-strong,var(--h-border));--color-border-secondary:var(--h-border);--color-border-tertiary:var(--h-border);
  --font-sans:var(--h-font);--font-mono:var(--h-font-mono,monospace);--border-radius-md:var(--h-radius);--border-radius-lg:var(--h-radius-lg,var(--h-radius));
}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%;background:transparent}
body{margin:0;padding:0;background:transparent;color:var(--h-text);font-family:var(--h-font);font-size:var(--h-font-size,15px);line-height:1.5;-webkit-font-smoothing:antialiased;overflow-wrap:break-word;-webkit-tap-highlight-color:transparent}
#hui-root{display:flow-root;padding:2px 2px 4px;overflow-x:auto}
#hui-root>:first-child{margin-top:0}
#hui-root>:last-child{margin-bottom:0}
body.hui-streaming #hui-root{pointer-events:none;-webkit-user-select:none;user-select:none}
h1,h2,h3,h4,h5{margin:1em 0 .45em;line-height:1.25;font-weight:600;letter-spacing:-.01em}
h1{font-size:1.4em}h2{font-size:1.22em}h3{font-size:1.06em}h4,h5{font-size:1em}
p{margin:.55em 0}
ul,ol{margin:.5em 0;padding-left:1.4em}
li{margin:.2em 0}
a{color:var(--h-accent);text-decoration:none}
a:active{opacity:.7}
small,.muted,figcaption{color:var(--h-muted)}
small{font-size:.85em}
strong,b{font-weight:600}
hr{border:0;border-top:1px solid var(--h-border);margin:1em 0}
img,video{max-width:100%;height:auto}
svg,canvas{max-width:100%}
svg{color:var(--h-text)}
code,kbd,samp,pre{font-family:var(--h-font-mono,monospace);font-size:.88em}
code{background:var(--h-code-bg,var(--h-surface-alt));padding:.1em .35em;border-radius:5px}
pre{background:var(--h-code-bg,var(--h-surface-alt));padding:10px 12px;border-radius:var(--h-radius-sm,8px);overflow-x:auto;line-height:1.45}
pre code{background:none;padding:0}
blockquote{margin:.6em 0;padding:.1em 0 .1em .9em;border-left:3px solid var(--h-border-strong,var(--h-border));color:var(--h-muted)}
table{width:100%;max-width:100%;display:block;overflow-x:auto;-webkit-overflow-scrolling:touch;border-collapse:collapse;font-size:.92em;font-variant-numeric:tabular-nums;margin:.5em 0}
th,td{padding:.5em .6em;text-align:left;border-bottom:1px solid var(--h-border);vertical-align:top}
th{font-weight:600;color:var(--h-muted);background:var(--h-surface-alt,var(--h-surface));font-size:.92em}
thead th:first-child{border-top-left-radius:var(--h-radius-sm,8px)}thead th:last-child{border-top-right-radius:var(--h-radius-sm,8px)}
tbody tr:last-child td{border-bottom:0}
caption{caption-side:bottom;color:var(--h-muted);font-size:.85em;padding-top:.4em;text-align:left}
button,.btn{-webkit-appearance:none;appearance:none;font:inherit;font-weight:500;font-size:.95em;line-height:1.2;padding:.6em 1em;min-height:40px;border-radius:var(--h-radius-sm,8px);border:1px solid var(--h-border-strong,var(--h-border));background:var(--h-surface);color:var(--h-text);cursor:pointer;transition:background-color .15s,opacity .15s,transform .08s;touch-action:manipulation}
button:active,.btn:active{transform:scale(.97);background:var(--h-surface-alt,var(--h-surface))}
button.primary,button[type=submit],.btn-primary,.primary>button{background:var(--h-accent);color:var(--h-on-accent,#fff);border-color:transparent}
button.primary:active,button[type=submit]:active,.btn-primary:active{opacity:.85;background:var(--h-accent)}
button:disabled,.btn:disabled{opacity:.45;cursor:default;transform:none}
button[aria-pressed=true],button.active{background:var(--h-accent-soft,var(--h-surface-alt));border-color:var(--h-accent);color:var(--h-accent)}
:focus{outline:none}
:focus-visible{outline:2px solid var(--h-accent);outline-offset:2px}
input,select,textarea{font:inherit;font-size:max(16px,1em);color:var(--h-text);background:var(--h-surface-alt,var(--h-surface));border:1px solid var(--h-border);border-radius:var(--h-radius-sm,8px);padding:.5em .7em;min-height:40px;max-width:100%}
input:focus,select:focus,textarea:focus{border-color:var(--h-accent);outline:none;box-shadow:0 0 0 3px var(--h-accent-soft,transparent)}
input::placeholder,textarea::placeholder{color:var(--h-subtle,var(--h-muted))}
input[aria-invalid=true]{border-color:var(--h-danger,#c2312b)}
textarea{min-height:80px;width:100%;resize:vertical}
select{padding-right:2em;-webkit-appearance:none;appearance:none;background-image:linear-gradient(45deg,transparent 50%,var(--h-muted) 50%),linear-gradient(135deg,var(--h-muted) 50%,transparent 50%);background-position:calc(100% - 15px) 55%,calc(100% - 10px) 55%;background-size:5px 5px,5px 5px;background-repeat:no-repeat}
input[type=checkbox],input[type=radio]{width:18px;height:18px;min-height:0;padding:0;margin:0 .4em 0 0;vertical-align:-3px;accent-color:var(--h-accent)}
input[type=color]{padding:2px;width:44px}
label{color:var(--h-text)}
fieldset{border:1px solid var(--h-border);border-radius:var(--h-radius);padding:.6em .9em;margin:.6em 0}
legend{padding:0 .3em;color:var(--h-muted);font-size:.9em}
details{border:1px solid var(--h-border);border-radius:var(--h-radius-sm,8px);padding:.5em .8em;margin:.5em 0}
summary{cursor:pointer;font-weight:500}
output{font-weight:600;font-variant-numeric:tabular-nums}
progress,meter{width:100%;accent-color:var(--h-accent)}
input[type=range]{-webkit-appearance:none;appearance:none;width:100%;height:28px;min-height:28px;padding:0;margin:.2em 0;border:0;background:transparent;accent-color:var(--h-accent);--hui-fill:0%}
input[type=range]::-webkit-slider-runnable-track{height:4px;border-radius:2px;background:linear-gradient(to right,var(--h-accent) var(--hui-fill),var(--h-border-strong,var(--h-border)) var(--hui-fill))}
input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:22px;height:22px;margin-top:-9px;border-radius:50%;background:var(--h-accent);border:3px solid var(--h-surface);box-shadow:0 1px 4px rgba(0,0,0,.28)}
input[type=range]::-moz-range-track{height:4px;border-radius:2px;background:var(--h-border-strong,var(--h-border))}
input[type=range]::-moz-range-progress{height:4px;border-radius:2px;background:var(--h-accent)}
input[type=range]::-moz-range-thumb{width:16px;height:16px;border-radius:50%;background:var(--h-accent);border:3px solid var(--h-surface);box-shadow:0 1px 4px rgba(0,0,0,.28)}
input[type=range]:focus{box-shadow:none}
.card{background:var(--h-surface);border:1px solid var(--h-border);border-radius:var(--h-radius);padding:14px 16px;margin:.5em 0}
.card>:first-child{margin-top:0}.card>:last-child{margin-bottom:0}
.row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.stack{display:flex;flex-direction:column;gap:10px}
.grid{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(min(100%,140px),1fr))}
/* design review P1-1 (390 pt): a wide child (4-column table, long number) must not widen a grid/flex track and
   make the whole card scroll sideways; it shrinks or scrolls inside itself instead. min-width:0 only changes
   grid/flex items (auto = 0 elsewhere); :where() keeps it at zero specificity, so any model rule still wins. */
:where(#hui-root) *{min-width:0}
:where(#hui-root) :is(.card,.row,.stack,.grid,section,article,form,fieldset,figure){max-width:100%}
.stat{display:flex;flex-direction:column;gap:2px;padding:10px 12px;border-radius:var(--h-radius-sm,8px);background:var(--h-surface-alt,var(--h-surface))}
.stat-label{color:var(--h-muted);font-size:.82em}
.stat-value{font-size:1.45em;font-weight:600;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.badge{display:inline-block;padding:.15em .55em;border-radius:999px;font-size:.78em;font-weight:500;background:var(--h-accent-soft,var(--h-surface-alt));color:var(--h-accent)}
.success{color:var(--h-success)}.warning{color:var(--h-warning)}.danger{color:var(--h-danger)}
@keyframes hui-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
@keyframes hui-fade{from{opacity:0}to{opacity:1}}
.hui-enter{animation:hui-in .26s ease-out both}
.hui-enter-fade{animation:hui-fade .26s ease-out both}
@media (prefers-reduced-motion:reduce){.hui-enter,.hui-enter-fade{animation:none}*{scroll-behavior:auto!important}}
`;

/** Applied after the model CSS: the document must size to its content for auto-height. */
const OVERRIDE_CSS = 'html,body{height:auto!important;min-height:0!important;max-height:none!important}';

/** Host -> shell message (web iframe only) that transfers the private tap port. Exact string, never parsed. */
export const FRAME_INIT_MESSAGE = '{"t":"hui-init"}';
/** Shell -> host message on the private port: one real tap (pointer down + up) inside the widget. */
export const FRAME_TAP_MESSAGE = 'tap';
/** Same thresholds as the native gate (actionGate.ts TAP_MAX_MOVE_PX / TAP_MAX_MS; shell.ts stays import-free). */
export const SHELL_TAP_MAX_MOVE_PX = 10;
export const SHELL_TAP_MAX_MS = 1_000;

/**
 * Pure tap classifier, shipped inside the shell runtime and evaluated by the tests. Only arithmetic and own
 * properties of a plain object the shell built itself: no Math.*, no prototype lookups model code could patch.
 * g = { trusted, cancelled, dist2 (max squared movement, px^2), ms (press duration) }.
 */
export const TAP_CLASSIFIER_JS = String.raw`
function huiClassifyTap(g, maxMove, maxMs) {
  if (!g || g.trusted !== true) return 'untrusted';
  if (g.cancelled === true) return 'scroll';
  if (!(typeof g.dist2 === 'number' && g.dist2 <= maxMove * maxMove)) return 'scroll';
  if (!(typeof g.ms === 'number' && g.ms >= 0 && g.ms <= maxMs)) return 'long';
  return 'tap';
}
function huiClassifyKey(k) {
  // keyboard activation (GPT security M1 / Astra F15: focus alone never authorizes; keyboard users get this instead)
  if (!k || k.trusted !== true || k.repeat === true) return 'untrusted';
  if (k.key === 'Enter') return 'tap';
  if (k.key === ' ' && k.buttonLike === true) return 'tap';
  return 'none';
}`;

/**
 * Shell runtime (plain ES2017 in a string: Hermes compiles app code to bytecode, so
 * Function#toString can't be used to ship it). Installs window.hermes, error capture,
 * autosize, link/submit/dialog interception, and the host message receiver.
 */
export const SHELL_RUNTIME_JS = String.raw`
(function () {
  'use strict';
  var root = document.getElementById('hui-root');
  var userCss = document.getElementById('hui-user-css');
  var themeEl = document.getElementById('hui-theme');
  var RN = window.ReactNativeWebView;
  var parentWin = window.parent;
  var addDoc = document.addEventListener;
  var addWin = window.addEventListener;
  var S = { finalized: false, painted: false, running: false, body: null, css: null, errors: 0, lastH: -1, timer: 0 };
  var XHTML = 'http://www.w3.org/1999/xhtml';
  var SVGNS = 'http://www.w3.org/2000/svg';
  var reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // ---------------------------------------------------------------- trusted tap channel (web iframe)
  // On web the shell is the only tap authority (GPT security M1 / Astra F15: focus moving into the iframe is not
  // consent): it reports real taps and keyboard activations over a MessagePort the host transfers in its init. This
  // runs before any model code (no render has been sent yet when the init arrives, see HtmlFrame.web.tsx) and
  // keeps private references to everything it uses later, so patched prototypes/globals can't fool or leak it.
  // Native WebViews never send the init: there the port stays null and the host watches touches itself.
  var apply = Reflect.apply;
  var gpd = Object.getOwnPropertyDescriptor;
  function getter(proto, name) { var d = proto ? gpd(proto, name) : null; return d && typeof d.get === 'function' ? d.get : null; }
  function rd(g, o) { return g && o ? apply(g, o, []) : undefined; }
  var EvP = Event.prototype;
  var stopImm = EvP.stopImmediatePropagation;
  var gStamp = getter(EvP, 'timeStamp');
  var MEP = window.MouseEvent ? MouseEvent.prototype : null;
  var gScrX = getter(MEP, 'screenX'), gScrY = getter(MEP, 'screenY'), gCliX = getter(MEP, 'clientX'), gCliY = getter(MEP, 'clientY');
  var gBtn = getter(MEP, 'button');
  var PEP = window.PointerEvent ? PointerEvent.prototype : null;
  var gPid = getter(PEP, 'pointerId'), gPrimary = getter(PEP, 'isPrimary');
  var TEP = window.TouchEvent ? TouchEvent.prototype : null;
  var gChanged = getter(TEP, 'changedTouches'), gTouches = getter(TEP, 'touches');
  var TLP = window.TouchList ? TouchList.prototype : null;
  var tlItem = TLP ? TLP.item : null, gTlLen = getter(TLP, 'length');
  var TP = window.Touch ? Touch.prototype : null;
  var gTId = getter(TP, 'identifier'), gTScrX = getter(TP, 'screenX'), gTScrY = getter(TP, 'screenY'), gTCliX = getter(TP, 'clientX'), gTCliY = getter(TP, 'clientY');
  var KEP = window.KeyboardEvent ? KeyboardEvent.prototype : null;
  var gKey = getter(KEP, 'key'), gRepeat = getter(KEP, 'repeat'), gTarget = getter(EvP, 'target');
  var gTag = getter(window.Element ? Element.prototype : null, 'tagName');
  var getAttr = window.Element ? Element.prototype.getAttribute : null;
  var MsgP = window.MessageEvent ? MessageEvent.prototype : null;
  var gMsgData = getter(MsgP, 'data'), gMsgSource = getter(MsgP, 'source'), gMsgPorts = getter(MsgP, 'ports');
  var portPost = window.MessagePort ? MessagePort.prototype.postMessage : null;
  var INIT = ${JSON.stringify(FRAME_INIT_MESSAGE)}, TAP = ${JSON.stringify(FRAME_TAP_MESSAGE)};
  var TAP_MOVE = ${SHELL_TAP_MAX_MOVE_PX}, TAP_MS = ${SHELL_TAP_MAX_MS};
  var tapPort = null;
  ${TAP_CLASSIFIER_JS}

  // Registered before anything else can listen: the init (and its port) never reaches model listeners.
  apply(addWin, window, ['message', function (e) {
    if (e.isTrusted !== true || rd(gMsgData, e) !== INIT) return;
    apply(stopImm, e, []);
    var ports = rd(gMsgPorts, e);
    if (tapPort || rd(gMsgSource, e) !== parentWin || parentWin === window || !ports || ports.length !== 1) return;
    tapPort = ports[0]; // first init only; nothing is received on it, so no start()/onmessage needed
  }, true]);

  // g: the press being tracked (one pointer / finger at a time; a second one makes it a pinch, never a tap)
  var g = null, lastTouchEnd = -1e9;
  function begin(id, sx, sy, cx, cy, t) { g = { id: id, sx: sx, sy: sy, cx: cx, cy: cy, t: t, dist2: 0, cancelled: false }; }
  function track(sx, sy, cx, cy) {
    // screen AND client deltas: while the chat scrolls, the iframe moves with the finger (client delta ~0)
    var a = sx - g.sx, b = sy - g.sy, c = cx - g.cx, d = cy - g.cy;
    var m = a * a + b * b, n = c * c + d * d;
    if (!(m <= g.dist2)) g.dist2 = m === m ? m : Infinity;
    if (!(n <= g.dist2)) g.dist2 = n === n ? n : Infinity;
  }
  function finish(trusted, t) {
    var p = g; g = null;
    var verdict = huiClassifyTap({ trusted: trusted, cancelled: p.cancelled, dist2: p.dist2, ms: t - p.t }, TAP_MOVE, TAP_MS);
    if (verdict === 'tap' && tapPort && portPost) { try { apply(portPost, tapPort, [TAP]); } catch (e) {} }
  }
  function onTrusted(fn) { return function (e) { if (e.isTrusted === true) fn(e); }; }
  var cap = { capture: true, passive: true };
  function buttonLike(el) {
    var tag = el && gTag ? String(rd(gTag, el)).toUpperCase() : '';
    if (tag === 'BUTTON' || tag === 'SUMMARY') return true;
    var type = tag === 'INPUT' && getAttr ? String(apply(getAttr, el, ['type']) || '').toLowerCase() : '';
    if (type === 'button' || type === 'submit' || type === 'checkbox' || type === 'radio' || type === 'reset') return true;
    return !!(tag && getAttr && apply(getAttr, el, ['role']) === 'button');
  }
  apply(addWin, window, ['keydown', function (e) {
    var verdict = huiClassifyKey({ trusted: e.isTrusted === true, repeat: rd(gRepeat, e) === true, key: rd(gKey, e), buttonLike: buttonLike(rd(gTarget, e)) });
    if (verdict === 'tap' && tapPort && portPost) { try { apply(portPost, tapPort, [TAP]); } catch (err) {} }
  }, cap]);
  if (PEP) {
    apply(addWin, window, ['pointerdown', onTrusted(function (e) {
      // a non-primary pointer is a second finger (pinch): the press in progress is no tap. A new primary pointer
      // starts over (drops a press whose pointerup never reached us, e.g. mouse released outside the iframe).
      if (rd(gPrimary, e) !== true) { if (g) g.cancelled = true; return; }
      if (rd(gBtn, e) !== 0) { g = null; return; }
      begin(rd(gPid, e), rd(gScrX, e), rd(gScrY, e), rd(gCliX, e), rd(gCliY, e), rd(gStamp, e));
    }), cap]);
    apply(addWin, window, ['pointermove', onTrusted(function (e) {
      if (g && rd(gPid, e) === g.id) track(rd(gScrX, e), rd(gScrY, e), rd(gCliX, e), rd(gCliY, e));
    }), cap]);
    apply(addWin, window, ['pointerup', onTrusted(function (e) {
      if (!g || rd(gPid, e) !== g.id) return;
      track(rd(gScrX, e), rd(gScrY, e), rd(gCliX, e), rd(gCliY, e));
      finish(true, rd(gStamp, e));
    }), cap]);
    // the browser took the gesture over (scroll / zoom): never a tap
    apply(addWin, window, ['pointercancel', onTrusted(function () { g = null; }), cap]);
  } else {
    // no Pointer Events (very old WebKit): touch events, plus mouse for desktop; compat mouse events after a touch are ignored
    var touch0 = function (e, list) {
      var l = rd(list, e);
      var n = rd(gTlLen, l) || 0;
      for (var i = 0; i < n; i++) {
        var t = apply(tlItem, l, [i]);
        if (!g || rd(gTId, t) === g.id) return t;
      }
      return null;
    };
    apply(addWin, window, ['touchstart', onTrusted(function (e) {
      if ((rd(gTlLen, rd(gTouches, e)) || 0) > 1) { if (g) g.cancelled = true; return; }
      g = null;
      var t = touch0(e, gChanged);
      if (t) begin(rd(gTId, t), rd(gTScrX, t), rd(gTScrY, t), rd(gTCliX, t), rd(gTCliY, t), rd(gStamp, e));
    }), cap]);
    apply(addWin, window, ['touchmove', onTrusted(function (e) {
      var t = g ? touch0(e, gChanged) : null;
      if (t) track(rd(gTScrX, t), rd(gTScrY, t), rd(gTCliX, t), rd(gTCliY, t));
    }), cap]);
    apply(addWin, window, ['touchend', onTrusted(function (e) {
      var t = g ? touch0(e, gChanged) : null;
      if (!t) return;
      track(rd(gTScrX, t), rd(gTScrY, t), rd(gTCliX, t), rd(gTCliY, t));
      lastTouchEnd = rd(gStamp, e);
      finish(true, lastTouchEnd);
    }), cap]);
    apply(addWin, window, ['touchcancel', onTrusted(function () { g = null; }), cap]);
    apply(addWin, window, ['mousedown', onTrusted(function (e) {
      if (rd(gBtn, e) !== 0 || rd(gStamp, e) - lastTouchEnd < 1000) return;
      begin('mouse', rd(gScrX, e), rd(gScrY, e), rd(gCliX, e), rd(gCliY, e), rd(gStamp, e));
    }), cap]);
    apply(addWin, window, ['mousemove', onTrusted(function (e) {
      if (g && g.id === 'mouse') track(rd(gScrX, e), rd(gScrY, e), rd(gCliX, e), rd(gCliY, e));
    }), cap]);
    apply(addWin, window, ['mouseup', onTrusted(function (e) {
      if (!g || g.id !== 'mouse') return;
      track(rd(gScrX, e), rd(gScrY, e), rd(gCliX, e), rd(gCliY, e));
      finish(true, rd(gStamp, e));
    }), cap]);
  }

  function post(m) {
    try {
      var s = JSON.stringify(m);
      var rn = RN || window.ReactNativeWebView;
      if (rn && typeof rn.postMessage === 'function') rn.postMessage(s);
      else if (parentWin && parentWin !== window) parentWin.postMessage(s, '*');
    } catch (e) {}
  }

  // ---------------------------------------------------------------- errors
  // Visible error texts come from the app (translated): {"error","atLine","unknownError",...}
  var L = {};
  try { L = JSON.parse(document.getElementById('hui-labels').textContent) || {}; } catch (e) {}
  function fill(tpl, v) {
    return String(tpl || '').replace(/\{(\w+)\}/g, function (_, k) { return v[k] != null ? String(v[k]) : ''; });
  }
  function report(msg) {
    if (!S.finalized || S.errors >= 3) return;
    S.errors++;
    post({ t: 'error', message: String(msg || L.unknownError || '').slice(0, 300) });
  }
  addWin.call(window, 'error', function (ev) {
    var t = ev.target;
    if (t && t !== window && t.tagName) {
      if (t.tagName === 'SCRIPT') report(fill(L.scriptFailed, { src: t.src || 'inline' }));
      return; // failed images / tiles / stylesheets are not fatal
    }
    report((ev.message || L.error || '') + (ev.lineno ? ' ' + fill(L.atLine, { line: ev.lineno }) : ''));
  }, true);
  addWin.call(window, 'unhandledrejection', function (ev) {
    var r = ev.reason;
    report(fill(L.promiseRejected, { reason: r && r.message ? r.message : String(r) }));
  });

  // ---------------------------------------------------------------- autosize
  function measure() {
    S.timer = 0;
    var cs = getComputedStyle(document.body);
    var h = root.getBoundingClientRect().bottom + (window.scrollY || 0) +
      (parseFloat(cs.paddingBottom) || 0) + (parseFloat(cs.borderBottomWidth) || 0) + (parseFloat(cs.marginBottom) || 0);
    h = Math.ceil(h);
    if (h !== S.lastH) { S.lastH = h; post({ t: 'height', h: h }); }
    if (!S.painted && h > 2 && (root.children.length > 0 || /\S/.test(root.textContent || ''))) {
      S.painted = true;
      post({ t: 'paint' });
    }
  }
  function schedule() { if (!S.timer) S.timer = setTimeout(measure, 16); }
  if (window.ResizeObserver) new ResizeObserver(schedule).observe(root);
  else setInterval(schedule, 300);
  addWin.call(window, 'resize', schedule);

  // ---------------------------------------------------------------- theme
  function applyTheme(css, scheme) {
    themeEl.textContent = ':root{' + css.replace(/[<>{}\\]/g, '') + '}';
    document.documentElement.setAttribute('data-scheme', scheme === 'dark' ? 'dark' : 'light');
  }

  // ---------------------------------------------------------------- morph
  function markEnter(node) {
    if (reduced || !node || node.nodeType !== 1) return;
    var cls = node.namespaceURI === XHTML ? 'hui-enter' : node.namespaceURI === SVGNS ? 'hui-enter-fade' : '';
    if (!cls) return;
    node.classList.add(cls);
    node.addEventListener('animationend', function () {
      node.classList.remove(cls);
      if (node.getAttribute('class') === '') node.removeAttribute('class');
    }, { once: true });
  }
  var morphOpts = {
    morphStyle: 'innerHTML',
    callbacks: {
      beforeNodeAdded: function (n) { markEnter(n); return true; },
      beforeAttributeUpdated: function (name, node) {
        // keep our enter-animation class while it plays
        if (name === 'class' && node.classList && (node.classList.contains('hui-enter') || node.classList.contains('hui-enter-fade'))) return false;
        return true;
      }
    }
  };
  function morph(html) {
    if (window.Idiomorph && window.Idiomorph.morph) {
      try { window.Idiomorph.morph(root, html, morphOpts); return; } catch (e) {}
    }
    root.innerHTML = html;
  }

  // ---------------------------------------------------------------- range fill
  function fillRange(el) {
    var min = parseFloat(el.min); if (!isFinite(min)) min = 0;
    var max = parseFloat(el.max); if (!isFinite(max)) max = 100;
    var v = parseFloat(el.value); if (!isFinite(v)) v = min;
    var p = max > min ? (v - min) / (max - min) * 100 : 0;
    el.style.setProperty('--hui-fill', Math.max(0, Math.min(100, p)) + '%');
  }
  function syncRanges() {
    if (!S.finalized) return;
    var list = root.querySelectorAll('input[type=range]');
    for (var i = 0; i < list.length; i++) fillRange(list[i]);
  }
  ['input', 'change', 'click', 'reset'].forEach(function (type) {
    addDoc.call(document, type, function (ev) {
      if (type === 'input' && ev.target && ev.target.type === 'range') fillRange(ev.target);
      else setTimeout(syncRanges, 0);
    }, true);
  });

  // ---------------------------------------------------------------- bridge
  function gestureOk() { var ua = navigator.userActivation; return !ua || ua.isActive; }
  function act(a) {
    if (!S.finalized) return false;
    if (!gestureOk()) { try { console.warn('[hermes] Aktion ohne Nutzerinteraktion blockiert'); } catch (e) {} return false; }
    post({ t: 'action', action: a });
    return true;
  }
  var hermes = Object.freeze({
    version: 1,
    send: function (text) {
      text = String(text == null ? '' : text).trim();
      return text ? act({ type: 'send', text: text.slice(0, 4000) }) : false;
    },
    copy: function (text) {
      text = String(text == null ? '' : text);
      return text ? act({ type: 'copy', text: text.slice(0, 32000) }) : false;
    },
    openUrl: function (url) {
      url = String(url == null ? '' : url).trim();
      return url ? act({ type: 'open_url', url: url.slice(0, 2048) }) : false;
    }
  });
  try { Object.defineProperty(window, 'hermes', { value: hermes, writable: false, configurable: false, enumerable: true }); }
  catch (e) { window.hermes = hermes; }
  // compatibility with OpenIntelligentUI-style widgets
  function ok(v, what) { return v ? Promise.resolve({ ok: true }) : Promise.reject(new Error(what + ' blockiert')); }
  window.Websandbox = { connection: { remote: {
    sendPrompt: function (a) { return ok(hermes.send(a && a.text), 'sendPrompt'); },
    openLink: function (a) { return ok(hermes.openUrl(a && a.url), 'openLink'); }
  } } };

  // links never navigate the sandbox: in-page anchors scroll, everything else -> openUrl
  addDoc.call(document, 'click', function (ev) {
    if (ev.defaultPrevented) return;
    var t = ev.target;
    var a = t && t.closest ? t.closest('a') : null;
    if (!a) return;
    var href = a.getAttribute('href') || a.getAttribute('xlink:href') || '';
    ev.preventDefault();
    if (!href) return;
    if (href.charAt(0) === '#') {
      var el = href.length > 1 ? document.getElementById(decodeURIComponent(href.slice(1))) : null;
      if (el) el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
      return;
    }
    hermes.openUrl(href);
  });
  addWin.call(window, 'submit', function (ev) { ev.preventDefault(); });
  window.open = function (u) { if (u) hermes.openUrl(String(u)); return null; };
  window.alert = function (m) { try { console.log('[alert]', m); } catch (e) {} };
  window.confirm = function () { return true; };
  window.prompt = function () { return null; };
  window.print = function () {};
  document.write = document.writeln = function () {
    root.insertAdjacentHTML('beforeend', Array.prototype.join.call(arguments, ''));
  };
  // WebRTC is not covered by CSP (STUN/TURN to arbitrary hosts) -> remove it
  ['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel'].forEach(function (k) {
    try { Object.defineProperty(window, k, { value: undefined, writable: false, configurable: false }); } catch (e) {}
  });
  // storage: the sandbox has none; give widgets a throwaway in-memory Storage instead of throwing
  function memStorage() {
    var m = {};
    return {
      get length() { return Object.keys(m).length; },
      key: function (i) { return Object.keys(m)[i] || null; },
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
      setItem: function (k, v) { m[k] = String(v); },
      removeItem: function (k) { delete m[k]; },
      clear: function () { m = {}; }
    };
  }
  ['localStorage', 'sessionStorage'].forEach(function (k) {
    var works = false;
    try { works = !!window[k] && (window[k].getItem('__hui') , true); } catch (e) {}
    if (!works) { try { Object.defineProperty(window, k, { value: memStorage(), configurable: true }); } catch (e) {} }
  });

  // ---------------------------------------------------------------- scripts
  // The shell document finished loading long ago: listeners for DOMContentLoaded / load that
  // model scripts register would never fire. Queue them and call them after all scripts ran.
  var deferred = [];
  function callListener(target, fn, type) {
    var ev = new Event(type);
    try {
      if (typeof fn === 'function') fn.call(target, ev);
      else if (fn && typeof fn.handleEvent === 'function') fn.handleEvent(ev);
    } catch (e) { report(e && e.message ? e.message : String(e)); }
  }
  function wrapAdd(target, orig) {
    return function (type, fn) {
      if ((type === 'DOMContentLoaded' || type === 'load') && this === target) {
        if (!fn) return;
        if (S.running) deferred.push([target, fn, type]);
        else setTimeout(function () { callListener(target, fn, type); }, 0);
        return;
      }
      return orig.apply(this, arguments);
    };
  }
  document.addEventListener = wrapAdd(document, addDoc);
  window.addEventListener = wrapAdd(window, addWin);

  function runScripts(list, done) {
    S.running = true;
    var i = 0;
    var onloadBefore = window.onload;
    function finish() {
      S.running = false;
      var q = deferred; deferred = [];
      q.forEach(function (d) { callListener(d[0], d[1], d[2]); });
      if (typeof window.onload === 'function' && window.onload !== onloadBefore) callListener(window, window.onload, 'load');
      done();
    }
    function next() {
      if (i >= list.length) { finish(); return; }
      var s = list[i++] || {};
      var el = document.createElement('script');
      if (s.module) el.type = 'module';
      if (s.src) {
        var fired = false, timer = 0;
        var go = function () { if (fired) return; fired = true; clearTimeout(timer); next(); };
        timer = setTimeout(go, 15000);
        el.onload = go;
        el.onerror = go; // reported by the capturing error listener
        el.src = String(s.src);
        document.head.appendChild(el);
      } else {
        el.textContent = String(s.code || '');
        document.head.appendChild(el); // classic inline scripts run synchronously here
        next();
      }
    }
    next();
  }

  // ---------------------------------------------------------------- host messages
  function receive(raw) {
    var m;
    try { m = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'theme') { applyTheme(String(m.css || ''), m.scheme); schedule(); return; }
    if (m.t !== 'render' || S.finalized) return;
    var css = String(m.css || '');
    if (css !== S.css) { S.css = css; userCss.textContent = css; }
    var body = String(m.body || '');
    if (body !== S.body) { S.body = body; morph(body); }
    schedule();
    if (m.final) {
      S.finalized = true;
      document.body.classList.remove('hui-streaming');
      var a = document.activeElement;
      if (a && a !== document.body && a.blur) a.blur(); // no surprise keyboard from autofocus
      runScripts(Array.isArray(m.scripts) ? m.scripts : [], function () {
        syncRanges();
        schedule();
        setTimeout(function () { measure(); post({ t: 'done' }); }, 30);
      });
    }
  }
  try { Object.defineProperty(window, '__hui', { value: Object.freeze({ receive: receive }), writable: false, configurable: false }); }
  catch (e) {}
  addWin.call(window, 'message', function (e) {
    if (parentWin && parentWin !== window && e.source === parentWin) receive(e.data);
  });

  post({ t: 'ready' });
  schedule();
})();
`;

/** Texts the shell shows in its error reports (translated by the app, see shellLabels). */
export type ShellLabels = {
  error: string;
  atLine: string;
  unknownError: string;
  scriptFailed: string;
  promiseRejected: string;
};

export function shellLabels(t: TFn): ShellLabels {
  return {
    error: t('sandbox.shell.error'),
    atLine: t('sandbox.shell.atLine'),
    unknownError: t('sandbox.error.unknown'),
    scriptFailed: t('sandbox.shell.scriptFailed'),
    promiseRejected: t('sandbox.shell.promiseRejected'),
  };
}

export type ShellOptions = {
  /** CSS declaration list for :root (e.g. `cssVariables(theme)` from ../ui). */
  themeCss: string;
  /** Error report texts; build with `shellLabels(t)`. */
  labels: ShellLabels;
  scheme: 'light' | 'dark';
  /** IDIOMORPH_JS from ./idiomorph (passed in to keep this module dependency-free). */
  idiomorphJs: string;
  /** Paint the root with --h-bg (web iframe: Chrome draws an opaque backdrop behind
   *  transparent iframes whose color-scheme differs from the host page's). */
  opaqueBackground?: boolean;
};

export function buildShellDocument({ themeCss, scheme, idiomorphJs, opaqueBackground = false, labels }: ShellOptions): string {
  // JSON in a non-executing <script> element; `<` is escaped so the text cannot end the element.
  const labelsJson = JSON.stringify(labels).replace(/</g, '\\u003c');
  return (
    '<!DOCTYPE html><html lang="de" data-scheme="' + (scheme === 'dark' ? 'dark' : 'light') + '"><head>' +
    '<meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${buildCsp()}">` +
    '<meta http-equiv="x-dns-prefetch-control" content="off">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">' +
    `<style id="hui-theme">:root{${sanitizeThemeCss(themeCss)}}</style>` +
    `<style id="hui-base">${BASE_CSS}</style>` +
    '<style id="hui-user-css"></style>' +
    `<style id="hui-override">${OVERRIDE_CSS}${opaqueBackground ? 'html{background:var(--h-bg)!important}' : ''}</style>` +
    '</head><body class="hui-streaming"><div id="hui-root"></div>' +
    `<script id="hui-labels" type="application/json">${labelsJson}</script>` +
    `<script>${idiomorphJs}</script>` +
    `<script>${SHELL_RUNTIME_JS}</script>` +
    '</body></html>'
  );
}
