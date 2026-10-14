import { makeT, type TFn } from '../i18n/core.ts';
import type { ImageAttribution } from './types.ts';

const deT = makeT('de', 'de-DE');

/** Host (lowercase, no port, no "www.") of an http(s) URL, or null. */
export function urlHost(url: string | undefined): string | null {
  const m = /^https?:\/\/(?:[^@/?#]*@)?(\[[^\]]+\]|[^/?#:]+)/i.exec(url ?? '');
  return m ? m[1].toLowerCase().replace(/^www\./, '') : null;
}

/**
 * Hosts that must never be shown as an image credit: the user's own bridge / proxy ("hermes.local"),
 * LAN and tailnet names, bare IPs and single-label names. They say nothing about the image's origin.
 */
export function isInternalHost(host: string | null | undefined): boolean {
  const h = (host ?? '').toLowerCase().replace(/\.$/, '');
  if (!h) return true;
  if (h.startsWith('[') || h.includes(':')) return true; // IPv6 literal
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true; // IPv4 literal (public IPs are no useful credit either)
  if (!h.includes('.')) return true; // "localhost", "hermes", "nas"
  return /\.(local|localhost|lan|home|internal|intranet|corp|ts\.net|home\.arpa)$/.test(h);
}

/** The original image URL inside a proxy URL (`…/proxy?url=https%3A%2F%2F…`), if any. */
function proxiedOrigin(url: string | undefined): string | null {
  const m = /[?&](?:url|src|u)=([^&#]+)/i.exec(url ?? '');
  if (!m) return null;
  try {
    const inner = decodeURIComponent(m[1]);
    return /^https?:\/\//i.test(inner) ? inner : null;
  } catch {
    return null;
  }
}

const WIKIMEDIA = /(^|\.)(wikimedia|wikipedia)\.org$/;

/**
 * "Foto: Autor · CC BY-SA 4.0 · Wikimedia" (parts omitted when unknown); direct URLs → "Bild: host".
 * Internal hosts are never shown: a proxied URL credits its original host, a web search result
 * without a public host says "Bildersuche", anything else gets no credit line ('').
 */
export function attributionText(a: ImageAttribution, maxAuthor = 28, t: TFn = deT): string {
  if (a.provider === 'source' || a.provider === 'web') {
    const domain = a.domain?.toLowerCase().replace(/^www\./, '');
    const candidates = [domain, urlHost(a.sourceUrl), urlHost(proxiedOrigin(a.sourceUrl) ?? undefined)];
    const host = candidates.find((h): h is string => !!h && !isInternalHost(h));
    if (host && WIKIMEDIA.test(host)) return t('ui.image.photoCredit', { parts: 'Wikimedia Commons' });
    if (host) return t('ui.image.imageCredit', { host });
    return a.provider === 'web' ? t('ui.image.searchCredit') : '';
  }
  const parts: string[] = [];
  const author = a.author?.replace(/\s+/g, ' ').trim();
  if (author && !/^(unknown|unbekannt|anonymous|anonym)/i.test(author)) {
    parts.push(author.length > maxAuthor ? author.slice(0, maxAuthor - 1).trimEnd() + '…' : author);
  }
  if (a.license) parts.push(a.license);
  parts.push(a.provider === 'commons' ? 'Wikimedia Commons' : 'Wikimedia');
  return t('ui.image.photoCredit', { parts: parts.join(' · ') });
}

/** Link target of the credit line: `sourceUrl`, or the original behind a proxy URL; never the user's own bridge / LAN. */
export function attributionUrl(a: ImageAttribution): string | null {
  if (!isInternalHost(urlHost(a.sourceUrl))) return a.sourceUrl;
  const origin = proxiedOrigin(a.sourceUrl);
  return origin && !isInternalHost(urlHost(origin)) ? origin : null;
}
