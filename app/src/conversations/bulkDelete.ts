/**
 * Deleting many chats at once (drawer selection mode, Settings → "Alle Chats löschen"). Pure, node:test.
 *
 * - `selectionReducer`: which rows are ticked in the drawer's selection mode
 * - `applyListFilter`: the optional selection filters ("Älter als 7 Tage", "Nur dieses Profil")
 * - `planDelete`: what a delete really touches: running turns are skipped, pinned chats only when asked,
 *   and only the app's own Hermes chats (source api_server + `hui-` id) may ever be deleted on Hermes
 * - `createBulkDeleter`: ONE index update hides the chats at once, the data stays for the undo window
 *   (~6 s); then transcripts / attachments / node state are removed in the background and only after
 *   that the (optional) Hermes DELETEs go out. Foreign sessions (Telegram/CLI/cron/other clients) and
 *   non-Hermes chats (demo, …: no server-side delete exists) are local only.
 *
 * Why running turns are skipped (not stopped first): the hidden session keeps persisting the stream, and a
 * stopped turn still finishes on the server – the sync could bring the chat right back. Skipping is the
 * predictable choice; the dialog says how many were skipped.
 */
import type { IndexStore } from './store.ts';
import { hiddenKey, isAppConversation } from './remoteSync.ts';
import type { ConversationMeta } from './types.ts';

// ------------------------------------------------------------------ selection

export type SelectionState = { active: boolean; selected: ReadonlySet<string> };
export const EMPTY_SELECTION: SelectionState = { active: false, selected: new Set() };

export type SelectionAction =
  /** enter selection mode (long press: with that row ticked) */
  | { type: 'enter'; id?: string }
  | { type: 'exit' }
  | { type: 'toggle'; id: string }
  /** "Alle auswählen": tick every one of `ids` (keeps the ticks that are already there) */
  | { type: 'selectAll'; ids: readonly string[] }
  /** "Keine" */
  | { type: 'clear' }
  /** drop ticks of rows that are no longer shown (filter changed, deleted elsewhere, turn started) */
  | { type: 'retain'; ids: readonly string[] };

export function selectionReducer(s: SelectionState, a: SelectionAction): SelectionState {
  switch (a.type) {
    case 'enter':
      if (s.active && (!a.id || s.selected.has(a.id))) return s;
      return { active: true, selected: a.id ? new Set([...(s.active ? s.selected : []), a.id]) : s.active ? s.selected : new Set() };
    case 'exit':
      return s.active || s.selected.size ? EMPTY_SELECTION : s;
    case 'toggle': {
      if (!s.active) return s;
      const next = new Set(s.selected);
      if (next.has(a.id)) next.delete(a.id);
      else next.add(a.id);
      return { ...s, selected: next };
    }
    case 'selectAll': {
      if (!s.active) return s;
      const missing = a.ids.filter((id) => !s.selected.has(id));
      return missing.length ? { ...s, selected: new Set([...s.selected, ...missing]) } : s;
    }
    case 'clear':
      return s.selected.size ? { ...s, selected: new Set() } : s;
    case 'retain': {
      const keep = new Set(a.ids);
      const next = [...s.selected].filter((id) => keep.has(id));
      return next.length === s.selected.size ? s : { ...s, selected: new Set(next) };
    }
    default:
      return s;
  }
}

// ------------------------------------------------------------------ filters

export const DAY_MS = 24 * 60 * 60 * 1000;
export type ListFilter = { olderThanDays?: number; profileId?: string };

export function applyListFilter<T extends Pick<ConversationMeta, 'updatedAt' | 'profileId'>>(items: readonly T[], f: ListFilter, now: number): T[] {
  return items.filter((c) => (!f.olderThanDays || c.updatedAt < now - f.olderThanDays * DAY_MS) && (!f.profileId || c.profileId === f.profileId));
}

/** "Alle auswählen": every shown row except running ones; pinned chats only by an explicit tick */
export function selectableIds(items: readonly ConversationMeta[], isRunning: (id: string) => boolean): string[] {
  return items.filter((c) => !c.pinned && !isRunning(c.id)).map((c) => c.id);
}

// ------------------------------------------------------------------ plan

/** May this chat ever be deleted on Hermes? Only the app's own Hermes sessions – never foreign or non-Hermes chats. */
export function remoteDeletable(m: ConversationMeta): boolean {
  // a bot's Bot Chat is shared with Hermes Desktop (bots/): never deleted from here
  return m.profileKind === 'hermes' && !!m.hermesSessionId && isAppConversation(m) && !m.botChat;
}

export type PlanOptions = {
  isRunning: (id: string) => boolean;
  /** delete pinned chats too (selection: they were ticked explicitly; "Alle löschen": asked separately) */
  includePinned: boolean;
  /** RemoteActions.isSynced: the sync must not bring the entry back → tombstone its session id */
  isSynced?: (m: ConversationMeta) => boolean;
  /** RemoteActions.canDeleteRemote (a server is configured + reachable); combined with `remoteDeletable` */
  canDeleteRemote?: (m: ConversationMeta) => boolean;
};

export type DeletePlan = {
  /** entries removed locally */
  metas: ConversationMeta[];
  /** subset that may additionally be deleted on Hermes ("Auch auf Hermes löschen") */
  remote: ConversationMeta[];
  /** synced entries that are only ever removed locally (Telegram/CLI/cron/other clients) */
  foreign: number;
  skippedRunning: number;
  skippedPinned: number;
  /** Hermes session ids the sync has to skip from now on */
  hide: string[];
};

