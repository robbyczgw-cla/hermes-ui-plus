/**
 * Coalesced checks keyed by an optional target (review M3): a request that arrives while a check runs is not
 * dropped – it is remembered and run in a follow-up pass right after the active one (duplicates merge; a
 * request without a target means "everything" and covers all targeted ones). Pure (node:test).
 */
export function createCoalescedCheck(run: (target?: string) => Promise<void>) {
  let active: Promise<void> | null = null;
  let all = false;
  const targets = new Set<string>();

  async function drain() {
    while (all || targets.size) {
      if (all) {
        all = false;
        targets.clear();
        await run(undefined).catch(() => {});
      } else {
        const [t] = targets;
        targets.delete(t);
        await run(t).catch(() => {});
      }
    }
  }

  return function request(target?: string): Promise<void> {
    if (target === undefined) all = true;
    else if (!all) targets.add(target);
    if (!active) {
      active = drain().finally(() => {
        active = null;
      });
    }
    return active;
  };
}
