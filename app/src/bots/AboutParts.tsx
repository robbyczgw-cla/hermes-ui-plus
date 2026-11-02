/**
 * The parts of "Über <Name>" added in Bots v2 slice 4 (bots/BotInfoSheet.tsx): "Merkt sich", "Kann", "Immer erlaubt",
 * "Benachrichtigungen" and "Bot archivieren". Calm list rows; destructive steps ask inline (Alert.alert does nothing
 * on react-native-web). Every state says something (loading, empty, unavailable with the reason, failed).
 */
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useT } from '../i18n';
import { Button, HText, Icon, useTheme } from '../ui';
import { a11yState } from '../ui/lib/a11yState';
import { allowLabelKey, manageReasonKey, type AllowEntry, type ManageRight, type MemorySummary, type SkillsSummary } from './about';
import type { AboutFailure, BotFields, SaveResult } from './aboutApi';
import { LabeledInput } from './create/BotCreateSheet';
import { LIMITS } from './create/core';
import { BOT_NOTIFY_LEVELS, type BotNotifyLevel } from './notify';
import type { AllowState } from './useBotAbout';

type Tr = ReturnType<typeof useT>;

function SectionTitle({ children, testID }: { children: string; testID?: string }) {
  return (
    <HText variant="bodyStrong" accessibilityRole="header" testID={testID}>
      {children}
    </HText>
  );
}

/** One tappable summary row: title + what it holds, chevron; `onPress` absent = a plain line (nothing to open). */
function SummaryRow({ title, summary, warn, onPress, a11y, testID }: { title: string; summary: string; warn?: boolean; onPress?: () => void; a11y: string; testID: string }) {
  const t = useTheme();
  const body = (
    <>
      <View style={styles.flex}>
        <HText variant="callout" weight="600">
          {title}
        </HText>
        <HText variant="caption" color={warn ? 'muted' : 'subtle'} numberOfLines={2}>
          {summary}
        </HText>
      </View>
      {onPress ? <Icon name="chevronRight" size={16} color={t.colors.subtle} /> : null}
    </>
  );
  const box = [styles.row, { borderColor: t.colors.border, borderRadius: t.radii.control }];
  if (!onPress) {
    return (
      <View style={box} testID={testID} accessible accessibilityLabel={`${title}: ${summary}`}>
        {body}
      </View>
    );
  }
  return (
    <Pressable onPress={onPress} testID={testID} accessibilityRole="button" accessibilityLabel={a11y} style={({ pressed }) => [...box, pressed && { backgroundColor: t.colors.surfacePressed }]}>
      {body}
    </Pressable>
  );
}

export function memoryLine(m: MemorySummary | null, tr: Tr, name: string): { text: string; open: boolean } {
  if (!m) return { text: tr('bots.info.sectionLoading'), open: false };
  const provider = 'provider' in m && m.provider ? ` ${tr('bots.info.memoryProvider', { provider: m.provider })}` : '';
  switch (m.kind) {
    case 'ready':
      return { text: `${tr('bots.info.memoryCount', { count: m.count })} · ${m.first}${provider}`, open: true };
    case 'empty':
      return { text: tr('bots.info.memoryEmpty', { name }) + provider, open: true };
    case 'disabled':
      return { text: tr('bots.info.memoryDisabled', { name }), open: true };
    case 'unavailable': {
      // the library screen's reason texts (library.memory.reasons.*) say what the owner can do
      const key = `library.memory.reasons.${m.reason}`;
      const reason = tr(key as never, { bot: name });
      return { text: reason !== key ? reason : tr('bots.info.memoryUnavailable', { name }), open: false };
    }
    default:
      return { text: tr('bots.info.memoryFailed', { name }), open: true };
  }
}

