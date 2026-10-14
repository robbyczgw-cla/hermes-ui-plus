// "Antwort melden": the report sheet (opened from the answer menu, chat/ActionMenu.tsx – "Melden" at the bottom).
// Reason + optional comment → stored locally (store.ts), the answer is hidden behind "Gemeldet – anzeigen?".
// Optional "An Entwickler senden": mailto: with reason + app version (+ an excerpt only if the user ticks it).
// No network calls to us, no backend.
import Constants from 'expo-constants';
import { useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { brand } from '../brand';
import { Icon } from '../chat/icons';
import { useT } from '../i18n';
import { SheetGrabber, SheetModal, haptic, useTheme } from '../ui';
import { buildReportMailto, MAX_COMMENT, REPORT_REASONS, reportExcerpt, type ReportReason } from './reports';
import { reportAnswer } from './store';

// ---------------------------------------------------------------- report sheet

const REASON_KEYS = {
  offensive: 'compliance.report.reasons.offensive',
  wrong: 'compliance.report.reasons.wrong',
  legal: 'compliance.report.reasons.legal',
  other: 'compliance.report.reasons.other',
} as const;

export type ReportSheetProps = {
  visible: boolean;
  messageId: string;
  conversationId?: string;
  /** plain answer text (only read when the user opts into sending an excerpt) */
  answerText: () => string;
  onClose: () => void;
  /** toast for "no mail app" */
  onToast?: (text: string) => void;
};

export function ReportSheet(props: ReportSheetProps) {
  const tr = useT();
  // keyed body: fresh state per opening
  return (
    <SheetModal visible={props.visible} onClose={props.onClose} closeLabel={tr('actions.close')} label={tr('compliance.report.title')} maxHeight="90%" style={styles.sheet} empty={!props.visible}>
      {props.visible ? <ReportBody {...props} /> : null}
    </SheetModal>
  );
}

function ReportBody({ messageId, conversationId, answerText, onClose, onToast }: ReportSheetProps) {
  const t = useT();
  const th = useTheme();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [comment, setComment] = useState('');
  const [done, setDone] = useState<{ reason: ReportReason; comment?: string } | null>(null);
  const [withExcerpt, setWithExcerpt] = useState(false); // default excluded
  const support = brand().supportEmail;

  const submit = () => {
    if (!reason) return;
    haptic('light');
    const r = reportAnswer({ messageId, conversationId, reason, comment });
    setDone({ reason: r.reason, comment: r.comment });
  };

  const sendMail = () => {
    if (!support || !done) return;
    const url = buildReportMailto({
      to: support,
      subject: t('compliance.report.mail.subject'),
      intro: t('compliance.report.mail.intro'),
      labels: {
        reason: t('compliance.report.mail.reason'),
        version: t('compliance.report.mail.version'),
        comment: t('compliance.report.mail.comment'),
        excerpt: t('compliance.report.mail.excerpt'),
      },
      reason: done.reason,
      reasonLabel: t(REASON_KEYS[done.reason]),
      appVersion: Constants.expoConfig?.version ?? '?',
      platform: `${Platform.OS} ${String(Platform.Version ?? '')}`.trim(),
      comment: done.comment,
      excerpt: withExcerpt ? answerText() : undefined,
      note: t('compliance.report.mail.note'),
    });
    Linking.openURL(url).catch(() => onToast?.(t('compliance.report.noMail', { email: support })));
  };

  if (done) {
    const excerpt = withExcerpt ? reportExcerpt(answerText()) : '';
    return (
      <>
        <SheetGrabber />
        <Text style={[styles.title, { color: th.colors.text }]} accessibilityRole="header">
          {t('compliance.report.doneTitle')}
        </Text>
        <Text style={[styles.lead, { color: th.colors.muted }]}>{t('compliance.report.doneText')}</Text>
        {support ? (
          <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
            <View style={[styles.switchRow, { borderColor: th.colors.border }]}>
              <Text style={[styles.switchText, { color: th.colors.text }]}>{t('compliance.report.includeExcerpt')}</Text>
              <Switch value={withExcerpt} onValueChange={setWithExcerpt} accessibilityLabel={t('compliance.report.includeExcerpt')} />
            </View>
            {excerpt ? (
              <Text style={[styles.excerpt, { color: th.colors.muted, backgroundColor: th.colors.surfaceAlt }]} selectable>
                {excerpt}
              </Text>
            ) : null}
            <Text style={[styles.hint, { color: th.colors.subtle }]}>{t('compliance.report.sendDevHint')}</Text>
          </ScrollView>
        ) : null}
        <View style={styles.buttons}>
          {support ? (
            <Pressable onPress={sendMail} accessibilityRole="button" style={({ pressed }) => [styles.btn, { backgroundColor: pressed ? th.colors.surfacePressed : th.colors.surfaceAlt }]}>
              <Icon name="mail" size={16} color={th.colors.text} />
              <Text style={[styles.btnText, { color: th.colors.text }]}>{t('compliance.report.sendDev')}</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={onClose} accessibilityRole="button" style={({ pressed }) => [styles.btn, { backgroundColor: th.colors.accent, opacity: pressed ? 0.85 : 1 }]}>
            <Text style={[styles.btnText, { color: th.colors.onAccent }]}>{t('compliance.report.done')}</Text>
          </Pressable>
        </View>
      </>
    );
  }

  return (
    <>
      <SheetGrabber />
      <Text style={[styles.title, { color: th.colors.text }]} accessibilityRole="header">
        {t('compliance.report.title')}
      </Text>
      <Text style={[styles.lead, { color: th.colors.muted }]}>{t('compliance.report.lead')}</Text>
      <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
        <View accessibilityRole="radiogroup">
          {REPORT_REASONS.map((r) => {
            const on = reason === r;
            return (
              <Pressable
                key={r}
                onPress={() => setReason(r)}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                style={({ pressed }) => [
                  styles.reason,
                  { borderColor: on ? th.colors.accent : th.colors.border, backgroundColor: on ? th.colors.accentSoft : pressed ? th.colors.surfacePressed : 'transparent' },
                ]}
              >
                <View style={[styles.radio, { borderColor: on ? th.colors.accent : th.colors.borderStrong }]}>{on ? <View style={[styles.radioDot, { backgroundColor: th.colors.accent }]} /> : null}</View>
                <Text style={[styles.reasonText, { color: th.colors.text }]}>{t(REASON_KEYS[r])}</Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={[styles.label, { color: th.colors.muted }]}>{t('compliance.report.commentLabel')}</Text>
        <TextInput
          value={comment}
          onChangeText={setComment}
          placeholder={t('compliance.report.commentPlaceholder')}
          placeholderTextColor={th.colors.subtle}
          multiline
          maxLength={MAX_COMMENT}
          accessibilityLabel={t('compliance.report.commentLabel')}
          style={[styles.input, { color: th.colors.text, borderColor: th.colors.border, backgroundColor: th.colors.surfaceAlt }]}
        />
      </ScrollView>
      <View style={styles.buttons}>
        <Pressable onPress={onClose} accessibilityRole="button" style={({ pressed }) => [styles.btn, { backgroundColor: pressed ? th.colors.surfacePressed : th.colors.surfaceAlt }]}>
          <Text style={[styles.btnText, { color: th.colors.text }]}>{t('actions.cancel')}</Text>
        </Pressable>
        <Pressable
          onPress={submit}
          disabled={!reason}
          accessibilityRole="button"
          accessibilityState={{ disabled: !reason }}
          style={({ pressed }) => [styles.btn, { backgroundColor: th.colors.accent, opacity: !reason ? 0.45 : pressed ? 0.85 : 1 }]}
        >
          <Icon name="flag" size={16} color={th.colors.onAccent} />
          <Text style={[styles.btnText, { color: th.colors.onAccent }]}>{t('compliance.report.submit')}</Text>
        </Pressable>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  sheet: { paddingHorizontal: 16 },
  title: { fontSize: 17, fontWeight: '600', marginBottom: 4 },
  lead: { fontSize: 14, lineHeight: 19, marginBottom: 12 },
  scroll: { flexGrow: 0 },
  reason: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, minHeight: 46, marginBottom: 8 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  reasonText: { fontSize: 15.5, flex: 1 },
  label: { fontSize: 13, fontWeight: '500', marginTop: 8, marginBottom: 6 },
  input: { minHeight: 72, maxHeight: 160, borderWidth: 1, borderRadius: 12, padding: 10, fontSize: 15, textAlignVertical: 'top' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },
  switchText: { flex: 1, fontSize: 14.5, lineHeight: 19 },
  excerpt: { fontSize: 13, lineHeight: 18, padding: 10, borderRadius: 10, marginBottom: 8 },
  hint: { fontSize: 12.5, lineHeight: 17, marginTop: 4 },
  buttons: { flexDirection: 'row', gap: 10, marginTop: 14 },
  btn: { flex: 1, flexDirection: 'row', gap: 6, minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  btnText: { fontSize: 15, fontWeight: '600' },
});
