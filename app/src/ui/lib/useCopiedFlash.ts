import { useEffect, useState } from 'react';
import { COPIED_MS, createCopiedFlash } from './copiedFlash';

/** `[copied, flash]`: call `flash()` after copying; `copied` is true for COPIED_MS (timer cleared on unmount). */
export function useCopiedFlash(ms: number = COPIED_MS): [boolean, () => void] {
  const [copied, setCopied] = useState(false);
  const [ctl] = useState(() => createCopiedFlash(setCopied, ms));
  useEffect(() => ctl.dispose, [ctl]);
  return [copied, ctl.flash];
}
