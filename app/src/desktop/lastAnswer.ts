/** ⇧⌘C / Chat → "Letzte Antwort kopieren": the text it copies (pure, desktop.test.ts). */
import { plainCopyText } from '../chat/format.ts';
import { extractMedia } from '../chat/mediaTags.ts';
import { answerOutputText } from '../chat/toolMarkup.ts';
import type { ChatMessage } from '../hermes/types.ts';
import { splitProgressNotes } from '../hermes/progressNotes.ts';

/**
 * plain text of the newest finished answer, as the answer's own copy button copies it: interim notes left out, raw
 * tool-call markup replaced by `notice` (chat/toolMarkup.ts)
 */
export function lastAnswerText(messages: readonly ChatMessage[], notesInline: boolean, notice: string): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'assistant' || m.status === 'streaming' || m.status === 'error') continue;
    const shown = answerOutputText(notesInline ? m.text : splitProgressNotes(m).answer, notice);
    const text = plainCopyText(extractMedia(shown, false).text).trim();
    if (text) return text;
  }
  return null;
}
