/**
 * TRUSTED built-in Leaflet document for the `map` node (never model HTML). Pure strings, no RN
 * imports (tested with node:test).
 *
 * The document is completely STATIC: model data (markers, titles) never becomes part of the HTML.
 * It is delivered afterwards as a JSON message (`{t:'init', …}`) and rendered with `textContent`
 * only. Security posture matches app/src/sandbox (same HtmlFrame: opaque origin, no storage,
 * navigation refused, locked WebView props) with an even tighter CSP: scripts/styles only inline
 * + unpkg (Leaflet 1.9.4, pinned with SRI), images only OSM tiles from `tile.openstreetmap.de`
 * (works without Referer, see sandbox/README "Map tiles"), no connect/frames/forms.
 *
 * Host → map messages (via `window.__hui.receive(json)`, same transport as the sandbox shell):
 *   {t:'init', markers:[{lat,lng,n,title,description?}], route, animate, reduced, final?, center?, zoom?, colors, dark, durationMs}
 *   {t:'select', i} · {t:'play'} · {t:'pause'} · {t:'replay'} · {t:'explore', on} · {t:'theme', colors, dark}
 * Map → host: see `MapMessage` in mapModel.ts.
 */

export const LEAFLET_VERSION = '1.9.4';
export const LEAFLET_JS = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.js`;
export const LEAFLET_CSS = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.css`;
/** Subresource integrity of the pinned files (verified against unpkg 2026-10). */
export const LEAFLET_JS_SRI = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';
export const LEAFLET_CSS_SRI = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';

export const TILE_ORIGIN = 'https://tile.openstreetmap.de';
export const TILE_URL = `${TILE_ORIGIN}/{z}/{x}/{y}.png`;
export const TILE_ATTRIBUTION = '© OpenStreetMap contributors';

