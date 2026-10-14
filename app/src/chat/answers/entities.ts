/**
 * A4 tappable entities (docs/SPEC-modules-v4.md): model-tagged `hui:` links and a conservative
 * client-side detector for phone numbers, e-mail addresses and dates in plain answer text.
 *
 * - `parseHuiHref('hui:place?q=…')` → entity or null. Only the known kinds (place/date/tel/price) become
 *   chips; any other `hui:` link renders as plain text (never navigable).
 * - `detectEntities(text)` splits a text run into text + detected entities. Single left-to-right pass with
 *   sticky regexes (linear); callers never run it on code spans, code blocks or table cells.
 *
 * Pure TS (erasable syntax only) so `node --test` can run it.
 */

export type HuiEntity =
  | { kind: 'place'; label: string; q: string; lat?: number; lng?: number }
  | { kind: 'date'; label: string; start: string; end?: string; title?: string; allDay: boolean }
  | { kind: 'tel'; label: string; n: string }
  | { kind: 'email'; label: string; to: string }
  | { kind: 'price'; label: string; v?: number; c?: string; q?: string };

export type EntityKind = HuiEntity['kind'];

const MAX_PARAM = 300;

function params(query: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of query.split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const k = (eq < 0 ? part : part.slice(0, eq)).trim();
    let v = eq < 0 ? '' : part.slice(eq + 1);
    try {
      v = decodeURIComponent(v.replace(/\+/g, ' '));
    } catch {
      // malformed escape: keep the raw text
    }
    if (k && !out.has(k)) out.set(k, v.trim().slice(0, MAX_PARAM));
  }
  return out;
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/** valid ISO 8601 date / date-time (calendar-checked) → normalised string, else null */
export function isoDate(s: string): string | null {
  const m = ISO_RE.exec(s.trim());
  if (!m) return null;
  const y = +m[1];
  const mo = +m[2];
  const d = +m[3];
  if (!validYmd(y, mo, d)) return null;
  if (m[4] !== undefined && (+m[4] > 23 || +m[5] > 59 || (m[6] !== undefined && +m[6] > 59))) return null;
  return s.trim().replace(' ', 'T');
}

function validYmd(y: number, mo: number, d: number): boolean {
  if (y < 1900 || y > 2200 || mo < 1 || mo > 12 || d < 1) return false;
  const dim = [31, y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
  return d <= dim;
}

const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);

/** phone: optional leading +, then 3–15 digits (separators stripped); no letters, `*` or `#` */
function phoneDigits(raw: string): string | null {
  const t = raw.trim();
  if (!/^\+?[\d\s()./-]+$/.test(t)) return null;
  const digits = t.replace(/\D/g, '');
  if (digits.length < 3 || digits.length > 15) return null;
  return (t.startsWith('+') ? '+' : '') + digits;
}

function num(s: string | undefined): number | undefined {
  if (s === undefined || s === '') return undefined;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

/** `hui:<kind>?<params>` → entity, or null (unknown kind / missing required params). */
export function parseHuiHref(href: string, label: string): HuiEntity | null {
  const h = href.trim();
  if (!/^hui:/i.test(h)) return null;
  const rest = h.slice(4);
  const qi = rest.indexOf('?');
  const kind = (qi < 0 ? rest : rest.slice(0, qi)).replace(/^\/+/, '').toLowerCase();
  const p = params(qi < 0 ? '' : rest.slice(qi + 1));
  const text = label.trim();
  switch (kind) {
    case 'place': {
      const q = p.get('q') || text;
      const lat = num(p.get('lat'));
      const lng = num(p.get('lng'));
      const geo = lat !== undefined && lng !== undefined && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
      if (!q && !geo) return null;
      return { kind: 'place', label: text || q, q, ...(geo ? { lat, lng } : {}) };
    }
    case 'date': {
      const start = isoDate(p.get('start') ?? '');
      if (!start) return null;
      const end = isoDate(p.get('end') ?? '') ?? undefined;
      const title = p.get('title') || undefined;
      return { kind: 'date', label: text || start, start, end: end && end >= start ? end : undefined, title, allDay: start.length === 10 };
    }
    case 'tel': {
      const n = phoneDigits(p.get('n') ?? '');
      if (!n) return null;
      return { kind: 'tel', label: text || n, n };
    }
    case 'price': {
      const v = num(p.get('v'));
      const c = p.get('c');
      const q = p.get('q') || undefined;
      if (v === undefined && !text) return null;
      return { kind: 'price', label: text || `${v}${c ? ` ${c}` : ''}`, v, c: c && /^[A-Za-z]{3}$/.test(c) ? c.toUpperCase() : undefined, q };
    }
    default:
      return null;
  }
}

/** Text to copy for an entity ("Kopieren"). */
export function entityCopyText(e: HuiEntity): string {
  switch (e.kind) {
    case 'tel':
      return e.n;
    case 'email':
      return e.to;
    case 'place':
      return e.q || e.label;
    default:
      return e.label;
  }
}

// ---------------------------------------------------------------- auto-detection

export type DetectedPart = string | HuiEntity;

// sticky matchers, tried only at candidate positions (linear overall)
const EMAIL_RE = /[A-Za-z0-9][A-Za-z0-9._%+-]{0,63}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?)*\.[A-Za-z]{2,24}/y;
/** +CC … (international) or 0AREA[ /-]… (national; at least one separator) */
const PHONE_INTL_RE = /\+\d{1,3}(?:[  /-]?\(?\d{1,5}\)?){1,6}/y;
const PHONE_NAT_RE = /0\d{1,5}(?:\)|[  ]?\/[  ]?|[  -])\d{2,}(?:[  -]\d{2,}){0,4}/y;
/** 2026-10-12, 2026-10-12 09:00, 2026-10-12T09:00, 2026-10-12T09:00:30.5+02:00 / …Z (seconds + zone consumed) */
const ISO_DATE_RE = /(\d{4})-(\d{2})-(\d{2})(?:(?:T| um | )(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})?)?/y;
/** 12.10.2026, 12.10.2026, 9:00 / 12.10.2026 um 9:00 Uhr / 12.10.2026 09:00 */
const DE_DATE_RE = /(\d{1,2})\.(\d{1,2})\.(\d{4})(?:(?:,? um |, | )(\d{1,2})[:.](\d{2})(?: Uhr)?)?/y;
/**
 * Does `s` end in an IBAN-like run (`[A-Z]{2}\d{2}` then letters/digits with single space/NBSP separators,
 * optional trailing separator)? Same language as the former regex `[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{1,4})*[ ]?$`,
 * whose nested quantifiers backtracked exponentially on e.g. "ZZ00AAAA…!" — this scan is linear.
 */
