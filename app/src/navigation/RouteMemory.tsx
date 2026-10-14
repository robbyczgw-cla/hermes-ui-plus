import { usePathname, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { rememberRoute, takeRouteToRestore } from './routeMemory';

/** Remembers the current route and reopens it after an Android activity recreation (see routeMemory.ts). */
export function RouteMemory() {
  const pathname = usePathname();
  const router = useRouter();
  // lazy initializer: read exactly once, before the first rememberRoute below overwrites it with the start route
  const [pending] = useState(() => (Platform.OS === 'android' ? takeRouteToRestore() : null));
  useEffect(() => {
    if (pending) router.push(pending as never);
    // once per mount: a later router identity change must not navigate again
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (pathname) rememberRoute(pathname);
  }, [pathname]);
  return null;
}