export function buildMapCsp(): string {
  return [
    "default-src 'none'",
    "script-src 'unsafe-inline' https://unpkg.com",
    "style-src 'unsafe-inline' https://unpkg.com",
    `img-src data: ${TILE_ORIGIN}`,
    "connect-src 'none'",
    "font-src 'none'",
    "media-src 'none'",
    "frame-src 'none'",
    "child-src 'none'",
    "worker-src 'none'",
    "object-src 'none'",
    "manifest-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

export type MapColors = { accent: string; onAccent: string; text: string; muted: string; surface: string; border: string; bg: string };

export type MapHostMessage =
  | {
      t: 'init';
      markers: { lat: number; lng: number; n: number; title: string; description?: string }[];
      route: boolean;
      animate: boolean;
      reduced: boolean;
      /** start in the completed state (animation already played once) */
      final?: boolean;
      center?: { lat: number; lng: number };
      zoom?: number;
      colors: MapColors;
      dark: boolean;
      durationMs: number;
    }
  | { t: 'select'; i: number }
  | { t: 'play' }
  | { t: 'pause' }
  | { t: 'replay' }
  | { t: 'explore'; on: boolean }
  | { t: 'theme'; colors: MapColors; dark: boolean };

/**
 * Animation math as ES5 source (runs inside the WebView). MUST stay equivalent to
 * tripFrame / pinLanding / pinPose / seekProgress in mapModel.ts – mapModel.test.ts compares them.
 */
export const MAP_ANIM_JS = String.raw`
function tripFrame(progress, n) {
  var p = Math.min(1, Math.max(0, isFinite(progress) ? progress : 0));
  var pinStep = p * n;
  var pinIndex = Math.min(n - 1, Math.floor(pinStep));
  var pinProgress = p === 1 ? 1 : Math.min(1, (pinStep - pinIndex) / 0.55);
  return { progress: p, pinIndex: pinIndex, pinProgress: pinProgress };
}
function pinLanding(f, i) { return i < f.pinIndex ? 1 : i === f.pinIndex ? f.pinProgress : 0; }
function pinPose(landing) {
  var t = landing - 1;
  var ease = 1 + 2.2 * t * t * t + 1.2 * t * t;
  return { opacity: landing > 0 ? 1 : 0, dy: -18 * (1 - ease), scale: 0.72 + 0.28 * ease };
}
function seekProgress(i, n) {
  if (n <= 1 || i >= n - 1) return 1;
  return Math.max(0, (i + 0.6) / n);
}
`;

const CSS = `
html,body{margin:0;padding:0;height:100%;background:transparent;-webkit-tap-highlight-color:transparent;overflow:hidden}
body{font:13px/1.35 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--text)}
#map{position:absolute;inset:0;background:var(--surface)}
.leaflet-container{background:var(--surface);font:inherit}
.dark .leaflet-tile-pane{filter:invert(1) hue-rotate(180deg) brightness(.92) contrast(.88) saturate(.7)}
.hm-wrap{background:none;border:0}
.hm-pin{position:relative;width:28px;height:36px;transform-origin:50% 100%;will-change:transform,opacity}
.hm-pin .hm-dot{position:absolute;left:0;top:0;width:28px;height:28px;border-radius:50%;background:var(--accent);color:var(--on-accent);
  display:flex;align-items:center;justify-content:center;font-weight:600;font-size:13px;box-shadow:0 1px 4px rgba(0,0,0,.35);border:2px solid #fff;box-sizing:border-box;font-variant-numeric:tabular-nums}
.hm-pin .hm-tip{position:absolute;left:10px;top:24px;width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;border-top:9px solid var(--accent)}
.hm-pin.hm-active .hm-dot{transform:scale(1.18);box-shadow:0 0 0 4px var(--accent-ring),0 2px 6px rgba(0,0,0,.4)}
.hm-pin .hm-dot{transition:transform .18s ease,box-shadow .18s ease}
.leaflet-popup-content-wrapper,.leaflet-popup-tip{background:var(--surface);color:var(--text);box-shadow:0 3px 14px rgba(0,0,0,.25)}
.leaflet-popup-content{margin:10px 12px;max-width:220px}
.hm-pt{font-weight:600;font-size:14px;margin:0 0 2px}
.hm-pd{color:var(--muted);font-size:12.5px}
.leaflet-control-attribution{background:rgba(255,255,255,.8)!important;color:#333!important;font-size:10px!important}
.dark .leaflet-control-attribution{background:rgba(0,0,0,.55)!important;color:#ddd!important}
.leaflet-control-zoom a{background:var(--surface)!important;color:var(--text)!important;border-color:var(--border)!important}
.leaflet-popup-close-button{color:var(--muted)!important}
@media (prefers-reduced-motion: reduce){.hm-pin .hm-dot{transition:none}}
`;

const RUNTIME_JS = String.raw`
(function () {
  'use strict';
  var RN = window.ReactNativeWebView;
  var parentWin = window.parent;
  function post(m) {
    try {
      var s = JSON.stringify(m);
      if (RN && typeof RN.postMessage === 'function') RN.postMessage(s);
      else if (parentWin && parentWin !== window) parentWin.postMessage(s, '*');
    } catch (e) {}
  }
  ${MAP_ANIM_JS}
  // no navigation, no popups, no dialogs
  window.open = function () { return null; };
  window.alert = window.confirm = window.prompt = function () { return null; };
  document.addEventListener('click', function (ev) {
    var a = ev.target && ev.target.closest ? ev.target.closest('a') : null;
    if (a && !a.classList.contains('leaflet-control-zoom-in') && !a.classList.contains('leaflet-control-zoom-out') && !a.classList.contains('leaflet-popup-close-button')) ev.preventDefault();
  }, true);

  var S = { map: null, tiles: null, pins: [], markers: [], segs: [], data: null, anim: null, active: -1, started: false, tilesOk: 0, tilesErr: 0, tileState: '' };

  function setColors(c, dark) {
    var r = document.documentElement.style;
    r.setProperty('--accent', c.accent); r.setProperty('--on-accent', c.onAccent); r.setProperty('--text', c.text);
    r.setProperty('--muted', c.muted); r.setProperty('--surface', c.surface); r.setProperty('--border', c.border);
    r.setProperty('--accent-ring', c.accent + '55');
    document.documentElement.className = dark ? 'dark' : '';
    for (var i = 0; i < S.segs.length; i++) S.segs[i].setStyle({ color: c.accent });
  }

  function tileState(s) { if (S.tileState !== s) { S.tileState = s; post({ t: 'tiles', s: s }); } }

  function setActive(i) {
    if (S.active === i) return;
    if (S.pins[S.active]) S.pins[S.active].classList.remove('hm-active');
    S.active = i;
    if (S.pins[i]) S.pins[i].classList.add('hm-active');
  }

  // ---------------------------------------------------------------- animation (OIUI trip animator)
  function Anim(n, duration) {
    this.n = n; this.duration = duration; this.elapsed = 0; this.last = null; this.raf = 0; this.playing = false; this.lastActive = -1;
  }
  Anim.prototype.apply = function () {
    var f = tripFrame(this.elapsed / this.duration, this.n);
    for (var i = 0; i < S.pins.length; i++) {
      var pose = pinPose(pinLanding(f, i));
      S.pins[i].style.opacity = String(pose.opacity);
      S.pins[i].style.transform = 'translateY(' + pose.dy.toFixed(2) + 'px) scale(' + pose.scale.toFixed(3) + ')';
    }
    for (var k = 0; k < S.segs.length; k++) S.segs[k].setStyle({ opacity: pinLanding(f, k + 1) >= 0.7 ? 0.85 : 0 });
    if (f.pinIndex !== this.lastActive) { this.lastActive = f.pinIndex; setActive(f.pinIndex); post({ t: 'active', i: f.pinIndex }); }
  };
  Anim.prototype.state = function (s) { post({ t: 'anim', s: s }); };
  Anim.prototype.pause = function () {
    var was = this.playing;
    this.playing = false; this.last = null;
    if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0;
    if (was || this.elapsed < this.duration) this.state(this.elapsed >= this.duration ? 'complete' : 'paused');
  };
  Anim.prototype.tick = function (time) {
    if (!this.playing) return;
    if (this.last !== null) this.elapsed = Math.min(this.duration, this.elapsed + Math.max(0, time - this.last));
    this.last = time;
    this.apply();
    if (this.elapsed >= this.duration) { this.playing = false; this.raf = 0; this.state('complete'); return; }
    var self = this;
    this.raf = requestAnimationFrame(function (t) { self.tick(t); });
  };
  Anim.prototype.play = function () {
    if (this.playing) return;
    if (reduced()) { this.finish(); return; }
    if (this.elapsed >= this.duration) return;
    this.playing = true; this.last = null; this.state('playing');
    var self = this;
    this.raf = requestAnimationFrame(function (t) { self.tick(t); });
  };
  Anim.prototype.finish = function () {
    this.playing = false; if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0;
    this.elapsed = this.duration; this.apply(); this.state('complete');
  };
  Anim.prototype.seek = function (i) {
    this.playing = false; this.last = null; if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0;
    this.elapsed = this.duration * seekProgress(i, this.n); this.apply();
    this.state(this.elapsed >= this.duration ? 'complete' : 'paused');
  };
  Anim.prototype.replay = function () { this.pause(); this.elapsed = 0; this.lastActive = -1; this.apply(); this.play(); };

  function reduced() {
    if (S.data && S.data.reduced) return true;
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
  }
  document.addEventListener('visibilitychange', function () { if (document.hidden && S.anim) S.anim.pause(); });

  function startAnimOnce() {
    if (S.started || !S.anim) return;
    S.started = true;
    S.anim.play();
  }

  // ---------------------------------------------------------------- build
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; }

  function interact(on) {
    var m = S.map; if (!m) return;
    var hs = ['dragging', 'touchZoom', 'doubleClickZoom', 'scrollWheelZoom', 'boxZoom', 'keyboard'];
    for (var i = 0; i < hs.length; i++) { var h = m[hs[i]]; if (h) { if (on) h.enable(); else h.disable(); } }
  }

  function build(d) {
    S.data = d;
    setColors(d.colors, d.dark);
    if (!window.L) { post({ t: 'error', message: 'Kartenbibliothek konnte nicht geladen werden.' }); return; }
    var L = window.L;
    if (!S.map) {
      S.map = L.map('map', { zoomControl: true, attributionControl: true, dragging: false, touchZoom: false, doubleClickZoom: false,
        scrollWheelZoom: false, boxZoom: false, keyboard: false, tap: true, zoomSnap: 0.5, fadeAnimation: !reduced(), zoomAnimation: !reduced(), markerZoomAnimation: !reduced() });
      S.map.attributionControl.setPrefix(false);
      S.tiles = L.tileLayer(${JSON.stringify(TILE_URL)}, { maxZoom: 18, attribution: ${JSON.stringify(TILE_ATTRIBUTION)} });
      S.tiles.on('loading', function () { if (!S.tilesOk) tileState('loading'); });
      S.tiles.on('tileload', function () { S.tilesOk++; });
      S.tiles.on('tileerror', function () { S.tilesErr++; });
      S.tiles.on('load', function () {
        tileState(S.tilesOk > 0 ? 'loaded' : 'failed');
        startAnimOnce();
      });
      S.tiles.addTo(S.map);
      setTimeout(function () { if (!S.tilesOk) { tileState('failed'); startAnimOnce(); } }, 12000);
    }
    // markers (rebuilt on every init)
    for (var i = 0; i < S.markers.length; i++) S.map.removeLayer(S.markers[i]);
    for (var k = 0; k < S.segs.length; k++) S.map.removeLayer(S.segs[k]);
    S.markers = []; S.pins = []; S.segs = []; S.active = -1;
    var pts = [];
    d.markers.forEach(function (m, idx) {
      var pin = el('div', 'hm-pin');
      var dot = el('div', 'hm-dot', String(m.n));
      pin.appendChild(dot); pin.appendChild(el('div', 'hm-tip'));
      var icon = L.divIcon({ html: pin, className: 'hm-wrap', iconSize: [28, 36], iconAnchor: [14, 34], popupAnchor: [0, -32] });
      var mk = L.marker([m.lat, m.lng], { icon: icon, title: m.title, alt: m.n + '. ' + m.title, riseOnHover: true, keyboard: false });
      var pop = el('div');
      pop.appendChild(el('div', 'hm-pt', m.n + '. ' + m.title));
      if (m.description) pop.appendChild(el('div', 'hm-pd', m.description));
      mk.bindPopup(pop, { closeButton: true, autoPanPadding: [16, 16] });
      mk.on('click', function () {
        // scrub only while the animation is unfinished; afterwards just highlight
        if (S.anim && S.anim.elapsed < S.anim.duration) S.anim.seek(idx); else setActive(idx);
        post({ t: 'select', i: idx });
      });
      mk.addTo(S.map);
      S.markers.push(mk); S.pins.push(pin); pts.push([m.lat, m.lng]);
    });
    if (d.route && pts.length > 1) {
      for (var s = 0; s < pts.length - 1; s++) {
        var seg = L.polyline([pts[s], pts[s + 1]], { color: d.colors.accent, weight: 3, opacity: 0.85, dashArray: '6 7', interactive: false });
        seg.addTo(S.map); S.segs.push(seg);
      }
    }
    // camera: fit once, then fixed (never moved by the animation)
    if (d.center && d.zoom) S.map.setView([d.center.lat, d.center.lng], d.zoom, { animate: false });
    else if (pts.length === 1) S.map.setView(pts[0], d.zoom || 14, { animate: false });
    else if (pts.length > 1) S.map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: d.zoom || 15, animate: false });
    else S.map.setView([d.center ? d.center.lat : 50, d.center ? d.center.lng : 10], d.zoom || 4, { animate: false });
    // animation
    if (S.anim) S.anim.pause();
    S.anim = null; S.started = false;
    if (d.animate && pts.length > 1) {
      S.anim = new Anim(pts.length, d.durationMs || 6000);
      // final: already played once (persisted) → show the end state, Replay still animates
      if (reduced() || d.final) { S.anim.finish(); S.started = true; } else S.anim.apply();
      if (S.tileState === 'loaded' || S.tileState === 'failed') startAnimOnce();
    }
  }

  function receive(raw) {
    var m;
    try { m = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    switch (m.t) {
      case 'init': build(m); break;
      case 'theme': if (S.data) { S.data.colors = m.colors; S.data.dark = m.dark; } setColors(m.colors, m.dark); break;
      case 'select':
        if (typeof m.i !== 'number' || !S.markers[m.i]) return;
        if (S.anim && S.anim.elapsed < S.anim.duration) S.anim.seek(m.i); else setActive(m.i);
        S.markers[m.i].openPopup();
        break;
      case 'play': if (S.anim) { S.started = true; if (S.anim.elapsed >= S.anim.duration) S.anim.replay(); else S.anim.play(); } break;
      case 'pause': if (S.anim) S.anim.pause(); break;
      case 'replay': if (S.anim) { S.started = true; S.anim.replay(); } break;
      case 'explore': interact(!!m.on); break;
    }
  }
  try { Object.defineProperty(window, '__hui', { value: Object.freeze({ receive: receive }), writable: false, configurable: false }); } catch (e) {}
  window.addEventListener('message', function (e) { if (parentWin && parentWin !== window && e.source === parentWin) receive(e.data); });
  if (!window.L) post({ t: 'error', message: 'Kartenbibliothek konnte nicht geladen werden.' });
  else post({ t: 'ready' });
})();
`;

/** The static map document (identical for every map; data arrives via the `init` message). */
export function buildMapDocument(opts: { lang?: string; ariaLabel?: string } = {}): string {
  const lang = /^[a-z]{2,3}$/i.test(opts.lang ?? '') ? opts.lang! : 'de';
  const aria = (opts.ariaLabel ?? 'Karte').replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  return (
    `<!DOCTYPE html><html lang="${lang}"><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="${buildMapCsp()}">` +
    '<meta http-equiv="x-dns-prefetch-control" content="off">' +
    '<meta name="referrer" content="no-referrer">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">' +
    `<link rel="stylesheet" href="${LEAFLET_CSS}" integrity="${LEAFLET_CSS_SRI}" crossorigin="anonymous">` +
    `<style>${CSS}</style>` +
    `<script src="${LEAFLET_JS}" integrity="${LEAFLET_JS_SRI}" crossorigin="anonymous"></script>` +
    `</head><body><div id="map" role="application" aria-label="${aria}"></div>` +
    `<script>${RUNTIME_JS}</script>` +
    '</body></html>'
  );
}

/** JS for WebView.injectJavaScript – same transport as the sandbox shell (`window.__hui.receive`). */
export function mapInjection(msg: MapHostMessage): string {
  return `window.__hui&&window.__hui.receive(${JSON.stringify(JSON.stringify(msg))});true;`;
}