export function endsInIbanPrefix(s: string): boolean {
  const isSep = (c: string | undefined) => c === ' ' || c === '\u00a0';
  const isAlnum = (c: string) => (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9');
  // maximal suffix of [A-Z0-9] / separators without two separators in a row
  let k = s.length;
  while (k > 0) {
    const c = s[k - 1];
    if (isAlnum(c)) k--;
    else if (isSep(c) && !isSep(s[k])) k--;
    else break;
  }
  for (let p = k; p + 4 <= s.length; p++) {
    const a = s[p];
    const b = s[p + 1];
    if (a >= 'A' && a <= 'Z' && b >= 'A' && b <= 'Z' && isDigit(s[p + 2]) && isDigit(s[p + 3])) return true;
  }
  return false;
}

const isDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9';
/** chars at which `detectEntities` may start a match (global: `lastIndex` = search start) */
const CANDIDATE_RE = /[\d@+]/g;
const isWordChar = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}_]/u.test(c);
/** the whole code point ending right before `i` (surrogate pairs: "𐐀" is one letter, not two lone halves) */
function charBefore(src: string, i: number): string | undefined {
  if (i <= 0) return undefined;
  const lo = src.charCodeAt(i - 1);
  if (lo >= 0xdc00 && lo <= 0xdfff && i >= 2) {
    const hi = src.charCodeAt(i - 2);
    if (hi >= 0xd800 && hi <= 0xdbff) return src.slice(i - 2, i);
  }
  return src[i - 1];
}
/** the whole code point starting at `i` */
function charAt(src: string, i: number): string | undefined {
  if (i >= src.length) return undefined;
  const cp = src.codePointAt(i)!;
  return cp > 0xffff ? src.slice(i, i + 2) : src[i];
}

function at(re: RegExp, src: string, i: number): RegExpExecArray | null {
  re.lastIndex = i;
  return re.exec(src);
}

