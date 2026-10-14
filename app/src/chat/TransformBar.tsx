import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ChatMessage } from '../hermes';
import type { Segment } from '../protocol/types';
import { useI18n, useT } from '../i18n';
import { PressableScale, useTheme } from '../ui';
import { usePreferences } from '../settings/PreferencesProvider';
import { scaledText } from '../settings/preferences';
import { Icon } from './icons';
import type { ActionHandler } from './MessageItem';
import { answerShape, reformatLabel, reformatMessage, transformChips, translateTargets, type ReformatKind } from './reformat';

/**
 * "Umformen" (docs/SPEC-modules-v4.md A1): quiet horizontally scrolling chip row under a finished answer.
 * A tap sends `[reformat:<kind>] <instruction>` through the normal send path (works for every backend;
 * the bridge router / direct backends turn the tag into a format hint). "Übersetzen" opens a small
 * inline language menu (app language excluded).
 */
export function TransformBar({
  message,
  onAction,
  segments,
  text = message.text,
}: {
  message: ChatMessage;
  onAction: ActionHandler;
  /** the answer's segments (UX6: no bar under an open question, no "Als Tabelle" under a table …) */
  segments?: readonly Segment[];
  /** the shown answer text (interim notes split off, hermes/progressNotes.ts) */
  text?: string;
}) {
  const t = useTheme();
  const tr = useT();
  const { lang } = useI18n();
  const { prefs } = usePreferences();
  const [langsOpen, setLangsOpen] = useState(false);
  const streaming = message.status === 'streaming';
  const shape = useMemo(() => (segments && !streaming ? answerShape(segments) : undefined), [segments, streaming]);
  const chips = transformChips({
    // pref owned by polish-answers (settings group "Antworten"); default ON when missing
    enabled: prefs['answers.transformBar'] !== false,
    streaming,
    failed: message.status === 'error',
    length: text.trim().length,
    shape,
  });
  if (!chips.base.length && !chips.translate) return null;
  const size = scaledText(13, 18, t.fontScale);
  const send = (kind: ReformatKind) => {
    if (onAction({ type: 'send', text: reformatMessage(kind, tr) }, undefined, { composed: true }) !== false) setLangsOpen(false);
  };
  const chip = (key: string, label: string, onPress: () => void, extra?: { icon?: 'chevronDown' | 'chevronRight'; a11y?: string; expanded?: boolean }) => (
    <PressableScale
      key={key}
      haptic="light"
      onPress={onPress}
      hitSlop={{ top: 6, bottom: 6 }}
      accessibilityLabel={extra?.a11y ?? label}
      accessibilityState={extra?.expanded === undefined ? undefined : { expanded: extra.expanded }}
      style={[styles.chip, { borderRadius: t.radii.pill, backgroundColor: t.colors.surfaceAlt }]}
      pressedStyle={{ backgroundColor: t.colors.surfacePressed }}
    >
      <Text style={[styles.label, size, { color: t.colors.muted }]} numberOfLines={1}>
        {label}
      </Text>
      {extra?.icon ? <Icon name={extra.icon} size={13} color={t.colors.subtle} /> : null}
    </PressableScale>
  );
  return (
    <View style={styles.wrap} accessibilityLabel={tr('chat.transform.a11y')}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} keyboardShouldPersistTaps="handled">
        {chips.base.map((k) => chip(k, reformatLabel(k, tr), () => send(k)))}
        {chips.translate
          ? chip('translate', tr('chat.transform.translate'), () => setLangsOpen((o) => !o), {
              icon: langsOpen ? 'chevronDown' : 'chevronRight',
              a11y: tr('chat.transform.translateA11y'),
              expanded: langsOpen,
            })
          : null}
      </ScrollView>
      {langsOpen ? (
        <View style={styles.langs} accessibilityLabel={tr('chat.transform.menuTitle')}>
          <Text style={[styles.menuTitle, size, { color: t.colors.subtle }]}>{tr('chat.transform.menuTitle')}</Text>
          {translateTargets(lang).map((l) => chip(`lang-${l}`, tr(`chat.transform.lang.${l}`), () => send(`translate:${l}`)))}
        </View>
      ) : null}
    </View>
  );
}

/** "umgeformt ↓" on an answer that a later reformat request refers to (the new version follows below). */
export function ReformattedMarker() {
  const t = useTheme();
  const tr = useT();
  return (
    <View style={styles.marker} accessible accessibilityLabel={tr('chat.transform.markerA11y')}>
      <Text style={[styles.markerText, scaledText(12, 16, t.fontScale), { color: t.colors.subtle }]}>{tr('chat.transform.marker')}</Text>
      <Icon name="arrowDown" size={12} color={t.colors.subtle} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 8, gap: 6 },
  row: { gap: 6, paddingRight: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32, paddingHorizontal: 12, paddingVertical: 6 },
  label: { fontSize: 13, fontWeight: '500' },
  langs: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  menuTitle: { fontSize: 13, marginRight: 2 },
  marker: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 4, alignSelf: 'flex-start' },
  markerText: { fontSize: 12 },
});
