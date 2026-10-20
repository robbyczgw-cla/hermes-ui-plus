/**
 * Opening a bot's "Bot Chat" on the server (bots/core.ts). Pure: the JSON request is injected (client.ts
 * hermesJsonRequest on the bot's connection, i.e. `/p/<bot>` for a non-default bot).
 *
 * 1. `GET /api/sessions?title=Bot%20Chat&include_hidden=1` → adopt the session with exactly that title (Hermes
 *    Desktop's thread is hidden, hence include_hidden).
 * 2. none → `POST /api/sessions {title:"Bot Chat"}`: the bridge (0.2+) adopts-or-creates, a direct Hermes creates.
 * An older bridge refuses the POST (404 / 405): `unsupported`, the app then keeps a chat of its own for this bot.
 */
import { isUnsupportedError, parseSession, type JsonRequest, type RemoteSession } from '../hermes/sessions.ts';
import { HermesError } from '../hermes/stream.ts';
import { BOT_CHAT_TITLE, botChatFromAnswer, pickBotChatRow } from './core.ts';

export type BotChatResolution =
  | { ok: true; session: RemoteSession; via: 'found' | 'created' }
  | { ok: false; reason: 'unsupported' | 'auth' | 'error'; error?: unknown };

export const BOT_CHAT_LOOKUP = `/api/sessions?title=${encodeURIComponent(BOT_CHAT_TITLE)}&include_hidden=1&limit=20`;

function failure(e: unknown): BotChatResolution {
  if (isUnsupportedError(e)) return { ok: false, reason: 'unsupported', error: e };
  if (e instanceof HermesError && (e.kind === 'auth' || e.status === 401 || e.status === 403)) return { ok: false, reason: 'auth', error: e };
  return { ok: false, reason: 'error', error: e };
}

/** Only the lookup (Bots tab refresh: last line / activity of every bot without opening it). */
export async function lookupBotChat(request: JsonRequest): Promise<RemoteSession | null> {
  return pickBotChatRow(await request('GET', BOT_CHAT_LOOKUP), parseSession);
}

export async function resolveBotChat(request: JsonRequest): Promise<BotChatResolution> {
  try {
    const found = await lookupBotChat(request);
    if (found) return { ok: true, session: found, via: 'found' };
  } catch (e) {
    return failure(e);
  }
  try {
    const made = botChatFromAnswer(await request('POST', '/api/sessions', { title: BOT_CHAT_TITLE }), parseSession);
    if (made) return { ok: true, session: made, via: 'created' };
    return { ok: false, reason: 'error' };
  } catch (e) {
    return failure(e);
  }
}