/** the match must not be glued to letters/digits/`.`/`-`/`/`/`:` on either side (versions, paths, ids) */
function cleanEdges(src: string, start: number, end: number): boolean {
  const before = charBefore(src, start);
  const after = charAt(src, end);
  if (isWordChar(before) || (before !== undefined && /[./:\-\\@#_=&?%~+]/.test(before))) return false;
  if (isWordChar(after)) return false;
  // "1.2.2026.4", "2026-10-12-x", "+43 660/12", trailing digit groups
  if (after !== undefined && /[\-/@\\_]/.test(after)) return false;
  if ((after === '.' || after === ':' || after === ',') && isDigit(src[end + 1])) return false;
  return true;
}

function deDate(m: RegExpExecArray): { start: string; allDay: boolean } | null {
  const d = +m[1];
  const mo = +m[2];
  const y = +m[3];
  if (!validYmd(y, mo, d)) return null;
  const date = `${y}-${pad(mo)}-${pad(d)}`;
  if (m[4] === undefined) return { start: date, allDay: true };
  const hh = +m[4];
  const mm = +m[5];
  if (hh > 23 || mm > 59) return null;
  return { start: `${date}T${pad(hh)}:${pad(mm)}`, allDay: false };
}

function isoMatch(m: RegExpExecArray): { start: string; allDay: boolean } | null {
  const y = +m[1];
  const mo = +m[2];
  const d = +m[3];
  if (!validYmd(y, mo, d)) return null;
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  if (m[4] === undefined) return { start: date, allDay: true };
  if (+m[4] > 23 || +m[5] > 59 || (m[6] !== undefined && +m[6] > 59)) return null;
  // seconds / zone kept like isoDate() does (a "Z" time is not a local 09:00)
  return { start: `${date}T${m[4]}:${m[5]}${m[6] !== undefined ? ':' + m[6] : ''}${m[7] ?? ''}`, allDay: false };
}

function tryAt(src: string, i: number): { entity: HuiEntity; end: number } | null {
  const c = src[i];
  if (c === '+' || c === '0') {
    const m = at(c === '+' ? PHONE_INTL_RE : PHONE_NAT_RE, src, i);
    if (m) {
      let raw = m[0];
      // a trailing ")" without its "(" belongs to the sentence
      if (raw.endsWith(')') && raw.split('(').length < raw.split(')').length) raw = raw.slice(0, -1);
      raw = raw.replace(/[\s/-]+$/, '');
      const end = i + raw.length;
      const digits = raw.replace(/\D/g, '');
      // national numbers need ≥ 7 digits; "05/2026" (month/year) and similar date-like tokens are not phone numbers
      const dateLike = /^(0[1-9]|1[0-2])[./-](19|20)\d{2}$/.test(raw);
      const enough = c === '+' ? digits.length >= 8 && digits.length <= 15 : !dateLike && digits.length >= 7 && digits.length <= 13;
      if (enough && cleanEdges(src, i, end) && !endsInIbanPrefix(src.slice(Math.max(0, i - 40), i))) {
        const n = phoneDigits(raw);
        if (n) return { entity: { kind: 'tel', label: raw, n }, end };
      }
    }
  }
  if (isDigit(c)) {
    // B6: only dates WITH a time become chips in prose — a bare date ("vom 12.10.2026") is just
    // reading text; chipping it loosened the line rhythm for no useful tap target. Model-tagged
    // `hui:date` links (parseHuiHref) still chip bare dates on purpose.
    const iso = at(ISO_DATE_RE, src, i);
    if (iso) {
      const v = isoMatch(iso);
      const end = i + iso[0].length;
      if (v && !v.allDay && cleanEdges(src, i, end)) return { entity: { kind: 'date', label: iso[0], start: v.start, allDay: v.allDay }, end };
    }
    const de = at(DE_DATE_RE, src, i);
    if (de) {
      const v = deDate(de);
      const end = i + de[0].length;
      if (v && !v.allDay && cleanEdges(src, i, end)) return { entity: { kind: 'date', label: de[0], start: v.start, allDay: v.allDay }, end };
    }
  }
  return null;
}

/**
 * Split `text` into plain strings and detected entities (phone numbers, e-mails, ISO / German dates
 * WITH a time — bare dates stay plain text, B6). Conservative: anything glued to letters, digits, dots, dashes or slashes is left alone, so
 * version numbers (1.2.3), IBANs, ids, paths and URLs never match. Returns `[text]` when nothing was found.
 */
export function detectEntities(text: string): DetectedPart[] {
  // cheap pre-check: entities need a digit or an "@"
  if (!/[\d@]/.test(text)) return [text];
  const out: DetectedPart[] = [];
  let last = 0;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '@') {
      // walk back to the start of the local part (bounded), then match forward
      let s = i;
      while (s > 0 && i - s < 64 && /[A-Za-z0-9._%+-]/.test(text[s - 1])) s--;
      while (s < i && !/[A-Za-z0-9]/.test(text[s])) s++;
      if (s >= last && s < i) {
        const m = at(EMAIL_RE, text, s);
        if (m) {
          const end = s + m[0].length;
          const before = text[s - 1];
          if ((before === undefined || !/[A-Za-z0-9./:@_-]/.test(before)) && !isWordChar(text[end]) && text[end] !== '@') {
            if (s > last) out.push(text.slice(last, s));
            out.push({ kind: 'email', label: m[0], to: m[0] });
            last = i = end;
            continue;
          }
        }
      }
      i++;
      continue;
    }
    if ((c === '+' || isDigit(c)) && (i === 0 || !isWordChar(charBefore(text, i)))) {
      const hit = tryAt(text, i);
      if (hit) {
        if (i > last) out.push(text.slice(last, i));
        out.push(hit.entity);
        last = i = hit.end;
        continue;
      }
      // skip the rest of this digit run: a match can't start inside it
      i++;
      while (i < n && (isDigit(text[i]) || text[i] === '.' || text[i] === '-')) i++;
      continue;
    }
    // every other char only advances: jump to the next candidate (`@`, `+`, digit) with a native search
    CANDIDATE_RE.lastIndex = i + 1;
    i = CANDIDATE_RE.exec(text)?.index ?? n;
  }
  if (!out.length) return [text];
  if (last < n) out.push(text.slice(last));
  return out;
}
