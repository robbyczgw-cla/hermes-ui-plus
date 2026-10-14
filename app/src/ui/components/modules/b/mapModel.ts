/**
 * Pure model for the `map` node (no RN imports – tested with node:test).
 *
 *  - normalizeMap(node)       validated markers (lat/lng range, title), numbering, center/zoom
 *  - tripFrame / pinPose      animation math, port of OpenIntelligentUI's trip animator
 *                             (refs/OpenIntelligentUI …/open-generative-ui/trip-animator.ts, MIT,
 *                             © Atai Barkai / CopilotKit): pins drop 18 px with a spring settle in the
 *                             first 55 % of each stop's slot, route segment appears once its
 *                             destination pin has landed ≥ 70 %, ~6 s total, camera fixed.
 *  - parseMapMessage(raw)     validates messages coming OUT of the map WebView
 */

export type MapMarker = {
  lat: number;
  lng: number;
  title: string;
  description?: string;
  /** label shown in the pin (model's `number` or position) */
  n: number;
  imageQuery?: string;
};

export type MapModel = {
  id: string;
  title?: string;
  markers: MapMarker[];
  /** markers dropped because of invalid coordinates / missing title */
  dropped: number;
  route: boolean;
  animate: boolean;
  center?: { lat: number; lng: number };
  zoom?: number;
};

