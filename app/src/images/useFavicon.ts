import { useMemo } from 'react';
import { planFavicon } from './favicon';
import { useImagesAllowed } from './policy';
import { imageLoadDecision, proxiedImagesAutoLoad, useImageTrustVersion } from './trust';
import type { ImageSourceSpec } from './proxy';
import { imageProxyFor, imageSourceFor, useImageProxyKey } from './web';

/**
 * expo-image source for the favicon of `pageUrl` under the image privacy settings (favicon.ts), or null for the
 * letter avatar. Re-plans on setting changes, unlocks and when the bridge image proxy comes or goes.
 */
export function useFaviconSource(pageUrl: string): ImageSourceSpec | null {
  const allowed = useImagesAllowed();
  const trustVer = useImageTrustVersion();
  const proxyKey = useImageProxyKey();
  return useMemo(() => {
    const uri = planFavicon(pageUrl, imageLoadDecision, { allowed, proxy: imageProxyFor, proxyAuto: proxiedImagesAutoLoad() });
    return uri ? imageSourceFor(uri) : null;
    // trustVer / proxyKey: the module state behind imageLoadDecision / imageProxyFor changed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageUrl, allowed, trustVer, proxyKey]);
}
