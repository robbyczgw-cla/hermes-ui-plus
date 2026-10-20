import { useLocalSearchParams, useRouter } from 'expo-router';
import { lazy, Suspense } from 'react';
import { useEscapeToClose } from '../ui/lib/useEscapeToClose';

// lazy: the gallery (demo data, loader gallery, all samples) stays out of the startup bundle
const Gallery = lazy(() => import('../ui/Gallery').then((m) => ({ default: m.Gallery })));
// `?fixtures=render`: every node type with degenerate data (scripts/ux-check/render-sweep.mjs)
const RenderSweep = lazy(() => import('../ui/RenderSweep').then((m) => ({ default: m.RenderSweep })));

export default function GalleryRoute() {
  const router = useRouter();
  const { fixtures, only } = useLocalSearchParams<{ fixtures?: string; only?: string }>();
  // web: Esc closes the gallery like the header back button (B11)
  useEscapeToClose(true, () => (router.canGoBack() ? router.back() : router.replace('/')));
  return <Suspense fallback={null}>{fixtures === 'render' ? <RenderSweep only={typeof only === 'string' ? only : undefined} /> : <Gallery />}</Suspense>;
}
