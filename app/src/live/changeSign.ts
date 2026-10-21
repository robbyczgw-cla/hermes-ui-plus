/**
 * The sign in front of a receipt line (live/ui/LiveNode.tsx `ChangeLine`, also in the history): one per kind of change,
 * so a line reads right without its screen-reader label. An item ticked again (✓) and one opened again (○, like an
 * empty checkbox) must never look alike (0.3 screen check: Hermes opened "Milch" again and the receipt
 * showed "✓ Milch").
 */
import type { ItemChange } from './model.ts';

export const CHANGE_SIGN: Record<ItemChange['kind'], string> = { added: '+', removed: '−', changed: '~', checked: '✓', unchecked: '○' };
