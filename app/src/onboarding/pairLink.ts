// Pair links: `hermesuiplus://pair?u=<url>&c=<code>&n=<name>` (official build; personal builds: `hermesui://`; both and the retired `hermesiui://` are accepted) – shown as QR code by a UI bridge (or written by
// hand). Everything in a link is untrusted input (any website / QR sticker can produce one), so parsing is
// strict and pure; tested in pairLink.test.ts. The app must still show the target and ask before saving.
//
// Credentials: current bridges put a ONE-TIME pair code into the link (`c=`, valid 1 h, works once). The app
// redeems it (`redeemPairCode`: POST <root>/bridge/pair/redeem {code} → {token, deviceId, name}) and only keeps
// the returned device token; the code is dropped right after. Older bridges (and hand-written links) carry the
// token itself (`t=`) – still accepted. Neither the code nor the token is ever logged or shown.
//
// Optional parameters (all old links keep working):
//   kind=hermes          backend of the new profile (default and only kind: hermes)
//   m=<model>            model of the new profile ('' = server default)
// Web app (PWA): the same query in the URL fragment, `https://<host>/#pair?u=…` (the fragment never reaches
// the web server / its logs). Same-origin web app (bundle at `/`, API at `/v1` on one host): `u=` may be omitted
// or relative (`u=/v1`) – it is then resolved against the page origin the caller passes (`opts.origin`). `toPairLink` / `parsePairLink` accept that form and map it to `hermesui://pair?…`.
import { allowedPairKinds, FLAVOR, pairScheme, type Flavor } from '../flavor.ts';
import { displayHost, normalizeServerUrl, type NormalizedUrl, type UrlErrorCode } from './url.ts';

/** scheme of the links this build creates / registers; parsing accepts `hermesuiplus:`, `hermesiui:` and `hermesui:` */
export const PAIR_SCHEME = pairScheme();
export const PAIR_VERSION = 1;
export const MAX_PAIR_LINK_LENGTH = 4096;
export const MAX_TOKEN_LENGTH = 1024;
export const MAX_CODE_LENGTH = 256;
export const MAX_NAME_LENGTH = 48;
export const MAX_MODEL_LENGTH = 200;

export type PairKind = 'hermes';
export const PAIR_KINDS: readonly PairKind[] = ['hermes'];

export type PairErrorCode =
  | 'empty'
  | 'too-long'
  | 'not-pair-link'
  | 'bad-encoding'
  | 'duplicate-param'
  | 'missing-url'
  | 'unsupported-version'
  | 'bad-token'
  /** `c=` is not a plausible one-time code, or the link carries both `c=` and `t=` */
  | 'bad-code'
  | 'unsupported-kind'
  /** valid link, but for a backend / mode this build does not include (flavor.ts) */
  | 'unsupported-in-build'
  | 'bad-model'
  | `url-${UrlErrorCode}`;

export type PairData = {
  /** normalized base URL incl. /v1 */
  baseUrl: string;
  /** API key / bridge token; '' if the link carries none (or only a one-time `code` that still has to be redeemed) */
  token: string;
  /** one-time pair code (`c=`); '' = none. Redeem with `redeemPairCode` before probing / saving; never persist it. */
  code: string;
  /** sanitized display name (falls back to the host) */
  name: string;
  /** the name came from the link (untrusted – show the host next to it) */
  nameFromLink: boolean;
  url: NormalizedUrl;
  /** backend of the profile to create (`kind=`, default hermes) */
  kind: PairKind;
  /** `m=` model id ('' = none / server default) */
  model: string;
  /** `u=` was missing/relative and resolved against the page origin */
  sameOrigin: boolean;
};

export type PairParseOptions = {
  /** web: `window.location.origin` – enables missing/relative `u=` (same-origin API). Ignored if not http(s). */
  origin?: string | null;
  /** build flavor whose limits apply (default: this bundle's). Tests pass it explicitly. */
  flavor?: Flavor;
};

export type PairResult = { ok: true; pair: PairData } | { ok: false; error: PairErrorCode };

