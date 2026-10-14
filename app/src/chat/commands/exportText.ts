/** /export: the visible transcript as Markdown (pure). Empty turns are skipped; attachments are listed by name. */
import type { ChatMessage } from '../../hermes/types.ts';

export function transcriptMarkdown(
  messages: readonly Pick<ChatMessage, 'role' | 'text' | 'attachments'>[],
  labels: { title: string; user: string; assistant: string; attachment: string },
): string {
  const parts = [`# ${labels.title}`];
  for (const m of messages) {
    const text = m.text.trim();
    const files = m.role === 'user' ? (m.attachments ?? []).map((a) => `_${labels.attachment}: ${a.name}_`) : [];
    if (!text && !files.length) continue;
    parts.push(`## ${m.role === 'user' ? labels.user : labels.assistant}`, [text, ...files].filter(Boolean).join('\n\n'));
  }
  return `${parts.join('\n\n')}\n`;
}
