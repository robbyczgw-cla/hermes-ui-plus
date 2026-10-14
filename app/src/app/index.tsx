import { useFocusEffect, useRouter, type ErrorBoundaryProps } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { recordChatCrash } from '../chat/ChatBoundary';
import { ChatErrorScreen } from '../chat/ChatErrorScreen';
import { ChatScreen } from '../chat/ChatScreen';
import { logRuntimeOnce } from '../compat/runtimeProbe';
import { useConversations } from '../conversations';
import { useConnection } from '../settings/ConnectionProvider';

// one-line engine capability report in logcat (ReactNativeJS) – device bug reports / emulator runs
logRuntimeOnce();

/**
 * Last-resort route boundary (crashes outside the per-chat ChatBoundary, e.g. in the drawer).
 * expo-router's `retry` only re-renders the same tree, so this screen also offers a new chat and
 * retries by itself as soon as the open conversation changes (new chat, settings switch).
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const router = useRouter();
  const convs = useConversations();
  const { active } = useConnection();
  const crashedId = useRef(convs.activeId);

  useEffect(() => {
    recordChatCrash(crashedId.current ?? undefined, active.id, error);
    console.error('[chat] route-level crash', error);
    // log once per error instance
  }, [error]); // eslint-disable-line react-hooks/exhaustive-deps

  // another conversation became active (settings created one, drawer, new chat) → try again
  useEffect(() => {
    if (convs.activeId !== crashedId.current) void retry();
  }, [convs.activeId, retry]);

  const switching = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!switching.current) return;
      switching.current = false;
      // back from settings with the crashed chat still open (same profile picked) → never loop into it
      if (convs.activeId === crashedId.current) convs.create(active);
    }, [convs, active]),
  );

  return (
    <ChatErrorScreen
      error={error}
      onRetry={() => void retry()}
      onNewChat={() => {
        convs.create(active);
        void retry();
      }}
      onSwitchConnection={() => {
        switching.current = true;
        router.push('/settings');
      }}
    />
  );
}

export default function ChatRoute() {
  return <ChatScreen />;
}