export function skillsLine(s: SkillsSummary | null, tr: Tr, name: string): string {
  if (!s) return tr('bots.info.sectionLoading');
  if (s.kind === 'empty') return tr('bots.info.skillsEmpty');
  if (s.kind === 'failed') return tr('bots.info.skillsFailed', { name });
  const head = s.off ? `${tr('bots.info.skillsCount', { count: s.count })} (${tr('bots.info.skillsOff', { count: s.off })})` : tr('bots.info.skillsCount', { count: s.count });
  return s.names.length ? `${head} · ${s.names.join(', ')}` : head;
}

export function KnowsAndCan({ memory, skills, name, onMemory, onSkills }: { memory: MemorySummary | null; skills: SkillsSummary | null; name: string; onMemory(): void; onSkills(): void }) {
  const tr = useT();
  const mem = memoryLine(memory, tr, name);
  const sk = skillsLine(skills, tr, name);
  return (
    <View style={styles.gap}>
      <SummaryRow
        title={tr('bots.info.memory')}
        summary={mem.text}
        warn={memory?.kind === 'unavailable' || memory?.kind === 'failed'}
        onPress={mem.open ? onMemory : undefined}
        a11y={tr('bots.info.memoryA11y', { summary: mem.text })}
        testID="bot-info-memory"
      />
      <SummaryRow
        title={tr('bots.info.skills')}
        summary={sk}
        warn={skills?.kind === 'failed'}
        onPress={skills ? onSkills : undefined}
        a11y={tr('bots.info.skillsA11y', { summary: sk })}
        testID="bot-info-skills"
      />
    </View>
  );
}

export const failureText = (tr: Tr, f: AboutFailure, name: string) => tr(`bots.info.fail.${f}` as never, { name });

export function manageText(tr: Tr, m: ManageRight | null): string | null {
  if (!m || m.allowed) return null;
  return tr(`bots.info.manage.${manageReasonKey(m.reason)}` as never);
}

export function entryLabel(tr: Tr, e: AllowEntry): string {
  const key = allowLabelKey(e);
  return key ? tr(`bots.info.allowedLabels.${key}` as never) : (e.description ?? e.pattern);
}

