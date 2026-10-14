// Keyboard hints ("↑↓ wählen · Enter · Esc", "Strg + Mausrad zum Zoomen") only where a physical keyboard and a
// mouse are likely: web, a fine pointer (mouse / trackpad) and not the phone layout. Pure; tested in
// keyboardHints.test.ts (useKeyboardHints.ts binds it to the window).
import { layoutClass } from './layout.ts';

export type HintEnv = { platform: string; width: number; finePointer: boolean };

export function showKeyboardHints(env: HintEnv): boolean {
  return env.platform === 'web' && env.finePointer && layoutClass(env.width) !== 'phone';
}

/** `(pointer: fine)` of the primary input, also true when any input is fine and hovers (desktop + touch screen) */
export const FINE_POINTER_QUERY = '(pointer: fine), (any-pointer: fine) and (any-hover: hover)';
