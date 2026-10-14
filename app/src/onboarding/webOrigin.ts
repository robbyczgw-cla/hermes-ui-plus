// Web app only: origin of the page (for same-origin pair links `u=/v1` / missing `u=` and the
// "Mit diesem Server verbinden" option). null on native.
import { Platform } from 'react-native';

export function pageOrigin(): string | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  const o = window.location?.origin;
  return typeof o === 'string' && /^https?:\/\//i.test(o) ? o : null;
}
