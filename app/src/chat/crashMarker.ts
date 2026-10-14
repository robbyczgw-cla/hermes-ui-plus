// Persisted "this chat crashed while rendering" marker (pure logic + injectable storage, node:test-able).
//
// A render crash that is caused by persisted data (a stored message, persisted node state) comes back
// on every start. The chat boundary writes this marker when it catches a crash and removes it once the
// chat has rendered stably again; on app start, ChatScreen opens a fresh empty chat instead of the
// marked one (the crashed chat stays in the drawer).

export const CRASH_STORAGE_KEY = 'hui.chatCrash';

export type ChatCrashMarker = {
  conversationId: string;
  profileId?: string;
  /** first line of the error message (diagnostics only) */
  message?: string;
  at: number;
};

export type CrashStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

/** Markers older than this are ignored (a chat fixed by an app update should open normally again). */
export const CRASH_MARKER_TTL_MS = 3 * 24 * 60 * 60 * 1000;

export function parseCrashMarker(raw: string | null | undefined): ChatCrashMarker | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<ChatCrashMarker> | null;
    if (!v || typeof v !== 'object' || typeof v.conversationId !== 'string' || !v.conversationId) return null;
    return {
      conversationId: v.conversationId,
      profileId: typeof v.profileId === 'string' ? v.profileId : undefined,
      message: typeof v.message === 'string' ? v.message.slice(0, 200) : undefined,
      at: typeof v.at === 'number' && Number.isFinite(v.at) ? v.at : 0,
    };
  } catch {
    return null;
  }
}

export function makeCrashMarker(conversationId: string, profileId: string | undefined, error: unknown, now = Date.now()): ChatCrashMarker {
  const msg = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return { conversationId, profileId, message: msg.split('\n')[0].slice(0, 200) || undefined, at: now };
}

/** On start: open a fresh chat instead of `activeId` when it is the (recently) crashed one. */
export function shouldStartFresh(marker: ChatCrashMarker | null, activeId: string | undefined, now = Date.now()): boolean {
  if (!marker || !activeId) return false;
  if (marker.conversationId !== activeId) return false;
  return now - marker.at < CRASH_MARKER_TTL_MS;
}

export async function readCrashMarker(storage: CrashStorage): Promise<ChatCrashMarker | null> {
  try {
    return parseCrashMarker(await storage.getItem(CRASH_STORAGE_KEY));
  } catch {
    return null;
  }
}

export async function writeCrashMarker(storage: CrashStorage, marker: ChatCrashMarker): Promise<void> {
  try {
    await storage.setItem(CRASH_STORAGE_KEY, JSON.stringify(marker));
  } catch {
    /* best effort – never throw from crash handling */
  }
}

/** Remove the marker; with `conversationId`, only when it belongs to that chat. */
export async function clearCrashMarker(storage: CrashStorage, conversationId?: string): Promise<void> {
  try {
    if (conversationId) {
      const cur = parseCrashMarker(await storage.getItem(CRASH_STORAGE_KEY));
      if (!cur || cur.conversationId !== conversationId) return;
    }
    await storage.removeItem(CRASH_STORAGE_KEY);
  } catch {
    /* best effort */
  }
}
