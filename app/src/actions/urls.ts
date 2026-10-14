/** Pure URL builders for maps / tel / mailto / sms. Platform is passed in (Platform.OS). */
import type { MapMode, ValidAction } from './types.ts';

export type Os = 'ios' | 'android' | 'web' | string;

const enc = encodeURIComponent;

/** Round to 6 decimals (~10 cm) and drop trailing zeros. */
export function coord(n: number): string {
  return String(Math.round(n * 1e6) / 1e6);
}

const GOOGLE_MODE: Record<MapMode, string> = { driving: 'driving', walking: 'walking', transit: 'transit' };
const APPLE_FLAG: Record<MapMode, string> = { driving: 'd', walking: 'w', transit: 'r' };

type MapsAction = Extract<ValidAction, { type: 'maps' }>;

function place(a: MapsAction): string {
  return a.lat !== undefined && a.lng !== undefined ? `${coord(a.lat)},${coord(a.lng)}` : (a.query ?? '');
}

/**
 * Candidate URLs in order of preference; the executor tries them until one opens.
 *  - Android without mode: `geo:` (opens the user's maps app), fallback google.com/maps.
 *  - with `mode` (route): Google Maps directions URL (also opens in the app via App Links).
 *  - iOS: Apple Maps (`maps.apple.com`), fallback Google Maps web.
 */
export function buildMapsUrls(a: MapsAction, os: Os): string[] {
  const dest = place(a);
  const hasCoords = a.lat !== undefined && a.lng !== undefined;
  const googleWeb = a.mode
    ? `https://www.google.com/maps/dir/?api=1&destination=${enc(dest)}&travelmode=${GOOGLE_MODE[a.mode]}`
    : `https://www.google.com/maps/search/?api=1&query=${enc(dest)}`;
  if (os === 'ios') {
    let apple: string;
    if (a.mode) {
      apple = `https://maps.apple.com/?daddr=${enc(dest)}&dirflg=${APPLE_FLAG[a.mode]}`;
    } else if (hasCoords) {
      apple = `https://maps.apple.com/?ll=${dest}&q=${enc(a.query ?? dest)}`;
    } else {
      apple = `https://maps.apple.com/?q=${enc(a.query ?? '')}`;
    }
    return [apple, googleWeb];
  }
  if (os === 'android' && !a.mode) {
    if (hasCoords) {
      const ll = `${coord(a.lat!)},${coord(a.lng!)}`;
      return [`geo:${ll}?q=${ll}${a.query ? `(${enc(a.query.replace(/[()]/g, ' '))})` : ''}`, googleWeb];
    }
    return [`geo:0,0?q=${enc(a.query ?? '')}`, googleWeb];
  }
  return [googleWeb];
}

export function buildTelUrl(phone: string): string {
  return `tel:${phone}`;
}

function crlf(s: string): string {
  return enc(s).replace(/%0A/g, '%0D%0A');
}

export function buildMailtoUrl(a: Extract<ValidAction, { type: 'email' }>): string {
  const to = a.to.map((x) => enc(x).replace(/%40/g, '@')).join(',');
  const q: string[] = [];
  if (a.subject) q.push(`subject=${enc(a.subject)}`);
  if (a.body) q.push(`body=${crlf(a.body)}`);
  return `mailto:${to}${q.length ? `?${q.join('&')}` : ''}`;
}

/** iOS separates the body with `&`, Android/others with `?` (RFC 5724 style). */
export function buildSmsUrl(a: Extract<ValidAction, { type: 'sms' }>, os: Os): string {
  const to = a.to.map((x) => enc(x).replace(/%2B/g, '+')).join(',');
  const body = a.body ? `${os === 'ios' ? '&' : '?'}body=${enc(a.body)}` : '';
  return `sms:${to}${body}`;
}
