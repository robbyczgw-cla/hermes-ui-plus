/**
 * React bindings for the conversation store.
 *
 *   <ConversationsProvider>…</ConversationsProvider>   once, inside the root layout (needs nothing else)
 *   useConversations()  → { ready, list, activeId, setActiveId, create, remove, rename, pin, search, get }
 *   useConversation(id) → { ready, messages, meta, save, setSessionId }
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { AppState, Platform } from 'react-native';
import { liveDraftUris } from '../attachments/liveDrafts';
import { deleteAttachmentFiles } from '../attachments/store';
import type { ChatMessage } from '../hermes/types';
import { useT } from '../i18n';
import { deleteConversationState } from '../nodestate/defaultStore';
import { createBulkDeleter, type BulkDeleter, type DeleteReport, type PendingDelete } from './bulkDelete';
import { BulkDeleteToast } from './BulkDeleteToast';
import { createController, type ConversationController } from './controller';
import type { RemoteActions } from './hermesSync';
import { findOrphanFiles, unreferencedFiles } from './prune';
import { createRepo, MSGS_PREFIX, type ConversationRepo, type StorageLike } from './repo';
import { listDocumentFiles } from './storage/fileKvExpo';
import { storageHealth, type StorageIssue } from './storage/health';
import { largeRecordStorage, migrateLegacyStorage } from './storage/platform';
import { createIndexStore, type IndexStore } from './store';
import { isDraft } from './indexReducer';
import { attachmentUris } from './messages';
import { sortByRecency } from './group';
import { afterIdle } from './idle';
import type { ConversationMeta, HermesChatOptions, ProfileRef, SearchHit } from './types';
import type { ModelLockState } from '../hermes/modelLock';

export type ConversationsApi = {
  /** index loaded from storage */
  ready: boolean;
  /** visible conversations (drafts without messages are hidden), newest first; `pinned` entries included */
  list: ConversationMeta[];
  /** conversation that was open last / is open now (persisted) */
  activeId: string | undefined;
  setActiveId: (id: string | undefined) => void;
  /**
   * start a new conversation for this profile (re-uses an existing empty draft of the same profile) and make it
   * active; `bot` = Hermes profile ("bot") of the new chat (hermes/bots.ts)
   */
  create: (profile: ProfileRef, opts?: { bot?: string }) => ConversationMeta;
  /** Hermes bot of an EMPTY chat (picker "Bot" section; ignored once it has messages) */
  setBot: (id: string, bot: string | undefined) => void;
  /** a bot's "Bot Chat" (bots/core.ts): existing / adopted / new, activated unless `activate: false` */
  openBotChat: ConversationController['openBotChat'];
  /** server activity of a bot's Bot Chat (Bots tab refresh) */
  botChatRemote: ConversationController['botChatRemote'];
  remove: (id: string) => void;
  rename: (id: string, title: string) => void;
  /** generated title (bridge auto-title): replaces only automatic titles; Hermes titles may replace it later */
  setAutoTitle: (id: string, title: string) => void;
  /** toggle, or set explicitly */
  pin: (id: string, pinned?: boolean) => void;
  /** "Archivieren" (default) / "Wiederherstellen" of one or many chats – local only, `list` still contains them */
  archive: (ids: string | readonly string[], archived?: boolean) => void;
  /** branched Hermes chat: number of copied messages sent along as context until the first accepted turn */
  setBranchSeed: (id: string, count: number | undefined) => void;
  /** title + message text, async because message bodies are loaded lazily */
  search: (query: string) => Promise<SearchHit[]>;
  get: (id: string) => ConversationMeta | undefined;
  /** per-conversation model override (undefined = profile default) */
  setModel: (id: string, model: string | undefined) => void;
  /** continue a chat on another profile of the same kind (ignored for a different kind) */
  setProfile: (id: string, profile: ProfileRef) => void;
  /** empty draft only: bind it to another profile (any kind; ignored once it has messages) */
  rebindDraft: (id: string, profile: ProfileRef) => void;
  // ---- Hermes session sync ----
  /** per-conversation Hermes reasoning/fast options */
  setModelOptions: (id: string, options: HermesChatOptions | undefined) => void;
  /** remove from the list without deleting the Hermes session; the sync will not re-add it */
  hideRemote: (id: string) => void;
  /** read a chat's stored transcript into memory ahead of opening it (drawer row press-in); local only */
  prefetch: (id: string) => void;
};

