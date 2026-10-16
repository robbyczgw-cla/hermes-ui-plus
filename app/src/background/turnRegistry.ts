/**
 * Running chat turns, app-wide (pure module state, node:test). A turn belongs to its conversation, not to the
 * screen: the chat shell keeps the session of a running conversation mounted (hidden) when the user switches
 * chats, opens the drawer or settings, so the stream keeps going and keeps persisting to that conversation.
 *
 * Fed by the session components (chat/useSessionPersistence.ts → `useTurnActivity`), read by
 *  - ChatScreen: which hidden sessions stay mounted (`keptSessions`)
 *  - the drawer: "läuft" dot
 *  - the Android foreground service (background/keepAlive.ts): runs while any turn runs, and until the final
 *    transcript writes of ended turns are done (`settle`)
 *  - the notification "Stopp" action: `stopAll()`
 */

export type RunningTurn = {
  conversationId: string;
  profileId?: string;
  /** profile name for the ongoing notification ("Hermes antwortet …") */
  label: string;
  startedAt: number;
  /** aborts the turn (the hook's `stop`) */
  stop?: () => void;
};

/** at most this many turns keep running in hidden chats; a newer one stops the oldest */
export const MAX_BACKGROUND_TURNS = 3;

export type TurnRegistry = ReturnType<typeof createTurnRegistry>;

export function createTurnRegistry() {
  let turns: readonly RunningTurn[] = [];
  /** final transcript writes of ended turns still in flight */
  let saving = 0;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const fn of listeners) fn();
  };

  return {
    /** register (or refresh: label / stop function) the running turn of a conversation */
    begin(t: RunningTurn): void {
      const i = turns.findIndex((x) => x.conversationId === t.conversationId);
      if (i === -1) {
        turns = [...turns, t];
      } else {
        const prev = turns[i];
        // keep the original start time; only emit when something visible changed
        const next = { ...t, startedAt: prev.startedAt };
        if (prev.label === next.label && prev.stop === next.stop && prev.profileId === next.profileId) return;
        turns = turns.map((x, j) => (j === i ? next : x));
      }
      emit();
    },
    end(conversationId: string): void {
      if (!turns.some((x) => x.conversationId === conversationId)) return;
      turns = turns.filter((x) => x.conversationId !== conversationId);
      emit();
    },
    /**
     * The final write of an ended turn (chat/useSessionPersistence.ts): the keep-alive service, and with it the
     * headless task that keeps JS timers alive in the background, is held until it settled. Returns `write`.
     */
    settle<T>(write: Promise<T>): Promise<T> {
      saving++;
      if (saving === 1) emit();
      const done = () => {
        if (saving > 0 && --saving === 0) emit();
      };
      write.then(done, done);
      return write;
    },
    /** final writes still in flight (`settle`) */
    saving(): number {
      return saving;
    },
    isRunning(conversationId: string): boolean {
      return turns.some((x) => x.conversationId === conversationId);
    },
    /** immutable snapshot (stable identity until the next change → useSyncExternalStore) */
    snapshot(): readonly RunningTurn[] {
      return turns;
    },
    subscribe(fn: () => void): () => void {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    /** user pressed Stop for this conversation (drawer / notification) */
    stop(conversationId: string): boolean {
      const t = turns.find((x) => x.conversationId === conversationId);
      if (!t?.stop) return false;
      t.stop();
      return true;
    },
    /** notification "Stopp": abort every running turn */
    stopAll(): number {
      let n = 0;
      for (const t of turns) {
        if (t.stop) {
          t.stop();
          n++;
        }
      }
      return n;
    },
    /** tests */
    reset(): void {
      turns = [];
      saving = 0;
      emit();
    },
  };
}

/** the app-wide registry */
export const turnRegistry = createTurnRegistry();

/**
 * Conversations whose session stays mounted although they are not open: running turns, newest first, at most
 * `max`. The open chat is rendered anyway and never counted. A running turn that falls out of this list is
 * unmounted → its hook aborts it and the partial answer is persisted as `stopped`.
 */
export function keptSessions(activeId: string | null | undefined, running: readonly RunningTurn[], max = MAX_BACKGROUND_TURNS): string[] {
  return running
    .filter((t) => t.conversationId !== activeId)
    .slice()
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, Math.max(0, max))
    .map((t) => t.conversationId);
}

/**
 * Stable render order for the mounted sessions (open chat + kept ones): sorted by id, so switching between them
 * only flips visibility and React never re-parents (= remounts) a running session.
 */
export function mountedSessionIds(activeId: string | null | undefined, kept: readonly string[]): string[] {
  const ids = new Set(kept);
  if (activeId) ids.add(activeId);
  return [...ids].sort();
}

/** title/body of the ongoing notification for the running turns */
export function keepAliveText(running: readonly RunningTurn[], t: (key: 'title' | 'one' | 'many', vars?: Record<string, string | number>) => string): { title: string; text: string } {
  if (running.length <= 1) return { title: t('title', { name: running[0]?.label ?? '' }), text: t('one', { name: running[0]?.label ?? '' }) };
  return { title: t('title', { name: running[running.length - 1].label }), text: t('many', { count: running.length }) };
}
