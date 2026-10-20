/**
 * "Neuer Bot" (Bots v2 slice 3, bots/create/core.ts): two steps. Phone: a full-screen modal,
 * step 1 the role (five templates, "Eigene Rolle", a link for an empty agent), step 2 the three fields and the "may"
 * switches. Wide windows (≥ 900 px: tablet, web, desktop): one dialog, roles on the left, fields on the right.
 * No model picker, no toolset list, no skills choice. The button says "<Name> anlegen"; the parent opens the new bot's
 * chat once the server made it.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View, type TextInput as RNTextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocale, useT, type TKey } from '../../i18n';
import { Button, HText, Icon, SheetLayer, TextInput, Toggle, useSheetDialog, useTheme } from '../../ui';
import { a11yState } from '../../ui/lib/a11yState';
import { BotAvatar } from '../BotAvatar';
import type { CreateResult } from './api';
import {
  BOT_COLORS, createBody, draftFor, draftProblems, failureField, LIMITS, nextColor, ROLE_TEMPLATES, showsCommands,
  type CreatedBot, type CreateFailure, type Draft, type FieldKey, type May, type TemplateId,
} from './core';
import { CreateIcon, TEMPLATE_ICON, type CreateIconName } from './icons';

type Props = {
  visible: boolean;
  onClose(): void;
  onCreate(body: ReturnType<typeof createBody>): Promise<CreateResult>;
  onCreated(bot: CreatedBot): void;
  /** the offline demo: the bot stays on this device and answers with sample texts (says so instead of "server") */
  demo?: boolean;
};

const tk = (k: string) => k as TKey;

