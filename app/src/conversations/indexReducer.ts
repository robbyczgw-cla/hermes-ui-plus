/**
 * Pure reducer for the conversation index (no I/O, no React).
 */
import type { ConversationMeta, HermesChatOptions, IndexState, ProfileKind, ProfileRef, RemoteInfo } from './types.ts';
import type { ModelLockState } from '../hermes/modelLock.ts';
import { DEFAULT_TITLE } from './types.ts';
import { cleanUserTitle, makeTitle } from './title.ts';
import { botOf } from '../hermes/bots.ts';

export type IndexAction =
  | { type: 'load'; state: IndexState }
  /** `activate: false` keeps the open conversation (inbox message for a chat that does not exist yet) */
  /** `bot`: Hermes profile of the new chat (hermes/bots.ts; undefined = default profile) */
  | { type: 'create'; id: string; profile: ProfileRef; sessionId: string; now: number; activate?: boolean; bot?: string }
  | { type: 'remove'; id: string }
  | { type: 'rename'; id: string; title: string }
  /** generated title (bridge auto-title): replaces only `auto`/`meta` titles and stays replaceable by Hermes titles */
  | { type: 'autoTitle'; id: string; title: string }
  | { type: 'pin'; id: string; pinned?: boolean }
  | { type: 'setSession'; id: string; sessionId: string }
  /** per-conversation model override (undefined/'' = profile default) */
  | { type: 'setModel'; id: string; model?: string }
  /** continue a chat on another profile of the SAME kind ("Verbindung fehlt"); other kinds are ignored */
  | { type: 'setProfile'; id: string; profileId: string; profileKind: ProfileKind }
  /** an EMPTY draft follows the active profile (any kind, fresh session id, no model override); ignored once it has messages */
  | { type: 'rebindDraft'; id: string; profile: ProfileRef; sessionId: string }
  | { type: 'setActive'; id: string | undefined }
  /**
   * Hermes bot of an EMPTY Hermes chat (fresh session id; the model override and options of the other bot are
   * dropped). Ignored once the chat has messages or for remote / non-Hermes chats.
   */
  | { type: 'setBot'; id: string; bot?: string; sessionId: string }
  /**
   * a bot's "Bot Chat" (bots/core.ts): a new entry bound to that Hermes session, or (`adopt`) an existing entry of the same
   * session (synced earlier as an ordinary chat) turned into it. `remote` = what the server reported for the session.
   */
  /** what the server reports for a bot's "Bot Chat" now (Bots tab refresh): newer activity is fetched on open */
  | { type: 'botChatRemote'; id: string; lastActive?: number; remoteCount?: number; preview?: string }
  | { type: 'botChat'; id: string; profile: ProfileRef; bot?: string; sessionId: string; now: number; title: string; adopt?: boolean; remote?: RemoteInfo; preview?: string; messageCount?: number; activate?: boolean }
  | {
      /** messages were saved: refresh preview/title/updatedAt */
      type: 'saved';
      id: string;
      now: number;
      firstUserText?: string;
      preview: string;
      messageCount: number;
      /** the size cap dropped older messages in this save */
      truncated?: boolean;
    }
  | { type: 'pruneDrafts'; keep?: string }
  // ---- Hermes session sync / per-chat options ----
  /** result of remoteSync.mergeRemoteSessions (whole item list) */
  | { type: 'mergeRemote'; items: ConversationMeta[] }
  /** "Nur aus Liste entfernen": drop the entry and remember its session id so the sync skips it */
  | { type: 'hideRemote'; id: string; sessionId: string }
  /**
   * transcript was (re)loaded from Hermes; `lastActive` = its newest row: newer server activity than the list knew
   * moves the chat like the list sync would (`updatedAt`)
   */
  | { type: 'remoteLoaded'; id: string; at: number; lastActive?: number }
  | { type: 'setModelOptions'; id: string; options?: HermesChatOptions }
  | { type: 'setModelLock'; id: string; lock?: ModelLockState }
  // ---- chat menu ----
  /** "Archivieren" / "Wiederherstellen" of one or many chats (local only) */
  | { type: 'archive'; ids: readonly string[]; archived: boolean }
  /** branched Hermes chat: number of copied messages that still go along as context (undefined = done) */
  | { type: 'setBranchSeed'; id: string; count?: number }
  // ---- bulk delete (bulkDelete.ts) ----
  /** drop many entries in ONE update (one index write); `hide` = Hermes session ids the sync must skip */
  | { type: 'removeMany'; ids: readonly string[]; hide?: readonly string[] }
  /** undo of `removeMany`: put the entries back, forget the tombstones it added */
  | { type: 'restore'; items: readonly ConversationMeta[]; unhide?: readonly string[] };

