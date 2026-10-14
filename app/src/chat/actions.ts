import * as Clipboard from 'expo-clipboard';
import { useCallback } from 'react';
import { Platform, Share } from 'react-native';
import type { HuiAction } from '../protocol/types';
import { haptic, type HuiActionMeta, type HuiFieldValue } from '../ui';
import { desktopShare } from '../desktop/bridge';
import { useT } from '../i18n';
import { handleChatAction, type ChatActionDeps } from './actionHandler';
import { useToast } from './Toast';

// both respect Settings → Bedienung → Haptik (via ui/haptics)
export function lightHaptic() {
  haptic('light');
}

export function successHaptic() {
  haptic('success');
}

/** Copy text + haptic + toast. */
export function useCopy() {
  const toast = useToast();
  const tr = useT();
  return useCallback(
    (text: string, message?: string) => {
      Clipboard.setStringAsync(text).catch(() => {});
      successHaptic();
      toast(message ?? tr('chat.copied'));
    },
    [toast, tr],
  );
}

/** Share text via the OS share sheet (web: Web Share API, else copy as fallback). */
export function useShareText() {
  const copy = useCopy();
  const tr = useT();
  return useCallback(
    async (text: string) => {
      if (!text) return;
      if (Platform.OS === 'web') {
        // macOS app: the system share picker (Messages, Mail, AirDrop, …) at the pointer
        if (await desktopShare(text)) return;
        const nav = (globalThis as { navigator?: { share?: (d: { text: string }) => Promise<void> } }).navigator;
        if (typeof nav?.share === 'function') {
          await nav.share({ text }).catch(() => {}); // dismissed
          return;
        }
        copy(text, tr('chat.share.unavailable'));
        return;
      }
      lightHaptic();
      try {
        await Share.share({ message: text });
      } catch {
        copy(text, tr('chat.share.failed'));
      }
    },
    [copy, tr],
  );
}

export type { ChatActionDeps } from './actionHandler';

/**
 * Central HuiAction handler for HuiView and HtmlBlock (SPEC-modules-v2); the logic lives in actionHandler.ts
 * (pure, tested): model-provided text the user did not see verbatim goes through the confirmation sheet first.
 * Returns false when a message could not be sent (turn running) so interactive nodes stay open.
 */
export function useChatActionHandler({ send, isBusy, run, buildAsk }: ChatActionDeps) {
  const toast = useToast();
  const tr = useT();
  return useCallback(
    (action: HuiAction, values?: Record<string, HuiFieldValue>, meta?: HuiActionMeta, messageId?: string): boolean =>
      handleChatAction({ send, isBusy, run, buildAsk }, { toast, tr, tapHaptic: lightHaptic }, action, values, meta, messageId),
    [send, isBusy, run, buildAsk, toast, tr],
  );
}
