/**
 * Screen-reader announcement of a FINISHED answer (AnswerAnnouncer.tsx). The streaming text itself has no live region:
 * a live region over the growing markdown would make TalkBack / VoiceOver / web readers speak every token batch.
 * Instead, when an answer we saw streaming turns `done` (voice/statusTrack.ts: live transitions only, so opening an old
 * chat stays silent), one short polite announcement: "Answer ready: <first sentence or so>". The full answer is then
 * read by moving to it. Pure (answerAnnounce.test.ts).
 */
import type { TFn } from '../i18n/core.ts';
import { answerText } from '../hermes/progressNotes.ts';
import type { ToolEvent } from '../hermes/types';
import { toSpeechText } from '../voice/speechText.ts';

/** characters of the answer read in the announcement (a sentence or two, never the whole answer) */
export const ANNOUNCE_PREVIEW_MAX = 160;

export type AnnounceableMessage = { id: string; role: string; text: string; status: string; tools?: ToolEvent[] };

/** First `max` characters of plain text, cut at a word boundary, "…" when shortened. */
export function previewText(text: string, max = ANNOUNCE_PREVIEW_MAX): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.–-]+$/, '')}…`;
}

/** The announcement for a finished answer ('' for anything that is not a finished assistant answer). */
export function answerAnnouncement(msg: AnnounceableMessage, t: TFn): string {
  if (msg.role !== 'assistant' || msg.status !== 'done') return '';
  // only the final answer: interim notes before tool calls are not repeated (same as read-aloud, voice/useAutoRead.ts)
  const text = msg.tools?.length ? answerText({ ...msg, role: 'assistant', status: 'done', tools: msg.tools }) : msg.text;
  const preview = previewText(toSpeechText(text, t));
  return preview ? t('chat.message.answerReadyPreview', { preview }) : t('chat.message.answerReady');
}
