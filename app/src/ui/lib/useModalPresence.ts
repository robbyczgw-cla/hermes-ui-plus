import { useEffect, useState } from 'react';

/**
 * For sheets built on RN `Modal`: true while `open`, and for `exitMs` after it closes (so the
 * fade-out still plays). A sheet returns `null` when this is false, so a closed sheet costs
 * nothing per parent render (no option lists, no Modal element).
 */
export function useModalPresence(open: boolean, exitMs = 350): boolean {
  const [present, setPresent] = useState(open);
  useEffect(() => {
    if (open) {
      setPresent(true);
      return;
    }
    const id = setTimeout(() => setPresent(false), exitMs);
    return () => clearTimeout(id);
  }, [open, exitMs]);
  return open || present;
}
