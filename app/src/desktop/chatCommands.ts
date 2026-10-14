/**
 * Desktop menu commands that need the open chat's messages (used by the visible ChatView only):
 * ⇧⌘C / Chat → "Letzte Antwort kopieren" copies the last finished answer as the "Kopieren" button would.
 */
import { useEffect, useRef } from 'react';
import { shellState } from '../background/noticeState';
import { useCopy } from '../chat/actions';
import { plainCopyText } from '../chat/format';
import { extractMedia } from '../chat/mediaTags';
import { useToast } from '../chat/Toast';
import type { ChatMessage } from '../hermes/types';
import { splitProgressNotes } from '../hermes/progressNotes';
import { useT } from '../i18n';
import { usePreferences } from '../settings/PreferencesProvider';
import { onDesktopEvent } from './bridge';

/** plain text of the newest finished answer (interim notes left out like the answer's own copy button) */
export function lastAnswerText(messages: readonly ChatMessage[], notesInline: boolean): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'assistant' || m.status === 'streaming' || m.status === 'error') continue;
    const shown = notesInline ? m.text : splitProgressNotes(m).answer;
    const text = plainCopyText(extractMedia(shown, false).text).trim();
    if (text) return text;
  }
  return null;
}

export function useDesktopChatCommands(messages: () => readonly ChatMessage[]): void {
  const copy = useCopy();
  const toast = useToast();
  const tr = useT();
  const notesInline = usePreferences().prefs['answers.progressNotes'];
  const ref = useRef({ messages, copy, toast, tr, notesInline });
  useEffect(() => {
    ref.current = { messages, copy, toast, tr, notesInline };
  });
  useEffect(
    () =>
      onDesktopEvent((e) => {
        if (e.cmd !== 'copy-last' || !shellState.chatFocused) return;
        const r = ref.current;
        const text = lastAnswerText(r.messages(), r.notesInline);
        if (text) r.copy(text, r.tr('desktop.copiedLast'));
        else r.toast(r.tr('desktop.noAnswer'));
      }),
    [],
  );
}
