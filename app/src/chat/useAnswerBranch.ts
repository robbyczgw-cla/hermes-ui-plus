/**
 * "In neuem Chat fortsetzen" from one answer (answer menu). The mode per backend is decided in answerMenu.ts
 * (planBranch): Hermes forks the server session from the last answer, seeds a fresh session with the copied turns
 * from an earlier one; direct backends get a plain copy of the transcript. The new chat opens with the composer
 * focused.
 */
import { fetch as expoFetch } from 'expo/fetch';
import { useCallback, useMemo } from 'react';
import { useConversations, useConversationsInternals } from '../conversations/ConversationsProvider';
import { requestComposerFocus } from '../desktop/bridge';
import { createJsonRequest, sessionErrorText } from '../hermes/sessions';
import { withBot } from '../hermes/bots';
import type { FetchLike } from '../hermes/stream';
import { sessionsSupported } from '../hermes/support';
import type { ChatMessage } from '../hermes/types';
import { useT } from '../i18n';
import type { ConnectionProfile } from '../settings/profiles';
import { branchHistory, branchPoint, planBranch } from './answerMenu';
import { forkSession } from './commands/api';
import { useToast } from './Toast';

const nativeFetch = expoFetch as unknown as FetchLike;

export function useAnswerBranch(opts: {
  conversationId: string | undefined;
  profile: ConnectionProfile;
  /** latest transcript (read at call time) */
  messages: () => ChatMessage[];
  /** Hermes session id of the open chat (hook state; the meta's id wins) */
  sessionId: string | undefined;
}): (answerId: string) => Promise<void> {
  const { conversationId, profile, messages, sessionId } = opts;
  const convs = useConversations();
  const { controller } = useConversationsInternals();
  const toast = useToast();
  const tr = useT();
  // fork under the chat's Hermes bot (/p/<bot>/api/sessions/{id}/fork)
  const bot = conversationId ? convs.get(conversationId)?.hermesProfile : undefined;
  const request = useMemo(() => createJsonRequest(nativeFetch, withBot({ baseUrl: profile.baseUrl, apiKey: profile.apiKey }, bot)), [profile.baseUrl, profile.apiKey, bot]);

  return useCallback(
    async (answerId: string) => {
      const meta = conversationId ? convs.get(conversationId) : undefined;
      if (!meta) return;
      const list = messages();
      // a failed answer (a chat Hermes paused): the copy starts from the answer before the failed turn
      const point = branchPoint(list, answerId);
      const history = point ? branchHistory(list, point) : null;
      if (!history) return;
      const hermes = profile.kind === 'hermes';
      const sid = hermes ? (meta.hermesSessionId ?? sessionId) : undefined;
      let mode = planBranch({
        kind: profile.kind,
        isLast: list[list.length - 1]?.id === point,
        hasRemoteSession: hermes && !!sid && history.some((m) => m.role === 'user'),
        sessionsApi: hermes ? sessionsSupported(withBot({ baseUrl: profile.baseUrl, apiKey: profile.apiKey }, meta.hermesProfile)) : undefined,
      });
      let fork: { id: string; title?: string } | null = null;
      if (mode === 'fork' && sid) {
        try {
          fork = await forkSession(request, sid);
        } catch (e) {
          // fork refused (old server, bridge allow-list, offline): a fresh session with the copied turns still works
          if (__DEV__) console.warn('[branch] fork failed, seeding a fresh session', sessionErrorText(e, tr));
        }
        if (!fork) mode = 'seed';
      }
      try {
        // always a NEW, fully initialised conversation that then becomes the open chat (never a mounted draft)
        controller.createBranch(
          { id: profile.id, kind: profile.kind },
          {
            messages: history,
            sessionId: fork?.id,
            seed: mode === 'seed' ? history.length : undefined,
            model: meta.model,
            modelOptions: meta.modelOptions,
            title: fork?.title ?? meta.title,
            bot: meta.hermesProfile,
          }
        );
        toast(tr('menus.answer.branchDone'));
        // after the switch: the old chat view must not take the focus request
        setTimeout(requestComposerFocus, 150);
      } catch (e) {
        toast(tr('menus.answer.branchFailed', { message: e instanceof Error ? e.message : String(e) }));
      }
    },
    [conversationId, convs, controller, messages, profile.id, profile.kind, profile.baseUrl, profile.apiKey, sessionId, request, toast, tr],
  );
}
