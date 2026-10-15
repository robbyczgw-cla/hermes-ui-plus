/**
 * Light runtime validation / coercion of model-produced HuiNode JSON.
 * Lenient on purpose: it is also applied to partially streamed nodes, so
 * missing required text fields default to '' instead of rejecting the node.
 * Unknown `type`s pass through unchanged (renderer shows a fallback card).
 */
import type {
  HuiAction,
  HuiBasis,
  HuiCell,
  HuiChartKind,
  HuiChartPoint,
  HuiWeatherCondition,
  HuiChartSeries,
  HuiField,
  HuiFieldKind,
  HuiNode,
  HuiBlockStyle,
  HuiPathIcon,
  HuiPathTone,
} from './types.ts';
import {
  HUI_AGENDA_KINDS,
  HUI_PATH_ICONS,
  HUI_BASES,
  HUI_PLACE_PRICES,
  HUI_STUDY_TASK_KINDS,
  HUI_WEATHER_CONDITIONS,
  HUI_NODE_TYPES,
  HUI_WORKOUT_KINDS,
  isInteractiveNodeType,
} from './types.ts';

export const MAX_TABLE_COLUMNS = 12;
export const MAX_TABLE_ROWS = 200;
export const MAX_GALLERY_ITEMS = 6;
export const MAX_IMAGE_QUERY_LENGTH = 120;
/** v2 caps (docs/SPEC-modules-v2.md). Everything beyond is dropped, never an error. */
export const MAX_CHOICE_OPTIONS = 12;
export const MAX_CHECKLIST_ITEMS = 200;
export const MAX_CALC_INPUTS = 12;
export const MAX_CALC_OUTPUTS = 12;
export const MAX_CALC_SELECT_OPTIONS = 30;
export const MAX_EXPR_LENGTH = 500;
export const MAX_MAP_MARKERS = 30;
export const MAX_RECIPE_INGREDIENTS = 60;
export const MAX_RECIPE_STEPS = 40;
export const MAX_RECIPE_TIPS = 10;
export const MAX_TABS = 6;
export const MAX_ACCORDION_ITEMS = 20;
export const MAX_QUIZ_QUESTIONS = 30;
export const MAX_QUIZ_OPTIONS = 10;
export const MAX_FLASHCARDS = 100;
export const MAX_SLOTS = 20;
export const MAX_SOURCES = 12;
export const MAX_ADD_TO_LIST_ITEMS = 50;
export const MAX_ASK_INCLUDE = 8;
export const MAX_ID_LENGTH = 100;
/** v3 caps (docs/SPEC-modules-v3.md) */
export const MAX_TRANSLATION_TARGETS = 4;
export const MAX_POLL_OPTIONS = 8;
export const MAX_POLL_VOTERS = 12;
export const MAX_AGENDA_BLOCKS = 30;
export const MAX_WEATHER_HOURLY = 24;
export const MAX_WEATHER_DAILY = 10;
export const MAX_DECISION_CRITERIA = 8;
export const MAX_DECISION_OPTIONS = 6;
export const MAX_RANK_ITEMS = 10;
export const MAX_SCALE_EMOJIS = 10;
export const MAX_SCALE_RANGE = 100;
export const MAX_SPARKLINE_POINTS = 60;
export const MAX_CHART_SERIES = 12;
export const MAX_CHART_POINTS = 1000;
export const MAX_RADAR_AXES = 8;
/** v4 caps (docs/SPEC-modules-v4.md) */
export const MAX_SUMMARY_POINTS = 4;
export const MAX_PLACES = 10;
export const MAX_PLACE_HOURS = 7;
export const MAX_PLACE_TAGS = 8;
export const MAX_PRODUCTS = 10;
export const MAX_PRODUCT_SCORES = 5;
export const MAX_PRODUCT_SPECS = 6;
export const MAX_PRODUCT_PROS_CONS = 6;
export const MAX_PRODUCT_OFFERS = 4;
export const MAX_TIMERS = 6;
export const MAX_GUIDE_STEPS = 20;
export const MAX_WORKOUT_EXERCISES = 20;
export const MAX_STUDYPLAN_WEEKS = 26;
export const MAX_STUDYPLAN_DAYS = 14;
export const MAX_STUDYPLAN_TASKS = 20;
export const MAX_VOCAB_ITEMS = 40;
/** root = depth 0 */
export const MAX_MINDMAP_DEPTH = 4;
export const MAX_MINDMAP_NODES = 60;
export const MAX_PATHS_ITEMS = 6;
export const MAX_PATH_NODES = 6;
export const MAX_BLOCK_COLUMNS = 3;
export const MAX_BLOCK_ITEMS = 12;
const MAX_DEPTH = 8;
/** children of one card/stack/tab/accordion item (legacy containers had no breadth cap) */
export const MAX_CHILDREN = 100;
/** items of the legacy list-like nodes (stats, list, steps, timeline, compare, buttons, suggestions …) */
export const MAX_LIST_ITEMS = 200;
export const MAX_FORM_FIELDS = 30;
/** total nodes per normalised tree: bounds the work done on the UI thread for any input shape */
export const MAX_TREE_NODES = 1500;

type Rec = Record<string, unknown>;

