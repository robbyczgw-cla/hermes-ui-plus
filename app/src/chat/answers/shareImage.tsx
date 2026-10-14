/**
 * A6 "Als Bild teilen" – web build: hidden. The only capture path for react-native-web would be
 * html2canvas (a dependency, and unreliable with SVG icons/charts and cross-origin images), so the
 * option is not offered in the browser (docs/SPEC-modules-v4.md A6). Native: shareImage.native.tsx.
 */
import type { Segment } from '../../protocol/types';

export const SHARE_IMAGE_SUPPORTED = false;

export function ShareImageButton(_props: { segments: readonly Segment[] }) {
  return null;
}

export function ShareImageSheet(_props: { segments: readonly Segment[]; onDone(): void }) {
  return null;
}
