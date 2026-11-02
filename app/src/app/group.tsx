import { useLocalSearchParams } from 'expo-router';
import { lazy, Suspense } from 'react';

// lazy: bot groups stay out of the startup bundle (opened from the Bots tab only)
const GroupChatScreen = lazy(() => import('../groups/GroupChatScreen').then((m) => ({ default: m.GroupChatScreen })));

export default function GroupRoute() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  return (
    <Suspense fallback={null}>
      {/* a fresh screen per group: no entries of the previous one */}
      <GroupChatScreen key={typeof id === 'string' ? id : ''} />
    </Suspense>
  );
}