function isRec(x: unknown): x is Rec {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function str(x: unknown): string | undefined {
  if (typeof x === 'string') return x;
  if (typeof x === 'number' && Number.isFinite(x)) return String(x);
  if (typeof x === 'boolean') return String(x);
  return undefined;
}

function num(x: unknown): number | undefined {
  if (typeof x === 'number') return Number.isFinite(x) ? x : undefined;
  if (typeof x === 'string' && x.trim() !== '') {
    // accept "12", "12.5", "-3", "1e3"; also German decimal comma "12,5"
    const s = x.trim().replace(/\s/g, '');
    const n = Number(/^-?\d+,\d+$/.test(s) ? s.replace(',', '.') : s);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function oneOf<T extends string>(x: unknown, allowed: readonly T[]): T | undefined {
  return typeof x === 'string' && (allowed as readonly string[]).includes(x) ? (x as T) : undefined;
}

function arr(x: unknown): unknown[] {
  return Array.isArray(x) ? x : [];
}

/** assign only defined values */
function put<T extends object>(o: T, k: string, v: unknown): void {
  if (v !== undefined) (o as Rec)[k] = v;
}

function strList(x: unknown, max = MAX_LIST_ITEMS): string[] {
  const out: string[] = [];
  const a = arr(x);
  for (let i = 0; i < a.length && out.length < max; i++) {
    const v = a[i];
    const s = str(v);
    if (s !== undefined) out.push(s);
  }
  return out;
}


// ───────────────────────── v2 helpers ─────────────────────────

const CTRL_RE = /[\u0000-\u001f\u007f]+/g;
const CTRL_KEEP_NL_RE = /[\u0000-\u0008\u000b-\u001f\u007f]+/g;

/** single-line text: control chars/newlines → space, trimmed, length-capped; '' → undefined */
function line(x: unknown, max: number): string | undefined {
  const s = str(x);
  if (s === undefined) return undefined;
  const t = s.replace(CTRL_RE, ' ').trim().slice(0, max).trim();
  return t === '' ? undefined : t;
}

/** multi-line text: control chars (except \n, \t) removed, trimmed, length-capped; '' → undefined */
function block(x: unknown, max: number): string | undefined {
  const s = str(x);
  if (s === undefined) return undefined;
  const t = s.replace(CTRL_KEEP_NL_RE, '').trim().slice(0, max).trim();
  return t === '' ? undefined : t;
}

function bool(x: unknown): boolean | undefined {
  return typeof x === 'boolean' ? x : undefined;
}

/** rounded integer clamped into [min,max]; non-numbers → undefined */
function int(x: unknown, min: number, max: number): number | undefined {
  const n = num(x);
  if (n === undefined) return undefined;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function isValidLat(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= -90 && n <= 90;
}
export function isValidLng(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= -180 && n <= 180;
}

function latLng(lat: unknown, lng: unknown): { lat: number; lng: number } | undefined {
  const a = num(lat);
  const b = num(lng);
  return isValidLat(a) && isValidLng(b) ? { lat: a, lng: b } : undefined;
}

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/;
const FORBIDDEN_NAMES = new Set(['__proto__', 'constructor', 'prototype', 'hasOwnProperty', 'toString', 'valueOf']);
/** names that collide with Object.prototype members when used as plain-object keys (state maps, submit dicts) */
function isProtoName(s: string): boolean {
  return FORBIDDEN_NAMES.has(s) || s.startsWith('__') || Object.prototype.hasOwnProperty.call(Object.prototype, s);
}
function ident(x: unknown): string | undefined {
  const s = typeof x === 'string' ? x.trim() : undefined;
  return s && IDENT_RE.test(s) && !isProtoName(s) ? s : undefined;
}

function expr(x: unknown): string | undefined {
  const s = typeof x === 'string' ? x : undefined;
  if (s === undefined) return undefined;
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length <= MAX_EXPR_LENGTH ? t : undefined; // never truncate: a cut expression computes the wrong thing
}

function basis(x: unknown): HuiBasis | undefined {
  return oneOf(x, HUI_BASES);
}

/** basis? + source? provenance (capped); `source` of table keeps its legacy behaviour */
function provenance(base: Rec, x: Rec, withSource = true): void {
  put(base, 'basis', basis(x.basis));
  if (withSource) put(base, 'source', line(x.source, 300));
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?)?$/;

/**
 * Strict-ish ISO 8601: "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm[:ss[.fff]][Z|±hh:mm]" (a space instead of
 * "T" is accepted and normalised). Calendar-validated (no Feb 30, no hour 24). Returns the
 * normalised string and whether it carries a time part.
 */
export function parseIso(x: unknown): { value: string; hasTime: boolean } | undefined {
  if (typeof x !== 'string') return undefined;
  const s = x.trim();
  if (s.length > 40) return undefined;
  const m = ISO_RE.exec(s);
  if (!m) return undefined;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return undefined;
  const dim = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  if (d > dim) return undefined;
  const hasTime = m[4] !== undefined;
  if (hasTime) {
    if (Number(m[4]) > 23 || Number(m[5]) > 59 || (m[6] !== undefined && Number(m[6]) > 59)) return undefined;
    if (m[7] && m[7] !== 'Z') {
      if (Number(m[7].slice(1, 3)) > 23 || Number(m[7].slice(4, 6)) > 59) return undefined;
    }
  }
  return { value: s.replace(' ', 'T'), hasTime };
}

/** end must not be before start (only compared when both have the same shape: date-only or date+time) */
function endNotBeforeStart(start: { value: string; hasTime: boolean }, end: { value: string; hasTime: boolean }): boolean {
  if (start.hasTime !== end.hasTime) return true;
  const a = Date.parse(start.value);
  const b = Date.parse(end.value);
  return Number.isNaN(a) || Number.isNaN(b) || b >= a;
}

const HOST_RE = /^[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?(?:\.[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?)*$/u;

/** hostname (lower-case) of an absolute http(s) URL string, without using `URL` (not reliable on RN). */
export function urlHost(url: string): string | undefined {
  const m = /^https?:\/\/([^/?#]*)/i.exec(url);
  if (!m) return undefined;
  const auth = m[1];
  if (auth.includes('@')) return undefined;
  const host = auth.replace(/:\d{1,5}$/, '').toLowerCase();
  return host && HOST_RE.test(host) ? host : undefined;
}

/**
 * Only absolute http(s) URLs: no other scheme (javascript:, data:, file:, intent: …), no
 * credentials, no whitespace/control chars, ≤ 2048 chars, valid host. `requireDot` additionally
 * demands a dotted host (public web, used for `sources`).
 */
export function safeHttpUrl(x: unknown, requireDot = false): string | undefined {
  if (typeof x !== 'string') return undefined;
  const s = x.trim();
  if (s.length === 0 || s.length > 2048 || /[\s\u0000-\u001f\u007f]/.test(s)) return undefined;
  const host = urlHost(s);
  if (!host) return undefined;
  if (requireDot && !host.includes('.')) return undefined;
  return s;
}

/** "+49 (30) 123-456" → "+4930123456"; 3..15 digits, optional leading "+"; anything else → undefined */
export function normalizePhone(x: unknown): string | undefined {
  if (typeof x !== 'string' && typeof x !== 'number') return undefined;
  const s = String(x).trim();
  if (!/^\+?[\d ()\-./]{3,40}$/.test(s)) return undefined;
  const c = s.replace(/[ ()\-./]/g, '');
  return /^\+?\d{3,15}$/.test(c) ? c : undefined;
}

const EMAIL_RE = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,24}$/;
export function isValidEmail(s: string): boolean {
  return s.length <= 254 && s.indexOf('@') <= 64 && EMAIL_RE.test(s);
}
/** one address, or up to 5 separated by , or ; → joined with "," ; any invalid entry → undefined */
function normalizeEmailList(x: unknown): string | undefined {
  const s = typeof x === 'string' ? x : undefined;
  if (!s) return undefined;
  const parts = s.split(/[,;]/).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0 || parts.length > 5 || !parts.every(isValidEmail)) return undefined;
  return parts.join(',');
}

type Ctx = { used: Set<string>; nodes: number };

/** returns `candidate` or `candidate-2`, `-3` … (first free) and marks it used */
function uniq(candidate: string, used: Set<string>): string {
  let id = candidate;
  for (let n = 2; used.has(id); n++) id = `${candidate}-${n}`;
  used.add(id);
  return id;
}

/** Stable id for an interactive node: explicit `id` if usable, else `<type>-<path>`; deduped per tree. */
function interactiveId(type: string, explicit: unknown, path: string, ctx: Ctx): string {
  const e = typeof explicit === 'string' || typeof explicit === 'number' ? String(explicit).replace(CTRL_RE, ' ').trim().slice(0, MAX_ID_LENGTH) : '';
  return uniq(e || `${type}-${path}`, ctx.used);
}

/** sub-item ids (choice options, checklist items, slots): explicit if unique, else `<prefix><index>` */
function itemId(explicit: unknown, prefix: string, index: number, used: Set<string>): string {
  const e = line(explicit, 64);
  // prototype-sensitive names ("constructor", "toString", "__proto__") would read as existing state in `{}` maps
  if (e && !used.has(e) && !isProtoName(e)) {
    used.add(e);
    return e;
  }
  return uniq(`${prefix}${index}`, used);
}

const UNICODE_FRACTIONS: Record<string, number> = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125 };
/** "1", "1,5", "1/2", "1 1/2", "½", "1½" → number; ranges/words → undefined */
export function parseQuantity(x: unknown): number | undefined {
  if (typeof x === 'number') return Number.isFinite(x) && x >= 0 && x <= 100000 ? x : undefined;
  if (typeof x !== 'string') return undefined;
  const s = x.trim();
  let m: RegExpExecArray | null;
  let v: number | undefined;
  if ((m = /^(\d+)?\s*([½¼¾⅓⅔⅛])$/.exec(s))) v = Number(m[1] ?? 0) + UNICODE_FRACTIONS[m[2]];
  else if ((m = /^(\d+)\s+(\d+)\/(\d+)$/.exec(s))) v = Number(m[3]) ? Number(m[1]) + Number(m[2]) / Number(m[3]) : undefined;
  else if ((m = /^(\d+)\/(\d+)$/.exec(s))) v = Number(m[2]) ? Number(m[1]) / Number(m[2]) : undefined;
  else v = num(s);
  return v !== undefined && Number.isFinite(v) && v >= 0 && v <= 100000 ? v : undefined;
}

/** Collect the ids of all interactive nodes in a (normalised) tree, pre-order. */
export function collectInteractiveIds(node: unknown, out: string[] = [], depth = 0): string[] {
  if (!isRec(node) || depth > MAX_DEPTH + 2) return out;
  if (typeof node.type === 'string' && isInteractiveNodeType(node.type) && typeof node.id === 'string') out.push(node.id);
  // no `push(...array)`: a huge child list would exceed the engine's argument limit (RangeError)
  const walk = (list: unknown) => {
    if (Array.isArray(list)) for (const k of list) collectInteractiveIds(k, out, depth + 1);
  };
  walk(node.children);
  if (Array.isArray(node.tabs)) for (const t of node.tabs) if (isRec(t)) walk(t.children);
  if (node.type === 'accordion' && Array.isArray(node.items)) {
    for (const t of node.items) if (isRec(t)) walk(t.children);
  }
  return out;
}

/** Image search query: trimmed, whitespace collapsed, length-capped; '' → undefined. */
export function normalizeImageQuery(x: unknown): string | undefined {
  const s = str(x);
  if (s === undefined) return undefined;
  const q = s.replace(/\s+/g, ' ').trim().slice(0, MAX_IMAGE_QUERY_LENGTH).trim();
  return q || undefined;
}

/** Wikipedia language code ('de', 'en', 'pt', 'simple', 'zh-yue' …); anything else → undefined. */
export function normalizeWikiLang(x: unknown): string | undefined {
  if (typeof x !== 'string') return undefined;
  const l = x.trim().toLowerCase();
  return /^(?:[a-z]{2,3}(?:-[a-z]{2,8})?|simple)$/.test(l) ? l : undefined;
}

export function normalizeAction(x: unknown): HuiAction | null {
  if (!isRec(x)) return null;
  switch (x.type) {
    case 'send': {
      const text = str(x.text);
      return text !== undefined ? { type: 'send', text } : null;
    }
    case 'submit':
      return { type: 'submit' };
    case 'open_url': {
      const url = safeHttpUrl(x.url);
      return url ? { type: 'open_url', url } : null;
    }
    case 'copy': {
      const text = str(x.text);
      return text !== undefined ? { type: 'copy', text } : null;
    }
    case 'calendar': {
      const title = line(x.title, 200);
      const start = parseIso(x.start);
      if (!title || !start) return null;
      const a: Rec = { type: 'calendar', title, start: start.value };
      const end = parseIso(x.end);
      if (end && endNotBeforeStart(start, end)) a.end = end.value;
      put(a, 'allDay', bool(x.allDay));
      put(a, 'location', line(x.location, 200));
      put(a, 'notes', block(x.notes, 2000));
      return a as unknown as HuiAction;
    }
    case 'reminder': {
      const title = line(x.title, 200);
      const at = parseIso(x.at);
      return title && at ? { type: 'reminder', title, at: at.value } : null;
    }
    case 'maps': {
      const a: Rec = { type: 'maps' };
      const query = line(x.query, 200);
      const ll = latLng(x.lat, x.lng);
      if (!query && !ll) return null;
      put(a, 'query', query);
      if (ll) {
        a.lat = ll.lat;
        a.lng = ll.lng;
      }
      put(a, 'mode', oneOf(x.mode, ['driving', 'walking', 'transit'] as const));
      return a as unknown as HuiAction;
    }
    case 'call': {
      const phone = normalizePhone(x.phone);
      return phone ? { type: 'call', phone } : null;
    }
    case 'email': {
      const to = normalizeEmailList(x.to);
      if (!to) return null;
      const a: Rec = { type: 'email', to };
      put(a, 'subject', line(x.subject, 200));
      put(a, 'body', block(x.body, 4000));
      return a as unknown as HuiAction;
    }
    case 'sms': {
      const to = normalizePhone(x.to);
      if (!to) return null;
      const a: Rec = { type: 'sms', to };
      put(a, 'body', block(x.body, 1000));
      return a as unknown as HuiAction;
    }
    case 'timer': {
      const seconds = num(x.seconds);
      if (seconds === undefined || seconds < 1 || seconds > 86400) return null;
      return { type: 'timer', seconds: Math.round(seconds), label: line(x.label, 100) ?? 'Timer' };
    }
    case 'add_to_list': {
      const items = arr(x.items)
        .map((v) => line(v, 200))
        .filter((v): v is string => v !== undefined)
        .slice(0, MAX_ADD_TO_LIST_ITEMS);
      if (items.length === 0) return null;
      const a: Rec = { type: 'add_to_list', items };
      put(a, 'listTitle', line(x.listTitle, 100));
      return a as unknown as HuiAction;
    }
    case 'ask': {
      const text = block(x.text, 2000);
      if (!text) return null;
      const a: Rec = { type: 'ask', text };
      if (Array.isArray(x.include)) {
        a.include = x.include
          .map((v) => line(v, MAX_ID_LENGTH))
          .filter((v): v is string => v !== undefined)
          .slice(0, MAX_ASK_INCLUDE);
      }
      return a as unknown as HuiAction;
    }
    default:
      return null;
  }
}

const FIELD_KINDS: readonly HuiFieldKind[] = ['text', 'number', 'slider', 'select', 'toggle', 'date'];

/** Form fields: capped, names unique and never prototype-sensitive (they become submit-dictionary keys). */
function formFields(x: unknown): HuiField[] {
  const used = new Set<string>();
  const out: HuiField[] = [];
  const a = arr(x);
  for (let i = 0; i < a.length && out.length < MAX_FORM_FIELDS; i++) {
    const f = normalizeField(a[i]);
    if (!f) continue;
    f.name = uniq(isProtoName(f.name) ? `field_${i}` : f.name, used);
    out.push(f);
  }
  return out;
}

function normalizeField(x: unknown): HuiField | null {
  if (!isRec(x)) return null;
  const name = line(x.name, 64);
  if (!name) return null;
  const f: HuiField = {
    name,
    label: str(x.label) ?? name,
    kind: oneOf(x.kind, FIELD_KINDS) ?? 'text',
  };
  put(f, 'placeholder', str(x.placeholder));
  put(f, 'min', num(x.min));
  put(f, 'max', num(x.max));
  put(f, 'step', num(x.step));
  put(f, 'unit', str(x.unit));
  if (Array.isArray(x.options)) f.options = strList(x.options);
  const d = x.default;
  if (typeof d === 'boolean') f.default = d;
  else if (typeof d === 'number' && Number.isFinite(d)) f.default = d;
  else if (typeof d === 'string') f.default = d;
  return f;
}

function normalizeCell(x: unknown): HuiCell {
  if (x === null || x === undefined) return null;
  if (typeof x === 'string') return x;
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  if (typeof x === 'boolean') return String(x);
  return JSON.stringify(x);
}

const CHART_KINDS: readonly HuiChartKind[] = [
  'bar', 'line', 'area', 'pie', 'donut', 'hbar', 'stacked', 'scatter', 'radar', 'gauge', 'heatmap', 'waterfall',
];

function normalizeSeries(x: unknown, kind: HuiChartKind = 'bar'): HuiChartSeries | null {
  if (!isRec(x)) return null;
  const data: HuiChartPoint[] = [];
  const rawPoints = arr(x.data);
  const maxPoints = kind === 'radar' ? MAX_RADAR_AXES : kind === 'gauge' ? 1 : MAX_CHART_POINTS;
  for (let i = 0; i < rawPoints.length && data.length < maxPoints; i++) {
    const p = rawPoints[i];
    let rx: unknown;
    let ry: unknown;
    let rec: Rec = {};
    if (Array.isArray(p)) {
      rx = p[0];
      ry = p[1];
    } else if (isRec(p)) {
      rx = p.x;
      ry = p.y;
      rec = p;
    } else continue;
    let y = num(ry);
    const total = kind === 'waterfall' && rec.total === true;
    if (y === undefined) {
      if (!total) continue;
      y = 0;
    }
    let xv: string | number | undefined;
    if (kind === 'scatter') xv = num(rx);
    else if (kind === 'heatmap' && typeof rx === 'string') {
      const d = parseIso(rx);
      xv = d && !d.hasTime ? d.value : line(rx, 100);
    } else xv = typeof rx === 'number' && Number.isFinite(rx) ? rx : str(rx);
    if (xv === undefined) {
      if (kind !== 'gauge') continue;
      xv = 'value';
    }
    const pt: HuiChartPoint = { x: xv, y };
    if (kind === 'heatmap') {
      const y2 = line(rec.y2, 100);
      if (y2) pt.y2 = y2;
    }
    if (kind === 'scatter') {
      const label = line(rec.label, 100);
      if (label) pt.label = label;
    }
    if (total) pt.total = true;
    data.push(pt);
  }
  return { name: str(x.name) ?? '', data };
}

/** `path` = index path of the PARENT; a child's path is `<path>.<original index in the array>` */
function children(x: unknown, depth: number, ctx: Ctx, path: string): HuiNode[] {
  if (depth >= MAX_DEPTH) return [];
  const out: HuiNode[] = [];
  const a = arr(x);
  for (let i = 0; i < a.length && out.length < MAX_CHILDREN && ctx.nodes < MAX_TREE_NODES; i++) {
    const n = norm(a[i], depth + 1, ctx, `${path}.${i}`);
    if (n) out.push(n);
  }
  return out;
}

function normChoice(x: Rec, base: Rec): void {
  const used = new Set<string>();
  put(base, 'question', block(x.question, 500));
  const opts = arr(x.options);
  const out: Rec[] = [];
  for (let i = 0; i < opts.length && out.length < MAX_CHOICE_OPTIONS; i++) {
    const o = opts[i];
    let label: string | undefined;
    let r: Rec = {};
    if (typeof o === 'string' || typeof o === 'number') label = line(o, 200);
    else if (isRec(o)) {
      label = line(o.label, 200);
      r = o;
    }
    if (!label) continue;
    const item: Rec = { id: itemId(r.id, 'o', i, used), label };
    put(item, 'description', line(r.description, 300));
    put(item, 'icon', line(r.icon, 16));
    put(item, 'imageQuery', normalizeImageQuery(r.imageQuery));
    out.push(item);
  }
  base.options = out;
  const multiple = bool(x.multiple);
  put(base, 'multiple', multiple);
  let min = int(x.min, 0, MAX_CHOICE_OPTIONS);
  const max = int(x.max, 0, MAX_CHOICE_OPTIONS);
  if (min !== undefined && max !== undefined && min > max) min = undefined;
  put(base, 'min', min);
  put(base, 'max', max);
  put(base, 'allowOther', bool(x.allowOther));
  put(base, 'layout', oneOf(x.layout, ['list', 'grid', 'chips'] as const));
  put(base, 'submitLabel', line(x.submitLabel, 60));
}

// model variants written from memory: `label`/`title`/`name` instead of `text`, `done` instead of
// `checked`, the list under another key, or grouped (`sections`/`groups` with nested items, or a
// `{category: [items]}` map) instead of flat items with `category`
const CHECKLIST_LIST_KEYS = ['items', 'entries', 'tasks', 'todos', 'list', 'checklist'] as const;
const CHECKLIST_GROUP_KEYS = ['sections', 'groups', 'categories'] as const;
const CHECKLIST_TEXT_KEYS = ['text', 'label', 'title', 'name', 'item', 'task', 'content'] as const;
const CHECKLIST_GROUP_TITLE_KEYS = ['title', 'name', 'label', 'category', 'heading'] as const;

function firstLine(r: Rec, keys: readonly string[], max: number): string | undefined {
  for (const k of keys) {
    const v = line(r[k], max);
    if (v) return v;
  }
  return undefined;
}

/** flat checklist entries `{it, category?}`: groups (array of `{title, items}` or a `{category: [...]}` map) are flattened */
function checklistEntries(x: Rec): { it: unknown; category?: string }[] {
  const out: { it: unknown; category?: string }[] = [];
  const add = (list: unknown, category: string | undefined, depth: number) => {
    if (isRec(list) && depth < 2) {
      // {"Kleidung": ["T-Shirts", …], "Hygiene": [...]}
      for (const [k, v] of Object.entries(list)) if (Array.isArray(v) && !isProtoName(k)) add(v, line(k, 60), depth + 1);
      return;
    }
    for (const it of arr(list)) {
      if (out.length >= MAX_CHECKLIST_ITEMS) return;
      if (isRec(it) && depth < 2) {
        const nested = firstArray(it, CHECKLIST_LIST_KEYS);
        // a group, not an item: it carries a nested list (and no own text besides its title)
        if (nested.length && line(it.text, 300) === undefined) {
          add(nested, firstLine(it, CHECKLIST_GROUP_TITLE_KEYS, 60) ?? category, depth + 1);
          continue;
        }
      }
      out.push({ it, category });
    }
  };
  const list = CHECKLIST_LIST_KEYS.map((k) => x[k]).find((v) => Array.isArray(v) && v.length > 0);
  if (list) add(list, undefined, 0);
  else {
    const group = [...CHECKLIST_GROUP_KEYS, ...CHECKLIST_LIST_KEYS].map((k) => x[k]).find((v) => (Array.isArray(v) && v.length > 0) || isRec(v));
    if (group) add(group, undefined, 0);
  }
  return out;
}

function normChecklist(x: Rec, base: Rec): void {
  const used = new Set<string>();
  put(base, 'title', line(x.title, 200) ?? line(x.name, 200));
  put(base, 'kind', oneOf(x.kind, ['shopping', 'todo', 'packing', 'generic'] as const));
  put(base, 'groupBy', oneOf(x.groupBy, ['category', 'none'] as const));
  put(base, 'editable', bool(x.editable));
  const entries = checklistEntries(x);
  const out: Rec[] = [];
  for (let i = 0; i < entries.length && out.length < MAX_CHECKLIST_ITEMS; i++) {
    const { it, category } = entries[i];
    let text: string | undefined;
    let r: Rec = {};
    if (typeof it === 'string' || typeof it === 'number') text = line(it, 300);
    else if (isRec(it)) {
      text = firstLine(it, CHECKLIST_TEXT_KEYS, 300);
      r = it;
    }
    if (!text) continue;
    const o: Rec = { id: itemId(r.id, 'i', i, used), text };
    const qty = typeof r.qty === 'number' ? (Number.isFinite(r.qty) ? r.qty : undefined) : line(r.qty, 20);
    put(o, 'qty', qty ?? (typeof r.quantity === 'number' && Number.isFinite(r.quantity) ? r.quantity : line(r.quantity, 20)));
    put(o, 'unit', line(r.unit, 20));
    put(o, 'category', line(r.category, 60) ?? line(r.group, 60) ?? line(r.section, 60) ?? category);
    put(o, 'checked', bool(r.checked) ?? bool(r.done) ?? bool(r.completed));
    put(o, 'note', line(r.note, 300));
    out.push(o);
  }
  base.items = out;
}

function normCalcInput(r: Rec): Rec | null {
  const name = ident(r.name);
  if (!name) return null;
  const kind = oneOf(r.kind, ['slider', 'number', 'select', 'toggle'] as const) ?? 'number';
  const o: Rec = { name, label: line(r.label, 100) ?? name, kind };
  put(o, 'unit', line(r.unit, 20));
  if (kind === 'toggle') {
    o.default = bool(r.default) ?? false;
    return o;
  }
  if (kind === 'select') {
    const options: { label: string; value: string | number }[] = [];
    for (const op of arr(r.options)) {
      if (options.length >= MAX_CALC_SELECT_OPTIONS) break;
      let label: string | undefined;
      let value: string | number | undefined;
      if (typeof op === 'string') {
        label = line(op, 100);
        value = op;
      } else if (typeof op === 'number' && Number.isFinite(op)) {
        label = String(op);
        value = op;
      } else if (isRec(op)) {
        const v = op.value;
        value = typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' ? v : undefined;
        label = line(op.label, 100) ?? (value !== undefined ? line(value, 100) : undefined);
        if (value === undefined && label !== undefined) value = label;
      }
      if (label !== undefined && value !== undefined) options.push({ label, value });
    }
    o.options = options;
    const d = r.default;
    const dv = typeof d === 'number' && Number.isFinite(d) ? d : typeof d === 'string' ? d : undefined;
    o.default =
      dv !== undefined && options.some((op) => op.value === dv) ? dv : options.length > 0 ? options[0].value : (dv ?? '');
    return o;
  }
  let min = num(r.min);
  let max = num(r.max);
  if (min !== undefined && max !== undefined && min > max) [min, max] = [max, min];
  const step = num(r.step);
  put(o, 'min', min);
  put(o, 'max', max);
  if (step !== undefined && step > 0) o.step = step;
  let def = num(r.default) ?? min ?? 0;
  if (min !== undefined && def < min) def = min;
  if (max !== undefined && def > max) def = max;
  o.default = def;
  return o;
}

function normCalc(x: Rec, base: Rec): void {
  put(base, 'title', line(x.title, 200));
  const inputs: Rec[] = [];
  const names = new Set<string>();
  for (const r of arr(x.inputs)) {
    if (inputs.length >= MAX_CALC_INPUTS) break;
    if (!isRec(r)) continue;
    const o = normCalcInput(r);
    if (!o || names.has(o.name as string)) continue;
    names.add(o.name as string);
    inputs.push(o);
  }
  base.inputs = inputs;
  const outputs: Rec[] = [];
  for (const r of arr(x.outputs)) {
    if (outputs.length >= MAX_CALC_OUTPUTS) break;
    if (!isRec(r)) continue;
    const name = ident(r.name);
    const e = expr(r.expr);
    // too long / non-string expression: drop (an empty one is a streaming intermediate state)
    if (e === undefined) continue;
    const label = line(r.label, 100) ?? name ?? '';
    const o: Rec = { label, expr: e };
    if (name && !names.has(name)) {
      names.add(name);
      o.name = name;
    }
    put(o, 'format', oneOf(r.format, ['number', 'currency', 'percent', 'duration', 'integer'] as const));
    put(o, 'decimals', int(r.decimals, 0, 10));
    put(o, 'unit', line(r.unit, 20));
    put(o, 'emphasis', bool(r.emphasis));
    outputs.push(o);
  }
  base.outputs = outputs;
  if (isRec(x.chart)) {
    const c = x.chart;
    const sw = isRec(c.sweep) ? c.sweep : undefined;
    const input = sw ? ident(sw.input) : undefined;
    const from = sw ? num(sw.from) : undefined;
    const to = sw ? num(sw.to) : undefined;
    const steps = sw ? int(sw.steps, 2, 200) : undefined;
    const y = expr(c.y);
    if (input && from !== undefined && to !== undefined && steps !== undefined && y) {
      const ch: Rec = {
        kind: oneOf(c.kind, ['line', 'bar'] as const) ?? 'line',
        sweep: { input, from, to, steps },
        y,
      };
      put(ch, 'label', line(c.label, 100));
      base.chart = ch;
    }
  }
  put(base, 'note', block(x.note, 1000));
  provenance(base, x);
}

function normMap(x: Rec, base: Rec): void {
  put(base, 'title', line(x.title, 200));
  const markers: Rec[] = [];
  for (const m of arr(x.markers)) {
    if (markers.length >= MAX_MAP_MARKERS) break;
    if (!isRec(m)) continue;
    const ll = latLng(m.lat, m.lng);
    if (!ll) continue;
    const o: Rec = { lat: ll.lat, lng: ll.lng, title: line(m.title, 200) ?? '' };
    put(o, 'description', line(m.description, 500));
    put(o, 'number', int(m.number, 1, 999));
    put(o, 'imageQuery', normalizeImageQuery(m.imageQuery));
    markers.push(o);
  }
  base.markers = markers;
  put(base, 'route', bool(x.route));
  put(base, 'animate', bool(x.animate));
  if (isRec(x.center)) put(base, 'center', latLng(x.center.lat, x.center.lng));
  put(base, 'zoom', int(x.zoom, 1, 19));
  provenance(base, x);
}

function normRecipe(x: Rec, base: Rec): void {
  base.title = line(x.title, 200) ?? '';
  put(base, 'imageQuery', normalizeImageQuery(x.imageQuery));
  const sv = num(x.servings);
  base.servings = sv !== undefined && sv > 0 && sv <= 100 ? sv : 4;
  if (isRec(x.time)) {
    const t: Rec = {};
    for (const k of ['prep', 'cook', 'total']) {
      const n = num((x.time as Rec)[k]);
      if (n !== undefined && n >= 0) t[k] = Math.min(10080, Math.round(n));
    }
    if (Object.keys(t).length > 0) base.time = t;
  }
  const ingredients: Rec[] = [];
  for (const it of arr(x.ingredients)) {
    if (ingredients.length >= MAX_RECIPE_INGREDIENTS) break;
    let item: string | undefined;
    let r: Rec = {};
    if (typeof it === 'string') item = line(it, 200);
    else if (isRec(it)) {
      item = line(it.item, 200);
      r = it;
    }
    if (!item) continue;
    const o: Rec = { item };
    let unit = line(r.unit, 40);
    if (r.qty !== undefined && r.qty !== null && r.qty !== '') {
      const q = parseQuantity(r.qty);
      if (q !== undefined) o.qty = q;
      else if (num(r.qty) === undefined) {
        // free-text quantity ("eine Prise", "2-3"): keep it, but not scalable
        const txt = line(r.qty, 40);
        if (txt) unit = unit ? `${txt} ${unit}`.slice(0, 40) : txt;
      }
    }
    put(o, 'unit', unit);
    put(o, 'group', line(r.group, 60));
    ingredients.push(o);
  }
  base.ingredients = ingredients;
  const steps: Rec[] = [];
  for (const it of arr(x.steps)) {
    if (steps.length >= MAX_RECIPE_STEPS) break;
    let text: string | undefined;
    let r: Rec = {};
    if (typeof it === 'string') text = block(it, 1000);
    else if (isRec(it)) {
      text = block(it.text, 1000);
      r = it;
    }
    if (!text) continue;
    const o: Rec = { text };
    const ts = num(r.timerSeconds);
    if (ts !== undefined && ts >= 1) o.timerSeconds = Math.min(86400, Math.round(ts));
    steps.push(o);
  }
  base.steps = steps;
  if (Array.isArray(x.tips)) {
    base.tips = x.tips
      .map((v) => block(v, 500))
      .filter((v): v is string => v !== undefined)
      .slice(0, MAX_RECIPE_TIPS);
  }
}

function normQuiz(x: Rec, base: Rec): void {
  put(base, 'title', line(x.title, 200));
  const questions: Rec[] = [];
  for (const r of arr(x.questions)) {
    if (questions.length >= MAX_QUIZ_QUESTIONS) break;
    if (!isRec(r)) continue;
    const q = block(r.q, 500);
    if (!q) continue;
    const rawOpts = arr(r.options).slice(0, MAX_QUIZ_OPTIONS);
    const options = rawOpts.map((v) => line(v, 200));
    // positional: one unusable option would shift the answer index -> drop the question
    if (options.length < 2 || !options.every((o): o is string => o !== undefined)) continue;
    const rawAns = Array.isArray(r.answer) ? r.answer : [r.answer];
    const idx: number[] = [];
    let ok = rawAns.length > 0 && rawAns.length <= MAX_QUIZ_OPTIONS;
    for (const a of rawAns) {
      let n: number | undefined;
      if (typeof a === 'string' && /^[A-Ja-j]$/.test(a.trim())) n = a.trim().toUpperCase().charCodeAt(0) - 65;
      else {
        const v = num(a);
        n = v !== undefined && Number.isInteger(v) ? v : undefined;
      }
      if (n === undefined || n < 0 || n >= options.length) {
        ok = false;
        break;
      }
      if (!idx.includes(n)) idx.push(n);
    }
    if (!ok || idx.length === 0) continue;
    idx.sort((a, b) => a - b);
    const o: Rec = { q, options, answer: idx.length === 1 ? idx[0] : idx };
    put(o, 'explanation', block(r.explanation, 1000));
    questions.push(o);
  }
  base.questions = questions;
}

function normFlashcards(x: Rec, base: Rec): void {
  put(base, 'title', line(x.title, 200));
  const cards: Rec[] = [];
  for (const r of arr(x.cards)) {
    if (cards.length >= MAX_FLASHCARDS) break;
    if (!isRec(r)) continue;
    const front = block(r.front, 500);
    if (!front) continue;
    cards.push({ front, back: block(r.back, 1000) ?? '' });
  }
  base.cards = cards;
}

function normSources(x: Rec, base: Rec): void {
  const items: Rec[] = [];
  for (const it of arr(x.items)) {
    if (items.length >= MAX_SOURCES) break;
    const r: Rec = isRec(it) ? it : typeof it === 'string' ? { url: it } : {};
    const url = safeHttpUrl(r.url, true);
    if (!url) continue;
    const host = urlHost(url) ?? url;
    const o: Rec = { title: line(r.title, 200) ?? host, url };
    put(o, 'snippet', line(r.snippet, 400));
    put(o, 'siteName', line(r.siteName, 60));
    items.push(o);
  }
  base.items = items;
}

function normSlots(x: Rec, base: Rec): void {
  const used = new Set<string>();
  put(base, 'title', line(x.title, 200));
  const slots: Rec[] = [];
  const raw = arr(x.slots);
  for (let i = 0; i < raw.length && slots.length < MAX_SLOTS; i++) {
    const r: Rec = isRec(raw[i]) ? (raw[i] as Rec) : typeof raw[i] === 'string' ? { start: raw[i] } : {};
    const start = parseIso(r.start);
    if (!start) continue;
    const o: Rec = { id: itemId(r.id, 's', i, used), start: start.value };
    const end = parseIso(r.end);
    if (end && endNotBeforeStart(start, end)) o.end = end.value;
    put(o, 'label', line(r.label, 100));
    put(o, 'note', line(r.note, 300));
    slots.push(o);
  }
  base.slots = slots;
  const tz = typeof x.timezone === 'string' ? x.timezone.trim() : '';
  if (tz.length <= 64 && /^(?:UTC|GMT|[A-Za-z][A-Za-z_+\-0-9]*(?:\/[A-Za-z][A-Za-z_+\-0-9]*){1,2})$/.test(tz)) base.timezone = tz;
  put(base, 'noneLabel', line(x.noneLabel, 100));
}


// ───────────────────────── v3 normalizers ─────────────────────────

/** 2..60 finite numbers (non-numeric entries dropped); fewer than 2 → undefined */
function sparkline(x: unknown): number[] | undefined {
  if (!Array.isArray(x)) return undefined;
  const out: number[] = [];
  for (const v of x) {
    if (out.length >= MAX_SPARKLINE_POINTS) break;
    const n = typeof v === 'number' ? (Number.isFinite(v) ? v : undefined) : num(v);
    if (n !== undefined) out.push(n);
  }
  return out.length >= 2 ? out : undefined;
}

/**
 * Language code: "de", "EN", "pt_br" → "de", "en", "pt-BR"; script subtags "zh-hant" → "zh-Hant".
 * Anything else (names, markup, too long) → 'und'.
 */
export function normalizeLangCode(x: unknown): string {
  if (typeof x !== 'string') return 'und';
  const m = /^([A-Za-z]{2,3})(?:[-_]([A-Za-z0-9]{2,8}))?$/.exec(x.trim());
  if (!m) return 'und';
  const lang = m[1].toLowerCase();
  const sub = m[2];
  if (!sub) return lang;
  const tag = /^[A-Za-z]{4}$/.test(sub) ? sub[0].toUpperCase() + sub.slice(1).toLowerCase() : /^[A-Za-z]{2}$/.test(sub) ? sub.toUpperCase() : sub.toLowerCase();
  return `${lang}-${tag}`;
}

function langText(x: unknown): Rec | undefined {
  if (typeof x === 'string') {
    const text = block(x, 2000);
    return text ? { lang: 'und', text } : undefined;
  }
  if (!isRec(x)) return undefined;
  const text = block(x.text, 2000);
  return text ? { lang: normalizeLangCode(x.lang), text } : undefined;
}

function normTranslation(x: Rec, base: Rec): void {
  // while streaming, source.text may still be missing: keep an (empty) source so the renderer has its slot
  const src = langText(x.source);
  base.source = src ?? { lang: isRec(x.source) ? normalizeLangCode(x.source.lang) : 'und', text: '' };
  const targets: Rec[] = [];
  for (const t of arr(x.targets)) {
    if (targets.length >= MAX_TRANSLATION_TARGETS) break;
    const o = langText(t);
    if (!o) continue;
    if (isRec(t)) put(o, 'romanization', line(t.romanization, 500));
    targets.push(o);
  }
  base.targets = targets;
  put(base, 'note', block(x.note, 500));
}

function normPoll(x: Rec, base: Rec): void {
  const used = new Set<string>();
  base.question = block(x.question, 500) ?? '';
  const raw = arr(x.options);
  const options: Rec[] = [];
  for (let i = 0; i < raw.length && options.length < MAX_POLL_OPTIONS; i++) {
    const o = raw[i];
    let label: string | undefined;
    let r: Rec = {};
    if (typeof o === 'string' || typeof o === 'number') label = line(o, 100);
    else if (isRec(o)) {
      label = line(o.label, 100);
      r = o;
    }
    if (!label) continue;
    const item: Rec = { id: itemId(r.id, 'o', i, used), label };
    put(item, 'emoji', line(r.emoji, 16));
    options.push(item);
  }
  base.options = options;
  put(base, 'multiple', bool(x.multiple));
  if (Array.isArray(x.voters)) {
    const seen = new Set<string>();
    const voters: string[] = [];
    for (const v of x.voters) {
      const n = line(v, 40);
      if (n && !seen.has(n.toLowerCase()) && voters.length < MAX_POLL_VOTERS) {
        seen.add(n.toLowerCase());
        voters.push(n);
      }
    }
    base.voters = voters;
  }
  put(base, 'allowAdd', bool(x.allowAdd));
  put(base, 'anonymous', bool(x.anonymous));
}

/** minutes since midnight of "H:MM[:SS]" or an ISO date-time's wall-clock part; invalid → undefined */
export function parseClock(x: unknown): number | undefined {
  if (typeof x !== 'string') return undefined;
  const s = x.trim();
  let m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(s);
  if (!m) {
    const iso = parseIso(s);
    if (!iso || !iso.hasTime) return undefined;
    m = /[T](\d{2}):(\d{2})/.exec(iso.value);
    if (!m) return undefined;
  }
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return h <= 23 && mi <= 59 ? h * 60 + mi : undefined;
}
function fmtClock(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

function normAgenda(x: Rec, base: Rec): void {
  const used = new Set<string>();
  const iso = parseIso(x.date);
  if (iso) base.date = iso.value.slice(0, 10);
  put(base, 'title', line(x.title, 200));
  const raw = arr(x.blocks);
  const blocks: { s: number; o: Rec }[] = [];
  for (let i = 0; i < raw.length && blocks.length < MAX_AGENDA_BLOCKS; i++) {
    const r = raw[i];
    if (!isRec(r)) continue;
    const start = parseClock(r.start);
    const title = line(r.title, 200);
    if (start === undefined || !title) continue;
    let end = parseClock(r.end);
    if (end === undefined || end <= start) end = Math.min(start + 60, 23 * 60 + 59);
    if (end <= start) continue; // 23:59 start: no room for a block
    const o: Rec = { id: itemId(r.id, 'b', i, used), start: fmtClock(start), end: fmtClock(end), title };
    put(o, 'location', line(r.location, 200));
    put(o, 'kind', oneOf(r.kind, HUI_AGENDA_KINDS));
    put(o, 'note', line(r.note, 300));
    blocks.push({ s: start, o });
  }
  blocks.sort((a, b) => a.s - b.s); // stable
  base.blocks = blocks.map((b) => b.o);
  put(base, 'editable', bool(x.editable));
}

export function normalizeWeatherCondition(x: unknown): HuiWeatherCondition {
  const s = typeof x === 'string' ? x.trim().toLowerCase().replace(/[_\s]+/g, '-') : '';
  return (HUI_WEATHER_CONDITIONS as readonly string[]).includes(s) ? (s as HuiWeatherCondition) : 'cloudy';
}

function temp(x: unknown): number | undefined {
  const n = num(x);
  return n === undefined ? undefined : Math.min(200, Math.max(-100, n));
}
function pct(x: unknown): number | undefined {
  const n = num(x);
  return n === undefined ? undefined : Math.min(100, Math.max(0, n));
}

function normWeather(x: Rec, base: Rec): void {
  base.location = line(x.location, 100) ?? '';
  put(base, 'unit', oneOf(typeof x.unit === 'string' ? x.unit.trim().toUpperCase().replace(/^°/, '') : x.unit, ['C', 'F'] as const));
  if (isRec(x.current)) {
    const c = x.current;
    const t = temp(c.temp);
    if (t !== undefined) {
      const o: Rec = { temp: t, condition: normalizeWeatherCondition(c.condition) };
      put(o, 'feelsLike', temp(c.feelsLike));
      const wind = num(c.wind);
      put(o, 'wind', wind === undefined ? undefined : Math.min(400, Math.max(0, wind)));
      put(o, 'humidity', pct(c.humidity));
      put(o, 'precip', pct(c.precip));
      base.current = o;
    }
  }
  if (Array.isArray(x.hourly)) {
    const hourly: Rec[] = [];
    for (const r of x.hourly) {
      if (hourly.length >= MAX_WEATHER_HOURLY) break;
      if (!isRec(r)) continue;
      const t = temp(r.temp);
      let time: string | undefined;
      if (parseClock(r.time) !== undefined) {
        const iso = parseIso(r.time);
        time = iso ? iso.value : fmtClock(parseClock(r.time) as number);
      }
      if (t === undefined || !time) continue;
      const o: Rec = { time, temp: t, condition: normalizeWeatherCondition(r.condition) };
      put(o, 'precip', pct(r.precip));
      hourly.push(o);
    }
    base.hourly = hourly;
  }
  if (Array.isArray(x.daily)) {
    const daily: Rec[] = [];
    for (const r of x.daily) {
      if (daily.length >= MAX_WEATHER_DAILY) break;
      if (!isRec(r)) continue;
      const d = parseIso(r.date);
      let mn = temp(r.min);
      let mx = temp(r.max);
      if (!d || mn === undefined || mx === undefined) continue;
      if (mn > mx) [mn, mx] = [mx, mn];
      const o: Rec = { date: d.value.slice(0, 10), min: mn, max: mx, condition: normalizeWeatherCondition(r.condition) };
      put(o, 'precip', pct(r.precip));
      daily.push(o);
    }
    base.daily = daily;
  }
  provenance(base, x);
}

function score(x: unknown): number | undefined {
  const n = num(x);
  return n === undefined ? undefined : Math.min(10, Math.max(0, n));
}

/** like itemId, but never a prototype-sensitive name (ids become object keys in decision scores) */
function keyId(explicit: unknown, prefix: string, index: number, used: Set<string>): string {
  const e = line(explicit, 64);
  return itemId(e, prefix, index, used);
}

function normDecision(x: Rec, base: Rec): void {
  put(base, 'title', line(x.title, 200));
  const cUsed = new Set<string>();
  const criteria: Rec[] = [];
  const rawC = arr(x.criteria);
  for (let i = 0; i < rawC.length && criteria.length < MAX_DECISION_CRITERIA; i++) {
    const c = rawC[i];
    let label: string | undefined;
    let r: Rec = {};
    if (typeof c === 'string') label = line(c, 100);
    else if (isRec(c)) {
      label = line(c.label, 100);
      r = c;
    }
    if (!label) continue;
    criteria.push({ id: keyId(r.id, 'c', i, cUsed), label, weight: score(r.weight) ?? 5 });
  }
  base.criteria = criteria;
  const oUsed = new Set<string>();
  const options: Rec[] = [];
  const rawO = arr(x.options);
  const lookup = (key: string): string | undefined => {
    const byId = criteria.find((c) => c.id === key);
    if (byId) return byId.id as string;
    const k = key.trim().toLowerCase();
    return criteria.find((c) => (c.label as string).toLowerCase() === k)?.id as string | undefined;
  };
  for (let i = 0; i < rawO.length && options.length < MAX_DECISION_OPTIONS; i++) {
    const o = rawO[i];
    let label: string | undefined;
    let r: Rec = {};
    if (typeof o === 'string') label = line(o, 100);
    else if (isRec(o)) {
      label = line(o.label, 100);
      r = o;
    }
    if (!label) continue;
    const scores: Record<string, number> = {};
    if (Array.isArray(r.scores)) {
      // positional scores: same order as the criteria
      r.scores.forEach((v, ci) => {
        const sc = score(v);
        if (sc !== undefined && criteria[ci]) scores[criteria[ci].id as string] = sc;
      });
    } else if (isRec(r.scores)) {
      for (const [k, v] of Object.entries(r.scores)) {
        const sc = score(v);
        const cid = sc === undefined ? undefined : lookup(k);
        if (cid !== undefined && sc !== undefined) scores[cid] = sc;
      }
    }
    const item: Rec = { id: keyId(r.id, 'o', i, oUsed), label, scores };
    put(item, 'note', line(r.note, 300));
    options.push(item);
  }
  base.options = options;
  put(base, 'note', block(x.note, 1000));
}

function normRank(x: Rec, base: Rec): void {
  const used = new Set<string>();
  put(base, 'prompt', block(x.prompt, 500));
  const raw = arr(x.items);
  const items: Rec[] = [];
  for (let i = 0; i < raw.length && items.length < MAX_RANK_ITEMS; i++) {
    const it = raw[i];
    let label: string | undefined;
    let r: Rec = {};
    if (typeof it === 'string' || typeof it === 'number') label = line(it, 150);
    else if (isRec(it)) {
      label = line(it.label, 150);
      r = it;
    }
    if (!label) continue;
    const o: Rec = { id: itemId(r.id, 'i', i, used), label };
    put(o, 'description', line(r.description, 300));
    items.push(o);
  }
  base.items = items;
  put(base, 'submitLabel', line(x.submitLabel, 60));
}

function normScale(x: Rec, base: Rec): void {
  base.question = block(x.question, 500) ?? '';
  const lim = (n: number | undefined) => (n === undefined ? undefined : Math.min(1e6, Math.max(-1e6, n)));
  let min = lim(num(x.min)) ?? 1;
  let max = lim(num(x.max)) ?? 5;
  if (min > max) [min, max] = [max, min];
  if (max === min) max = min + 1;
  if (max - min > MAX_SCALE_RANGE) max = min + MAX_SCALE_RANGE;
  base.min = min;
  base.max = max;
  const st = num(x.step);
  const step = st !== undefined && st > 0 && st <= max - min ? st : undefined;
  put(base, 'step', step);
  let style = oneOf(x.style, ['slider', 'stars', 'emoji', 'segments'] as const);
  // discrete styles only make sense for a handful of steps
  if (style && style !== 'slider' && (max - min) / (step ?? 1) > 10) style = 'slider';
  put(base, 'style', style);
  if (isRec(x.labels)) {
    const labels: Rec = {};
    put(labels, 'min', line(x.labels.min, 40));
    put(labels, 'max', line(x.labels.max, 40));
    if (Object.keys(labels).length > 0) base.labels = labels;
  }
  if (Array.isArray(x.emojis)) {
    base.emojis = x.emojis
      .map((v) => line(v, 16))
      .filter((v): v is string => v !== undefined)
      .slice(0, MAX_SCALE_EMOJIS);
  }
}

// ───────────────────────── v4 modules (docs/SPEC-modules-v4.md) ─────────────────────────

function normSummary(x: Rec, base: Rec): void {
  base.text = block(x.text, 600) ?? '';
  if (Array.isArray(x.points)) {
    base.points = x.points
      .map((v) => line(v, 200))
      .filter((v): v is string => v !== undefined)
      .slice(0, MAX_SUMMARY_POINTS);
  }
  put(base, 'verdict', line(x.verdict, 200));
}

/** 0..5 star rating; "4,5" works; out of range is clamped, non-numbers dropped */
function rating(x: unknown): number | undefined {
  const n = num(x);
  return n === undefined ? undefined : Math.min(5, Math.max(0, Math.round(n * 10) / 10));
}
function count(x: unknown): number | undefined {
  const n = num(x);
  return n === undefined || n < 0 ? undefined : Math.min(1e9, Math.round(n));
}
/** [raw string list] → trimmed single-line strings, capped */
function lines(x: unknown, max: number, len: number): string[] {
  const out: string[] = [];
  const a = arr(x);
  for (let i = 0; i < a.length && out.length < max; i++) {
    const v = line(a[i], len);
    if (v !== undefined) out.push(v);
  }
  return out;
}
/** optional image URL (http/https only; the image trust policy decides at render time) */
function imageUrl(x: unknown): string | undefined {
  return safeHttpUrl(x);
}

function normPlacePrice(x: unknown): string | undefined {
  if (typeof x === 'number' && Number.isInteger(x) && x >= 1 && x <= 4) return HUI_PLACE_PRICES[x - 1];
  const s = typeof x === 'string' ? x.trim() : '';
  if (/^[€$£]{1,4}$/.test(s)) return HUI_PLACE_PRICES[s.length - 1];
  return undefined;
}

function normPlaces(x: Rec, base: Rec): void {
  put(base, 'title', line(x.title, 200));
  put(base, 'layout', oneOf(x.layout, ['carousel', 'list'] as const));
  const used = new Set<string>();
  const places: Rec[] = [];
  const raw = Array.isArray(x.places) ? x.places : arr(x.items);
  for (let i = 0; i < raw.length && places.length < MAX_PLACES; i++) {
    const r = raw[i];
    if (!isRec(r)) continue;
    const name = line(r.name, 150) ?? line(r.title, 150);
    if (!name) continue;
    const o: Rec = { id: itemId(r.id, 'p', i, used), name };
    put(o, 'category', line(r.category, 80));
    put(o, 'address', line(r.address, 250));
    const ll = latLng(r.lat, r.lng);
    if (ll) {
      o.lat = ll.lat;
      o.lng = ll.lng;
    }
    put(o, 'rating', rating(r.rating));
    put(o, 'reviews', count(r.reviews));
    put(o, 'price', normPlacePrice(r.price));
    put(o, 'openNow', bool(r.openNow));
    if (Array.isArray(r.hours)) o.hours = lines(r.hours, MAX_PLACE_HOURS, 100);
    put(o, 'hoursToday', line(r.hoursToday, 100));
    put(o, 'phone', normalizePhone(r.phone));
    put(o, 'website', safeHttpUrl(r.website));
    put(o, 'imageQuery', normalizeImageQuery(r.imageQuery));
    put(o, 'image', imageUrl(r.image));
    put(o, 'distance', line(r.distance, 40));
    put(o, 'note', line(r.note, 300));
    if (Array.isArray(r.tags)) o.tags = lines(r.tags, MAX_PLACE_TAGS, 40);
    places.push(o);
  }
  base.places = places;
  provenance(base, x);
}

function normProductSpecs(x: unknown): Rec[] {
  const out: Rec[] = [];
  // tolerate {"Akku": "30 h"} as well as [{label, value}]
  const entries: unknown[] = isRec(x) ? Object.entries(x).map(([label, value]) => ({ label, value })) : arr(x);
  for (const it of entries) {
    if (out.length >= MAX_PRODUCT_SPECS) break;
    if (typeof it === 'string') {
      // model variant: plain strings. "Akku: 30 h" → label/value; else a value-only spec (label '')
      const m = /^([^:]{1,60}):\s+(.+)$/.exec(it.trim());
      const label = m ? line(m[1], 60) : undefined;
      const value = line(m && label ? m[2] : it, 120);
      if (value) out.push({ label: label ?? '', value });
      continue;
    }
    if (!isRec(it)) continue;
    const label = line(it.label ?? it.name ?? it.key, 60);
    const value = line(it.value, 120);
    if (label && value) out.push({ label, value });
  }
  return out;
}

/** [{label, value 0..10}] (≤ 5); also tolerates {"Ergonomie": 9, …}; values clamped, one decimal. */
function normProductScores(x: unknown): Rec[] {
  const items: [unknown, unknown][] = Array.isArray(x) ? x.filter(isRec).map((it) => [it.label, it.value]) : isRec(x) ? Object.entries(x) : [];
  const out: Rec[] = [];
  for (const [l, v] of items) {
    if (out.length >= MAX_PRODUCT_SCORES) break;
    const label = line(l, 40);
    const value = num(v);
    if (!label || value === undefined) continue;
    out.push({ label, value: Math.round(Math.max(0, Math.min(10, value)) * 10) / 10 });
  }
  return out;
}

const CURRENCY_TOKENS: Readonly<Record<string, string>> = { '€': 'EUR', eur: 'EUR', euro: 'EUR', $: 'USD', usd: 'USD', '£': 'GBP', gbp: 'GBP', chf: 'CHF' };

/** product price: JSON number, a plain "229,99 €" / "$199" string (→ number + currency), else a display text */
function productPrice(x: unknown): { price?: number; currency?: string; text?: string } {
  const n = num(x);
  if (n !== undefined) return n >= 0 ? { price: Math.min(1e9, n) } : {};
  if (typeof x !== 'string') return {};
  const m = /^\s*(€|\$|£)?\s*(\d{1,9}(?:[.,]\d{1,2})?)\s*(€|\$|£|eur|euro|usd|gbp|chf)?\s*$/i.exec(x);
  if (m && !(m[1] && m[3])) {
    const v = Number(m[2].replace(',', '.'));
    const cur = m[1] ?? m[3];
    if (Number.isFinite(v)) return { price: v, ...(cur ? { currency: CURRENCY_TOKENS[cur.toLowerCase()] } : {}) };
  }
  return { text: line(x, 100) };
}

function normProducts(x: Rec, base: Rec): void {
  put(base, 'title', line(x.title, 200));
  put(base, 'layout', oneOf(x.layout, ['carousel', 'grid'] as const));
  put(base, 'compare', bool(x.compare));
  put(base, 'ranked', bool(x.ranked));
  const used = new Set<string>();
  const products: Rec[] = [];
  // model variant: `items` instead of `products`, `title`/`label` instead of `name`
  const raw = Array.isArray(x.products) ? x.products : arr(x.items);
  for (let i = 0; i < raw.length && products.length < MAX_PRODUCTS; i++) {
    const r = raw[i];
    if (!isRec(r)) continue;
    const name = line(r.name, 200) ?? line(r.title, 200) ?? line(r.label, 200);
    if (!name) continue;
    const o: Rec = { id: itemId(r.id, 'p', i, used), name };
    put(o, 'brand', line(r.brand, 80));
    put(o, 'imageQuery', normalizeImageQuery(r.imageQuery));
    put(o, 'image', imageUrl(r.image));
    const pr = productPrice(r.price);
    if (pr.price !== undefined) o.price = pr.price;
    put(o, 'currency', line(r.currency, 8) ?? pr.currency);
    // a display price ("ca. 229–244 USD") is kept as the price note instead of being dropped
    put(o, 'priceNote', line(r.priceNote, 100) ?? pr.text);
    put(o, 'rating', rating(r.rating));
    put(o, 'reviews', count(r.reviews));
    put(o, 'badge', line(r.badge, 40));
    put(o, 'verdict', line(r.verdict, 160));
    if (r.scores !== undefined) {
      const scores = normProductScores(r.scores);
      if (scores.length) o.scores = scores;
    }
    if (r.specs !== undefined) o.specs = normProductSpecs(r.specs);
    if (Array.isArray(r.pros)) o.pros = lines(r.pros, MAX_PRODUCT_PROS_CONS, 200);
    if (Array.isArray(r.cons)) o.cons = lines(r.cons, MAX_PRODUCT_PROS_CONS, 200);
    if (Array.isArray(r.offers)) {
      const offers: Rec[] = [];
      for (const of_ of r.offers) {
        if (offers.length >= MAX_PRODUCT_OFFERS) break;
        if (!isRec(of_)) continue;
        const merchant = line(of_.merchant, 80);
        const url = safeHttpUrl(of_.url);
        if (!merchant || !url) continue;
        const p = num(of_.price);
        const oo: Rec = { merchant, url };
        if (typeof of_.price === 'number' || (p !== undefined && typeof of_.price === 'string' && /^\s*[\d.,]+\s*$/.test(of_.price))) {
          if (p !== undefined && p >= 0) oo.price = Math.min(1e9, p);
        } else put(oo, 'price', line(of_.price, 40));
        offers.push(oo);
      }
      o.offers = offers;
    }
    put(o, 'url', safeHttpUrl(r.url));
    products.push(o);
  }
  base.products = products;
  provenance(base, x);
}

/** timer v2 fields on top of the v1 label/seconds/autostart (all optional, invalid → dropped) */
function normTimer(x: Rec, base: Rec): void {
  base.label = line(x.label, 100) ?? '';
  base.seconds = int(x.seconds, 0, 86400) ?? 0;
  put(base, 'autostart', bool(x.autostart));
  const until = parseIso(x.until);
  if (until) base.until = until.value;
  put(base, 'mode', oneOf(x.mode, ['countdown', 'stopwatch'] as const));
  if (Array.isArray(x.timers)) {
    const used = new Set<string>();
    const timers: Rec[] = [];
    const raw = x.timers;
    for (let i = 0; i < raw.length && timers.length < MAX_TIMERS; i++) {
      const r = raw[i];
      if (!isRec(r)) continue;
      const sec = num(r.seconds);
      if (sec === undefined || sec < 0.5) continue;
      const seconds = Math.min(86400, Math.round(sec));
      timers.push({ id: itemId(r.id, 't', i, used), label: line(r.label, 100) ?? '', seconds });
    }
    base.timers = timers;
  }
}

function normGuide(x: Rec, base: Rec): void {
  base.title = line(x.title, 200) ?? '';
  put(base, 'intro', block(x.intro, 1000));
  put(base, 'stuckLabel', line(x.stuckLabel, 80));
  const used = new Set<string>();
  const steps: Rec[] = [];
  const raw = arr(x.steps);
  for (let i = 0; i < raw.length && steps.length < MAX_GUIDE_STEPS; i++) {
    const r = raw[i];
    let title: string | undefined;
    let body: string | undefined;
    let rec: Rec = {};
    if (typeof r === 'string') body = block(r, 2000);
    else if (isRec(r)) {
      title = line(r.title, 200);
      body = block(r.body, 2000);
      rec = r;
    }
    if (!title && !body) continue;
    if (!title) title = (body as string).replace(/[#*_`>\-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60).trim() || '…';
    const o: Rec = { id: itemId(rec.id, 's', i, used), title, body: body ?? '' };
    put(o, 'imageQuery', normalizeImageQuery(rec.imageQuery));
    put(o, 'tip', block(rec.tip, 500));
    put(o, 'warning', block(rec.warning, 500));
    const sec = num(rec.seconds);
    if (sec !== undefined && sec >= 1) o.seconds = Math.min(86400, Math.round(sec));
    steps.push(o);
  }
  base.steps = steps;
}

function normReps(x: unknown): number | string | undefined {
  if (typeof x === 'number') return Number.isFinite(x) && x >= 1 ? Math.min(1000, Math.round(x)) : undefined;
  const s = line(x, 20);
  if (!s) return undefined;
  if (/^\d+$/.test(s)) return Math.min(1000, Math.max(1, Number(s)));
  return s;
}

function normWorkout(x: Rec, base: Rec): void {
  base.title = line(x.title, 200) ?? '';
  put(base, 'kind', oneOf(x.kind, HUI_WORKOUT_KINDS));
  put(base, 'warmup', block(x.warmup, 500));
  put(base, 'cooldown', block(x.cooldown, 500));
  const used = new Set<string>();
  const exercises: Rec[] = [];
  const raw = arr(x.exercises);
  for (let i = 0; i < raw.length && exercises.length < MAX_WORKOUT_EXERCISES; i++) {
    const r = raw[i];
    if (!isRec(r)) continue;
    const name = line(r.name, 150);
    if (!name) continue;
    const o: Rec = { id: itemId(r.id, 'e', i, used), name };
    const sets = num(r.sets);
    if (sets !== undefined && sets >= 1) o.sets = Math.min(50, Math.round(sets));
    put(o, 'reps', normReps(r.reps));
    const sec = num(r.seconds);
    if (sec !== undefined && sec >= 1) o.seconds = Math.min(86400, Math.round(sec));
    put(o, 'weight', line(r.weight, 30));
    put(o, 'restSeconds', int(r.restSeconds, 0, 3600));
    put(o, 'note', line(r.note, 300));
    put(o, 'imageQuery', normalizeImageQuery(r.imageQuery));
    exercises.push(o);
  }
  base.exercises = exercises;
}

function normStudyPlan(x: Rec, base: Rec): void {
  base.title = line(x.title, 200) ?? '';
  put(base, 'goal', block(x.goal, 500));
  if (!Array.isArray(x.weeks)) return;
  const used = new Set<string>();
  const taskIds = new Set<string>();
  const weeks: Rec[] = [];
  const rawW = x.weeks;
  for (let wi = 0; wi < rawW.length && weeks.length < MAX_STUDYPLAN_WEEKS; wi++) {
    const w = rawW[wi];
    if (!isRec(w)) continue;
    const label = line(w.label, 150) ?? '';
    const days: Rec[] = [];
    const rawD = arr(w.days);
    for (let di = 0; di < rawD.length && days.length < MAX_STUDYPLAN_DAYS; di++) {
      const d = rawD[di];
      if (!isRec(d)) continue;
      const dl = line(d.label, 60) ?? '';
      const tasks: Rec[] = [];
      const rawT = arr(d.tasks);
      for (let ti = 0; ti < rawT.length && tasks.length < MAX_STUDYPLAN_TASKS; ti++) {
        const t = rawT[ti];
        let text: string | undefined;
        let r: Rec = {};
        if (typeof t === 'string') text = line(t, 300);
        else if (isRec(t)) {
          text = line(t.text, 300);
          r = t;
        }
        if (!text) continue;
        const o: Rec = { id: itemId(r.id, `t${wi}-${di}-`, ti, taskIds), text };
        const min = num(r.minutes);
        if (min !== undefined && min >= 1) o.minutes = Math.min(1440, Math.round(min));
        put(o, 'kind', oneOf(r.kind, HUI_STUDY_TASK_KINDS));
        tasks.push(o);
      }
      if (!dl && tasks.length === 0) continue;
      days.push({ id: uniq(`d${wi}-${di}`, used), label: dl, tasks });
    }
    if (!label && days.length === 0) continue;
    weeks.push({ id: uniq(`w${wi}`, used), label, days });
  }
  base.weeks = weeks;
}

function normVocab(x: Rec, base: Rec): void {
  put(base, 'title', line(x.title, 200));
  base.from = normalizeLangCode(x.from);
  base.to = normalizeLangCode(x.to);
  put(base, 'mode', oneOf(x.mode, ['cards', 'quiz', 'type'] as const));
  const used = new Set<string>();
  const items: Rec[] = [];
  const raw = arr(x.items);
  for (let i = 0; i < raw.length && items.length < MAX_VOCAB_ITEMS; i++) {
    const r = raw[i];
    if (!isRec(r)) continue;
    const term = line(r.term, 200);
    const translation = line(r.translation, 200);
    if (!term || !translation) continue;
    const o: Rec = { id: itemId(r.id, 'v', i, used), term, translation };
    put(o, 'example', line(r.example, 300));
    put(o, 'note', line(r.note, 300));
    put(o, 'romanization', line(r.romanization, 200));
    items.push(o);
  }
  base.items = items;
}

function normMindmap(x: Rec, base: Rec): void {
  put(base, 'title', line(x.title, 200));
  const used = new Set<string>();
  let budget = MAX_MINDMAP_NODES;
  // pre-order, so a node's number never changes while the block streams
  const walk = (r: unknown, depth: number, path: string): Rec | undefined => {
    if (!isRec(r) || budget <= 0) return undefined;
    const label = line(r.label, 150);
    if (!label) return undefined;
    budget--;
    const o: Rec = { id: uniq(line(r.id, 64) ?? path, used), label };
    put(o, 'note', block(r.note, 600));
    if (Array.isArray(r.children) && depth < MAX_MINDMAP_DEPTH) {
      const kids: Rec[] = [];
      r.children.forEach((c, i) => {
        const k = walk(c, depth + 1, `${path}-${i}`);
        if (k) kids.push(k);
      });
      o.children = kids;
    }
    return o;
  };
  const rootRaw = isRec(x.root) ? x.root : {};
  // streaming: the root label may not have arrived yet → keep a root so the renderer has its slot
  base.root = walk(rootRaw, 0, 'm') ?? { id: 'm', label: '' };
}

// ── paths ──

/** badge tone words models use (lowercased, separators removed) → canonical tone */
const PATH_TONE_WORDS: Readonly<Record<string, HuiPathTone>> = {
  neutral: 'neutral', default: 'neutral', info: 'neutral', base: 'neutral', baseline: 'neutral', basis: 'neutral', grey: 'neutral', gray: 'neutral', muted: 'neutral', none: 'neutral', normal: 'neutral',
  good: 'good', positive: 'good', ok: 'good', okay: 'good', recommended: 'good', recommend: 'good', success: 'good', green: 'good', best: 'good', better: 'good', preferred: 'good', yes: 'good', pro: 'good', interesting: 'good',
  warn: 'warn', warning: 'warn', caution: 'warn', careful: 'warn', orange: 'warn', yellow: 'warn', amber: 'warn', risky: 'warn', mixed: 'warn', meh: 'warn',
  bad: 'bad', avoid: 'bad', negative: 'bad', danger: 'bad', red: 'bad', error: 'bad', critical: 'bad', poor: 'bad', worse: 'bad', no: 'bad', con: 'bad',
};

/** badge tone of a path row: canonical names + synonyms (good/positive/ok/recommended → good, …); unknown → neutral */
export function normalizePathTone(x: unknown): HuiPathTone {
  if (typeof x !== 'string') return 'neutral';
  const k = x.trim().toLowerCase().replace(/[\s_-]+/g, '');
  return Object.prototype.hasOwnProperty.call(PATH_TONE_WORDS, k) ? PATH_TONE_WORDS[k] : 'neutral';
}

/** icon words/emoji models use → icon of the fixed set (HUI_PATH_ICONS) */
const PATH_ICON_WORDS: Readonly<Record<string, HuiPathIcon>> = {
  mac: 'laptop', macos: 'laptop', macbook: 'laptop', notebook: 'laptop', computer: 'laptop', client: 'laptop', '💻': 'laptop',
  pc: 'desktop', monitor: 'desktop', screen: 'desktop', display: 'desktop', workstation: 'desktop', '🖥': 'desktop', '🖥️': 'desktop',
  mobile: 'phone', smartphone: 'phone', iphone: 'phone', android: 'phone', ios: 'phone', tablet: 'phone', '📱': 'phone',
  host: 'server', backend: 'server', api: 'server', bridge: 'server', rack: 'server', homeserver: 'server',
  web: 'globe', internet: 'globe', www: 'globe', browser: 'globe', world: 'globe', '🌐': 'globe',
  cloudstorage: 'cloud', icloud: 'cloud', s3: 'cloud', saas: 'cloud', '☁': 'cloud', '☁️': 'cloud',
  drive: 'disk', harddisk: 'disk', harddrive: 'disk', hdd: 'disk', ssd: 'disk', storage: 'disk', volume: 'disk', nas: 'disk', usb: 'disk', backup: 'disk', '💾': 'disk', '💽': 'disk',
  dir: 'folder', directory: 'folder', share: 'folder', sharedfolder: 'folder', mount: 'folder', '📁': 'folder', '📂': 'folder',
  document: 'file', doc: 'file', '📄': 'file',
  db: 'database', sql: 'database', postgres: 'database', sqlite: 'database', '🗄': 'database', '🗄️': 'database',
  net: 'network', lan: 'network', wifi: 'network', router: 'network', switch: 'network', tailscale: 'network', vpn: 'network', '📡': 'network',
  key: 'lock', secure: 'lock', security: 'lock', encrypted: 'lock', encryption: 'lock', shield: 'lock', auth: 'lock', '🔒': 'lock', '🔐': 'lock', '🔑': 'lock',
  person: 'user', human: 'user', account: 'user', me: 'user', '👤': 'user',
  application: 'app', program: 'app', software: 'app',
  docker: 'container', box: 'container', package: 'container', pod: 'container', '📦': 'container', '🐳': 'container',
  virtualmachine: 'vm', virtualbox: 'vm', hypervisor: 'vm', guest: 'vm', utm: 'vm', parallels: 'vm', qemu: 'vm',
  cli: 'terminal', shell: 'terminal', console: 'terminal', bash: 'terminal', command: 'terminal',
};

/** icon of a path node: one of HUI_PATH_ICONS (or a synonym / emoji for one); unknown → undefined (no icon, no error) */
export function normalizePathIcon(x: unknown): HuiPathIcon | undefined {
  if (typeof x !== 'string') return undefined;
  const raw = x.trim();
  const has = (k: string) => Object.prototype.hasOwnProperty.call(PATH_ICON_WORDS, k);
  if (has(raw)) return PATH_ICON_WORDS[raw];
  const k = raw.toLowerCase().replace(/[\s_-]+/g, '');
  if ((HUI_PATH_ICONS as readonly string[]).includes(k)) return k as HuiPathIcon;
  return has(k) ? PATH_ICON_WORDS[k] : undefined;
}

/** arrows models put into a chain written as ONE string ("macOS → APFS → SSD") */
const PATH_ARROW_RE = /\s*(?:→|->|=>|⇒|⟶|➜|➔|➝)\s*/;

/** path nodes: array of `{label, icon?, detail?}` or plain strings, or one "A → B → C" string; ≤ MAX_PATH_NODES */
function pathSteps(x: unknown): Rec[] {
  const a: unknown[] = typeof x === 'string' ? x.split(PATH_ARROW_RE) : arr(x);
  const out: Rec[] = [];
  for (let i = 0; i < a.length && out.length < MAX_PATH_NODES; i++) {
    const v = a[i];
    if (typeof v === 'string' || typeof v === 'number') {
      const label = line(v, 60);
      if (label) out.push({ label });
      continue;
    }
    if (!isRec(v)) continue;
    const label = line(v.label ?? v.title ?? v.name ?? v.text, 60);
    if (!label) continue;
    const o: Rec = { label };
    put(o, 'icon', normalizePathIcon(v.icon));
    put(o, 'detail', line(v.detail ?? v.note ?? v.sub, 80));
    out.push(o);
  }
  return out;
}

/** first array among the given keys (models write `rows`/`options`/`steps` … instead of the spec name) */
function firstArray(x: Rec, keys: readonly string[]): unknown[] {
  for (const k of keys) if (Array.isArray(x[k])) return x[k] as unknown[];
  return [];
}

const PATHS_ITEM_KEYS = ['items', 'rows', 'options', 'paths', 'variants', 'ways', 'routes'] as const;
const PATH_KEYS = ['path', 'steps', 'nodes', 'chain', 'flow', 'route'] as const;

function normPaths(x: Rec, base: Rec): void {
  put(base, 'title', line(x.title, 200));
  const used = new Set<string>();
  const raw = firstArray(x, PATHS_ITEM_KEYS);
  const items: Rec[] = [];
  for (let i = 0; i < raw.length && items.length < MAX_PATHS_ITEMS; i++) {
    const r = raw[i];
    if (!isRec(r)) continue;
    const title = line(r.title ?? r.label ?? r.name, 120);
    if (!title) continue;
    const it: Rec = { id: itemId(r.id, 'p', i, used), title };
    const b = r.badge ?? r.verdict ?? r.tag;
    if (typeof b === 'string' || typeof b === 'number') {
      const text = line(b, 40);
      if (text) it.badge = { text, tone: normalizePathTone(r.tone) };
    } else if (isRec(b)) {
      const text = line(b.text ?? b.label, 40);
      if (text) it.badge = { text, tone: normalizePathTone(b.tone ?? r.tone) };
    }
    const p = PATH_KEYS.find((k) => r[k] !== undefined);
    it.path = p ? pathSteps(r[p]) : [];
    put(it, 'note', line(r.note ?? r.description ?? r.detail, 200));
    items.push(it);
  }
  base.items = items;
  put(base, 'select', bool(x.select) ?? bool(x.selectable));
  provenance(base, x);
}

// ── blocks ──

/** box style words models use (lowercased, separators removed) → canonical style */
const BLOCK_STYLE_WORDS: Readonly<Record<string, HuiBlockStyle>> = {
  soft: 'soft', filled: 'soft', fill: 'soft', solid: 'soft', grey: 'soft', gray: 'soft', shaded: 'soft', default: 'soft',
  framed: 'framed', frame: 'framed', outline: 'framed', outlined: 'framed', border: 'framed', bordered: 'framed', stroke: 'framed', stroked: 'framed', boxed: 'framed', dashed: 'framed',
};

/** box style: `soft` / `framed` or a synonym (outlined/bordered → framed); `framed:true` / `outlined:true` → framed; unknown → undefined */
export function normalizeBlockStyle(x: Rec): HuiBlockStyle | undefined {
  if (typeof x.style === 'string') {
    const k = x.style.trim().toLowerCase().replace(/[\s_-]+/g, '');
    if (Object.prototype.hasOwnProperty.call(BLOCK_STYLE_WORDS, k)) return BLOCK_STYLE_WORDS[k];
  }
  if (bool(x.framed) === true || bool(x.outlined) === true || bool(x.outline) === true) return 'framed';
  if (bool(x.framed) === false || bool(x.filled) === true) return 'soft';
  return undefined;
}

const BLOCK_COLUMN_KEYS = ['columns', 'cols', 'groups', 'sides', 'stacks'] as const;
const BLOCK_ITEM_KEYS = ['items', 'boxes', 'nodes', 'children', 'blocks', 'parts'] as const;
const BLOCK_BASE_KEYS = ['base', 'shared', 'layer', 'foundation'] as const;

/** one box: `{label, sub?, icon?, style?, tone?}` or a plain string / number */
function blockItem(v: unknown): Rec | undefined {
  if (typeof v === 'string' || typeof v === 'number') {
    const label = line(v, 60);
    return label ? { label } : undefined;
  }
  if (!isRec(v)) return undefined;
  const label = line(v.label ?? v.title ?? v.name ?? v.text, 60);
  if (!label) return undefined;
  const o: Rec = { label };
  put(o, 'sub', line(v.sub ?? v.subtitle ?? v.detail ?? v.note ?? v.description, 80));
  put(o, 'icon', normalizePathIcon(v.icon));
  put(o, 'style', normalizeBlockStyle(v));
  if (v.tone !== undefined) o.tone = normalizePathTone(v.tone);
  return o;
}

/** shared layer under a column's grid: `{label, sub?, icon?}` or a plain string */
function blockBase(v: unknown): Rec | undefined {
  const it = blockItem(v);
  if (!it) return undefined;
  const o: Rec = { label: it.label };
  put(o, 'sub', it.sub);
  put(o, 'icon', it.icon);
  return o;
}

/** boxes per row: 1..3 (numbers and numeric strings, rounded and clamped); else undefined (renderer default) */
function blockGrid(x: unknown): 1 | 2 | 3 | undefined {
  const n = typeof x === 'number' ? x : typeof x === 'string' && x.trim() !== '' ? Number(x) : NaN;
  if (!Number.isFinite(n)) return undefined;
  return Math.min(3, Math.max(1, Math.round(n))) as 1 | 2 | 3;
}

/** one column: `{title?, grid?, items, base?}` (aliases boxes/nodes/children, shared/layer/foundation) or a bare array of boxes */
function blockColumn(v: unknown): Rec | undefined {
  const c: Rec | undefined = Array.isArray(v) ? { items: v } : isRec(v) ? v : undefined;
  if (!c) return undefined;
  const items: Rec[] = [];
  const raw = firstArray(c, BLOCK_ITEM_KEYS);
  for (let i = 0; i < raw.length && items.length < MAX_BLOCK_ITEMS; i++) {
    const it = blockItem(raw[i]);
    if (it) items.push(it);
  }
  const bk = BLOCK_BASE_KEYS.find((k) => c[k] !== undefined);
  const base = bk ? blockBase(c[bk]) : undefined;
  if (!items.length && !base) return undefined;
  const o: Rec = {};
  put(o, 'title', line(c.title ?? c.label ?? c.name ?? c.heading, 80));
  put(o, 'grid', blockGrid(c.grid ?? c.perRow ?? c.per_row));
  o.items = items;
  put(o, 'base', base);
  return o;
}

function normBlocks(x: Rec, base: Rec): void {
  put(base, 'title', line(x.title, 200));
  let raw = firstArray(x, BLOCK_COLUMN_KEYS);
  // no column list but boxes at the root ({items:[…], base}) → one column
  if (!raw.length && BLOCK_ITEM_KEYS.some((k) => Array.isArray(x[k]))) raw = [{ items: firstArray(x, BLOCK_ITEM_KEYS), base: BLOCK_BASE_KEYS.map((k) => x[k]).find((v) => v !== undefined) }];
  const columns: Rec[] = [];
  for (let i = 0; i < raw.length && columns.length < MAX_BLOCK_COLUMNS; i++) {
    const col = blockColumn(raw[i]);
    if (col) columns.push(col);
  }
  base.columns = columns;
  put(base, 'caption', line(x.caption ?? x.footnote ?? x.note, 200));
  provenance(base, x);
}

function norm(x: unknown, depth: number, ctx: Ctx, path: string): HuiNode | null {
  if (!isRec(x) || typeof x.type !== 'string') return null;
  if (++ctx.nodes > MAX_TREE_NODES) return null;
  x = withCanonicalType(x);
  if (!isRec(x) || typeof x.type !== 'string') return null;
  const base: Rec = { type: x.type };
  if (isInteractiveNodeType(x.type)) {
    // always a usable, per-tree-unique id (explicit or `<type>-<path>`)
    base.id = interactiveId(x.type, x.id, path, ctx);
  } else {
    const id = str(x.id);
    if (id !== undefined) base.id = id;
  }

  switch (x.type) {
    case 'card':
      put(base, 'title', str(x.title));
      put(base, 'subtitle', str(x.subtitle));
      put(base, 'imageQuery', normalizeImageQuery(x.imageQuery));
      base.children = children(x.children, depth, ctx, path);
      break;
    case 'stack':
      put(base, 'direction', oneOf(x.direction, ['vertical', 'horizontal'] as const));
      put(base, 'gap', oneOf(x.gap, ['s', 'm', 'l'] as const));
      base.children = children(x.children, depth, ctx, path);
      break;
    case 'text':
      base.text = str(x.text) ?? '';
      put(base, 'variant', oneOf(x.variant, ['title', 'body', 'caption', 'mono'] as const));
      break;
    case 'callout':
      base.tone = oneOf(x.tone, ['info', 'success', 'warning', 'danger'] as const) ?? 'info';
      put(base, 'title', str(x.title));
      base.text = str(x.text) ?? '';
      break;
    case 'stats':
      base.items = arr(x.items).slice(0, MAX_LIST_ITEMS).flatMap((it) => {
        if (!isRec(it)) return [];
        const label = str(it.label);
        const value = str(it.value);
        if (label === undefined && value === undefined) return [];
        const o: Rec = { label: label ?? '', value: value ?? '' };
        put(o, 'delta', str(it.delta));
        put(o, 'trend', oneOf(it.trend, ['up', 'down', 'flat'] as const));
        const spark = sparkline(it.sparkline);
        if (spark) o.sparkline = spark;
        return [o];
      });
      provenance(base, x);
      break;
    case 'table': {
      const columns = strList(x.columns).slice(0, MAX_TABLE_COLUMNS);
      base.columns = columns;
      base.rows = arr(x.rows)
        .filter(Array.isArray)
        .slice(0, MAX_TABLE_ROWS)
        .map((r) => (r as unknown[]).slice(0, Math.max(columns.length, 0)).map(normalizeCell));
      put(base, 'caption', str(x.caption));
      put(base, 'source', str(x.source));
      put(base, 'basis', basis(x.basis));
      break;
    }
    case 'chart': {
      const kind = oneOf(x.kind, CHART_KINDS) ?? 'bar';
      base.kind = kind;
      put(base, 'title', str(x.title));
      put(base, 'unit', str(x.unit));
      put(base, 'xLabel', str(x.xLabel));
      put(base, 'yLabel', str(x.yLabel));
      const series = arr(x.series)
        .slice(0, MAX_CHART_SERIES)
        .map((sr) => normalizeSeries(sr, kind))
        .filter((sr): sr is HuiChartSeries => sr !== null);
      if (kind === 'gauge') {
        // ONE canonical shape: series[0].data[0].y. A top-level `value` (or `data: [..]` shortcut) is moved there.
        if (!series[0] || series[0].data.length === 0) {
          const v = num(x.value);
          if (v !== undefined) series.splice(0, series.length, { name: series[0]?.name ?? '', data: [{ x: 'value', y: v }] });
        }
        series.splice(1);
      }
      base.series = series;
      if (kind === 'gauge' || kind === 'radar') {
        let min = num(x.min);
        let max = num(x.max);
        if (min !== undefined && max !== undefined && min > max) [min, max] = [max, min];
        if (kind === 'radar') {
          put(base, 'max', max !== undefined && max > 0 ? max : undefined);
        } else {
          put(base, 'min', min);
          put(base, 'max', max);
          put(base, 'target', num(x.target));
        }
      }
      provenance(base, x);
      break;
    }
    case 'list':
      put(base, 'style', oneOf(x.style, ['bullet', 'number', 'check'] as const));
      base.items = arr(x.items).slice(0, MAX_LIST_ITEMS).flatMap((it) => {
        if (typeof it === 'string') return [{ title: it }];
        if (!isRec(it)) return [];
        const title = str(it.title) ?? str(it.text) ?? str(it.label) ?? str(it.name);
        if (title === undefined) return [];
        const o: Rec = { title };
        put(o, 'subtitle', str(it.subtitle));
        put(o, 'trailing', str(it.trailing));
        put(o, 'icon', str(it.icon));
        put(o, 'imageQuery', normalizeImageQuery(it.imageQuery));
        return [o];
      });
      break;
    case 'steps':
      base.items = arr(x.items).slice(0, MAX_LIST_ITEMS).flatMap((it) => {
        if (typeof it === 'string') return [{ title: it }];
        if (!isRec(it)) return [];
        const title = str(it.title) ?? str(it.text) ?? str(it.label) ?? str(it.name) ?? str(it.step);
        if (title === undefined) return [];
        const o: Rec = { title };
        put(o, 'detail', str(it.detail) ?? str(it.description));
        put(o, 'imageQuery', normalizeImageQuery(it.imageQuery));
        return [o];
      });
      put(base, 'current', num(x.current));
      break;
    case 'timeline':
      base.items = arr(x.items ?? x.events).slice(0, MAX_LIST_ITEMS).flatMap((it) => {
        if (typeof it === 'string') return [{ time: '', title: it }];
        if (!isRec(it)) return [];
        const title = str(it.title) ?? str(it.event) ?? str(it.label) ?? str(it.text) ?? str(it.name);
        if (title === undefined) return [];
        const o: Rec = { time: str(it.time) ?? str(it.date) ?? str(it.year) ?? str(it.when) ?? str(it.period) ?? '', title };
        put(o, 'detail', str(it.detail) ?? str(it.description));
        put(o, 'imageQuery', normalizeImageQuery(it.imageQuery));
        return [o];
      });
      break;
    case 'compare':
      base.columns = arr(x.columns).slice(0, MAX_LIST_ITEMS).flatMap((c) => {
        if (!isRec(c)) return [];
        const o: Rec = { title: str(c.title) ?? '' };
        put(o, 'badge', str(c.badge));
        if (typeof c.highlight === 'boolean') o.highlight = c.highlight;
        o.items = strList(c.items);
        const pros = strList(c.pros);
        if (pros.length) o.pros = pros;
        const cons = strList(c.cons);
        if (cons.length) o.cons = cons;
        put(o, 'imageQuery', normalizeImageQuery(c.imageQuery));
        return [o];
      });
      provenance(base, x);
      break;
    case 'image': {
      // url (from a tool/source) or query (resolved in the app); while streaming the url may
      // still be partial – the renderer only loads complete http(s) URLs.
      const url = str(x.url);
      const query = normalizeImageQuery(x.query);
      if (!url && !query) return null;
      put(base, 'url', url || undefined);
      put(base, 'query', query);
      put(base, 'lang', normalizeWikiLang(x.lang));
      put(base, 'source', x.source === 'web' ? 'web' : undefined);
      put(base, 'alt', str(x.alt));
      put(base, 'caption', str(x.caption));
      const aspect = num(x.aspect);
      if (aspect !== undefined && aspect > 0) base.aspect = aspect;
      break;
    }
    case 'gallery': {
      base.items = arr(x.items)
        .flatMap((it) => {
          if (typeof it === 'string') {
            const q = normalizeImageQuery(it);
            return q ? [{ query: q }] : [];
          }
          if (!isRec(it)) return [];
          const o: Rec = {};
          const url = str(it.url);
          put(o, 'query', normalizeImageQuery(it.query));
          put(o, 'url', url || undefined);
          if (o.query === undefined && o.url === undefined) return [];
          put(o, 'source', it.source === 'web' ? 'web' : undefined);
          put(o, 'caption', str(it.caption));
          return [o];
        })
        .slice(0, MAX_GALLERY_ITEMS);
      const aspect = num(x.aspect);
      if (aspect !== undefined && aspect > 0) base.aspect = aspect;
      put(base, 'lang', normalizeWikiLang(x.lang));
      put(base, 'source', x.source === 'web' ? 'web' : undefined);
      break;
    }
    case 'progress':
      base.label = str(x.label) ?? '';
      base.value = num(x.value) ?? 0;
      put(base, 'max', num(x.max));
      break;
    case 'code':
      put(base, 'language', str(x.language));
      base.code = typeof x.code === 'string' ? x.code : '';
      break;
    case 'buttons':
      base.items = arr(x.items).slice(0, MAX_LIST_ITEMS).flatMap((it) => {
        if (!isRec(it)) return [];
        const action = normalizeAction(it.action);
        if (!action) return [];
        const o: Rec = { label: str(it.label) ?? '', action };
        put(o, 'style', oneOf(it.style, ['primary', 'secondary'] as const));
        return [o];
      });
      break;
    case 'suggestions':
      // models sometimes name the list after the node (`suggestions`) or `questions` / `options`
      base.items = strList(x.items ?? x.suggestions ?? x.questions ?? x.options);
      break;
    case 'form':
      put(base, 'title', str(x.title));
      base.fields = formFields(x.fields);
      base.submit = { label: (isRec(x.submit) ? str(x.submit.label) : undefined) ?? 'Senden' };
      break;
    case 'choice':
      normChoice(x, base);
      break;
    case 'checklist':
      normChecklist(x, base);
      break;
    case 'calc':
      normCalc(x, base);
      break;
    case 'map':
      normMap(x, base);
      break;
    case 'recipe':
      normRecipe(x, base);
      break;
    case 'tabs': {
      const tabs: Rec[] = [];
      const raw = arr(x.tabs);
      for (let i = 0; i < raw.length && tabs.length < MAX_TABS; i++) {
        const t = raw[i];
        if (!isRec(t)) continue;
        tabs.push({ label: line(t.label, 40) ?? `Tab ${i + 1}`, children: children(t.children, depth, ctx, `${path}.${i}`) });
      }
      base.tabs = tabs;
      break;
    }
    case 'accordion': {
      const items: Rec[] = [];
      const raw = arr(x.items);
      for (let i = 0; i < raw.length && items.length < MAX_ACCORDION_ITEMS; i++) {
        const t = raw[i];
        if (!isRec(t)) continue;
        items.push({ title: line(t.title, 200) ?? `Abschnitt ${i + 1}`, children: children(t.children, depth, ctx, `${path}.${i}`) });
      }
      base.items = items;
      const open = num(x.open);
      if (open !== undefined && Number.isInteger(open) && open >= 0 && open < 1000) base.open = open;
      break;
    }
    case 'quiz':
      normQuiz(x, base);
      break;
    case 'flashcards':
      normFlashcards(x, base);
      break;
    case 'sources':
      normSources(x, base);
      break;
    case 'timer':
      normTimer(x, base);
      break;
    case 'slots':
      normSlots(x, base);
      break;
    case 'confirm':
      base.title = line(x.title, 200) ?? '';
      put(base, 'text', block(x.text, 1000));
      put(base, 'confirmLabel', line(x.confirmLabel, 60));
      put(base, 'cancelLabel', line(x.cancelLabel, 60));
      put(base, 'tone', oneOf(x.tone, ['info', 'success', 'warning', 'danger'] as const));
      break;
    case 'translation':
      normTranslation(x, base);
      break;
    case 'poll':
      normPoll(x, base);
      break;
    case 'agenda':
      normAgenda(x, base);
      break;
    case 'weather':
      normWeather(x, base);
      break;
    case 'decision':
      normDecision(x, base);
      break;
    case 'rank':
      normRank(x, base);
      break;
    case 'scale':
      normScale(x, base);
      break;
    case 'summary':
      normSummary(x, base);
      break;
    case 'places':
      normPlaces(x, base);
      break;
    case 'products':
      normProducts(x, base);
      break;
    case 'guide':
      normGuide(x, base);
      break;
    case 'workout':
      normWorkout(x, base);
      break;
    case 'studyplan':
      normStudyPlan(x, base);
      break;
    case 'vocab':
      normVocab(x, base);
      break;
    case 'mindmap':
      normMindmap(x, base);
      break;
    case 'paths':
      normPaths(x, base);
      break;
    case 'blocks':
      normBlocks(x, base);
      break;
    default:
      // unknown type: pass through as-is for fallback rendering
      return x as unknown as HuiNode;
  }
  return base as unknown as HuiNode;
}

export interface NormalizeOptions {
  /**
   * Index path of this node inside its message, used for fallback ids of interactive nodes
   * (`<type>-<path>`). The stream parser passes the segment key (`seg-3`); default `n`.
   */
  path?: string;
  /** ids already used by other nodes of the same message (earlier segments) – duplicates get `-2`, `-3` … */
  reservedIds?: Iterable<string>;
}

/**
 * Coerce + cap a model-produced node. Never throws. Interactive nodes (INTERACTIVE_NODE_TYPES)
 * always come back with a string `id`: the explicit one (trimmed, ≤ 100 chars), or the
 * deterministic fallback `<type>-<path>`, e.g. `choice-seg-2` (top level) or `quiz-seg-2.1.0`
 * (child 0 of tab/accordion item 1 of the node in segment 2; indexes are positions in the model's
 * ORIGINAL arrays, so they stay stable while the block streams). Duplicate ids within the tree
 * (and vs. `reservedIds`) are made unique with a `-2`, `-3` … suffix, in document order.
 */
export function normalizeNode(x: unknown, opts?: NormalizeOptions): HuiNode | null {
  try {
    const ctx: Ctx = { used: new Set(opts?.reservedIds ?? []), nodes: 0 };
    return norm(coerceRoot(x), 0, ctx, opts?.path ?? 'n');
  } catch {
    return null;
  }
}

// ───────────────────────── model-variant tolerance ─────────────────────────
// Models sometimes wrap or rename nodes (seen in the wild: a document envelope
// `{"version":4,"title":…,"blocks":[{…products…}]}` with `items`/`title` instead of
// `products`/`name`). The variants below are unambiguous, so they are mapped onto the spec
// instead of failing the whole block. Anything else still passes through to the fallback card.

const KNOWN_TYPES: ReadonlySet<string> = new Set<string>(HUI_NODE_TYPES);

/** normalised alias key → canonical type (keys after normTypeKey) */
const TYPE_ALIASES: Readonly<Record<string, string>> = {
  'product-list': 'products',
  'products-list': 'products',
  'product-cards': 'products',
  'product-carousel': 'products',
  'product-grid': 'products',
  'product-compare': 'products',
  'product-comparison': 'products',
  'product-ranking': 'products',
  'ranked-products': 'products',
  'ranked-product-list': 'products',
  'top-products': 'products',
  'place-list': 'places',
  'places-list': 'places',
  'place-cards': 'places',
  'mind-map': 'mindmap',
  'study-plan': 'studyplan',
  'flash-cards': 'flashcards',
  'check-list': 'checklist',
  'todo-list': 'checklist',
  'shopping-list': 'checklist',
  'source-list': 'sources',
  'tldr': 'summary',
  'path-list': 'paths',
  'path-compare': 'paths',
  'path-comparison': 'paths',
  'block-diagram': 'blocks',
  'building-blocks': 'blocks',
  'architecture': 'blocks',
  'architecture-diagram': 'blocks',
  'architecture-overview': 'blocks',
};
/** alias keys that also mean `ranked: true` */
const RANKED_ALIASES: ReadonlySet<string> = new Set(['product-ranking', 'ranked-products', 'ranked-product-list', 'top-products']);
/** singular → plural is NOT applied to these (prefix of another type while the name streams in) */
// `block` is also a single-node wrapper key ({"block": {…}}), so it never means `blocks`
const NO_PLURAL: ReadonlySet<string> = new Set(['tab', 'block']);

/** "productList" / "Product_List" / "hui:products" → "product-list" / "products" */
function normTypeKey(t: string): string {
  return t
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/^hui[-:]/, '');
}

/**
 * Canonical node type for harmless model variants (case, separators, singular/plural, a few
 * aliases). Unknown names come back unchanged (→ fallback card), known names are returned as is.
 */
export function canonicalType(t: string): string {
  if (KNOWN_TYPES.has(t)) return t;
  let k = normTypeKey(t);
  if (KNOWN_TYPES.has(k)) return k;
  if (TYPE_ALIASES[k]) return TYPE_ALIASES[k];
  k = k.replace(/-(block|node|widget|component|module|view)$/, '');
  if (KNOWN_TYPES.has(k)) return k;
  if (TYPE_ALIASES[k]) return TYPE_ALIASES[k];
  if (!NO_PLURAL.has(k) && KNOWN_TYPES.has(k + 's')) return k + 's';
  if (k.endsWith('s') && KNOWN_TYPES.has(k.slice(0, -1))) return k.slice(0, -1);
  return t;
}

/**
 * `t` is not a node type yet but a strict prefix of exactly one ("product" → products while the
 * type string streams in). The stream parser keeps such a root unnormalised so the UI shows the
 * skeleton of the guessed type instead of switching between alias and real type mid-stream.
 */
export function isPartialTypeName(t: string): boolean {
  if (KNOWN_TYPES.has(t) || t === '') return false;
  for (const k of KNOWN_TYPES) if (k.startsWith(t)) return true;
  return false;
}

function withCanonicalType(x: Rec): Rec {
  const t = x.type as string;
  const canon = canonicalType(t);
  if (canon === t) return x;
  const out: Rec = { ...x, type: canon };
  if (canon === 'products' && x.ranked === undefined && RANKED_ALIASES.has(normTypeKey(t).replace(/-(block|node|widget|component|module|view)$/, ''))) out.ranked = true;
  return out;
}

function isTypedRec(x: unknown): boolean {
  return isRec(x) && typeof x.type === 'string' && x.type !== '';
}

/** single-object wrappers: {"node": {…}}, {"component": {…}} … */
const WRAPPER_KEYS = ['node', 'component', 'hui', 'ui', 'block', 'root', 'widget', 'element', 'data'];
/** document envelopes: {"version":4, "title":…, "blocks":[…]} */
const LIST_KEYS = ['blocks', 'nodes', 'components', 'children', 'elements', 'content', 'sections'];
/** envelope keys that carry no content */
const META_KEYS: ReadonlySet<string> = new Set(['version', 'schema', '$schema', 'format', 'kind', 'lang', 'locale']);
/** {"<type>": [...]} → which field of that type receives the array */
const SELF_LIST: Readonly<Record<string, string>> = {
  products: 'products',
  places: 'places',
  tabs: 'tabs',
  checklist: 'items',
  sources: 'items',
  steps: 'items',
  timeline: 'items',
  suggestions: 'items',
  gallery: 'items',
  flashcards: 'cards',
  quiz: 'questions',
  paths: 'items',
};

function nodesOf(list: unknown[], depth: number): Rec[] {
  const out: Rec[] = [];
  for (const v of list) {
    const c = coerceRoot(v, depth + 1);
    if (isTypedRec(c)) out.push(c as Rec);
  }
  return out;
}

/**
 * Root-level repair of a parsed ```hui value (before norm): a top-level array of nodes → `stack`
 * (one node → that node), document envelopes (`blocks`/`nodes`/… → nodes, envelope `title` moves
 * onto a single untitled node), single-key wrappers (`{"node":{…}}`, `{"products":{…}}`) and a
 * missing `type` next to a self-named list (`{"products":[…], "ranked":true}`). Never throws.
 */
export function coerceRoot(x: unknown, depth = 0): unknown {
  if (depth > 4) return x;
  if (Array.isArray(x)) {
    const nodes = nodesOf(x, depth);
    if (!nodes.length) return x;
    return nodes.length === 1 ? nodes[0] : { type: 'stack', children: nodes };
  }
  if (!isRec(x) || isTypedRec(x)) return x;
  const title = typeof x.title === 'string' && x.title.trim() ? x.title : undefined;
  for (const k of LIST_KEYS) {
    const v = x[k];
    if (!Array.isArray(v)) continue;
    const nodes = nodesOf(v, depth);
    if (!nodes.length) continue;
    if (nodes.length === 1) return title && nodes[0].title === undefined ? { ...nodes[0], title } : nodes[0];
    return { type: 'stack', children: title ? [{ type: 'text', text: title, variant: 'title' }, ...nodes] : nodes };
  }
  const content = Object.keys(x).filter((k) => !META_KEYS.has(k));
  for (const k of WRAPPER_KEYS) {
    const v = x[k];
    if (!isRec(v) && !Array.isArray(v)) continue;
    const c = coerceRoot(v, depth + 1);
    if (isTypedRec(c)) return title && content.length > 1 && (c as Rec).title === undefined ? { ...(c as Rec), title } : c;
  }
  for (const k of Object.keys(x)) {
    const t = canonicalType(k);
    if (!KNOWN_TYPES.has(t)) continue;
    const v = x[k];
    if (isRec(v) && content.length === 1) return withCanonicalType({ ...v, type: k });
    const field = SELF_LIST[t];
    if (Array.isArray(v) && field) {
      const rest: Rec = { ...x };
      delete rest[k];
      for (const m of META_KEYS) delete rest[m];
      return withCanonicalType({ ...rest, type: k, [field]: v });
    }
  }
  return x;
}

/** the list a list-like node exists to show (an empty one renders as an empty card) */
const COLLECTION_FIELD: Readonly<Record<string, string>> = {
  checklist: 'items',
  steps: 'items',
  timeline: 'items',
  list: 'items',
  stats: 'items',
  sources: 'items',
  gallery: 'items',
  paths: 'items',
  compare: 'columns',
  blocks: 'columns',
  products: 'products',
  places: 'places',
  quiz: 'questions',
  flashcards: 'cards',
};

/** a list-like node whose list came out empty (`checklist` with no items, `products` with no products …) */
export function isEmptyCollection(node: unknown): boolean {
  if (!isRec(node) || typeof node.type !== 'string') return false;
  const f = COLLECTION_FIELD[node.type];
  return f !== undefined && Array.isArray(node[f]) && node[f].length === 0;
}

/** the raw value carries readable list content somewhere (an array with a readable entry, depth ≤ 3) */
export function hasListContent(x: unknown, depth = 0): boolean {
  if (Array.isArray(x)) return x.some((v) => valueText(v) !== undefined);
  if (!isRec(x) || depth > 3) return false;
  return Object.values(x).some((v) => hasListContent(v, depth + 1));
}

// ───────────────────────── readable fallback ─────────────────────────

const TITLE_KEYS = ['name', 'title', 'label', 'heading', 'question', 'model', 'term', 'text'];
const SKIP_KEYS: ReadonlySet<string> = new Set(['type', 'id', 'image', 'imageQuery', 'icon', 'version', 'schema', '$schema']);
const MAX_FALLBACK_ITEMS = MAX_ACCORDION_ITEMS;

function scalarText(v: unknown): string | undefined {
  if (typeof v === 'string') return v.trim() || undefined;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'boolean') return v ? 'ja' : 'nein';
  return undefined;
}

/** any JSON value → one readable line (lists joined with " · ", objects as "k: v, …") */
function valueText(v: unknown, depth = 0): string | undefined {
  const s = scalarText(v);
  if (s !== undefined) return s;
  if (depth > 2) return undefined;
  if (Array.isArray(v)) {
    const parts = v.map((x) => valueText(x, depth + 1)).filter((x): x is string => !!x);
    return parts.length ? parts.join(' · ') : undefined;
  }
  if (isRec(v)) {
    // {label, value} pairs read naturally as "label: value"
    const lv = scalarText(v.label) ?? scalarText(v.name);
    const vv = valueText(v.value, depth + 1);
    if (lv && vv) return `${lv}: ${vv}`;
    const parts: string[] = [];
    for (const [k, x] of Object.entries(v)) {
      if (SKIP_KEYS.has(k)) continue;
      const t = valueText(x, depth + 1);
      if (t) parts.push(`${k}: ${t}`);
    }
    return parts.length ? parts.join(', ') : undefined;
  }
  return undefined;
}

function humanKey(k: string): string {
  const s = k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function fieldNodes(r: Rec, skip: string | undefined): Rec[] {
  const out: Rec[] = [];
  for (const [k, v] of Object.entries(r)) {
    if (k === skip || SKIP_KEYS.has(k)) continue;
    const t = valueText(v);
    if (!t) continue;
    const url = typeof v === 'string' ? safeHttpUrl(v) : undefined;
    out.push({ type: 'text', text: url ? `**${humanKey(k)}:** [${urlHost(url) ?? url}](${url})` : `**${humanKey(k)}:** ${t.slice(0, 1000)}` });
  }
  return out;
}

function titleOf(r: Rec): { key?: string; title?: string } {
  for (const k of TITLE_KEYS) {
    const t = scalarText(r[k]);
    if (t) return { key: k, title: t };
  }
  return {};
}

/** first array of objects (breadth-first, depth ≤ 3) */
function findRecordList(x: unknown, depth = 0): Rec[] | undefined {
  if (Array.isArray(x)) {
    const recs = x.filter(isRec);
    if (recs.length) return recs;
    return undefined;
  }
  if (!isRec(x) || depth > 3) return undefined;
  for (const v of Object.values(x)) if (Array.isArray(v) && v.some(isRec)) return v.filter(isRec);
  for (const v of Object.values(x)) {
    const r = findRecordList(v, depth + 1);
    if (r) return r;
  }
  return undefined;
}

/**
 * Last resort for a complete ```hui block that is valid JSON but no renderable node: a readable
 * view of its content (records → accordion "title / field: value", plain object → card), so the
 * answer is never just an error line. Returns null when there is nothing readable.
 */
export function readableFallback(x: unknown, opts?: NormalizeOptions): HuiNode | null {
  try {
    const top = isRec(x) ? titleOf(x) : {};
    const list = findRecordList(x);
    let raw: Rec | null = null;
    if (list && list.length) {
      const items = list.slice(0, MAX_FALLBACK_ITEMS).map((r, i) => {
        const { key, title } = titleOf(r);
        const children = fieldNodes(r, key);
        return { title: title ?? `${i + 1}.`, children: children.length ? children : [{ type: 'text', text: valueText(r) ?? '–' }] };
      });
      const acc = { type: 'accordion', items, open: 0 };
      raw = top.title ? { type: 'stack', children: [{ type: 'text', text: top.title, variant: 'title' }, acc] } : acc;
    } else if (isRec(x)) {
      const children = fieldNodes(x, top.key);
      if (children.length) raw = { type: 'card', title: top.title, children };
    }
    return raw ? normalizeNode(raw, opts) : null;
  } catch {
    return null;
  }
}
