// Keyboard operation of the composer mic button on web. The button is a View with role="button" under a touch
// GestureDetector (MicButton): react-native-web makes it a tab stop but only wires pointer events, so Enter / Space did
// nothing. Enter acts on keydown, Space on keyup (like a native button); modifiers and key repeat are ignored.
import { tapDictation, type PressDictation } from './holdPress.ts';

type KeyEvent = { key?: string; repeat?: boolean; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; preventDefault?: () => void };

const plain = (e: KeyEvent) => !e.altKey && !e.ctrlKey && !e.metaKey;

export function micKeyProps(o: { dictation: Pick<PressDictation, 'phase' | 'start' | 'stop' | 'cancel'>; disabled?: boolean }): Record<string, unknown> {
  return {
    onKeyDown: (e: KeyEvent) => {
      if (o.disabled || !plain(e)) return;
      if (e.key === ' ') e.preventDefault?.(); // no page scroll; the tap itself happens on keyup
      else if (e.key === 'Enter' && !e.repeat) {
        e.preventDefault?.();
        tapDictation(o.dictation);
      }
    },
    onKeyUp: (e: KeyEvent) => {
      if (o.disabled || !plain(e) || e.key !== ' ') return;
      e.preventDefault?.();
      tapDictation(o.dictation);
    },
  };
}
