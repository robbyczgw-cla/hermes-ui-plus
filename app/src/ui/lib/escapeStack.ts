// Esc closes the topmost overlay on web (drawer, bottom sheets, dialogs). Pure LIFO stack + a tiny DOM binding
// (tested in escapeStack.test.ts). Overlays register while open (useEscapeToClose); the newest one closes first.
// The key is handled on keydown; the matching keyup is swallowed so react-native-web's own Modal Esc handler
// (keyup) cannot close a second layer underneath in the same key press.

export type EscapeStack = {
  push(onEscape: () => void): () => void;
  /** handle one Esc press: true when an overlay took it */
  escape(): boolean;
  size(): number;
};

export function createEscapeStack(): EscapeStack {
  const entries: { id: number; cb: () => void }[] = [];
  let next = 1;
  return {
    push(cb) {
      const id = next++;
      entries.push({ id, cb });
      return () => {
        const i = entries.findIndex((e) => e.id === id);
        if (i !== -1) entries.splice(i, 1);
      };
    },
    escape() {
      const top = entries[entries.length - 1];
      if (!top) return false;
      top.cb();
      return true;
    },
    size: () => entries.length,
  };
}

type KeyEv = { key: string; defaultPrevented: boolean; isComposing?: boolean; preventDefault(): void; stopPropagation(): void };
type Target = { addEventListener(type: string, fn: (e: KeyEv) => void, capture?: boolean): void };

/** Bind a stack to `window` (once). keydown (bubble: inputs that handle Esc themselves win) + keyup swallow. */
export function bindEscapeStack(stack: EscapeStack, target: Target): void {
  let swallowKeyup = false;
  target.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return;
    if (stack.escape()) {
      e.preventDefault();
      swallowKeyup = true;
    }
  });
  target.addEventListener(
    'keyup',
    (e) => {
      if (e.key !== 'Escape' || !swallowKeyup) return;
      swallowKeyup = false;
      e.stopPropagation();
    },
    true,
  );
}
