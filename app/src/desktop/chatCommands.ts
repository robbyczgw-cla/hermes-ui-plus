/**
 * Desktop menu commands that need the open chat's messages (used by the visible ChatView only):
 * ⇧⌘C / Chat → "Letzte Antwort kopieren" copies the last finished answer as the "Kopieren" button would.
 */
import { useEffect, useRef } from 'react';
import { shellState } from '../background/noticeState';
import { useCopy } from '../chat/actions';
import { useToast } from '../chat/Toast';
import { TOOL_MARKUP_NOTICE_KEY } from '../chat/toolMarkup';
import type { ChatMessage } from '../hermes/types';
import { useT } from '../i18n';
import { usePreferences } from '../settings/PreferencesProvider';
import { onDesktopEvent } from './bridge';
import { lastAnswerText } from './lastAnswer';

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
        const text = lastAnswerText(r.messages(), r.notesInline, r.tr(TOOL_MARKUP_NOTICE_KEY));
        if (text) r.copy(text, r.tr('desktop.copiedLast'));
        else r.toast(r.tr('desktop.noAnswer'));
      }),
    [],
  );
}
