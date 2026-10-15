/**
 * Conversation operations on top of repo + store (no React): everything the provider exposes,
 * testable with an in-memory storage.
 */
import type { ChatMessage } from '../hermes/types.ts';
import { newConversationId, newSessionIdFor } from './ids.ts';
import { isDraft } from './indexReducer.ts';
import { firstUserText, messagesSignature, previewOf } from './messages.ts';
import { withoutUnackedAnswers } from '../hermes/pendingSend.ts';
import type { ConversationRepo } from './repo.ts';
import { searchConversations } from './search.ts';
import { sortByRecency } from './group.ts';
import type { IndexStore } from './store.ts';
import type { ConversationMeta, HermesChatOptions, ProfileRef, SearchHit } from './types.ts';
import type { ModelLockState } from '../hermes/modelLock.ts';
import type { RemoteSession } from '../hermes/sessions.ts';
import { hiddenKey, mergeRemoteSessions, type MergeResult, type SyncFilter } from './remoteSync.ts';
import { botOf } from '../hermes/bots.ts';

export function createController(store: IndexStore, repo: ConversationRepo, now: () => number = Date.now) {
  /** signature of the last persisted list per conversation: identical saves are no-ops */
  const sigs = new Map<string, string>();

  const get = (id: string): ConversationMeta | undefined => store.get().items.find((c) => c.id === id);

  /** Visible conversations (drafts hidden), newest first. Pinned handling is left to the UI grouping. */
  const list = (): ConversationMeta[] => sortByRecency(store.get().items.filter((c) => !isDraft(c)));

  /** Merge a GET /api/sessions result into the index (see remoteSync.mergeRemoteSessions). */
  const mergeRemote = (
    profile: ProfileRef,
    sessions: RemoteSession[],
    opts: { completeSources?: string[]; filter?: SyncFilter; sameServer?: (profileId: string) => boolean; bot?: string } = {}
  ): MergeResult => {
    const st = store.get();
    const res = mergeRemoteSessions(st.items, {
      profile,
      sessions,
      bot: opts.bot,
      completeSources: opts.completeSources,
      filter: opts.filter,
      sameServer: opts.sameServer,
      hidden: st.hiddenRemote,
      activeId: st.activeId,
    });
    if (res.changed) store.dispatch({ type: 'mergeRemote', items: res.items });
    for (const id of res.removed) {
      sigs.delete(id);
      repo.removeMessages(id); // local transcript only – never a Hermes call
    }
    return res;
  };

  /**
   * Persist a conversation's messages (debounced) and refresh title/preview/updatedAt. `keepOrder`: leave
   * `updatedAt` as it is (a transcript fetched ahead in the background must not move the chat in the list).
   */
  const save = (id: string, messages: ChatMessage[], opts: { keepOrder?: boolean } = {}) => {
    if (!get(id)) return; // deleted meanwhile
    const sig = messagesSignature(messages);
    if (sigs.get(id) === sig) return;
    const stored = repo.saveMessages(id, messages);
    if (!stored) return; // unreadable stored transcript: neither it nor the index meta is replaced (repo.ts)
    sigs.set(id, sig);
    store.dispatch({
      type: 'saved',
      id,
      now: opts.keepOrder ? (get(id)?.updatedAt ?? now()) : now(),
      firstUserText: firstUserText(messages),
      preview: previewOf(stored),
      messageCount: stored.length,
      // the answer placeholder of a send the server has not accepted yet is not stored (not a cut history)
      truncated: stored.length < withoutUnackedAnswers(messages).length,
    });
  };

  /** Hermes bot of an EMPTY chat (picker "Bot" section); chats with messages keep theirs (no-op). */
  const setBot = (id: string, bot: string | undefined) => {
    const c = get(id);
    if (!c) return;
    store.dispatch({ type: 'setBot', id, bot, sessionId: newSessionIdFor(c.profileKind) });
  };

  return {
    get,
    list,

    /**
     * Start a conversation for a profile and make it active; re-uses an existing empty draft of the same profile.
     * `{ fresh: true }`: always a new entry and the open conversation stays active (messages arriving for a
     * chat that does not exist yet must never take over the user's open draft).
     * `bot`: Hermes profile of the new chat (a re-used draft switches to it; hermes/bots.ts).
     */
    create(profile: ProfileRef, opts: { fresh?: boolean; bot?: string } = {}): ConversationMeta {
      if (!opts.fresh) {
        const draft = store.get().items.find((c) => isDraft(c) && c.profileId === profile.id && c.profileKind === profile.kind);
        if (draft) {
          if ((draft.hermesProfile ?? undefined) !== botOf(opts.bot)) setBot(draft.id, opts.bot);
          store.dispatch({ type: 'setActive', id: draft.id });
          return get(draft.id)!;
        }
      }
      const t = now();
      const id = newConversationId(t);
      store.dispatch({ type: 'create', id, profile, sessionId: newSessionIdFor(profile.kind), now: t, activate: !opts.fresh, bot: opts.bot });
      return get(id)!;
    },

    setBot,

    /**
     * A branched chat ("In neuem Chat fortsetzen", /branch): ALWAYS a new conversation (never a re-used draft –
     * a mounted draft's chat hook would keep its empty transcript and old session id, review M5), fully
     * initialised (session, transcript, seed, model, title) BEFORE it becomes the open chat.
     */
    createBranch(
      profile: ProfileRef,
      b: { messages: ChatMessage[]; sessionId?: string; seed?: number; model?: string; modelOptions?: HermesChatOptions; title?: string; bot?: string }
    ): ConversationMeta {
      const t = now();
      const id = newConversationId(t);
      // a branch stays on the bot of its source chat (a forked session lives in the same Hermes profile)
      store.dispatch({ type: 'create', id, profile, sessionId: b.sessionId ?? newSessionIdFor(profile.kind), now: t, activate: false, bot: b.bot });
      this.save(id, b.messages);
      if (b.seed) store.dispatch({ type: 'setBranchSeed', id, count: b.seed });
      if (b.model) store.dispatch({ type: 'setModel', id, model: b.model });
      if (b.modelOptions) store.dispatch({ type: 'setModelOptions', id, options: b.modelOptions });
      if (b.title) store.dispatch({ type: 'autoTitle', id, title: b.title });
      store.dispatch({ type: 'setActive', id });
      return get(id)!;
    },

    remove(id: string) {
      store.dispatch({ type: 'remove', id });
      sigs.delete(id);
      repo.removeMessages(id);
    },

    rename(id: string, title: string) {
      store.dispatch({ type: 'rename', id, title });
    },

    /** generated title (bridge auto-title); never overrides a user rename, Hermes titles still replace it */
    setAutoTitle(id: string, title: string) {
      store.dispatch({ type: 'autoTitle', id, title });
    },

    pin(id: string, pinned?: boolean) {
      store.dispatch({ type: 'pin', id, pinned });
    },

    /** "Archivieren" / "Wiederherstellen" (local only; the Hermes session and the transcript stay) */
    archive(ids: string | readonly string[], archived = true) {
      store.dispatch({ type: 'archive', ids: typeof ids === 'string' ? [ids] : ids, archived });
    },

    /** branched Hermes chat: copied messages still to be sent as context (undefined = done) */
    setBranchSeed(id: string, count: number | undefined) {
      store.dispatch({ type: 'setBranchSeed', id, count });
    },

    setActive(id: string | undefined) {
      store.dispatch({ type: 'setActive', id });
    },

    setSessionId(id: string, sessionId: string) {
      store.dispatch({ type: 'setSession', id, sessionId });
    },

    /** model override for one conversation (undefined = profile default) */
    setModel(id: string, model: string | undefined) {
      store.dispatch({ type: 'setModel', id, model });
    },

    /** continue a chat on another profile of the same kind (no-op for a different kind) */
    setProfile(id: string, profile: ProfileRef) {
      store.dispatch({ type: 'setProfile', id, profileId: profile.id, profileKind: profile.kind });
    },

    /** empty draft → bind it to `profile` (any kind; no-op once it has messages), see chat/chatProfile emptyChatRebindTarget */
    rebindDraft(id: string, profile: ProfileRef) {
      store.dispatch({ type: 'rebindDraft', id, profile: { id: profile.id, kind: profile.kind }, sessionId: newSessionIdFor(profile.kind) });
    },

    /** per-conversation Hermes reasoning/fast options (undefined = server defaults) */
    setModelOptions(id: string, options: HermesChatOptions | undefined) {
      store.dispatch({ type: 'setModelOptions', id, options });
    },

    /** outcome of the Hermes session model lock (hermes/modelLock.ts) */
    setModelLock(id: string, lock: ModelLockState | undefined) {
      store.dispatch({ type: 'setModelLock', id, lock });
    },

    mergeRemote,

    /**
     * Drop remote-only entries of `profile` that the session filter hides (setting switched off, app update).
     * LOCAL ONLY: index entry + stored transcript; the Hermes session is never touched, no tombstone (switching
     * the setting on again brings them back). Works offline (no list fetch needed).
     */
    pruneForeign(profile: ProfileRef, filter: SyncFilter): MergeResult {
      return mergeRemote(profile, [], { filter });
    },

    /** "Nur aus Liste entfernen": local delete + the sync will not bring it back. */
    hideRemote(id: string) {
      const c = get(id);
      if (!c) return;
      // tombstone per server: the same session id on another server stays visible
      if (c.hermesSessionId) store.dispatch({ type: 'hideRemote', id, sessionId: hiddenKey(c.profileId, c.hermesSessionId) });
      else store.dispatch({ type: 'remove', id });
      sigs.delete(id);
      repo.removeMessages(id);
    },

    markRemoteLoaded(id: string, at: number, lastActive?: number) {
      store.dispatch({ type: 'remoteLoaded', id, at, lastActive });
    },

    async loadMessages(id: string): Promise<ChatMessage[]> {
      const messages = await repo.loadMessages(id);
      if (!sigs.has(id)) sigs.set(id, messagesSignature(messages));
      return messages;
    },

    /** in-memory transcript (prefetched / recently open / pending write) or undefined – synchronous */
    peekMessages(id: string): ChatMessage[] | undefined {
      const messages = repo.peekMessages(id);
      if (messages && !sigs.has(id)) sigs.set(id, messagesSignature(messages));
      return messages;
    },

    /**
     * Read these transcripts into the memory cache ahead of a tap (start-up idle, drawer row press-in), one at a
     * time; `between` runs before each storage read (yield to the UI). Never throws; stops when `cancelled()`.
     */
    async prefetchMessages(ids: readonly string[], opts: { between?: () => Promise<void>; cancelled?: () => boolean } = {}): Promise<void> {
      for (const id of ids) {
        if (opts.cancelled?.()) return;
        if (!get(id) || repo.peekMessages(id)) continue;
        if (opts.between) await opts.between();
        if (opts.cancelled?.()) return;
        // signature now (idle) rather than on the tap that opens the chat
        const messages = await repo.loadMessages(id).catch(() => undefined);
        if (messages && !sigs.has(id)) sigs.set(id, messagesSignature(messages));
      }
    },

    save,

    /**
     * `save` + write to storage now (not debounced); resolves once written (a failed write is reported by the repo
     * and retried, never thrown). Before a turn request starts (hermes/pendingSend.ts "durable send").
     */
    saveNow(id: string, messages: ChatMessage[]): Promise<void> {
      save(id, messages);
      return repo.flush();
    },

    /** Title + message-text search over all (non-draft) conversations. */
    async search(query: string): Promise<SearchHit[]> {
      const items = list();
      if (!query.trim()) return [];
      await repo.ensureSearchTexts(items.map((c) => c.id));
      return searchConversations(items, query, repo.searchTextOf);
    },
  };
}

export type ConversationController = ReturnType<typeof createController>;
