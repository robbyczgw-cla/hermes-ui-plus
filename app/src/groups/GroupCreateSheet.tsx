/**
 * "Neue Gruppe" (spec 2.6): pick 2 to 6 bots (the first picked leads), a name proposed from them, and the honest cost
 * line ("every bot that answers is a model call"). Phone: a full-screen modal; wide windows: a dialog.
 */
import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BotAvatar } from '../bots/BotAvatar';
import { useT } from '../i18n';
import { Button, HText, Icon, SheetLayer, TextInput, useSheetDialog, useTheme } from '../ui';
import { a11yState } from '../ui/lib/a11yState';
import type { Result } from './api';
import { draftProblems, NAME_MAX, suggestName, toggleMember, type GroupDraft, type GroupFailure, type GroupInfo, type GroupLimits } from './core';
import { failureText } from './text';

type Member = { key: string; label: string; color?: string };
type Props = {
  visible: boolean;
  members: Member[];
  limits: GroupLimits;
  onClose(): void;
  onCreate(body: { name: string; members: string[] }): Promise<Result<GroupInfo>>;
  onCreated(group: GroupInfo): void;
};

export function GroupCreateSheet({ visible, members, limits, onClose, onCreate, onCreated }: Props) {
  const wide = useSheetDialog();
  const tr = useT();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<GroupDraft>({ name: '', members: [] });
  const [nameTouched, setNameTouched] = useState(false);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<GroupFailure | null>(null);

  // the parent mounts a fresh sheet each time it opens (key): every field starts empty

  const labelOf = (k: string) => members.find((m) => m.key === k)?.label ?? k;
  const proposed = suggestName(draft.members.map(labelOf), tr('groups.and'));
  const name = nameTouched ? draft.name : proposed;
  const problems = draftProblems({ ...draft, name }, limits);

  const submit = async () => {
    if (busy) return;
    setTried(true);
    if (problems.length) return;
    setBusy(true);
    setFailure(null);
    const r = await onCreate({ name: name.trim(), members: draft.members });
    setBusy(false);
    if (r.ok) onCreated(r.value);
    else setFailure(r.failure);
  };
  const close = busy ? undefined : onClose;

  const body = (
    <View style={styles.form}>
      <HText variant="body" color="muted">
        {tr('groups.create.lead', { min: limits.minMembers, max: limits.maxMembers })}
      </HText>
      <View style={styles.field}>
        <HText variant="caption" weight="600" color="muted">
          {tr('groups.create.bots')}
        </HText>
        {members.length < limits.minMembers ? (
          <HText variant="callout" color="muted" testID="group-create-nobots">
            {tr('groups.create.noBots')}
          </HText>
        ) : null}
        <View style={styles.list} accessibilityRole="list">
          {members.map((m) => {
            const at = draft.members.indexOf(m.key);
            const on = at >= 0;
            const full = !on && draft.members.length >= limits.maxMembers;
            return (
              <Pressable
                key={m.key}
                onPress={() => {
                  setDraft((d) => toggleMember(d, m.key, limits));
                  setFailure(null);
                }}
                disabled={full || busy}
                testID={`group-create-bot-${m.key}`}
                accessibilityRole="checkbox"
                {...a11yState({ checked: on, disabled: full }, 'checkbox')}
                accessibilityLabel={[m.label, on && at === 0 ? tr('groups.create.leader') : '', on ? tr('groups.create.picked', { n: at + 1 }) : ''].filter(Boolean).join(', ')}
                style={({ pressed }) => [
                  styles.bot,
                  { borderRadius: t.radii.control, borderColor: on ? t.colors.accent : t.colors.border, borderWidth: on ? 1.5 : StyleSheet.hairlineWidth, backgroundColor: pressed ? t.colors.surfacePressed : t.colors.surface, opacity: full ? 0.5 : 1 },
                ]}
              >
                <BotAvatar name={m.label} bot={m.key === 'default' ? undefined : m.key} color={m.color} size={34} />
                <HText variant="bodyStrong" numberOfLines={1} style={styles.flex}>
                  {m.label}
                </HText>
                {on && at === 0 ? (
                  <View style={[styles.lead, { backgroundColor: t.colors.accentSoft, borderRadius: t.radii.inline }]}>
                    <HText variant="micro" weight="600" style={{ color: t.colors.accentText }}>
                      {tr('groups.create.leader')}
                    </HText>
                  </View>
                ) : null}
                <View style={[styles.check, { borderRadius: 6, borderColor: on ? t.colors.accent : t.colors.borderStrong, backgroundColor: on ? t.colors.accent : 'transparent' }]}>
                  {on ? <HText variant="micro" weight="700" tabular style={{ color: t.colors.onAccent }}>{String(at + 1)}</HText> : null}
                </View>
              </Pressable>
            );
          })}
        </View>
        {tried && problems.includes('many') ? (
          <HText variant="caption" style={{ color: t.colors.danger }} accessibilityLiveRegion="polite">
            {tr('groups.create.many', { max: limits.maxMembers })}
          </HText>
        ) : null}
        {tried && problems.includes('few') ? (
          <HText variant="caption" style={{ color: t.colors.danger }} accessibilityLiveRegion="polite">
            {tr('groups.create.few', { min: limits.minMembers })}
          </HText>
        ) : null}
      </View>
      <View style={styles.field}>
        <HText variant="caption" weight="600" color="muted">
          {tr('groups.create.name')}
        </HText>
        <TextInput
          value={name}
          onChangeText={(v) => {
            setNameTouched(true);
            setDraft((d) => ({ ...d, name: v }));
          }}
          placeholder={tr('groups.create.namePlaceholder')}
          maxLength={NAME_MAX + 10}
          editable={!busy}
          testID="group-create-name"
          accessibilityLabel={tr('groups.create.name')}
          style={[styles.input, { borderColor: t.colors.border, borderRadius: t.radii.control, backgroundColor: t.colors.surface, color: t.colors.text }]}
        />
        {tried && problems.includes('name') ? (
          <HText variant="caption" style={{ color: t.colors.danger }}>
            {tr('groups.create.nameTooLong')}
          </HText>
        ) : null}
      </View>
      <View style={[styles.note, { backgroundColor: t.colors.surfaceAlt, borderRadius: t.radii.control }]}>
        <Icon name="info" size={16} color={t.colors.muted} />
        <View style={styles.flex}>
          <HText variant="caption" color="muted" testID="group-create-cost">
            {tr('groups.create.cost', { max: limits.perRound })}
          </HText>
          <HText variant="caption" color="muted">
            {tr('groups.create.approvals')}
          </HText>
        </View>
      </View>
      {failure ? (
        <View accessibilityRole="alert" style={[styles.note, { backgroundColor: t.colors.dangerSoft, borderRadius: t.radii.control }]}>
          <Icon name="alert" size={16} color={t.colors.danger} />
          <HText variant="caption" style={[styles.flex, { color: t.colors.danger }]}>
            {failureText(failure, tr)}
          </HText>
        </View>
      ) : null}
      <Button label={tr('groups.create.submit')} variant="primary" onPress={submit} loading={busy} disabled={busy} testID="group-create-submit" />
    </View>
  );

  const header = (
    <View style={[styles.header, { borderBottomColor: t.colors.border }]}>
      <Pressable onPress={close} disabled={!close} hitSlop={8} accessibilityRole="button" accessibilityLabel={tr('groups.close')} testID="group-create-close" style={styles.headerBtn}>
        <Icon name="x" size={20} color={t.colors.text} />
      </Pressable>
      <HText variant="headline" numberOfLines={1} accessibilityRole="header" style={styles.headerTitle}>
        {tr('groups.create.title')}
      </HText>
      <View style={styles.headerBtn} />
    </View>
  );

  if (wide) {
    return (
      <Modal visible={visible} transparent animationType="fade" onRequestClose={close} statusBarTranslucent>
        <SheetLayer onClose={close} closeLabel={tr('groups.close')} maxWidth={520} label={tr('groups.create.title')} style={styles.dialog}>
          {header}
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            {body}
          </ScrollView>
        </SheetLayer>
      </Modal>
    );
  }
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={close} statusBarTranslucent>
      <View style={[styles.flex, { backgroundColor: t.colors.bg, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        {header}
        <KeyboardAvoidingView style={styles.flex} behavior="padding">
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            {body}
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  dialog: { padding: 0, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  headerBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center' },
  content: { padding: 20, paddingBottom: 32 },
  form: { gap: 18, width: '100%', maxWidth: 560, alignSelf: 'center' },
  field: { gap: 8 },
  list: { gap: 8 },
  bot: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 8, minHeight: 52 },
  lead: { paddingHorizontal: 6, paddingVertical: 1 },
  check: { width: 22, height: 22, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  input: { borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, minHeight: 46 },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 10 },
});
