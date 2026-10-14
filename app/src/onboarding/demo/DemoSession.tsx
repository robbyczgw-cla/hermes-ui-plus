// Chat session for the offline demo profile (`kind: 'demo'`), lazy-loaded via chat/sessionRegistry.
// Same contract as every lazy session component (chat/sessionRegistry.ts). The "Demo" strip with the CTA to set up a real connection is
// drawn by chat/ChatHeader for `kind === 'demo'` (in the header flow, no guessed offsets).
import type { SessionProps } from '../../chat/ChatScreen';
import { ChatView, SessionPending } from '../../chat/ChatView';
import { sessionOptions, usePersistOnNewMessage } from '../../chat/useSessionPersistence';
import { useConversation, type UseConversation } from '../../conversations';
import { useStarterPrompt } from '../starterPrompt';
import { useDemoChat } from './useDemoChat';

export default function DemoSession(props: SessionProps) {
  const conv = useConversation(props.conversationId);
  // header + composer at once, placeholder in the message area while the stored transcript is read (ChatView SessionPending)
  if (!conv.ready || !conv.meta) {
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
  const chat = useDemoChat(sessionOptions(conv));
  usePersistOnNewMessage(conv, chat.messages, { stop: chat.stop, label: profile.name, profileId: profile.id });
  useStarterPrompt(conv.meta?.id, chat.send);
  return (
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
}
