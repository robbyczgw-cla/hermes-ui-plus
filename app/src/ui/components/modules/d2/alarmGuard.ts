/**
 * Per-clock scheduling generations for the "done" alarm (GPT review #13). Every (re)arm and every clock
 * change starts a new generation; a scheduling result that completes for an older generation is cancelled
 * instead of stored. Without this, start + sound toggle during the permission prompt produced two live
 * alarms for the same `endsAt`, the last write hid the other, and pause/reset could not cancel the orphan.
 * Pure TS (no RN imports) so `node --test` can exercise the races.
 */
export type ArmGuard = {
  /** invalidate any in-flight scheduling for `key` (clock changed / removed) */
  bump(key: string): void;
  /**
   * Schedule via `schedule()`; commit the id only if no newer generation started meanwhile and
   * `stillWanted()` holds, otherwise cancel it. Resolves to the committed id or null.
   */
  arm(key: string, schedule: () => Promise<string | null>, stillWanted: () => boolean, commit: (id: string) => void, cancel: (id: string) => void): Promise<string | null>;
};

export function createArmGuard(): ArmGuard {
  const gen = new Map<string, number>();
  const bump = (key: string): number => {
    const g = (gen.get(key) ?? 0) + 1;
    gen.set(key, g);
    return g;
  };
  return {
    bump(key) {
      bump(key);
    },
    async arm(key, schedule, stillWanted, commit, cancel) {
      const mine = bump(key);
      const id = await schedule();
      if (!id) return null;
      if (gen.get(key) !== mine || !stillWanted()) {
        cancel(id);
        return null;
      }
      commit(id);
      return id;
    },
  };
}
