/**
 * The hand-over between a chat's live cards (LiveProvider) and its send path (hermes/useHermesChat.ts): the batches
 * of this device's pending edits for the next request, the open cards for the bridge router (`X-HUI-Live`), and what
 * to do once Hermes accepted the turn.
 */
import type { ChatMessage } from '../hermes/types';
import type { LiveBatches, LiveTypes } from './trailer.ts';

export interface LiveOutgoing {
  /** trailer batches (may be empty: then only the header goes along) */
  batches: LiveBatches;
  /** how each card spells its items on the wire */
  types: LiveTypes;
  /** `X-HUI-Live` for the bridge router (live/focus.ts `liveHeader`); empty = no open cards */
  header: string;
  /** Hermes took the turn: the sent ops leave the pending list (ops made meanwhile stay) */
  onAccepted(): void;
}

export const hasBatches = (o: LiveOutgoing | null | undefined): o is LiveOutgoing => !!o && Object.keys(o.batches).length > 0;

/** The transcript with the sent batches on its last user message (the fold reads them from there). */
export function withLiveOnLastUser(messages: ChatMessage[], batches: LiveBatches): ChatMessage[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== 'user') continue;
    const out = messages.slice();
    out[i] = { ...messages[i], live: batches };
    return out;
  }
  return messages;
}
