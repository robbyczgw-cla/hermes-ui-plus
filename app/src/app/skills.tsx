import { lazy, Suspense } from 'react';

// lazy: Skills & memory stay out of the startup bundle (opened from Settings and /skills, /memory only)
const LibraryScreen = lazy(() => import('../library/LibraryScreen').then((m) => ({ default: m.LibraryScreen })));

export default function SkillsRoute() {
  return (
    <Suspense fallback={null}>
      <LibraryScreen />
    </Suspense>
  );
}