export function BotCreateSheet({ visible, onClose, onCreate, onCreated, demo }: Props) {
  const wide = useSheetDialog();
  const tr = useT();
  const { locale } = useLocale();
  const [step, setStep] = useState<'role' | 'form'>('role');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<CreateFailure | null>(null);

  useEffect(() => {
    if (!visible) return;
    setStep('role');
    setDraft(wide ? fresh('deals') : null);
    setTried(false);
    setFailure(null);
    setBusy(false);
    // a new sheet each time it opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  function fresh(t: TemplateId): Draft {
    return draftFor(t, (k) => tr(tk(`botCreate.templates.${t}.${k}`)));
  }
  const pick = (t: TemplateId) => {
    setDraft(fresh(t));
    setTried(false);
    setFailure(null);
    setStep('form');
  };

  const submit = async () => {
    if (!draft || busy) return;
    setTried(true);
    if (draftProblems(draft).length) return;
    setBusy(true);
    setFailure(null);
    const r = await onCreate(createBody(draft, locale));
    setBusy(false);
    if (r.ok) onCreated(r.bot);
    else setFailure(r.failure);
  };
  const close = busy ? undefined : onClose;

  const form = draft ? (
    <DraftForm draft={draft} onChange={(d) => { setDraft(d); setFailure(null); }} tried={tried} failure={failure} busy={busy} onSubmit={submit} demo={demo} />
  ) : null;

  if (wide) {
    return (
      <Modal visible={visible} transparent animationType="fade" onRequestClose={close} statusBarTranslucent>
        <SheetLayer onClose={close} closeLabel={tr('botCreate.close')} maxWidth={760} label={tr('botCreate.newBot')} style={styles.dialog}>
          <Header title={tr('botCreate.newBot')} onClose={close} />
          <View style={styles.columns}>
            <ScrollView style={styles.left} contentContainerStyle={styles.leftContent} keyboardShouldPersistTaps="handled">
              <HText variant="caption" weight="600" color="muted" style={styles.sectionLabel}>
                {tr('botCreate.roleSection')}
              </HText>
              <RoleList selected={draft?.template} onPick={pick} compact />
            </ScrollView>
            <KeyboardAvoidingView style={styles.right} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
              <ScrollView contentContainerStyle={styles.rightContent} keyboardShouldPersistTaps="handled">
                {form}
              </ScrollView>
            </KeyboardAvoidingView>
          </View>
        </SheetLayer>
      </Modal>
    );
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={step === 'form' && !busy ? () => setStep('role') : close} statusBarTranslucent>
      <PhoneFrame>
        {step === 'role' || !draft ? (
          <>
            <Header title={tr('botCreate.newBot')} onClose={close} />
            <ScrollView contentContainerStyle={styles.phoneContent} keyboardShouldPersistTaps="handled">
              <View style={styles.lead}>
                <HText variant="title" accessibilityRole="header">
                  {tr('botCreate.roleTitle')}
                </HText>
                <HText variant="body" color="muted">
                  {tr('botCreate.roleLead')}
                </HText>
              </View>
              <RoleList onPick={pick} />
              <Footer onBlank={() => pick('blank')} demo={demo} />
            </ScrollView>
          </>
        ) : (
          <>
            <Header title={draft.template === 'blank' ? tr('botCreate.templates.blank.title') : tr(tk(`botCreate.templates.${draft.template}.title`))} onBack={busy ? undefined : () => setStep('role')} />
            <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
              <ScrollView contentContainerStyle={styles.phoneContent} keyboardShouldPersistTaps="handled">
                {form}
              </ScrollView>
            </KeyboardAvoidingView>
          </>
        )}
      </PhoneFrame>
    </Modal>
  );
}

function PhoneFrame({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return <View style={[styles.flex, { backgroundColor: t.colors.bg, paddingTop: insets.top, paddingBottom: insets.bottom }]}>{children}</View>;
}

function Header({ title, onClose, onBack }: { title: string; onClose?: () => void; onBack?: () => void }) {
  const t = useTheme();
  const tr = useT();
  const btn = (icon: 'x' | 'chevronLeft', label: string, onPress: (() => void) | undefined, testID: string) => (
    <Pressable onPress={onPress} disabled={!onPress} hitSlop={8} accessibilityRole="button" accessibilityLabel={label} testID={testID} style={({ pressed }) => [styles.headerBtn, { borderRadius: t.radii.pill, backgroundColor: pressed ? t.colors.surfacePressed : 'transparent', opacity: onPress ? 1 : 0.4 }]}>
      <Icon name={icon} size={20} color={t.colors.text} />
    </Pressable>
  );
  return (
    <View style={[styles.header, { borderBottomColor: t.colors.border }]}>
      <View style={styles.headerSide}>{onBack !== undefined || !onClose ? btn('chevronLeft', tr('botCreate.back'), onBack, 'bot-create-back') : btn('x', tr('botCreate.close'), onClose, 'bot-create-close')}</View>
      <HText variant="headline" numberOfLines={1} accessibilityRole="header" style={styles.headerTitle}>
        {title}
      </HText>
      <View style={styles.headerSide} />
    </View>
  );
}

function RoleList({ selected, onPick, compact }: { selected?: TemplateId; onPick(t: TemplateId): void; compact?: boolean }) {
  const t = useTheme();
  const tr = useT();
  return (
    <View style={styles.roles} accessibilityRole={compact ? 'radiogroup' : undefined}>
      {ROLE_TEMPLATES.map((id) => {
        const on = selected === id;
        const title = tr(tk(`botCreate.templates.${id}.title`));
        const sub = tr(tk(`botCreate.templates.${id}.sub`));
        return (
          <Pressable
            key={id}
            onPress={() => onPick(id)}
            testID={`bot-create-role-${id}`}
            accessibilityRole={compact ? 'radio' : 'button'}
            {...a11yState(compact ? { checked: on } : undefined, compact ? 'radio' : 'button')}
            accessibilityLabel={`${title}. ${sub}`}
            style={({ pressed }) => [
              styles.role,
              { borderRadius: t.radii.card, borderColor: on ? t.colors.accent : t.colors.border, borderWidth: on ? 1.5 : StyleSheet.hairlineWidth, backgroundColor: pressed ? t.colors.surfacePressed : t.colors.surface },
            ]}
          >
            <View style={[styles.roleIcon, { backgroundColor: t.colors.accentSoft, borderRadius: t.radii.control }]}>
              <CreateIcon name={TEMPLATE_ICON[id]} color={t.colors.accentText} />
            </View>
            <View style={styles.flex}>
              <HText variant="bodyStrong" numberOfLines={1}>
                {title}
              </HText>
              <HText variant="caption" color="muted" numberOfLines={2}>
                {sub}
              </HText>
            </View>
            {compact ? null : <Icon name="chevronRight" size={16} color={t.colors.subtle} />}
          </Pressable>
        );
      })}
    </View>
  );
}

function Footer({ onBlank, demo }: { onBlank(): void; demo?: boolean }) {
  const t = useTheme();
  const tr = useT();
  return (
    <View style={styles.footer}>
      <Pressable onPress={onBlank} testID="bot-create-blank" accessibilityRole="button" hitSlop={6} style={({ pressed }) => [styles.blank, pressed && { opacity: 0.6 }]}>
        <CreateIcon name="sparkle" size={16} color={t.colors.accentText} />
        <HText variant="callout" weight="600" style={{ color: t.colors.accentText, flexShrink: 1 }}>
          {tr('botCreate.blank')}
        </HText>
      </Pressable>
      <View style={styles.footNote}>
        <Icon name="info" size={14} color={t.colors.subtle} />
        <HText variant="caption" color="subtle" style={styles.flex}>
          {demo ? tr('botCreate.demoFooter') : tr('botCreate.footer')}
        </HText>
      </View>
    </View>
  );
}

function failureText(tr: ReturnType<typeof useT>, f: CreateFailure): string {
  const reason = (r: string) => tr(tk(`botCreate.reasons.${r}`)) || tr('botCreate.reasons.unknown');
  switch (f.kind) {
    case 'exists': return tr('botCreate.errors.exists');
    case 'limit': return tr('botCreate.errors.limit', { limit: f.limit });
    case 'forbidden': return tr('botCreate.errors.forbidden');
    case 'invalid': return tr('botCreate.errors.invalid', { field: f.field === 'title' ? tr('botCreate.name') : f.field === 'job' ? tr('botCreate.job') : f.field === 'how' ? tr('botCreate.how') : f.field });
    case 'unavailable': return tr('botCreate.errors.unavailable', { reason: reason(f.reason) });
    case 'offline': return tr('botCreate.errors.offline');
    default: return tr('botCreate.errors.server', { reason: reason(f.reason) });
  }
}

function DraftForm({ draft, onChange, tried, failure, busy, onSubmit, demo }: { draft: Draft; onChange(d: Draft): void; tried: boolean; failure: CreateFailure | null; busy: boolean; onSubmit(): void; demo?: boolean }) {
  const t = useTheme();
  const tr = useT();
  const jobRef = useRef<RNTextInput>(null);
  const howRef = useRef<RNTextInput>(null);
  const problems = useMemo(() => draftProblems(draft), [draft]);
  const badField = failureField(failure);
  const problemOf = (f: FieldKey) => {
    const p = problems.find((x) => x.field === f);
    if (p?.kind === 'tooLong') return tr('botCreate.tooLong', { max: p.max ?? LIMITS[f] });
    if (p && tried) return tr('botCreate.required');
    return null;
  };
  const name = draft.title.replace(/\s+/g, ' ').trim();
  const colorIndex = Math.max(0, BOT_COLORS.indexOf(draft.color));
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });
  const setMay = (k: keyof May, v: boolean) => onChange({ ...draft, may: { ...draft.may, [k]: v } });

  return (
    <View style={styles.form}>
      <View style={styles.avatarRow}>
        <BotAvatar name={name || '?'} bot={name ? 'new' : undefined} color={draft.color} size={56} />
        <Pressable
          onPress={() => set({ color: nextColor(draft.color) })}
          testID="bot-create-color"
          accessibilityRole="button"
          accessibilityLabel={tr('botCreate.colorA11y', { n: colorIndex + 1, count: BOT_COLORS.length })}
          hitSlop={8}
        >
          <HText variant="callout" weight="600" style={{ color: t.colors.accentText }}>
            {tr('botCreate.changeColor')}
          </HText>
        </Pressable>
      </View>
      <LabeledInput
        label={tr('botCreate.name')}
        value={draft.title}
        onChangeText={(v) => set({ title: v })}
        placeholder={tr('botCreate.namePlaceholder')}
        problem={problemOf('title') ?? (badField === 'title' && failure ? failureText(tr, failure) : null)}
        maxLength={LIMITS.title + 20}
        returnKeyType="next"
        onSubmitEditing={() => jobRef.current?.focus()}
        testID="bot-create-name"
        autoCapitalize="words"
      />
      <LabeledInput
        ref={jobRef}
        label={tr('botCreate.job')}
        value={draft.job}
        onChangeText={(v) => set({ job: v })}
        placeholder={tr('botCreate.jobPlaceholder')}
        problem={problemOf('job') ?? (badField === 'job' && failure ? failureText(tr, failure) : null)}
        maxLength={LIMITS.job + 40}
        returnKeyType="next"
        onSubmitEditing={() => howRef.current?.focus()}
        testID="bot-create-job"
      />
      <LabeledInput
        ref={howRef}
        label={tr('botCreate.how')}
        value={draft.how}
        onChangeText={(v) => set({ how: v })}
        placeholder={tr('botCreate.howPlaceholder')}
        hint={tr('botCreate.howHint')}
        problem={problemOf('how') ?? (badField === 'how' && failure ? failureText(tr, failure) : null)}
        maxLength={LIMITS.how + 200}
        multiline
        testID="bot-create-how"
      />
      <View style={styles.maySection}>
        <HText variant="caption" weight="600" color="muted">
          {tr('botCreate.may')}
        </HText>
        <MayRow icon="globe" label={tr('botCreate.mayWeb')} value={draft.may.web} onChange={(v) => setMay('web', v)} testID="bot-create-may-web" />
        <MayRow icon="bookmark" label={tr('botCreate.mayMemory')} sub={tr('botCreate.mayMemorySub')} value={draft.may.memory} onChange={(v) => setMay('memory', v)} testID="bot-create-may-memory" />
        <MayRow icon="repeat" label={tr('botCreate.mayRoutines')} sub={tr('botCreate.mayRoutinesSub')} value={draft.may.routines} onChange={(v) => setMay('routines', v)} testID="bot-create-may-routines" />
        {showsCommands(draft.template) ? (
          <MayRow icon="terminal" label={tr('botCreate.mayCommands')} sub={tr('botCreate.mayCommandsSub')} value={draft.may.commands} onChange={(v) => setMay('commands', v)} testID="bot-create-may-commands" />
        ) : null}
        <HText variant="caption" color="subtle">
          {demo ? tr('botCreate.demoNoModel') : tr('botCreate.noModel')}
        </HText>
      </View>
      {failure && !badField ? (
        <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={[styles.failure, { backgroundColor: t.colors.dangerSoft, borderRadius: t.radii.control }]} testID="bot-create-error">
          <Icon name="alert" size={16} color={t.colors.danger} />
          <HText variant="callout" style={[styles.flex, { color: t.colors.danger }]}>
            {failureText(tr, failure)}
          </HText>
        </View>
      ) : null}
      <Button
        label={busy ? tr('botCreate.creating', { name: name || '…' }) : name ? tr('botCreate.submit', { name }) : tr('botCreate.submitPlain')}
        variant="primary"
        onPress={onSubmit}
        loading={busy}
        disabled={busy}
        numberOfLines={2}
        testID="bot-create-submit"
        style={styles.submit}
      />
    </View>
  );
}

