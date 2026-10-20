// Chat session for the offline demo profile (`kind: 'demo'`), lazy-loaded via chat/sessionRegistry.
// Same contract as every lazy session component (chat/sessionRegistry.ts). The "Demo" strip with the CTA to set up a real connection is
// drawn by chat/ChatHeader for `kind === 'demo'` (in the header flow, no guessed offsets).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SessionProps } from '../../chat/ChatScreen';
import { ChatView, SessionPending } from '../../chat/ChatView';
import { sessionOptions, usePersistOnNewMessage } from '../../chat/useSessionPersistence';
import { useConversation, type UseConversation } from '../../conversations';
import { LiveProvider, type LiveController } from '../../live/LiveProvider';
import { useStarterPrompt } from '../starterPrompt';
import { useReportAttention } from '../../bots/state';
import { botOf } from '../../hermes/bots';
import { useLocale } from '../../i18n';
import { demoBotRole, SCOUT_APPROVAL, scoutPendingSteps } from './bots';
import { demoBotStore, useDemoBotsState } from './botStore';
import { useDemoChat } from './useDemoChat';

export default function DemoSession(props: SessionProps) {
  const conv = useConversation(props.conversationId);
  // a demo bot's chat also waits for what the demo remembers about its bots (is Scout's approval still open?)
  const bots = useDemoBotsState();
  // header + composer at once, placeholder in the message area while the stored transcript is read (ChatView SessionPending)
  if (!conv.ready || !conv.meta || (conv.meta.botChat && !bots.loaded)) {
    return (
      <SessionPending
        exists={!!conv.meta}
        profile={props.profile}
        onNewChat={props.onNewChat}
        onOpenDrawer={props.onOpenDrawer}
      />
    );
  }
  return <DemoSessionInner {...props} conv={conv} />;
}

function DemoSessionInner({ conv, profile, onNewChat, onOpenDrawer }: SessionProps & { conv: UseConversation }) {
  // live cards as with Hermes (chat/ChatScreen.tsx): the tray, receipts and the user's edits on the next message
  const liveRef = useRef<LiveController | null>(null);
  const liveOutgoing = useCallback((text: string) => liveRef.current?.outgoing(text) ?? null, []);
  // a demo bot's Bot Chat (onboarding/demo/bots.ts) answers in its role; Scout's last turn still waits for an approval
  const { lang } = useLocale();
  const demoBots = useDemoBotsState();
  const bot = conv.meta?.hermesProfile;
  const botChat = !!conv.meta?.botChat;
  const role = botChat ? demoBotRole(bot, lang, demoBots.created) : undefined;
  // fixed when the chat opens: the waiting turn is replayed once per mount
  const [scoutWaiting] = useState(() => botChat && botOf(bot) === 'scout' && demoBots.scoutApproval === 'waiting');
  // the waiting turn is replayed on every open until it is answered (a stored partial of it is dropped first)
  const initialMessages = useMemo(
    () => (scoutWaiting ? conv.messages.filter((m) => m.id !== SCOUT_APPROVAL.messageId) : conv.messages),
    // the stored transcript as it was when the chat opened
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const onApprovalAnswer = useCallback((runId: string) => {
    if (runId === SCOUT_APPROVAL.runId) demoBotStore.answerScout();
  }, []);
  const chat = useDemoChat({ ...sessionOptions(conv), initialMessages, liveOutgoing }, { bot, role, onApprovalAnswer });
  const resume = chat.resume;
  useEffect(() => {
    if (scoutWaiting) resume({ id: SCOUT_APPROVAL.messageId, name: 'bot:deals:pending', steps: scoutPendingSteps(lang) });
    // once per mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // its approval card → "Wartet auf dich" in the Bots tab, like a Hermes chat (bots/state.ts)
  const approvals = useMemo(() => (chat.approval ? [chat.approval] : []), [chat.approval]);
  useReportAttention(conv.meta?.id, profile.id, bot, approvals);
  usePersistOnNewMessage(conv, chat.messages, { stop: chat.stop, label: profile.name, profileId: profile.id });
  useStarterPrompt(conv.meta?.id, chat.send);
  const convId = conv.meta?.id;
  const view = (
    <ChatView
      chat={chat}
      profile={profile}
      health="online"
      model={undefined}
      onPickModel={() => {}}
      onNewChat={onNewChat}
      onOpenDrawer={onOpenDrawer}
    />
  );
  return convId ? (
    <LiveProvider conversationId={convId} messages={chat.messages} controllerRef={liveRef} demo>
      {view}
    </LiveProvider>
  ) : (
    view
  );
}

