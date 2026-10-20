/**
 * /export: the visible transcript as Markdown (pure). Empty turns are skipped; attachments are listed by name. Raw
 * tool-call markup in an answer becomes the answer's notice line (`toolNotice`, chat/toolMarkup.ts), as it shows.
 */
import type { ChatMessage } from '../../hermes/types.ts';
import { answerOutputText } from '../toolMarkup.ts';

export function transcriptMarkdown(
  messages: readonly Pick<ChatMessage, 'role' | 'text' | 'attachments'>[],
  labels: { title: string; user: string; assistant: string; attachment: string; toolNotice: string },
): string {
  const parts = [`# ${labels.title}`];
  for (const m of messages) {
    const text = (m.role === 'assistant' ? answerOutputText(m.text, labels.toolNotice) : m.text).trim();
    const files = m.role === 'user' ? (m.attachments ?? []).map((a) => `_${labels.attachment}: ${a.name}_`) : [];
    if (!text && !files.length) continue;
    parts.push(`## ${m.role === 'user' ? labels.user : labels.assistant}`, [text, ...files].filter(Boolean).join('\n\n'));
  }
  return `${parts.join('\n\n')}\n`;
}
