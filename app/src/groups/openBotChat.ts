/**
 * A bot's own chat for something that happened in a group (an approval line's "Öffnen", an approval push of a member
 * turn): the app's Bot Chat of that bot, else looked up / created on the server (bots/api.ts). Never a chat of the
 * hidden `Group: <id>` session itself. Pure, the request is injected (node:test).
 */
import { botOf } from '../hermes/bots.ts';
import type { JsonRequest } from '../hermes/sessions.ts';
import type { BotChatController } from '../bots/adopt.ts';
import { resolveBotChat } from '../bots/api.ts';
import { findBotChat } from '../bots/core.ts';
import type { ConversationMeta } from '../conversations/types.ts';

export async function openBotChatOf(
  ctl: BotChatController,
  p: { id: string },
  bot: string | undefined,
  request: JsonRequest,
): Promise<ConversationMeta | null> {
  const b = botOf(bot);
  const known = findBotChat(ctl.list(), p.id, b);
  if (known) return known;
  const r = await resolveBotChat(request);
  if (r.ok) return ctl.openBotChat({ id: p.id, kind: 'hermes' }, b, r.session, { activate: false });
  if (r.reason === 'unsupported') return ctl.openBotChat({ id: p.id, kind: 'hermes' }, b, null, { activate: false });
  return null;
}
