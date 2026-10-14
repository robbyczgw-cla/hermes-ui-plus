import { Platform } from 'react-native';

/**
 * Text props for narrow columns (table cells, compare bullets, chips) on Android.
 *
 * React Native's Android default is `android_hyphenationFrequency="none"`. Minikin then has no break
 * opportunity inside a word – not even after an explicit "-" – so a word wider than the column is cut
 * at an arbitrary letter ("Hintergrundbeleucht|ung", "Vollfläche|n-Helligkeit"). With "normal" and the
 * high-quality breaker, Android prefers whole-word breaks and only hyphenates (with a visible "-") where
 * a word does not fit. iOS and web never break mid-word this way, so the props are Android-only.
 */
export const NARROW_TEXT_PROPS = (Platform.OS === 'android'
  ? { android_hyphenationFrequency: 'normal', textBreakStrategy: 'highQuality' }
  : {}) as { android_hyphenationFrequency?: 'normal'; textBreakStrategy?: 'highQuality' };
