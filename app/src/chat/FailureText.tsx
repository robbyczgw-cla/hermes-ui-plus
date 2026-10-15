// Text of the failure card: friendly message; for network failures the scrubbed technical detail behind a
// "Details" toggle (hermes/networkFailure.ts).
import { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import type { ChatMessage } from '../hermes';
import { useT } from '../i18n';
import { scaledText } from '../settings/preferences';
import { useTheme } from '../ui';
import { presentMessageError } from '../hermes/networkFailure';

export function FailureText({ message, override }: { message: Pick<ChatMessage, 'error' | 'errorText'>; override?: string }) {
  const t = useTheme();
  const tr = useT();
  const [open, setOpen] = useState(false);
  const fs = (size: number, line: number) => scaledText(size, line, t.fontScale);
  const shown = override ? { text: override } : presentMessageError(message, tr);
  return (
    <>
      <Text style={[styles.text, fs(13, 18), { color: t.colors.text }]} numberOfLines={4}>
        {shown.text}
      </Text>
      {shown.detail ? (
        <Pressable
          onPress={() => setOpen((v) => !v)}
          hitSlop={6}
          style={({ pressed }) => [styles.toggle, pressed && { opacity: 0.6 }]}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
        >
          <Text style={[styles.toggleText, fs(12.5, 17), { color: t.colors.muted }]}>
            {open ? tr('chat.message.hideDetails') : tr('chat.message.showDetails')}
          </Text>
        </Pressable>
      ) : null}
      {shown.detail && open ? (
        <Text style={[styles.detail, fs(12, 16), { color: t.colors.subtle }]} selectable>
          {shown.detail}
        </Text>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  text: { fontSize: 13, lineHeight: 18 },
  toggle: { alignSelf: 'flex-start', paddingVertical: 2 },
  toggleText: { fontSize: 12.5, fontWeight: '600', textDecorationLine: 'underline' },
  detail: { fontSize: 12, lineHeight: 16 },
});