export type Internals = {
  store: IndexStore;
  controller: ConversationController;
  repo: ConversationRepo;
  ready: boolean;
  /** test storage injected → no file pruning */
  custom?: boolean;
  /** bulk delete with undo window (drawer selection mode, Settings → "Alle Chats löschen") */
  deleter: BulkDeleter;
  /** the mounted session sync's remote actions (set by useHermesSessionSync), null without one */
  remoteActionsRef: { current: RemoteActions | null };
};

const Ctx = createContext<Internals | null>(null);

export function ConversationsProvider({ children, storage }: { children: ReactNode; storage?: StorageLike }) {
  const [internals] = useState(() => {
    const store = createIndexStore();
    // index (small) in AsyncStorage; transcripts in files (native) / IndexedDB (web), migrated from AsyncStorage
    const repo = createRepo(storage ?? (AsyncStorage as unknown as StorageLike), {
      blobs: storage ? undefined : largeRecordStorage('conv', MSGS_PREFIX),
      onError: (e, what) => {
        if (!storage) storageHealth.reportError(e, `conversations.${what}`);
        if (__DEV__) console.warn('[conversations]', what, e);
      },
      onFlushOk: () => {
        if (!storage) storageHealth.reportOk();
      },
    });
    const base = createController(store, repo);
    const controller: ConversationController = {
      ...base,
      save(id: string, messages: ChatMessage[], opts?: { keepOrder?: boolean }) {
        if (pruneState.running) for (const uri of attachmentUris(messages)) pruneState.saved.add(uri);
        base.save(id, messages, opts);
      },
      // deleting a chat also deletes its local attachment copies (read the list before it is dropped) – unless
      // another chat (a branch / its parent) still references them
      remove(id: string) {
        const pending = base.loadMessages(id);
        base.remove(id);
        void pending.then((messages) => deleteUnshared(store, repo, attachmentUris(messages))).catch(() => {});
      },
      hideRemote(id: string) {
        const pending = base.loadMessages(id);
        base.hideRemote(id);
        void pending.then((messages) => deleteUnshared(store, repo, attachmentUris(messages))).catch(() => {});
      },
      // chats the session sync drops (deleted/archived elsewhere) also lose their node state
      mergeRemote(...args: Parameters<ConversationController['mergeRemote']>) {
        const res = base.mergeRemote(...args);
        for (const id of res.removed) void deleteConversationState(id).catch(() => {});
        return res;
      },
      // entries hidden by the session filter (local only) also lose their node state
      pruneForeign(...args: Parameters<ConversationController['pruneForeign']>) {
        const res = base.pruneForeign(...args);
        for (const id of res.removed) void deleteConversationState(id).catch(() => {});
        return res;
      },
    };
    const deleter = createBulkDeleter({ store, purge: (ids) => purgeLocal(store, repo, ids) });
    return { store, repo, controller, custom: !!storage, deleter, remoteActionsRef: { current: null as RemoteActions | null } };
  });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const { store, repo } = internals;
    void repo.loadIndex().then((state) => {
      if (cancelled) return;
      // start reading the open chat's transcript now: it runs alongside ChatScreen's crash-marker read and is
      // usually in memory when the session mounts (useConversation takes it synchronously)
      if (state.activeId) void internals.controller.prefetchMessages([state.activeId]);
      store.dispatch({ type: 'load', state });
      store.dispatch({ type: 'pruneDrafts', keep: state.activeId });
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [internals]);

  // once per start, after the first chat is on screen: finish the AsyncStorage → files/IndexedDB migration,
  // then delete attachment files no stored chat references any more (native only; skipped in tests)
  useEffect(() => {
    if (!ready || internals.custom) return;
    let cancelled = false;
    const cancel = afterIdle(() => {
      void (async () => {
        await migrateLegacyStorage().catch(() => {});
        // unreadable/corrupt index: "unreferenced" files may belong to chats that are only missing from it
        if (!cancelled && Platform.OS !== 'web' && internals.repo.trustedIndex()) await pruneOrphanFiles(internals, () => cancelled);
      })();
    }, 4000);
    return () => {
      cancelled = true;
      cancel();
    };
  }, [ready, internals]);

  // instant chat switching: once the open chat is on screen and the JS thread is idle, read the most recent
  // chats' transcripts into the memory cache (one per idle slot), so tapping one of them in the drawer mounts it
  // with its messages on the first frame. Local storage only, never a network request.
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const cancel = afterIdle(() => {
      const { store, controller } = internals;
      const st = store.get();
      const ids = sortByRecency(st.items.filter((c) => !isDraft(c) && !c.archived && c.id !== st.activeId))
        .slice(0, PREFETCH_RECENT)
        .map((c) => c.id);
      void controller.prefetchMessages(ids, { between: () => new Promise<void>((r) => afterIdle(r, 0)), cancelled: () => cancelled });
    }, 1200);
    return () => {
      cancelled = true;
      cancel();
    };
  }, [ready, internals]);

  // persist the index whenever it changes (after the initial load)
  useEffect(() => {
    if (!ready) return;
    const { store, repo } = internals;
    repo.saveIndex(store.get());
    return store.subscribe(() => repo.saveIndex(store.get()));
  }, [ready, internals]);

  // flush on background / unmount so a killed app does not lose the last seconds. Deferred by a microtask:
  // the open chat's own AppState listener saves its live (partial) transcript in the same event first.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') {
        // a pending bulk delete ends with the undo window: the app may be killed in the background
        void internals.deleter.commit();
        void Promise.resolve().then(() => internals.repo.flush());
      }
    });
    return () => {
      sub.remove();
      void internals.deleter.commit();
      void internals.repo.flush();
    };
  }, [internals]);

  const value = useMemo<Internals>(() => ({ ...internals, ready }), [internals, ready]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <BulkDeleteToast />
    </Ctx.Provider>
  );
}