const LINK_RE = /hermes(?:uiplus|i?ui):\/{0,3}pair\/?(?:\?[^\s"'<>]*)?/i;
/** web app form: `https://<host>[/path]/#pair?…` or `#/pair?…` */
const WEB_LINK_RE = /https?:\/\/[^\s"'<>#]+#\/?pair\/?(\?[^\s"'<>]*)?/i;
/** free-text params: `+` means space (like `n`) */
const TEXT_PARAMS = new Set(['n']);

/** `https://host/#pair?…` → `hermesui://pair?…` (same query), else null. Accepts surrounding text. */
export function webToPairLink(input: string): string | null {
  const m = WEB_LINK_RE.exec(input);
  return m ? `${PAIR_SCHEME}://pair${m[1] ?? ''}` : null;
}

/** Quick check (no validation): does this string look like a pair link? Accepts surrounding text. */
export function isPairLink(input: string | null | undefined): boolean {
  return typeof input === 'string' && input.length <= MAX_PAIR_LINK_LENGTH * 2 && (LINK_RE.test(input) || WEB_LINK_RE.test(input));
}

/**
 * Parse + validate a pair link. Accepts the bare link, the link inside pasted text, `hermesui:///pair`
 * (some launchers add a slash) and `hermesui://pair/?…`. Rejects duplicate parameters (ambiguous: which
 * one did the user see?), malformed %-encoding, tokens that are not header-safe and non-http(s) URLs.
 */
export function parsePairLink(input: string | null | undefined, opts: PairParseOptions = {}): PairResult {
  const text = (input ?? '').trim();
  if (!text) return { ok: false, error: 'empty' };
  if (text.length > MAX_PAIR_LINK_LENGTH * 2) return { ok: false, error: 'too-long' };
  const m = LINK_RE.exec(text);
  const web = m ? null : WEB_LINK_RE.exec(text);
  if (!m && !web) return { ok: false, error: 'not-pair-link' };
  const raw = m ? m[0] : `${PAIR_SCHEME}://pair${web?.[1] ?? ''}`;
  // Embedded in prose ("…: hermesui://pair?…, viel Spaß") → drop trailing sentence punctuation.
  const link = (m ? m[0] : web?.[0]) === text ? raw : raw.replace(/[.,;:!?)\]]+$/, '');
  if (link.length > MAX_PAIR_LINK_LENGTH) return { ok: false, error: 'too-long' };

  const q = link.indexOf('?');
  const query = q === -1 ? '' : link.slice(q + 1).replace(/#.*$/, '');
  const params = new Map<string, string>();
  for (const part of query.split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const rawKey = eq === -1 ? part : part.slice(0, eq);
    const rawVal = eq === -1 ? '' : part.slice(eq + 1);
    let key: string;
    let val: string;
    try {
      key = decodeURIComponent(rawKey.replace(/\+/g, ' '));
      // `+` means space only in the free-text name; tokens (base64!) and URLs keep a literal `+`.
      val = decodeURIComponent(TEXT_PARAMS.has(key) ? rawVal.replace(/\+/g, '%20') : rawVal);
    } catch {
      return { ok: false, error: 'bad-encoding' };
    }
    if (params.has(key)) return { ok: false, error: 'duplicate-param' };
    params.set(key, val);
  }

  const v = params.get('v');
  if (v !== undefined && v !== String(PAIR_VERSION)) return { ok: false, error: 'unsupported-version' };

  let u = params.get('u');
  let sameOrigin = false;
  const origin = opts.origin && /^https?:\/\/[^/\s?#]+$/i.test(opts.origin) ? opts.origin : null;
  if (origin && (!u || (u.startsWith('/') && !u.startsWith('//')))) {
    u = `${origin}${u ?? ''}`;
    sameOrigin = true;
  }
  if (!u) return { ok: false, error: 'missing-url' };
  const url = normalizeServerUrl(u);
  if (!url.ok) return { ok: false, error: `url-${url.error}` };

  const token = params.get('t') ?? '';
  if (token && !isHeaderSafeToken(token)) return { ok: false, error: 'bad-token' };
  const code = params.get('c') ?? '';
  // a code and a token at once is ambiguous (which one would be used?) → refuse, like duplicate parameters
  if (params.has('c') && (!isPairCode(code) || token)) return { ok: false, error: 'bad-code' };

  const kindRaw = (params.get('kind') ?? 'hermes').toLowerCase();
  if (!(PAIR_KINDS as readonly string[]).includes(kindRaw)) return { ok: false, error: 'unsupported-kind' };
  const kind = kindRaw as PairKind;
  const flavor = opts.flavor ?? FLAVOR;
  if (!allowedPairKinds(flavor).includes(kind)) return { ok: false, error: 'unsupported-in-build' };

  const model = (params.get('m') ?? '').trim();
  if (model && !isSafeModelId(model)) return { ok: false, error: 'bad-model' };


  const cleanName = sanitizeName(params.get('n') ?? '');
  const name = cleanName || displayHost(url);
  return {
    ok: true,
    pair: { baseUrl: url.baseUrl, token, code, name, nameFromLink: !!cleanName, url, kind, model, sameOrigin },
  };
}


/** One-time pair codes (`c=`): visible ASCII without quotes/backslash, 6..256 chars (they go into a JSON body). */
export function isPairCode(code: string): boolean {
  return code.length >= 6 && code.length <= MAX_CODE_LENGTH && /^[\x21\x23-\x5b\x5d-\x7e]+$/.test(code);
}

/** Model ids go into the JSON request body: visible ASCII, no spaces, ≤ 200 chars. */
export function isSafeModelId(model: string): boolean {
  return model.length > 0 && model.length <= MAX_MODEL_LENGTH && /^[\x21-\x7e]+$/.test(model);
}

/**
 * Tokens go into `Authorization: Bearer <token>`: visible ASCII only (no spaces, CR/LF, unicode),
 * max 1024 chars. Also used to validate a manually entered API key.
 */
export function isHeaderSafeToken(token: string): boolean {
  return token.length > 0 && token.length <= MAX_TOKEN_LENGTH && /^[\x21-\x7e]+$/.test(token);
}

/**
 * Display name from untrusted input: strips control chars, bidi overrides / zero-width chars
 * (spoofing), collapses whitespace, caps the length.
 */
export function sanitizeName(name: string, max = MAX_NAME_LENGTH): string {
  const cleaned = name
     
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿￹-￻]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = Array.from(cleaned);
  return chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : cleaned;
}

export type PairLinkInput = {
  url: string;
  token?: string;
  /** one-time pair code (`c=`) */
  code?: string;
  name?: string;
  kind?: PairKind;
  model?: string;
};

function pairQuery(p: PairLinkInput): string {
  const parts = [`u=${encodeURIComponent(p.url)}`];
  if (p.code) parts.push(`c=${encodeURIComponent(p.code)}`);
  if (p.token) parts.push(`t=${encodeURIComponent(p.token)}`);
  if (p.name) parts.push(`n=${encodeURIComponent(p.name)}`);
  if (p.model) parts.push(`m=${encodeURIComponent(p.model)}`);
  return parts.join('&');
}

/** Build a pair link (for bridges/tests). `u` is encoded, so `?`/`&` inside the URL are safe. */
export function buildPairLink(p: PairLinkInput): string {
  return `${PAIR_SCHEME}://pair?${pairQuery(p)}`;
}

/** Web-app pair link: `<appUrl>#pair?…` (appUrl e.g. `https://host.example.ts.net/`). */
export function buildWebPairLink(appUrl: string, p: PairLinkInput): string {
  return `${appUrl.replace(/#.*$/, '')}#pair?${pairQuery(p)}`;
}

/**
 * Expo Router hands `+native-intent` either the full URL (`hermesui://pair?…`) or just the path
 * (`/pair?…`, `pair?…`). Returns the canonical pair link, or null if this isn't a pair link.
 */
export function toPairLink(pathOrUrl: string | null | undefined): string | null {
  if (typeof pathOrUrl !== 'string' || pathOrUrl.length > MAX_PAIR_LINK_LENGTH) return null;
  const s = pathOrUrl.trim();
  const m = LINK_RE.exec(s);
  if (m && m.index === 0) return m[0];
  const w = WEB_LINK_RE.exec(s);
  if (w && w.index === 0) return `${PAIR_SCHEME}://pair${w[1] ?? ''}`;
  const p = /^\/{0,3}pair\/?(\?[^\s"'<>]*)?$/i.exec(s);
  return p ? `${PAIR_SCHEME}://pair${p[1] ?? ''}` : null;
}

/**
 * Web: if the page URL's fragment is a pair link (`#pair?…` / `#/pair?…`), returns the canonical pair link
 * (null when the fragment is a malformed/oversized pair link) plus the same URL without the fragment, for
 * `history.replaceState` – the token must not stay in the address bar or the history. Any other URL → null.
 */
export function takeWebPairHash(href: string | null | undefined): { link: string | null; cleanUrl: string } | null {
  if (typeof href !== 'string') return null;
  const i = href.indexOf('#');
  if (i === -1 || !/^#\/?pair(?:[/?&]|$)/i.test(href.slice(i))) return null;
  return { link: toPairLink(href), cleanUrl: href.slice(0, i) };
}
