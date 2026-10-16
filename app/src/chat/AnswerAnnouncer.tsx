/**
 * Tells screen-reader users that an answer is finished (answerAnnounce.ts): one polite announcement per answer that
 * went streaming → done while the chat was open, never per token. iOS / Android: announceForAccessibility (a no-op
 * without TalkBack / VoiceOver); web: a visually hidden aria-live region. Silent while "read answers aloud" is on,
 * the voice already speaks the answer (voice/useAutoRead.ts).
 */
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Platform, StyleSheet, View } from 'react-native';
import { Text } from '../ui/primitives/Text';
import { useT } from '../i18n';
import { useVoiceSettings } from '../voice';
import { createStatusTrack, stepStatuses } from '../voice/statusTrack';
import { answerAnnouncement, type AnnounceableMessage } from './answerAnnounce';

export function AnswerAnnouncer({ messages }: { messages: readonly AnnounceableMessage[] }) {
  const tr = useT();
  const [voice] = useVoiceSettings();
  const track = useRef(createStatusTrack<AnnounceableMessage>());
  const [said, setSaid] = useState<{ n: number; text: string } | null>(null);
  const muted = voice.autoRead;
  useEffect(() => {
    // step on every update (also while muted) so a later unmute never announces an old answer
    const { finished } = stepStatuses(track.current, messages);
    if (!finished || muted) return;
    const text = answerAnnouncement(finished, tr);
    if (!text) return;
    if (Platform.OS === 'web') setSaid((s) => ({ n: (s?.n ?? 0) + 1, text }));
    else AccessibilityInfo.announceForAccessibility(text);
  }, [messages, muted, tr]);
  if (Platform.OS !== 'web') return null;
  return (
    <View style={styles.srOnly} pointerEvents="none" aria-live="polite" accessibilityLiveRegion="polite">
      {said ? <Text key={said.n}>{said.text}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // visually hidden, still in the accessibility tree (opacity, not display: none)
  srOnly: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0, left: 0, top: 0 },
});