/**
 * Local data of deleted chats, after the undo window: attachment uris are read first (cheap raw scan), then the
 * transcripts are queued for removal (one throttled flush), node state and attachment files go in the background.
 */
async function purgeLocal(store: IndexStore, repo: ConversationRepo, ids: string[]): Promise<void> {
  const uris: string[] = [];
  for (const id of ids) {
    try {
      uris.push(...(await repo.attachmentUrisOf(id)));
    } catch {
      // unreadable transcript: the startup orphan prune catches its files later
    }
  }
  for (const id of ids) repo.removeMessages(id);
  for (const id of ids) await deleteConversationState(id).catch(() => {});
  await deleteUnshared(store, repo, uris, ids).catch(() => {});
}

/** delete these attachment files except those a surviving chat or a live draft still references (branches) */
async function deleteUnshared(store: IndexStore, repo: ConversationRepo, uris: string[], deleted: readonly string[] = []): Promise<void> {
  if (!uris.length) return;
  const gone = new Set(deleted);
  const files = await unreferencedFiles({
    uris,
    survivorIds: store.get().items.map((c) => c.id).filter((id) => !gone.has(id)),
    urisOf: repo.attachmentUrisOf,
    keep: liveDraftUris,
  });
  if (files.length) await deleteAttachmentFiles(files.map((uri) => ({ uri })));
}

export type UseBulkDelete = {
  deleter: BulkDeleter;
  /** batch inside its undo window */
  pending: PendingDelete | null;
  /** last batch whose Hermes deletes partly failed */
  report: DeleteReport | null;
  /** remote actions of the mounted session sync (Hermes deletes), if any */
  remote: () => RemoteActions | null;
};

/** Bulk delete + undo state (drawer selection mode, Settings, undo toast). */
export function useBulkDelete(): UseBulkDelete {
  const { deleter, remoteActionsRef } = useInternals();
  const pending = useSyncExternalStore(deleter.subscribe, deleter.pending, deleter.pending);
  const report = useSyncExternalStore(deleter.subscribe, deleter.report, deleter.report);
  return useMemo(() => ({ deleter, pending, report, remote: () => remoteActionsRef.current }), [deleter, pending, report, remoteActionsRef]);
}