type InputProps = {
  label: string;
  value: string;
  onChangeText(v: string): void;
  placeholder: string;
  hint?: string;
  problem: string | null;
  maxLength: number;
  multiline?: boolean;
  returnKeyType?: 'next' | 'done';
  onSubmitEditing?: () => void;
  autoCapitalize?: 'none' | 'sentences' | 'words';
  testID: string;
  ref?: React.Ref<RNTextInput>;
};

function LabeledInput({ label, value, onChangeText, placeholder, hint, problem, maxLength, multiline, returnKeyType, onSubmitEditing, autoCapitalize, testID, ref }: InputProps) {
  const t = useTheme();
  const [focus, setFocus] = useState(false);
  const border = problem ? t.colors.danger : focus ? t.colors.accent : t.colors.borderControl;
  return (
    <View style={styles.field}>
      <HText variant="caption" weight="600" color="muted">
        {label}
      </HText>
      <TextInput
        ref={ref}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={t.colors.subtle}
        accessibilityLabel={label}
        accessibilityHint={problem ?? hint}
        maxLength={maxLength}
        multiline={multiline}
        returnKeyType={multiline ? undefined : returnKeyType}
        onSubmitEditing={onSubmitEditing}
        blurOnSubmit={!multiline}
        autoCapitalize={autoCapitalize ?? 'sentences'}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        testID={testID}
        style={[
          styles.input,
          multiline && styles.inputMulti,
          { color: t.colors.text, borderColor: border, borderRadius: t.radii.control, backgroundColor: t.colors.surface, fontSize: t.typography.body.fontSize },
          Platform.OS === 'web' && ({ outlineStyle: 'none' } as object),
        ]}
      />
      {problem ? (
        <HText variant="caption" style={{ color: t.colors.danger }} accessibilityLiveRegion="polite">
          {problem}
        </HText>
      ) : hint ? (
        <HText variant="caption" color="subtle">
          {hint}
        </HText>
      ) : null}
    </View>
  );
}