export const MAX_MARKERS = 30;
export const MAX_TITLE = 120;
export const MAX_DESCRIPTION = 600;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
function num(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}
function text(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  // control characters out, whitespace collapsed (titles/descriptions are rendered as TEXT only)
  const s = v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return undefined;
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

export function isValidLatLng(lat: unknown, lng: unknown): boolean {
  const a = num(lat);
  const b = num(lng);
  return a !== undefined && b !== undefined && a >= -90 && a <= 90 && b >= -180 && b <= 180 && !(a === 0 && b === 0);
}

/** One marker or null (invalid coordinates, (0,0) "null island", missing title). */
export function validateMarker(o: unknown, index: number): MapMarker | null {
  if (!isObj(o)) return null;
  const lat = num(o.lat ?? o.latitude);
  const lng = num(o.lng ?? o.lon ?? o.longitude);
  if (!isValidLatLng(lat, lng)) return null;
  const title = text(o.title ?? o.name, MAX_TITLE);
  if (!title) return null;
  const nRaw = num(o.number);
  const n = nRaw !== undefined && Number.isInteger(nRaw) && nRaw >= 0 && nRaw < 1000 ? nRaw : index + 1;
  const m: MapMarker = { lat: lat!, lng: lng!, title, n };
  const d = text(o.description, MAX_DESCRIPTION);
  if (d) m.description = d;
  const q = text(o.imageQuery, 200);
  if (q) m.imageQuery = q;
  return m;
}

export function normalizeMap(node: unknown): MapModel {
  const n = isObj(node) ? node : {};
  const raw = Array.isArray(n.markers) ? n.markers : [];
  const markers: MapMarker[] = [];
  let dropped = 0;
  for (let i = 0; i < raw.length; i++) {
    const m = validateMarker(raw[i], markers.length);
    if (m && markers.length < MAX_MARKERS) markers.push(m);
    else dropped++;
  }
  const c = isObj(n.center) && isValidLatLng(n.center.lat, n.center.lng) ? { lat: num(n.center.lat)!, lng: num(n.center.lng)! } : undefined;
  const z = num(n.zoom);
  return {
    // the validator's id verbatim: it is the persistence/action key (messageId:nodeId). Shortening it here
    // merged distinct ids that share a long prefix (and dropped validator-added `-2` suffixes).
    id: typeof n.id === 'string' && n.id.trim() !== '' ? n.id : 'map',
    title: text(n.title, 200),
    markers,
    dropped,
    route: n.route === true && markers.length >= 2,
    animate: n.animate === true && markers.length >= 2,
    center: c,
    zoom: z !== undefined ? Math.max(1, Math.min(18, Math.round(z))) : undefined,
  };
}

/* ───────────── animation (mirrored in mapTemplate.ts → MAP_ANIM_JS) ───────────── */

export const PIN_DROP_PX = 18;
export const LAND_FRACTION = 0.55;
export const SEGMENT_REVEAL = 0.7;

/** ~6 s for up to 10 stops, then 600 ms per stop (max 18 s). */
export function animDuration(stopCount: number): number {
  return Math.min(18000, Math.max(6000, stopCount * 600));
}

export type TripFrame = {
  progress: number;
  /** stop that is currently landing (= active stop) */
  pinIndex: number;
  /** 0..1 landing of pinIndex */
  pinProgress: number;
};

export function tripFrame(progress: number, stopCount: number): TripFrame {
  const p = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
  const pinStep = p * stopCount;
  const pinIndex = Math.min(stopCount - 1, Math.floor(pinStep));
  const pinProgress = p === 1 ? 1 : Math.min(1, (pinStep - pinIndex) / LAND_FRACTION);
  return { progress: p, pinIndex, pinProgress };
}

/** Landing 0..1 of pin `i` in frame `f`. */
export function pinLanding(f: TripFrame, i: number): number {
  return i < f.pinIndex ? 1 : i === f.pinIndex ? f.pinProgress : 0;
}

/** Visual pose for a landing value: hidden before, drop from −18 px with a light overshoot, scale .72 → 1. */
export function pinPose(landing: number): { opacity: number; dy: number; scale: number } {
  const t = landing - 1;
  const ease = 1 + 2.2 * t * t * t + 1.2 * t * t;
  return { opacity: landing > 0 ? 1 : 0, dy: -PIN_DROP_PX * (1 - ease), scale: 0.72 + 0.28 * ease };
}

/** Route segment k (stop k → k+1) is visible once pin k+1 has landed ≥ 70 %. */
export function segmentVisible(f: TripFrame, k: number): boolean {
  return pinLanding(f, k + 1) >= SEGMENT_REVEAL;
}

/** Progress that shows stop `i` landed and active (seek target, as in OIUI). */
export function seekProgress(i: number, stopCount: number): number {
  if (stopCount <= 1 || i >= stopCount - 1) return 1;
  return Math.max(0, (i + 0.6) / stopCount);
}

/* ───────────── messages from the WebView ───────────── */

export type MapMessage =
  | { t: 'ready' }
  | { t: 'error'; message: string }
  | { t: 'tiles'; s: 'loading' | 'loaded' | 'failed' }
  | { t: 'select'; i: number }
  | { t: 'active'; i: number }
  | { t: 'anim'; s: 'playing' | 'paused' | 'complete' };

/** Validates a raw message from the map frame (string or object). Unknown / malformed → null. */
export function parseMapMessage(raw: unknown, markerCount: number): MapMessage | null {
  let d: unknown = raw;
  if (typeof raw === 'string') {
    if (raw.length > 2000) return null;
    try {
      d = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!isObj(d)) return null;
  const idx = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < markerCount ? v : null);
  switch (d.t) {
    case 'ready':
      return { t: 'ready' };
    case 'error':
      return { t: 'error', message: (typeof d.message === 'string' ? d.message : 'Fehler').slice(0, 200) };
    case 'tiles':
      return d.s === 'loading' || d.s === 'loaded' || d.s === 'failed' ? { t: 'tiles', s: d.s } : null;
    case 'select':
    case 'active': {
      const i = idx(d.i);
      return i === null ? null : { t: d.t, i };
    }
    case 'anim':
      return d.s === 'playing' || d.s === 'paused' || d.s === 'complete' ? { t: 'anim', s: d.s } : null;
    default:
      return null;
  }
}

/** Plain-text summary (accessibility + share): "1. Kolosseum · 2. Forum Romanum". */
export function stopsSummary(markers: MapMarker[]): string {
  return markers.map((m) => `${m.n}. ${m.title}`).join(' · ');
}