export function indexReducer(state: IndexState, a: IndexAction): IndexState {
  switch (a.type) {
    case 'load':
      return a.state;
    case 'create': {
      const meta: ConversationMeta = {
        id: a.id,
        title: DEFAULT_TITLE,
        titleSource: 'auto',
        profileId: a.profile.id,
        profileKind: a.profile.kind,
        hermesSessionId: a.sessionId,
        createdAt: a.now,
        updatedAt: a.now,
        preview: '',
        messageCount: 0,
      };
      const bot = a.profile.kind === 'hermes' || a.profile.kind === 'demo' ? botOf(a.bot) : undefined;
      if (bot) meta.hermesProfile = bot;
      return { ...state, items: [meta, ...state.items], activeId: a.activate === false ? state.activeId : a.id };
    }
    case 'botChat': {
      const bot = botOf(a.bot);
      const activeId = a.activate === false ? state.activeId : a.id;
      if (a.adopt) {
        const next = mapOne(state, a.id, (c) => {
          if (c.botChat) return c;
          const { archived: _a, pinned: _p, ...rest } = c;
          return { ...rest, botChat: true, title: a.title, titleSource: 'remote', ...(a.remote ? { remote: { ...c.remote, ...a.remote } } : {}) };
        });
        return next.activeId === activeId ? next : { ...next, activeId };
      }
      const meta: ConversationMeta = {
        id: a.id,
        title: a.title,
        titleSource: 'remote',
        profileId: a.profile.id,
        profileKind: a.profile.kind,
        hermesSessionId: a.sessionId,
        createdAt: a.now,
        updatedAt: a.remote?.lastActive ?? a.now,
        preview: a.preview ?? '',
        messageCount: a.messageCount ?? 0,
        botChat: true,
        ...(bot ? { hermesProfile: bot } : {}),
        // a session with history on the server: its transcript is fetched when the chat opens (needsRemoteLoad)
        ...(a.remote ? { remote: a.remote, ...(a.messageCount ? { origin: 'remote' as const } : {}) } : {}),
      };
      return { ...state, items: [meta, ...state.items], activeId };
    }
    case 'botChatRemote':
      return mapOne(state, a.id, (c) => {
        if (!c.botChat) return c;
        const lastActive = Math.max(c.remote?.lastActive ?? 0, a.lastActive ?? 0) || undefined;
        const remote: RemoteInfo = { source: c.remote?.source ?? 'api_server', ...c.remote, ...(lastActive ? { lastActive } : {}), ...(a.remoteCount !== undefined ? { remoteCount: a.remoteCount } : {}) };
        const updatedAt = lastActive && lastActive > c.updatedAt + 1000 ? lastActive : c.updatedAt;
        // never loaded here yet: the server's preview stands in until the transcript is fetched
        const preview = !c.remote?.loadedAt && !c.messageCount && a.preview ? a.preview.slice(0, 90) : c.preview;
        const messageCount = !c.messageCount && a.remoteCount ? Math.max(1, a.remoteCount) : c.messageCount;
        const origin = messageCount && !c.remote?.loadedAt && c.messageCount === 0 ? { origin: 'remote' as const } : {};
        if (JSON.stringify(remote) === JSON.stringify(c.remote) && updatedAt === c.updatedAt && preview === c.preview && messageCount === c.messageCount) return c;
        return { ...c, ...origin, remote, updatedAt, preview, messageCount };
      });
    case 'remove':
      return {
        ...state,
        items: state.items.filter((c) => c.id !== a.id),
        activeId: state.activeId === a.id ? undefined : state.activeId,
      };
    case 'removeMany': {
      const drop = new Set(a.ids);
      const items = state.items.filter((c) => !drop.has(c.id));
      const hidden = state.hiddenRemote ?? [];
      const add = (a.hide ?? []).filter((sid, i, arr) => sid && !hidden.includes(sid) && arr.indexOf(sid) === i);
      if (items.length === state.items.length && !add.length) return state;
      return {
        ...state,
        items,
        activeId: state.activeId && drop.has(state.activeId) ? undefined : state.activeId,
        ...(add.length ? { hiddenRemote: [...hidden, ...add].slice(-500) } : {}),
      };
    }
    case 'restore': {
      const have = new Set(state.items.map((c) => c.id));
      const back = a.items.filter((c) => !have.has(c.id));
      const unhide = new Set(a.unhide ?? []);
      const hidden = state.hiddenRemote?.filter((sid) => !unhide.has(sid));
      if (!back.length && hidden?.length === state.hiddenRemote?.length) return state;
      return { ...state, items: [...state.items, ...back], ...(state.hiddenRemote ? { hiddenRemote: hidden } : {}) };
    }
    case 'mergeRemote': {
      if (a.items === state.items) return state;
      // the open chat may have been hidden by the session filter → the shell starts a new chat
      const activeId = state.activeId && a.items.some((c) => c.id === state.activeId) ? state.activeId : undefined;
      return { ...state, items: a.items, activeId };
    }
    case 'hideRemote': {
      const hidden = state.hiddenRemote ?? [];
      return {
        ...state,
        items: state.items.filter((c) => c.id !== a.id),
        activeId: state.activeId === a.id ? undefined : state.activeId,
        hiddenRemote: hidden.includes(a.sessionId) ? hidden : [...hidden, a.sessionId].slice(-500),
      };
    }
    case 'remoteLoaded':
      return mapOne(state, a.id, (c) => {
        if (!c.remote) return c;
        const lastActive = Math.max(c.remote.lastActive ?? 0, a.lastActive ?? 0) || undefined;
        // same 1 s tolerance as mergeRemoteSessions (device vs. server clock, list rounding)
        const updatedAt = lastActive && lastActive > c.updatedAt + 1000 ? lastActive : c.updatedAt;
        return { ...c, updatedAt, remote: { ...c.remote, loadedAt: a.at, lastActive } };
      });
    case 'setModelOptions':
      return mapOne(state, a.id, (c) => {
        const { modelOptions: _old, ...rest } = c;
        const o = a.options && Object.keys(a.options).length ? a.options : undefined;
        if (JSON.stringify(c.modelOptions) === JSON.stringify(o)) return c;
        return o ? { ...rest, modelOptions: o } : rest;
      });
    case 'setModelLock':
      return mapOne(state, a.id, (c) => {
        if (JSON.stringify(c.modelLock) === JSON.stringify(a.lock)) return c;
        const { modelLock: _old, ...rest } = c;
        return a.lock ? { ...rest, modelLock: a.lock } : rest;
      });
    case 'archive': {
      const ids = new Set(a.ids);
      let changed = false;
      const items = state.items.map((c) => {
        if (!ids.has(c.id) || !!c.archived === a.archived) return c;
        changed = true;
        if (a.archived) return { ...c, archived: true };
        const { archived: _old, ...rest } = c;
        return rest;
      });
      return changed ? { ...state, items } : state;
    }
    case 'setBranchSeed':
      return mapOne(state, a.id, (c) => {
        const count = a.count && a.count > 0 ? Math.floor(a.count) : undefined;
        if (c.branchSeed === count) return c;
        const { branchSeed: _old, ...rest } = c;
        return count ? { ...rest, branchSeed: count } : rest;
      });
    case 'rename': {
      const title = cleanUserTitle(a.title);
      if (!title) return state;
      return mapOne(state, a.id, (c) => ({ ...c, title, titleSource: 'user' }));
    }
    case 'autoTitle': {
      const title = cleanUserTitle(a.title);
      if (!title) return state;
      return mapOne(state, a.id, (c) =>
        (c.titleSource === 'auto' || c.titleSource === 'meta') && (c.title !== title || c.titleSource !== 'meta') ? { ...c, title, titleSource: 'meta' } : c
      );
    }
    case 'pin':
      return mapOne(state, a.id, (c) => {
        const pinned = a.pinned ?? !c.pinned;
        return { ...c, pinned: pinned ? true : undefined };
      });
    case 'setSession':
      return mapOne(state, a.id, (c) => (c.hermesSessionId === a.sessionId ? c : { ...c, hermesSessionId: a.sessionId }));
    case 'setModel': {
      const model = a.model?.trim() || undefined;
      return mapOne(state, a.id, (c) => {
        if (c.model === model) return c;
        const { model: _old, ...rest } = c;
        return model ? { ...rest, model } : rest;
      });
    }
    case 'setProfile':
      return mapOne(state, a.id, (c) =>
        c.profileKind !== a.profileKind || c.profileId === a.profileId ? c : { ...c, profileId: a.profileId },
      );
    case 'rebindDraft':
      return mapOne(state, a.id, (c) => {
        if (!isDraft(c) || c.origin === 'remote' || (c.profileId === a.profile.id && c.profileKind === a.profile.kind)) return c;
        const { model: _m, modelOptions: _o, hermesProfile: _b, ...rest } = c;
        return { ...rest, profileId: a.profile.id, profileKind: a.profile.kind, hermesSessionId: a.sessionId };
      });
    case 'setBot':
      return mapOne(state, a.id, (c) => {
        const bot = botOf(a.bot);
        if (!isDraft(c) || c.origin === 'remote' || (c.profileKind !== 'hermes' && c.profileKind !== 'demo') || c.hermesProfile === bot) return c;
        const { model: _m, modelOptions: _o, hermesProfile: _b, ...rest } = c;
        return { ...rest, hermesSessionId: a.sessionId, ...(bot ? { hermesProfile: bot } : {}) };
      });
    case 'setActive':
      return state.activeId === a.id ? state : { ...state, activeId: a.id };
    case 'saved':
      return mapOne(state, a.id, (c) => ({
        ...c,
        // auto title: first user message; never overwrite a user title
        title: c.titleSource === 'auto' && a.firstUserText ? makeTitle(a.firstUserText) : c.title,
        preview: a.preview,
        messageCount: a.messageCount,
        updatedAt: a.now,
        ...(a.truncated || c.historyTruncated ? { historyTruncated: true } : {}),
      }));
    case 'pruneDrafts': {
      const items = state.items.filter((c) => c.messageCount > 0 || c.preview !== '' || c.botChat || c.id === a.keep);
      return items.length === state.items.length ? state : { ...state, items };
    }
    default:
      return state;
  }
}

function mapOne(state: IndexState, id: string, fn: (c: ConversationMeta) => ConversationMeta): IndexState {
  let changed = false;
  const items = state.items.map((c) => {
    if (c.id !== id) return c;
    const n = fn(c);
    if (n !== c) changed = true;
    return n;
  });
  return changed ? { ...state, items } : state;
}

/** Drafts (nothing sent yet) are not shown in the list. */
export function isDraft(c: ConversationMeta): boolean {
  // a bot's empty "Bot Chat" is a place, not a draft: never re-used for a new chat, rebound or pruned
  return c.messageCount === 0 && c.preview === '' && !c.botChat;
}
