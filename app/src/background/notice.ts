/**
 * "Antwort ist da" notices (pure, node:test). One notice per finished turn, for every backend, whichever path
 * delivered the final answer (live stream end, Hermes recovery via inbox / stored session / transcript sync):
 * all paths keep the message id, so `${conversationId}:${messageId}` de-duplicates them.
 *
 * Routing:
 *   app in the background                         → local notification (preview setting respected)
 *   foreground, another chat / another screen     → banner "Antwort von <Profil> ist da" + "Öffnen", unread dot
 *   foreground, same chat, scrolled away          → "Neue Antwort ↓" pill
 *   foreground, same chat, at the bottom          → short flash on the message (only for answers that arrived
 *                                                   late: recovered / finished while hidden), else nothing
 */
import type { ChatMessage } from '../hermes/types.ts';
import { answerText } from '../hermes/progressNotes.ts';

export type NoticeRoute = 'notification' | 'banner' | 'pill' | 'flash' | 'none';

export type NoticeContext = {
  /** AppState is `active` */
  appActive: boolean;
  /** conversation the chat screen shows (null: none) */
  openConversationId: string | null | undefined;
  /** the chat screen is the visible screen (not settings / gallery on top) */
  chatFocused: boolean;
  /** the open chat's list is scrolled to (near) the newest message */
  nearBottom: boolean;
};

export type NoticeEvent = {
  conversationId: string;
  message: ChatMessage;
  /** the answer arrived late (Hermes recovery) or while the chat was hidden */
  late?: boolean;
};

export function routeNotice(ev: NoticeEvent, c: NoticeContext): NoticeRoute {
  if (!isFinishedAnswer(ev.message)) return 'none';
  if (!c.appActive) return 'notification';
  if (!c.chatFocused || c.openConversationId !== ev.conversationId) return 'banner';
  if (!c.nearBottom) return 'pill';
  return ev.late ? 'flash' : 'none';
}

/** a finished, non-empty assistant answer (stopped / failed turns get no "ready" notice) */
export function isFinishedAnswer(m: ChatMessage | undefined): m is ChatMessage {
  return !!m && m.role === 'assistant' && m.status === 'done' && (!!m.text.trim() || !!m.attachments?.length);
}

export function noticeKey(ev: Pick<NoticeEvent, 'conversationId' | 'message'>): string {
  return `${ev.conversationId}:${ev.message.id}`;
}

/** remembers notified answers (bounded); `first(key)` is true exactly once per key */
export function createNoticeDeduper(max = 300) {
  const seen = new Set<string>();
  return {
    first(key: string): boolean {
      if (seen.has(key)) return false;
      seen.add(key);
      if (seen.size > max) {
        const oldest = seen.values().next().value;
        if (oldest !== undefined) seen.delete(oldest);
      }
      return true;
    },
    /** answers that already existed when the app started must never notify (restored transcripts) */
    mark(key: string): void {
      seen.add(key);
    },
    has(key: string): boolean {
      return seen.has(key);
    },
  };
}

const FENCE_RE = /```[\s\S]*?(```|$)/g;

/** first readable line of an answer for the notification body (fenced hui/code blocks and markdown stripped) */
export function firstLine(text: string, max = 120): string {
  const plain = text
    .replace(FENCE_RE, '\n')
    .split('\n')
    .map((l) => l.replace(/^\s*(#{1,6}\s+|[-*+]\s+|>\s*|\d+[.)]\s+)/, '').replace(/[*_`~]+/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').trim())
    .find((l) => l.length > 0);
  if (!plain) return '';
  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain;
}

/** notification body: first line, or a generic text when previews are off / nothing readable */
export function notificationBody(m: ChatMessage, preview: boolean, generic: string): string {
  if (!preview) return generic;
  return firstLine(answerText(m)) || generic;
}
