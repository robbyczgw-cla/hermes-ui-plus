import { useEffect, useState } from 'react';
import { Platform, useWindowDimensions } from 'react-native';
import { FINE_POINTER_QUERY, showKeyboardHints } from './keyboardHints';

function finePointerNow(): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(FINE_POINTER_QUERY).matches;
}

/** true when keyboard shortcuts hints make sense (web, mouse/trackpad, not the phone layout) */
export function useKeyboardHints(): boolean {
  const { width } = useWindowDimensions();
  const [fine, setFine] = useState(finePointerNow);
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(FINE_POINTER_QUERY);
    const on = () => setFine(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return showKeyboardHints({ platform: Platform.OS, width, finePointer: fine });
}
