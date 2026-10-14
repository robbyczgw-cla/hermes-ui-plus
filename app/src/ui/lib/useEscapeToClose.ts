import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { bindEscapeStack, createEscapeStack } from './escapeStack';

const stack = createEscapeStack();
let bound = false;

/** Web: Esc calls `onClose` while `active` (topmost registered overlay first). No-op on native. */
export function useEscapeToClose(active: boolean, onClose: (() => void) | undefined): void {
  const ref = useRef(onClose);
  useEffect(() => {
    ref.current = onClose;
  });
  const enabled = active && !!onClose;
  useEffect(() => {
    if (Platform.OS !== 'web' || !enabled || typeof window === 'undefined') return;
    if (!bound) {
      bound = true;
      bindEscapeStack(stack, window as unknown as Parameters<typeof bindEscapeStack>[1]);
    }
    return stack.push(() => ref.current?.());
  }, [enabled]);
}
