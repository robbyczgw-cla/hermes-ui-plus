import { lazy, Suspense } from 'react';
import { usePreferences } from '../settings/PreferencesProvider';
import { RoutinesHidden } from '../routines/RoutinesHidden';

// lazy: Routines stay out of the startup bundle (opened from "Über <Name>" only)
const RoutinesScreen = lazy(() => import('../routines/RoutinesScreen').then((m) => ({ default: m.RoutinesScreen })));

export default function RoutinesRoute() {
  const { prefs, loaded } = usePreferences();
  // Settings → Chat → "Routinen" off on this device: an explanation with "Turn on Routines" instead of the screen
  if (!loaded) return null;
  if (!prefs.routines) return <RoutinesHidden />;
  return (
    <Suspense fallback={null}>
      <RoutinesScreen />
    </Suspense>
  );
}
