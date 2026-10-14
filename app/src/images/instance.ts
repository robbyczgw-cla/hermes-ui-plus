/** App-wide resolver instance (AsyncStorage-persisted cache, platform-appropriate UA headers). */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { createImageResolver, USER_AGENT } from './resolver';
import type { ResolvedImage } from './types';

// Browsers forbid setting User-Agent; Wikimedia accepts Api-User-Agent instead (CORS-allowed).
const headers: Record<string, string> = Platform.OS === 'web' ? { 'Api-User-Agent': USER_AGENT } : { 'User-Agent': USER_AGENT, 'Api-User-Agent': USER_AGENT };

export const imageResolver = createImageResolver({
  fetch: (url, init) => fetch(url, init),
  headers,
  storage: AsyncStorage,
});

export function resolveImage(query: string, lang = 'de'): Promise<ResolvedImage | null> {
  return imageResolver.resolve(query, lang);
}

