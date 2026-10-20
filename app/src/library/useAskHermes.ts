/**
 * "Ask Hermes" from Skills & memory and Routines: hands a normal chat message to a new chat of the bot (askHermes.ts)
 * and goes back to it. The composer takes the text through the share hand-off (share/inbox.ts): it sends right away
 * when its input was empty, keeps the user's own draft otherwise (and says so), and `fill` only puts the text in.
 */
import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { useConversations } from '../conversations/ConversationsProvider';
import type { ConnectionProfile } from '../settings/profiles';
import { deliverShare } from '../share/inbox';
import { askInNewChat } from './askHermes';

export function useAskHermes(profile: ConnectionProfile | null | undefined, bot: string | undefined): (text: string, mode: 'send' | 'fill') => void {
  const router = useRouter();
  const convs = useConversations();
  return useCallback(
    (text: string, mode: 'send' | 'fill') => {
      if (!askInNewChat(convs, profile, bot, text, mode, deliverShare)) return;
      // out of this screen and Settings (when it was opened from there) back to the chat
      if (router.canDismiss()) router.dismissTo('/');
      else router.replace('/');
    },
    [profile, bot, convs, router],
  );
}