export function AllowedSection({
  state,
  name,
  isDefault,
  manage,
  onRevoke,
}: {
  state: AllowState;
  name: string;
  isDefault: boolean;
  manage: ManageRight | null;
  onRevoke(pattern: string): Promise<{ ok: true } | { ok: false; failure: AboutFailure }>;
}) {
  const t = useTheme();
  const tr = useT();
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; warn: boolean } | null>(null);
  const canChange = manage?.allowed === true;
  const why = manageText(tr, manage);

  const body = (() => {
    if (state.kind === 'loading') return <HText variant="callout" color="muted">{tr('bots.info.sectionLoading')}</HText>;
    if (state.kind === 'none') return <HText variant="callout" color="muted">{tr(state.why === 'demo' ? 'bots.info.allowedDemo' : 'bots.info.allowedNoBridge')}</HText>;
    if (state.kind === 'failed') {
      return (
        <HText variant="callout" color="muted">
          {state.failure === 'unsupported' ? tr('bots.info.allowedUnsupported') : tr('bots.info.allowedFailed', { reason: failureText(tr, state.failure, name) })}
        </HText>
      );
    }
    const entries = state.list.entries;
    if (!entries.length) return <HText variant="callout" color="muted">{tr('bots.info.allowedEmpty')}</HText>;
    return (
      <View style={[styles.group, { borderColor: t.colors.border, borderRadius: t.radii.card, backgroundColor: t.colors.surface }]}>
        {entries.map((e, i) => {
          const label = entryLabel(tr, e);
          const asking = confirm === e.pattern;
          return (
            <View key={e.pattern} style={[styles.entry, i < entries.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: t.colors.border }]} testID={`bot-info-allowed-${i}`}>
              <View style={styles.entryHead}>
                <View style={styles.flex}>
                  <HText variant="callout">{label}</HText>
                  {label !== e.pattern ? (
                    <HText variant="caption" color="subtle" numberOfLines={1}>
                      {tr('bots.info.allowedCommand', { pattern: e.pattern })}
                    </HText>
                  ) : null}
                </View>
                {canChange && !asking ? (
                  <Button label={tr('bots.info.allowedRevoke')} variant="tertiary" size="small" onPress={() => setConfirm(e.pattern)} accessibilityLabel={tr('bots.info.allowedRevokeA11y', { label })} testID={`bot-info-revoke-${i}`} />
                ) : null}
              </View>
              {asking ? (
                <View style={styles.confirm}>
                  <HText variant="callout" weight="600">
                    {tr('bots.info.allowedRevokeTitle')}
                  </HText>
                  <HText variant="caption" color="muted">
                    {tr('bots.info.allowedRevokeBody', { label, name })}
                  </HText>
                  <View style={styles.actions}>
                    <Button label={tr('actions.cancel')} variant="tertiary" size="small" onPress={() => setConfirm(null)} />
                    <Button
                      label={tr('bots.info.allowedRevoke')}
                      variant="primary"
                      tone="seal"
                      size="small"
                      loading={busy === e.pattern}
                      testID={`bot-info-revoke-confirm-${i}`}
                      onPress={() => {
                        setBusy(e.pattern);
                        void onRevoke(e.pattern).then((r) => {
                          setBusy(null);
                          setConfirm(null);
                          setNote(r.ok ? { text: tr('bots.info.allowedRevoked', { name }), warn: false } : { text: tr('bots.info.allowedRevokeFailed', { reason: failureText(tr, r.failure, name) }), warn: true });
                        });
                      }}
                    />
                  </View>
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
    );
  })();

  return (
    <View style={styles.gap}>
      <SectionTitle testID="bot-info-allowed">{tr('bots.info.allowed')}</SectionTitle>
      {body}
      {state.kind === 'ready' && state.list.omitted ? (
        <HText variant="caption" color="subtle" testID="bot-info-allowed-omitted">
          {tr('bots.info.allowedOmitted', { count: state.list.omitted })}
        </HText>
      ) : null}
      {note ? (
        <HText variant="caption" color={note.warn ? 'muted' : 'subtle'} accessibilityLiveRegion="polite" testID="bot-info-allowed-note">
          {note.text}
        </HText>
      ) : null}
      {state.kind === 'ready' && state.list.entries.length && why ? (
        <HText variant="caption" color="subtle">
          {why}
        </HText>
      ) : null}
      <HText variant="caption" color="subtle">
        {tr(isDefault ? 'bots.info.allowedHintDefault' : 'bots.info.allowedHint', { name })}
      </HText>
    </View>
  );
}

export function NotifySection({ level, name, isDefault, push, onLevel }: { level: BotNotifyLevel; name: string; isDefault: boolean; push: 'on' | 'off'; onLevel(l: BotNotifyLevel): void }) {
  const t = useTheme();
  const tr = useT();
  const label: Record<BotNotifyLevel, [string, string]> = {
    all: [tr('bots.info.notifyAll'), tr('bots.info.notifyAllSub')],
    needed: [tr('bots.info.notifyNeeded'), tr('bots.info.notifyNeededSub')],
    off: [tr('bots.info.notifyOff'), tr('bots.info.notifyOffSub', { name })],
  };
  return (
    <View style={styles.gap}>
      <SectionTitle testID="bot-info-notify">{tr('bots.info.notify')}</SectionTitle>
      <View accessibilityRole="radiogroup" style={[styles.group, { borderColor: t.colors.border, borderRadius: t.radii.card, backgroundColor: t.colors.surface }]}>
        {BOT_NOTIFY_LEVELS.map((l, i) => {
          const on = level === l;
          return (
            <Pressable
              key={l}
              onPress={() => onLevel(l)}
              testID={`bot-info-notify-${l}`}
              accessibilityRole="radio"
              {...a11yState({ checked: on }, 'radio')}
              accessibilityLabel={`${label[l][0]}. ${label[l][1]}`}
              style={({ pressed }) => [styles.radio, i < BOT_NOTIFY_LEVELS.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: t.colors.border }, pressed && { backgroundColor: t.colors.surfacePressed }]}
            >
              <View style={[styles.radioDot, { borderColor: on ? t.colors.accent : t.colors.borderStrong }]}>{on ? <View style={[styles.radioFill, { backgroundColor: t.colors.accent }]} /> : null}</View>
              <View style={styles.flex}>
                <HText variant="callout" weight={on ? '600' : undefined}>
                  {label[l][0]}
                </HText>
                <HText variant="caption" color="subtle">
                  {label[l][1]}
                </HText>
              </View>
            </Pressable>
          );
        })}
      </View>
      <HText variant="caption" color="subtle">
        {[isDefault ? tr('bots.info.notifyDefaultNote', { name }) : '', push === 'off' ? tr('bots.info.notifyPushOff') : tr('bots.info.notifyHint')].filter(Boolean).join(' ')}
      </HText>
    </View>
  );
}

export function ArchiveSection({ name, manage, onArchive }: { name: string; manage: ManageRight | null; onArchive(): Promise<{ ok: true } | { ok: false; failure: AboutFailure }> }) {
  const t = useTheme();
  const tr = useT();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const why = manageText(tr, manage);
  return (
    <View style={[styles.gap, styles.archive, { borderColor: t.colors.border }]}>
      {!asking ? (
        <Button label={tr('bots.info.archive')} variant="secondary" tone="seal" onPress={() => setAsking(true)} disabled={manage?.allowed !== true} testID="bot-info-archive" />
      ) : (
        <View style={styles.confirm}>
          <HText variant="callout" weight="600">
            {tr('bots.info.archiveTitle', { name })}
          </HText>
          <HText variant="caption" color="muted">
            {tr('bots.info.archiveBody', { name })}
          </HText>
          <View style={styles.actions}>
            <Button label={tr('actions.cancel')} variant="tertiary" size="small" onPress={() => setAsking(false)} />
            <Button
              label={tr('bots.info.archiveConfirm')}
              variant="primary"
              tone="seal"
              size="small"
              loading={busy}
              testID="bot-info-archive-confirm"
              onPress={() => {
                setBusy(true);
                setError(null);
                void onArchive().then((r) => {
                  setBusy(false);
                  if (!r.ok) {
                    setAsking(false);
                    setError(tr('bots.info.archiveFailed', { reason: failureText(tr, r.failure, name) }));
                  }
                });
              }}
            />
          </View>
        </View>
      )}
      <HText variant="caption" color="subtle">
        {why ?? tr('bots.info.archiveSub', { name })}
      </HText>
      {error ? (
        <HText variant="caption" color="muted" accessibilityLiveRegion="polite" testID="bot-info-archive-error">
          {error}
        </HText>
      ) : null}
    </View>
  );
}

/**
 * "So arbeitet <Name>" (spec 2.5): the main job and how the bot works, with "Bearbeiten" (the three fields of the create
 * flow; the plugin rewrites SOUL.md and profile.yaml). Only for bots whose fields this device may read; otherwise the
 * header line already shows the job and nothing else is promised.
 */
export function HowSection({ fields, name, canEdit, onSave }: { fields: BotFields; name: string; canEdit: boolean; onSave(f: { title: string; job: string; how: string }): Promise<SaveResult> }) {
  const t = useTheme();
  const tr = useT();
  const [edit, setEdit] = useState<{ title: string; job: string; how: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ field?: string; text: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const check = (field: 'title' | 'job' | 'how', v: string) => {
    const x = field === 'how' ? v.trim() : v.replace(/\s+/g, ' ').trim();
    if (!x) return tr('botCreate.required');
    if (x.length > LIMITS[field]) return tr('botCreate.tooLong', { max: LIMITS[field] });
    return null;
  };
  if (!edit) {
    return (
      <View style={styles.gap} testID="bot-info-how">
        <View style={styles.entryHead}>
          <View style={styles.flex}>
            <SectionTitle>{tr('bots.info.how', { name })}</SectionTitle>
          </View>
          {canEdit ? (
            <Button label={tr('bots.info.howEdit')} variant="tertiary" size="small" onPress={() => { setEdit({ title: fields.title, job: fields.job, how: fields.how }); setSaved(false); setProblem(null); }} testID="bot-info-how-edit" />
          ) : null}
        </View>
        <View style={[styles.howBox, { borderColor: t.colors.border, borderRadius: t.radii.card, backgroundColor: t.colors.surface }]}>
          {fields.job ? <HText variant="callout" weight="600">{fields.job}</HText> : null}
          <HText variant="callout" color={fields.how ? undefined : 'muted'}>
            {fields.how || tr('bots.info.howEmpty', { name })}
          </HText>
        </View>
        {saved ? (
          <HText variant="caption" color="subtle" accessibilityLiveRegion="polite" testID="bot-info-how-saved">
            {tr('bots.info.howSaved', { name })}
          </HText>
        ) : null}
      </View>
    );
  }
  const p = (f: 'title' | 'job' | 'how') => (problem?.field === f ? problem.text : null);
  return (
    <View style={styles.gap} testID="bot-info-how-form">
      <SectionTitle>{tr('bots.info.how', { name })}</SectionTitle>
      <LabeledInput label={tr('botCreate.name')} value={edit.title} onChangeText={(v) => setEdit({ ...edit, title: v })} placeholder={fields.title} problem={p('title')} maxLength={LIMITS.title + 10} testID="bot-info-how-title" returnKeyType="next" />
      <LabeledInput label={tr('botCreate.job')} value={edit.job} onChangeText={(v) => setEdit({ ...edit, job: v })} placeholder={fields.job} problem={p('job')} maxLength={LIMITS.job + 20} testID="bot-info-how-job" returnKeyType="next" />
      <LabeledInput label={tr('botCreate.how')} value={edit.how} onChangeText={(v) => setEdit({ ...edit, how: v })} placeholder={fields.how} hint={tr('botCreate.howHint')} problem={p('how')} maxLength={LIMITS.how + 50} multiline testID="bot-info-how-how" />
      {problem && !problem.field ? (
        <HText variant="caption" color="muted" accessibilityLiveRegion="polite">
          {problem.text}
        </HText>
      ) : null}
      <View style={styles.actions}>
        <Button label={tr('actions.cancel')} variant="tertiary" size="small" onPress={() => { setEdit(null); setProblem(null); }} />
        <Button
          label={tr('bots.info.howSave')}
          variant="primary"
          size="small"
          loading={busy}
          testID="bot-info-how-save"
          onPress={() => {
            for (const f of ['title', 'job', 'how'] as const) {
              const bad = check(f, edit[f]);
              if (bad) return setProblem({ field: f, text: bad });
            }
            setBusy(true);
            setProblem(null);
            void onSave({ title: edit.title.replace(/\s+/g, ' ').trim(), job: edit.job.replace(/\s+/g, ' ').trim(), how: edit.how.trim() }).then((r) => {
              setBusy(false);
              if (r.ok) {
                setEdit(null);
                setSaved(true);
              } else if (r.failure === 'exists') setProblem({ field: 'title', text: tr('botCreate.errors.exists') });
              else if (r.failure === 'invalid') setProblem({ ...(r.field === 'title' || r.field === 'job' || r.field === 'how' ? { field: r.field } : {}), text: tr('bots.info.howInvalid') });
              else setProblem({ text: tr('bots.info.howFailed', { reason: failureText(tr, r.failure, name) }) });
            });
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, paddingHorizontal: 14, paddingVertical: 8, borderWidth: StyleSheet.hairlineWidth },
  group: { borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  entry: { paddingHorizontal: 14, paddingVertical: 10, gap: 8 },
  entryHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  confirm: { gap: 6 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 4 },
  radio: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 14, paddingVertical: 8 },
  radioDot: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioFill: { width: 10, height: 10, borderRadius: 5 },
  howBox: { borderWidth: StyleSheet.hairlineWidth, padding: 12, gap: 6 },
  archive: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 14, marginTop: 4 },
});