/** recent chats whose transcripts are prefetched at start-up (repo LRU holds 10: these, the open one and the Hermes chats fetched ahead) */
const PREFETCH_RECENT = 4;

/** files sent while the prune collects the stored uris must survive it */
const pruneState = { running: false, saved: new Set<string>() };

/** attachments dir of attachments/store.ts (`<documents>/attachments`) */
const ATTACHMENTS_DIR = 'attachments';

async function pruneOrphanFiles({ store, repo }: Pick<Internals, 'store' | 'repo'>, cancelled: () => boolean) {
  if (pruneState.running) return;
  pruneState.running = true;
  try {
    const files = listDocumentFiles(ATTACHMENTS_DIR);
    if (!files.length) return; // most installs: nothing to look for, no transcript is read
    const orphans = await findOrphanFiles({
      files,
      conversationIds: store.get().items.map((c) => c.id),
      urisOf: repo.attachmentUrisOf,
      keep: () => [...liveDraftUris(), ...pruneState.saved],
      yieldFn: () => new Promise((r) => setTimeout(r, 0)),
      cancelled,
    });
    if (orphans.length) await deleteAttachmentFiles(orphans.map((uri) => ({ uri })));
    if (__DEV__ && orphans.length) console.log(`[conversations] removed ${orphans.length} orphaned attachment file(s)`);
  } catch (e) {
    if (__DEV__) console.warn('[conversations] prune', e);
  } finally {
    pruneState.running = false;
    pruneState.saved.clear();
  }
}

/**
 * Non-blocking "storage full" notice: calls `notify` once whenever transcripts / node state cannot be written
 * because the device or browser storage is full (again after it recovered). Mount once inside the toast host.
 */
export function useStorageFullNotice(notify: (issue: StorageIssue) => void): void {
  const notifyRef = useRef(notify);
  useLayoutEffect(() => {
    notifyRef.current = notify;
  });
  useEffect(() => {
    let shown: StorageIssue | null = null;
    const check = () => {
      const issue = storageHealth.get();
      if (issue && issue !== shown) notifyRef.current(issue);
      shown = issue;
    };
    check();
    return storageHealth.subscribe(check);
  }, []);
}

/** `useStorageFullNotice` with the localized toast text (root layout, inside the ToastProvider). */
export function useStorageFullToast(toast: (message: string) => void): void {
  const tr = useT();
  useStorageFullNotice(() => toast(tr('conversations.storage.full')));
}

/** @internal for the session-sync hooks in this folder (not exported from index.ts) */
export function useConversationsInternals(): Internals {
  return useInternals();
}

function useInternals(): Internals {
  const v = useContext(Ctx);
  if (!v) throw new Error('useConversations: wrap the app in <ConversationsProvider>');
  return v;
}

export function useConversations(): ConversationsApi {
  const { store, controller, ready } = useInternals();
  const state = useSyncExternalStore(store.subscribe, store.get, store.get);
  const list = useMemo(() => sortByRecency(state.items.filter((c) => !isDraft(c))), [state.items]);
  return useMemo<ConversationsApi>(
    () => ({
      ready,
      list,
      activeId: state.activeId,
      setActiveId: controller.setActive,
      create: (profile: ProfileRef, opts?: { bot?: string }) => controller.create(profile, { bot: opts?.bot }),
      setBot: controller.setBot,
      openBotChat: controller.openBotChat,
      botChatRemote: controller.botChatRemote,
      remove: controller.remove,
      rename: controller.rename,
      setAutoTitle: controller.setAutoTitle,
      pin: controller.pin,
      archive: controller.archive,
      setBranchSeed: controller.setBranchSeed,
      search: controller.search,
      get: controller.get,
      setModel: controller.setModel,
      setProfile: controller.setProfile,
      rebindDraft: controller.rebindDraft,
      setModelOptions: controller.setModelOptions,
      hideRemote: controller.hideRemote,
      prefetch: (id: string) => void controller.prefetchMessages([id]),
    }),
    [ready, list, state.activeId, controller]
  );
}

