/**
 * Which answer just finished (useAutoRead.ts): message statuses of the previous update, kept across streaming updates.
 * The previous version rebuilt a Map over every message of the chat on each streaming tick; now an update that keeps
 * the ids in place (the usual one: the last message changed, or messages were appended) only touches the message
 * objects that changed (React state is immutable). Anything else – a switched chat, a removed or replaced message –
 * rebuilds the map as before. Message ids are unique within a chat. Pure (node:test, statusTrack.test.ts).
 */

export type TrackedMessage = { id: string; role: string; text: string; status: string };

export type StatusTrack<M extends TrackedMessage> = { list: readonly M[] | null; seen: Map<string, string> };

export type StatusStep<M> = {
  /** the last assistant message that went streaming → done in this update (with text), if any */
  finished: M | null;
  /** the id of the last message was known before this update */
  lastWasKnown: boolean;
};

export function createStatusTrack<M extends TrackedMessage>(): StatusTrack<M> {
  return { list: null, seen: new Map() };
}

const justFinished = (m: TrackedMessage, before: string | undefined) => m.role === 'assistant' && m.status === 'done' && before === 'streaming' && !!m.text.trim();

export function stepStatuses<M extends TrackedMessage>(track: StatusTrack<M>, messages: readonly M[]): StatusStep<M> {
  const prev = track.list;
  const last = messages[messages.length - 1];
  const lastWasKnown = !!last && track.seen.has(last.id);
  let inPlace = !!prev && messages.length >= prev.length;
  if (prev && inPlace) {
    for (let i = 0; i < prev.length; i++) {
      if (prev[i] !== messages[i] && prev[i].id !== messages[i].id) {
        inPlace = false;
        break;
      }
    }
  }
  let finished: M | null = null;
  if (prev && inPlace) {
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      if (i < prev.length && m === prev[i]) continue; // same object: same status as last time
      if (justFinished(m, track.seen.get(m.id))) finished = m;
      track.seen.set(m.id, m.status);
    }
  } else {
    const next = new Map<string, string>();
    for (const m of messages) {
      next.set(m.id, m.status);
      if (justFinished(m, track.seen.get(m.id))) finished = m;
    }
    track.seen = next;
  }
  track.list = messages;
  return { finished, lastWasKnown };
}
