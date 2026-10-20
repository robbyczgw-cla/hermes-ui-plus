// Text of the failure card: friendly message; for network failures the scrubbed technical detail behind a
// "Details" toggle (hermes/networkFailure.ts). Under open details: "Report a problem" (support/), which only gets
// the error's category + code (support/report.ts), never its text.
import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import { Text } from '../ui/primitives/Text';
import type { ChatMessage } from '../hermes';
import { useT } from '../i18n';
import { useTheme } from '../ui';
import { presentMessageError } from '../hermes/networkFailure';
import { ProblemReportSheet } from '../support/ProblemReportSheet';
import { errorCodeOf, noteLastError } from '../support/report';
import { useToast } from './Toast';
import { a11yState } from '../ui/lib/a11yState';
import { scaledLineLimit } from '../ui/lib/fontScaleLayout';

export function FailureText({ message, override }: { message: Pick<ChatMessage, 'error' | 'errorText'> & { createdAt?: number }; override?: string }) {
  const t = useTheme();
  const tr = useT();
  const [open, setOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const toast = useToast();
  // 4 lines at text scale 1; more at large text so the advice part of the message is not cut
  const maxLines = scaledLineLimit(4, t.fontScale * (useWindowDimensions().fontScale || 1));
  // a browser that knows it is offline: say so instead of guessing at the server (web only; native has no cheap flag)
  const offline = Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.onLine === false;
  const simple = false;
  const shown = override ? { text: override } : presentMessageError(message, tr, { plain: simple, offline });
  const { error, errorText, createdAt } = message;
  useEffect(() => noteLastError(errorCodeOf({ error, errorText }), createdAt), [error, errorText, createdAt]);
  return (
    <>
      <Text style={[t.typography.caption, { color: t.colors.text }]} numberOfLines={maxLines}>
        {shown.text}
      </Text>
      {shown.detail ? (
        <Pressable
          onPress={() => setOpen((v) => !v)}
          hitSlop={6}
          style={({ pressed }) => [styles.toggle, pressed && { opacity: 0.6 }]}
          accessibilityRole="button"
          {...a11yState({ expanded: open })}
        >
          <Text style={[t.typography.caption, styles.toggleText, { color: t.colors.muted }]}>
            {open ? tr('chat.message.hideDetails') : tr('chat.message.showDetails')}
          </Text>
        </Pressable>
      ) : null}
      {shown.detail && open ? (
        <Text style={[t.typography.caption, { color: t.colors.subtle }]} selectable>
          {shown.detail}
        </Text>
      ) : null}
      {shown.detail && open ? (
        <Pressable
          onPress={() => {
            noteLastError(errorCodeOf({ error, errorText }), Date.now()); // the card the user reports from wins
            setReporting(true);
          }}
          hitSlop={6}
          style={({ pressed }) => [styles.toggle, pressed && { opacity: 0.6 }]}
          accessibilityRole="button"
        >
          <Text style={[t.typography.caption, styles.toggleText, { color: t.colors.muted }]}>{tr('support.report.fromError')}</Text>
        </Pressable>
      ) : null}
      {reporting ? <ProblemReportSheet visible onClose={() => setReporting(false)} onToast={toast} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  toggle: { alignSelf: 'flex-start', paddingVertical: 2 },
  toggleText: { fontWeight: '600', textDecorationLine: 'underline' },
});
