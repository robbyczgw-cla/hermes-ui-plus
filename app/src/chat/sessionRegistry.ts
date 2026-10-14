// Session component registry (owner: integration-B). ChatScreen calls `getSessionComponent(kind)` for
// the open conversation's profile kind and renders the result inside <Suspense> with
// `key={conversation.id}` and the usual `SessionProps` (see ChatScreen.tsx).
//
// Returns null for kinds ChatScreen renders inline (`hermes` → HermesSession).
import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import { FLAVOR, isKindAllowed, type Flavor } from '../flavor.ts';
import type { SessionProps } from './ChatScreen';

export type SessionComponent = LazyExoticComponent<ComponentType<SessionProps>>;

// Offline demo: replays bundled scenarios, never touches the network.
const DemoSession = lazy(() => import('../onboarding/demo/DemoSession'));

const REGISTRY: Record<string, SessionComponent> = {
  demo: DemoSession,
};

/**
 * Lazy session component for a profile kind (`demo`), or
 * null for `hermes` (and unknown kinds) → ChatScreen renders its inline HermesSession.
 */
export function getSessionComponent(kind: string, flavor: Flavor = FLAVOR): SessionComponent | null {
  if (!isKindAllowed(kind, flavor)) return null;
  return REGISTRY[kind] ?? null;
}

/**
 * The session components this build renders, by kind (module constant). ChatScreen reads its component from
 * here instead of calling getSessionComponent during render: every entry is a module-level `lazy()` singleton,
 * so a kind always maps to the same component identity and a re-render never remounts the session – and
 * React's static-components lint can see that (a call result in render looks like a fresh component).
 */
export const SESSION_COMPONENTS: Readonly<Partial<Record<string, SessionComponent>>> = Object.freeze(
  Object.fromEntries(Object.keys(REGISTRY).flatMap((k) => {
    const c = getSessionComponent(k);
    return c ? [[k, c]] : [];
  })),
);