export type UseConversation = {
  /** meta + stored messages are available (safe to mount the chat with `initialMessages`) */
  ready: boolean;
  /** stored transcript (stripped, capped); pass as `initialMessages`. Empty until `ready`. */
  messages: ChatMessage[];
  meta: ConversationMeta | undefined;
  /**
   * debounced persist; bound to THIS conversation id, safe to call from onTurnEnd of an unmounting chat. `keepOrder`:
   * the chat keeps its place in the list (a fetched Hermes transcript is not activity, remoteSync SNAPSHOT_SAVE)
   */
  save: (messages: ChatMessage[], opts?: { keepOrder?: boolean }) => void;
  /** `save` + write to storage now; resolves once written (before a turn request starts: durable send) */
  saveNow: (messages: ChatMessage[]) => Promise<void>;
  /** write every pending save (transcripts + index) now, not on the debounce timer; resolves once written */
  flush: () => Promise<void>;
  setSessionId: (sessionId: string) => void;
  /** per-conversation model override (undefined = profile default) */
  setModel: (model: string | undefined) => void;
  /** per-conversation Hermes reasoning/fast options (persisted; pass `meta.modelOptions` to useHermesChat) */
  setModelOptions: (options: HermesChatOptions | undefined) => void;
  /** outcome of the Hermes session model lock (hermes/modelLock.ts) */
  setModelLock: (lock: ModelLockState | undefined) => void;
};

const EMPTY: ChatMessage[] = [];

export function useConversation(id: string | null | undefined): UseConversation {
  const { store, controller, ready: indexReady } = useInternals();
  const state = useSyncExternalStore(store.subscribe, store.get, store.get);
  // a transcript already in memory (start-up warm, idle prefetch, drawer press-in, recently open) is taken
  // synchronously: the chat mounts with its messages on the first render instead of a blank frame + storage read
  const peek = (): { id: string; messages: ChatMessage[] } | null => {
    const messages = id && indexReady ? controller.peekMessages(id) : undefined;
    return id && messages ? { id, messages } : null;
  };
  const [loaded, setLoaded] = useState(peek);
  if (id && indexReady && loaded?.id !== id) {
    const hit = peek();
    if (hit) setLoaded(hit); // render-phase update: React re-renders right away, nothing blank is committed
  }
  const loadedId = loaded?.id;

  useEffect(() => {
    if (!id || !indexReady || loadedId === id) return;
    let cancelled = false;
    void controller.loadMessages(id).then((messages) => {
      if (!cancelled) setLoaded({ id, messages });
    });
    return () => {
      cancelled = true;
    };
  }, [id, indexReady, controller, loadedId]);

  const meta = useMemo(() => (id ? state.items.find((c) => c.id === id) : undefined), [id, state.items]);
  const save = useCallback((messages: ChatMessage[], opts?: { keepOrder?: boolean }) => (id ? controller.save(id, messages, opts) : undefined), [id, controller]);
  const saveNow = useCallback((messages: ChatMessage[]) => (id ? controller.saveNow(id, messages) : Promise.resolve()), [id, controller]);
  const flush = useCallback(() => controller.flush(), [controller]);
  const setSessionId = useCallback(
    (sessionId: string) => {
      if (id) controller.setSessionId(id, sessionId);
    },
    [id, controller]
  );

  const setModel = useCallback(
    (model: string | undefined) => {
      if (id) controller.setModel(id, model);
    },
    [id, controller]
  );

  const setModelOptions = useCallback(
    (options: HermesChatOptions | undefined) => {
      if (id) controller.setModelOptions(id, options);
    },
    [id, controller]
  );

  const setModelLock = useCallback(
    (lock: ModelLockState | undefined) => {
      if (id) controller.setModelLock(id, lock);
    },
    [id, controller]
  );

  const isLoaded = !!id && loaded?.id === id;
  return {
    ready: indexReady && isLoaded,
    messages: isLoaded ? loaded.messages : EMPTY,
    meta,
    save,
    saveNow,
    flush,
    setSessionId,
    setModel,
    setModelOptions,
    setModelLock,
  };
}
