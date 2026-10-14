/**
 * After a failed turn in a chat that runs on an explicitly picked model (conversation override),
 * offer to go back to "Standard" (e.g. Hermes 409 model_lock_unavailable, a provider without
 * credentials, a model the server rejects). Returns props for ChatView's notice.
 */
import { useMemo } from 'react';
import type { ChatMessage } from '../hermes/types';
import { useT } from '../i18n';
import { failedWithPickedModel } from './models';

export function useModelFallback(
  messages: readonly ChatMessage[],
  override: string | undefined,
  label: string,
  reset: () => void
): { notice?: string; noticeAction?: { label: string; onPress(): void } } {
  const tr = useT();
  const failed = failedWithPickedModel(messages, override);
  return useMemo(
    () => (failed ? { notice: tr('chat.models.rejected', { model: label || override || '' }), noticeAction: { label: tr('chat.models.useDefault'), onPress: reset } } : {}),
    [failed, tr, label, override, reset]
  );
}
