import { Platform } from 'react-native';
import { a11yStateProps, type A11yStateLike } from './ariaState';

/**
 * `{...a11yState({ checked })}` on a raw Pressable / View: native reads `accessibilityState`, react-native-web gets the
 * aria-* attributes it would otherwise drop (ariaState.ts). Enforced by the a11y audit (a11yAudit.test.ts).
 */
export function a11yState<S extends A11yStateLike | undefined>(s: S, role?: string) {
  return a11yStateProps(s, Platform.OS, role);
}
