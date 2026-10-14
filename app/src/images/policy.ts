// Image-loading policy for Wikimedia/Wikipedia photos resolved by query (Settings → Medien → Bilder laden).
// Direct image URLs from tools/sources/markdown are gated separately by trust.ts (unknown hosts: tap to load). Set by the preferences provider.
import { useSyncExternalStore } from 'react';

export type ImageLoadPolicy = 'always' | 'wifi' | 'never';

let policy: ImageLoadPolicy = 'always';
const listeners = new Set<() => void>();

export function setImageLoadPolicy(p: ImageLoadPolicy): void {
  if (p === policy) return;
  policy = p;
  listeners.forEach((l) => l());
}

export function getImageLoadPolicy(): ImageLoadPolicy {
  return policy;
}

type NetConn = { type?: string; effectiveType?: string; saveData?: boolean };

/**
 * Best effort "is this a metered connection?". Web: Network Information API (`navigator.connection`),
 * where available. Native: no network-info module is bundled → unknown (false), see TODO in the report.
 */
export function isMeteredConnection(nav: { connection?: NetConn } | undefined = (globalThis as { navigator?: { connection?: NetConn } }).navigator): boolean {
  const c = nav?.connection;
  if (!c) return false;
  if (c.saveData) return true;
  if (c.type === 'cellular') return true;
  return false;
}

/** Pure decision (tested). */
export function imagesAllowed(p: ImageLoadPolicy, metered: boolean): boolean {
  return p === 'always' || (p === 'wifi' && !metered);
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** React hook: may query images be resolved right now? Re-renders when the setting changes. */
export function useImagesAllowed(): boolean {
  const p = useSyncExternalStore(subscribe, getImageLoadPolicy, getImageLoadPolicy);
  return imagesAllowed(p, p === 'wifi' ? isMeteredConnection() : false);
}
