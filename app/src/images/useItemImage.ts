import { useEffect, useState } from 'react';
import { combinedImages, imageProxyFor, useImageProxyKey, useWebImagesEnabled } from './web';
import { useImagesAllowed } from './policy';
import { imageLoadDecision, proxiedImagesAutoLoad, useImageTrustVersion } from './trust';
import { createSearchQueue, peekItemImage, planItemImage, resolveItemImage, type ItemImageResult } from './itemImage';

/** App-wide search budget for item images: max 3 concurrent searches, identical queries share one run. */
const itemSearchQueue = createSearchQueue(3);
// places & co: web first, Wikipedia/Wikimedia as fallback · products (`webOnly`): web search only, never Wikimedia
// (keyless title matching turns "Cube Touring" into a horse carriage) → no web search = calm category icon
const search = (q: string, webOnly: boolean) => itemSearchQueue.run(`${webOnly ? 'w' : 'a'}|${q}`, () => combinedImages.resolve(q, undefined, webOnly ? 'only' : true));
const peek = (q: string, webOnly: boolean) => combinedImages.peek(q, undefined, webOnly ? 'only' : true);

export type ItemImageState = { status: 'idle' | 'loading' | 'done'; result: ItemImageResult };
const ICON: ItemImageResult = { kind: 'icon' };

/**
 * Image for a products/places item (order: `image` via the bridge image proxy → trusted `image` → `imageQuery` → `autoQuery` → tap-to-load
 * (`allowAsk`) → icon, see itemImage.ts). `webOnly` (products): searches never fall back to Wikipedia/Wikimedia. Nothing is searched before `visible` (lazy); `enabled: false`
 * (still streaming) stays idle.
 */
export function useItemImage(item: { image?: string; imageQuery?: string; autoQuery?: string }, opts: { visible: boolean; enabled?: boolean; allowAsk?: boolean; webOnly?: boolean }): ItemImageState {
  const trustVer = useImageTrustVersion();
  const allowed = useImagesAllowed();
  const webOn = useWebImagesEnabled();
  const enabled = opts.enabled ?? true;
  const allowAsk = !!opts.allowAsk;
  const webOnly = !!opts.webOnly;
  const proxyKey = useImageProxyKey();
  // answer-provided `image` URLs go through the user's bridge (when it has the proxy) – unless images are switched off;
  // "Erst nach Tippen" makes them wait for a tap like any unknown URL (trustVer re-plans on setting changes / taps)
  const plan = planItemImage(item, imageLoadDecision, { searchAllowed: allowed, proxy: allowed ? imageProxyFor : undefined, proxyAuto: proxiedImagesAutoLoad() });
  const sig = JSON.stringify([plan, allowAsk, webOn, trustVer, proxyKey, webOnly]);
  const cached = enabled ? peekItemImage(plan, (q) => peek(q, webOnly), allowAsk) : undefined;
  const [res, setRes] = useState<{ sig: string; result: ItemImageResult } | null>(null);
  const need = enabled && opts.visible && cached === undefined;

  useEffect(() => {
    if (!need) return;
    let alive = true;
    resolveItemImage(JSON.parse(sig)[0], (q) => search(q, webOnly), allowAsk).then((result) => {
      if (alive) setRes({ sig, result });
    });
    return () => {
      alive = false;
    };
  }, [need, sig, allowAsk, webOnly]);

  if (!enabled) return { status: 'idle', result: ICON };
  if (cached) return { status: 'done', result: cached };
  if (res && res.sig === sig) return { status: 'done', result: res.result };
  return { status: 'loading', result: ICON };
}
