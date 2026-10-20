/**
 * "Ask Hermes" from Skills & memory and Routines: the question goes to a NEW chat with the screen's bot, never into
 * whatever chat happens to be open (it may be another topic, or a continued chat that sends its own context first).
 * `create` re-uses an empty draft of this connection (conversations/controller.ts), so repeated asks do not pile up
 * empty chats. Pure; the hook around it is useAskHermes.ts.
 */
import { botOf } from '../hermes/bots.ts';
import type { ProfileRef } from '../conversations/types.ts';
import type { ShareDelivery } from '../share/inbox.ts';

export interface AskConversations {
  activeId: string | undefined;
  create(profile: ProfileRef, opts?: { bot?: string }): { id: string };
  setActiveId(id: string): void;
}

/** Start the chat for the question and hand it the text; returns the chat's id (null: nothing to ask). */
export function askInNewChat(
  convs: AskConversations,
  profile: ProfileRef | null | undefined,
  bot: string | undefined,
  text: string,
  mode: 'send' | 'fill',
  deliver: (conversationId: string, d: ShareDelivery) => void,
): string | null {
  if (!profile || !text.trim()) return null;
  const b = botOf(bot);
  const target = convs.create({ id: profile.id, kind: profile.kind }, b ? { bot: b } : undefined);
  if (convs.activeId !== target.id) convs.setActiveId(target.id);
  deliver(target.id, { text, files: [], ...(mode === 'fill' ? { fillOnly: true } : {}) });
  return target.id;
}
