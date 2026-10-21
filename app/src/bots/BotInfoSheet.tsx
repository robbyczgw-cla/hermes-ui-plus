/**
 * "Über <Name>" (bots/, Bots v2 spec 2.5): tapping the name in a bot's chat. The bot's look and line, its model (a tap
 * opens the model picker, as the header did before), and "Macht regelmäßig": the bot's own routines from the Hermes job
 * API under its `/p/<bot>/` prefix (routines/source.ts), each with pause / resume where this device may, a tap opens
 * the routine's details. New routines are made by telling the bot in the chat. With Settings → Chat → "Routinen" off on
 * this device (routines/enabled.ts) the sheet has no routines part at all and loads nothing from the job API.
 */
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useLocale, useT } from '../i18n';
import type { ConnectionProfile } from '../settings/profiles';
import { usePreference } from '../settings/PreferencesProvider';
import { HText, Icon, SheetGrabber, SheetModal, useTheme } from '../ui';
import { RoutineRow, type GlyphKind } from '../routines/RoutineParts';
import { routinesSource } from '../routines/source';
import { describeSchedule } from '../routines/schedule';
import { controlsFor, groupOf, isRunning, lastOutcome } from '../routines/status';
import { routinesErrorKind } from '../routines/rights';
import { GROUP_KEYS, rowStatus } from '../routines/rowText';
import type { JobList, RoutineJob } from '../routines/jobs';
import { BotAvatar } from './BotAvatar';

type Load = { kind: 'loading' } | { kind: 'ready'; list: JobList } | { kind: 'error'; reason: 'off' | 'forbidden' | 'unsupported' | 'other'; message?: string };