export function planDelete(candidates: readonly ConversationMeta[], o: PlanOptions): DeletePlan {
  const metas: ConversationMeta[] = [];
  const remote: ConversationMeta[] = [];
  const hide: string[] = [];
  let foreign = 0;
  let skippedRunning = 0;
  let skippedPinned = 0;
  for (const m of candidates) {
    // a bot's Bot Chat is not a chat of the list (Bots tab): "delete all chats" leaves it alone
    if (m.botChat) continue;
    if (o.isRunning(m.id)) {
      skippedRunning++;
      continue;
    }
    if (m.pinned && !o.includePinned) {
      skippedPinned++;
      continue;
    }
    metas.push(m);
    const synced = !!o.isSynced?.(m) || !!m.remote;
    if (m.profileKind === 'hermes' && m.hermesSessionId && synced) hide.push(hiddenKey(m.profileId, m.hermesSessionId));
    if (remoteDeletable(m) && o.canDeleteRemote?.(m)) remote.push(m);
    else if (synced && m.profileKind === 'hermes' && !isAppConversation(m)) foreign++;
  }
  return { metas, remote, foreign, skippedRunning, skippedPinned, hide };
}

// ------------------------------------------------------------------ deleter with undo window

export const UNDO_MS = 6000;

export type BulkDeleteDeps = {
  store: IndexStore;
  /**
   * Remove the local data of deleted chats (transcripts, attachments, node state). Runs after the undo
   * window, in the background; must not throw.
   */
  purge: (ids: string[]) => Promise<void>;
  undoMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
};

export type PendingDelete = {
  batch: number;
  count: number;
  /** chats that will also be deleted on Hermes when the window ends */
  remote: number;
};

export type DeleteReport = { batch: number; count: number; remoteOk: number; remoteFailed: number };

type Batch = {
  batch: number;
  metas: ConversationMeta[];
  remote: ConversationMeta[];
  addedHide: string[];
  deleteRemote?: (m: ConversationMeta) => Promise<void>;
  timer: unknown;
};

export function createBulkDeleter(d: BulkDeleteDeps) {
  const undoMs = d.undoMs ?? UNDO_MS;
  const setTimer = d.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = d.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let pending: Batch | null = null;
  let snap: PendingDelete | null = null;
  let report: DeleteReport | null = null;
  let seq = 0;
  const subs = new Set<() => void>();
  const emit = () => {
    for (const f of Array.from(subs)) f();
  };
  const setPending = (b: Batch | null) => {
    pending = b;
    snap = b ? { batch: b.batch, count: b.metas.length, remote: b.remote.length } : null;
  };

  async function finish(b: Batch): Promise<DeleteReport> {
    await d.purge(b.metas.map((m) => m.id));
    let remoteOk = 0;
    let remoteFailed = 0;
    if (b.deleteRemote) {
      for (const m of b.remote) {
        // double guard: whatever the caller planned, foreign / non-Hermes chats never reach the server
        if (!remoteDeletable(m)) continue;
        try {
          await b.deleteRemote(m);
          remoteOk++;
        } catch {
          remoteFailed++;
        }
      }
    }
    const r = { batch: b.batch, count: b.metas.length, remoteOk, remoteFailed };
    if (remoteFailed) {
      report = r;
      emit();
    }
    return r;
  }

  return {
    /**
     * Hide `plan.metas` now (one index update) and delete for real after the undo window. A batch that is
     * still waiting is committed first. `deleteRemote` (only with "Auch auf Hermes löschen") is called for
     * `plan.remote` after the window. Returns the batch number.
     */
    start(plan: Pick<DeletePlan, 'metas' | 'remote' | 'hide'>, deleteRemote?: (m: ConversationMeta) => Promise<void>): number {
      if (pending) void this.commit();
      if (!plan.metas.length) return 0;
      const before = new Set(d.store.get().hiddenRemote ?? []);
      const ids = new Set(plan.metas.map((m) => m.id));
      d.store.dispatch({ type: 'removeMany', ids: [...ids], hide: plan.hide });
      const batch = ++seq;
      const b: Batch = {
        batch,
        metas: plan.metas,
        remote: deleteRemote ? plan.remote.filter((m) => ids.has(m.id) && remoteDeletable(m)) : [],
        addedHide: plan.hide.filter((sid) => !before.has(sid)),
        deleteRemote,
        timer: null,
      };
      b.timer = setTimer(() => {
        if (pending === b) void this.commit();
      }, undoMs);
      setPending(b);
      emit();
      return batch;
    },

    /** "Rückgängig": put the chats back (nothing was deleted yet). */
    undo(): boolean {
      const b = pending;
      if (!b) return false;
      clearTimer(b.timer);
      setPending(null);
      d.store.dispatch({ type: 'restore', items: b.metas, unhide: b.addedHide });
      emit();
      return true;
    },

    /** End the undo window now (toast gone, app backgrounded, next batch). Resolves when everything ran. */
    async commit(): Promise<DeleteReport | null> {
      const b = pending;
      if (!b) return null;
      clearTimer(b.timer);
      setPending(null);
      emit();
      return finish(b);
    },

    pending: (): PendingDelete | null => snap,
    /** last batch whose Hermes deletes partly failed (cleared by `dismissReport`) */
    report: (): DeleteReport | null => report,
    dismissReport() {
      if (!report) return;
      report = null;
      emit();
    },
    subscribe(fn: () => void): () => void {
      subs.add(fn);
      return () => {
        subs.delete(fn);
      };
    },
  };
}

export type BulkDeleter = ReturnType<typeof createBulkDeleter>;