function MayRow({ icon, label, sub, value, onChange, testID }: { icon: CreateIconName; label: string; sub?: string; value: boolean; onChange(v: boolean): void; testID: string }) {
  const t = useTheme();
  return (
    <View style={[styles.mayRow, { borderTopColor: t.colors.border }]}>
      <CreateIcon name={icon} size={18} color={t.colors.muted} />
      <View style={styles.flex}>
        <HText variant="body">{label}</HText>
        {sub ? (
          <HText variant="caption" color="muted">
            {sub}
          </HText>
        ) : null}
      </View>
      <Toggle value={value} onValueChange={onChange} accessibilityLabel={sub ? `${label}. ${sub}` : label} testID={testID} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  dialog: { padding: 0, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  headerSide: { width: 48, alignItems: 'center' },
  headerTitle: { flex: 1, textAlign: 'center' },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  columns: { flexDirection: 'row', flexShrink: 1, minHeight: 420 },
  left: { width: 320, flexGrow: 0 },
  leftContent: { padding: 18, paddingRight: 8, gap: 10 },
  right: { flex: 1 },
  rightContent: { padding: 18, paddingLeft: 10 },
  sectionLabel: { paddingHorizontal: 4 },
  phoneContent: { padding: 20, gap: 20, paddingBottom: 32 },
  lead: { gap: 8 },
  roles: { gap: 10 },
  role: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, minHeight: 64 },
  roleIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  footer: { gap: 14 },
  blank: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  footNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  form: { gap: 16, width: '100%', maxWidth: 560, alignSelf: 'center' },
  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  field: { gap: 6 },
  input: { borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, minHeight: 46 },
  inputMulti: { minHeight: 104, textAlignVertical: 'top' },
  maySection: { gap: 2 },
  mayRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth },
  failure: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 10 },
  submit: { marginTop: 4 },
});