export function BotInfoSheet({
  open,
  onClose,
  profile,
  name,
  bot,
  color,
  description,
  model,
  onPickModel,
}: {
  open: boolean;
  onClose(): void;
  profile: ConnectionProfile;
  name: string;
  /** profile name; undefined = the default bot */
  bot?: string;
  color?: string;
  description?: string;
  /** the chat's model label ('' = server default) */
  model: string;
  onPickModel(): void;
}) {
  const t = useTheme();
  const tr = useT();
  const { lang, locale, formatRelative } = useLocale();
  const router = useRouter();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [busy, setBusy] = useState<string | null>(null);
  const routinesOn = usePreference('routines');
  const src = open && routinesOn ? routinesSource(profile, bot, lang) : null;
  const srcKey = src?.key;

  const refresh = useCallback(async () => {
    const s = routinesSource(profile, bot, lang);
    if (!s) return setLoad({ kind: 'error', reason: 'unsupported' });
    try {
      setLoad({ kind: 'ready', list: await s.list() });
    } catch (e) {
      const k = routinesErrorKind(e);
      setLoad({ kind: 'error', reason: k === 'off' ? 'off' : k === 'forbidden' ? 'forbidden' : k === 'unsupported' || k === 'unknownBot' ? 'unsupported' : 'other', message: e instanceof Error ? e.message : undefined });
    }
  }, [profile, bot, lang]);
  useEffect(() => {
    if (open && srcKey) void refresh();
  }, [open, srcKey, refresh]);

  const act = async (job: RoutineJob, action: 'pause' | 'resume') => {
    if (!src || busy) return;
    setBusy(job.id);
    try {
      const updated = await src.act(job.id, action);
      setLoad((l) => (l.kind === 'ready' ? { ...l, list: { ...l.list, jobs: l.list.jobs.map((j) => (j.id === updated.id ? updated : j)) } } : l));
    } catch {
      void refresh();
    } finally {
      setBusy(null);
    }
  };
  const openJob = (job: RoutineJob) => {
    onClose();
    router.push({ pathname: '/routines', params: { ...(bot ? { bot } : {}), job: job.id } });
  };
  // the Routines screen: all routines, their results and, when they are off here, the owner's step and the chat route
  const openRoutines = () => {
    onClose();
    router.push({ pathname: '/routines', params: bot ? { bot } : {} });
  };

  const line = description ?? (bot ? undefined : tr('bots.roster.defaultHint'));
  const routines = (() => {
    if (load.kind === 'loading') return <HText variant="callout" color="muted">{tr('bots.info.loading')}</HText>;
    if (load.kind === 'error') {
      const key = load.reason === 'off' ? 'bots.info.routinesOff' : load.reason === 'forbidden' ? 'bots.info.routinesForbidden' : load.reason === 'unsupported' ? 'bots.info.routinesUnsupported' : 'bots.info.routinesFailed';
      return <HText variant="callout" color="muted">{tr(key, { name, message: load.message ?? '' })}</HText>;
    }
    const jobs = load.list.jobs;
    if (!jobs.length) return <HText variant="callout" color="muted">{tr('bots.info.routinesEmpty', { name })}</HText>;
    return (
      <View style={[styles.group, { borderColor: t.colors.border, borderRadius: t.radii.card, backgroundColor: t.colors.surface }]}>
        {jobs.map((job, i) => {
          const controls = controlsFor(job, load.list.access);
          const glyph: GlyphKind = isRunning(job) ? 'running' : groupOf(job);
          const schedule = describeSchedule(job.schedule, { t: tr, locale });
          const [when, outcome] = rowStatus(job, tr, formatRelative);
          const status = when ? `${when} · ${outcome}` : outcome;
          const action = controls.pause
            ? { label: tr('routines.actions.pause'), a11y: tr('routines.actions.pauseA11y', { name: job.name }), onPress: () => void act(job, 'pause'), busy: busy === job.id }
            : controls.resume
              ? { label: tr('routines.actions.resume'), a11y: tr('routines.actions.resumeA11y', { name: job.name }), onPress: () => void act(job, 'resume'), busy: busy === job.id }
              : undefined;
          return (
            <RoutineRow
              key={job.id}
              testID={`bot-info-routine-${job.id}`}
              title={job.name}
              schedule={schedule}
              when={when}
              outcome={outcome}
              outcomeWarn={['failed', 'blocked', 'deliveryFailed'].includes(lastOutcome(job))}
              glyph={glyph}
              a11yLabel={tr('routines.row.a11y', { name: job.name, state: tr(GROUP_KEYS[groupOf(job)]), schedule, status })}
              onPress={() => openJob(job)}
              action={action}
              last={i === jobs.length - 1}
            />
          );
        })}
      </View>
    );
  })();

  return (
    <SheetModal visible={open} onClose={onClose} closeLabel={tr('actions.close')} label={tr('bots.info.title', { name })} maxWidth={560} maxHeight="88%" style={styles.sheet}>
      <SheetGrabber />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} testID="bot-info">
        <View style={styles.head}>
          <BotAvatar name={name} bot={bot} color={color} size={64} />
          <View style={styles.flex}>
            <HText variant="title" accessibilityRole="header" numberOfLines={2}>
              {name}
            </HText>
            {line ? (
              <HText variant="callout" color="muted">
                {line}
              </HText>
            ) : null}
          </View>
        </View>
        <Pressable
          onPress={() => {
            onClose();
            onPickModel();
          }}
          accessibilityRole="button"
          accessibilityLabel={tr('bots.info.modelA11y', { model: model || tr('bots.info.modelDefault') })}
          style={({ pressed }) => [styles.modelRow, { borderColor: t.colors.border, borderRadius: t.radii.control }, pressed && { backgroundColor: t.colors.surfacePressed }]}
        >
          <HText variant="callout" style={styles.flex}>
            {tr('bots.info.model')}
          </HText>
          <HText variant="callout" color="muted" numberOfLines={1} style={styles.shrink}>
            {model || tr('bots.info.modelDefault')}
          </HText>
          <Icon name="chevronRight" size={16} color={t.colors.subtle} />
        </Pressable>
        {routinesOn ? (
          <>
            <HText variant="bodyStrong" accessibilityRole="header" testID="bot-info-routines">
              {tr('bots.info.routines')}
            </HText>
            {routines}
            {load.kind !== 'loading' ? (
              <Pressable
                onPress={openRoutines}
                testID="bot-info-routines-more"
                accessibilityRole="button"
                style={({ pressed }) => [styles.moreRow, pressed && { opacity: 0.6 }]}
              >
                <HText variant="callout" weight="600" color="accent" style={styles.flex}>
                  {load.kind === 'error' ? tr('bots.info.routinesWhy') : tr('bots.info.routinesAll')}
                </HText>
                <Icon name="chevronRight" size={16} color={t.colors.accentText} />
              </Pressable>
            ) : null}
            <HText variant="caption" color="subtle">
              {tr('bots.info.routinesHint', { name })}
            </HText>
            {src?.demo ? (
              <HText variant="caption" color="subtle" testID="bot-info-demo">
                {tr('bots.info.demoNote')}
              </HText>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  shrink: { flexShrink: 1 },
  sheet: { paddingHorizontal: 18 },
  // capped at 88 % of the screen (many routines, a small phone or large text make it taller): the content scrolls inside
  scroll: { flexGrow: 0, flexShrink: 1 },
  content: { gap: 14, paddingBottom: 24 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  modelRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, paddingHorizontal: 14, borderWidth: StyleSheet.hairlineWidth },
  group: { borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  moreRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 },
});
