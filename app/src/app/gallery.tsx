import { useRouter } from 'expo-router';
import { lazy, Suspense } from 'react';
import { useEscapeToClose } from '../ui/lib/useEscapeToClose';

// lazy: the gallery (demo data, loader gallery, all samples) stays out of the startup bundle
const Gallery = lazy(() => import('../ui/Gallery').then((m) => ({ default: m.Gallery })));

export default function GalleryRoute() {
  const router = useRouter();
  // web: Esc closes the gallery like the header back button (B11)
  useEscapeToClose(true, () => (router.canGoBack() ? router.back() : router.replace('/')));
  return (
    <Suspense fallback={null}>
      <Gallery />
    </Suspense>
  );
}
