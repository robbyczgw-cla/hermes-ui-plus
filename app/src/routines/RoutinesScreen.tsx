// Routines: two tabs. Inbox (slice 2): results of the bot's scheduled runs from the UI bridge, a result view with the
// chat's answer renderer and "Continue in chat". Schedules (slice 1): the bot's Hermes cron jobs, read-only plus
// pause / resume / run now when this device may manage them; a detail page in place (like the settings sub-pages).
// Creating and editing come with the managed Routines of a later version (design: 0.2 routines, phase B).
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BackHandler, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../ui/primitives/Text';
import { Button, textStyle, useTheme } from '../ui';
import { SkeletonLines } from '../ui/primitives/Skeleton';
import { useEscapeToClose } from '../ui/lib/useEscapeToClose';
import { useTitlebarInset } from '../desktop/chrome';
import { useLocale, useT, type TKey } from '../i18n';
import { useToast } from '../chat/Toast';
import { requestComposerFocus } from '../desktop/bridge';
import { useConversationsInternals } from '../conversations/ConversationsProvider';
import { confirmAsync } from '../chat/commands/confirm';
import { Markdown } from '../chat/Markdown';
import { describeError, HermesError } from '../hermes/stream';
import { botOf, DEFAULT_BOT } from '../hermes/bots';
import { useHermesBots } from '../hermes/useHermesBots';
import { useActiveProfile } from '../settings/ConnectionProvider';
import { useAskHermes } from '../library/useAskHermes';
import { Footnote, Group, SectionTitle } from '../settings/ui';
import { isRoutinesUnsupported, JOB_ID_RE, type JobAction, type JobList, type RoutineJob } from './jobs';
import type { LastResult } from './lastResult';
import { cachedInbox, cachedList, probeInbox, rememberList, rememberUnread, routinesSource, useInboxProbe, type RoutinesSource } from './source';
import { continuationSeed } from './continueChat';
import { INBOX_ID_RE, initialTab, type InboxItem, type InboxSummary, type RoutinesTab } from './inbox';
import { onRoutineEvent, routineEventMatches } from './events';
import { canManage, readOnlyReason, routinesErrorKind } from './rights';
import { InboxView } from './InboxView';
import { ResultView } from './ResultView';
import { describeSchedule, offsetLabel, serverClock } from './schedule';
import { controlsFor, groupJobs, groupOf, isPaused, isRunning, lastOutcome, type RoutineGroup } from './status';
import { InfoRow, RoutineGlyph, RoutineRow, RoutineTabs, type GlyphKind } from './RoutineParts';
import { GROUP_KEYS, lastText, OUTCOME_KEYS, rowStatus } from './rowText';

type Load = { kind: 'loading' } | { kind: 'ready'; list: JobList } | { kind: 'unsupported' } | { kind: 'off' } | { kind: 'forbidden' } | { kind: 'error'; message: string };

const PLATFORM_NAMES: Record<string, string> = {
  telegram: 'Telegram',
  discord: 'Discord',
  slack: 'Slack',
  whatsapp: 'WhatsApp',
  signal: 'Signal',
  matrix: 'Matrix',
  email: 'E-Mail',
  sms: 'SMS',
  cli: 'CLI',
  api_server: 'API',
  'bot-chat': 'Bot Chat',
};
const platformName = (k: string) => PLATFORM_NAMES[k] ?? k;


/** Error code (bridge jobs.mjs) → text; otherwise the server's own message. */
function actionErrorKey(e: unknown): TKey | null {
  if (!(e instanceof HermesError)) return null;
  switch (e.code) {
    case 'job_not_found':
      return 'routines.errors.notFound';
    case 'routines_read_only':
      return 'routines.errors.readOnly';
    case 'routines_forbidden':
      return 'routines.errors.forbidden';
    case 'job_busy':
      return 'routines.errors.busy';
    case 'run_cooldown':
      return 'routines.errors.cooldown';
    case 'job_paused':
      return 'routines.errors.paused';
    case 'job_terminal':
      return 'routines.errors.terminal';
    default:
      return e.status === 404 ? 'routines.errors.notFound' : null;
  }
}

export function RoutinesScreen() {
  const th = useTheme();
  const t = useT();
  const { locale, lang, formatDate, formatRelative } = useLocale();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const titlebarInset = useTitlebarInset();
  const profile = useActiveProfile();
  const { controller } = useConversationsInternals();
  // `job`: a routine's detail straight away ("Über <Name>" in a bot's chat, bots/BotInfoSheet.tsx)
  const params = useLocalSearchParams<{ bot?: string; tab?: string; item?: string; job?: string }>();
  const bot = botOf(params.bot);
  // off / no access: the same chat route as Skills & memory (a normal question to this bot, back in its chat)
  const ask = useAskHermes(profile, bot);
  const { bots } = useHermesBots(profile ?? undefined, bot);
  const botEntry = bots.find((b) => (bot ? b.name === bot : b.default || b.name === DEFAULT_BOT));
  const botName = bot ? (botEntry?.label ?? bot) : (botEntry?.label ?? t('bots.picker.default'));

  // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuilt only when the connection, bot or demo language changes
  const src: RoutinesSource | null = useMemo(() => routinesSource(profile, bot, lang), [profile?.id, profile?.kind, profile?.baseUrl, profile?.apiKey, profile?.bridge, bot, lang]);
  const [load, setLoad] = useState<Load>(() => {
    const hit = src ? cachedList(src.key) : undefined;
    return hit ? { kind: 'ready', list: hit } : { kind: 'loading' };
  });
  const [refreshing, setRefreshing] = useState(false);
  const [openId, setOpenId] = useState<string | null>(() => (typeof params.job === 'string' && JOB_ID_RE.test(params.job) ? params.job : null));
  const [busy, setBusy] = useState<string | null>(null);
  const reqRef = useRef(0);

  // ---- inbox: availability + unread (shared with the drawer badge), tab, open result
  const { probe, failed: probeFailed } = useInboxProbe(src, !!src);
  const inboxReady = probe?.availability.kind === 'ready' ? probe.availability : null;
  const unread = inboxReady ? (probe?.unread ?? 0) : 0;
  const paramItem = typeof params.item === 'string' && INBOX_ID_RE.test(params.item) ? params.item : null;
  // "View schedule" from a result: Back returns to that result (inbox tab), not to the schedules list
  const returnTo = useRef<{ id: string; preview?: InboxSummary } | null>(null);
  const [tab, setTabState] = useState<RoutinesTab>(() => {
    const hit = src ? cachedInbox(src.key) : undefined;
    if (typeof params.job === 'string' && JOB_ID_RE.test(params.job)) return 'schedules';
    return initialTab({ param: paramItem ? 'inbox' : params.tab, unread: hit?.unread, inboxAvailable: hit?.availability.kind === 'ready' });
  });
  // the default tab is decided once: by a deep link, or by the first unread count we know; never switched under the user
  const tabDecided = useRef(!!paramItem || !!params.job || params.tab === 'inbox' || params.tab === 'schedules' || (src ? !!cachedInbox(src.key) : false));
  const setTab = useCallback((v: RoutinesTab) => {
    tabDecided.current = true;
    returnTo.current = null;
    setTabState(v);
  }, []);
  useEffect(() => {
    if (tabDecided.current || !probe) return;
    tabDecided.current = true;
    setTabState(initialTab({ unread: probe.unread, inboxAvailable: probe.availability.kind === 'ready' }));
  }, [probe]);
  const [openItem, setOpenItem] = useState<{ id: string; preview?: InboxSummary } | null>(() => (paramItem ? { id: paramItem } : null));
  // a notification tap while the screen is open: show that result
  useEffect(() => {
    if (!paramItem) return;
    tabDecided.current = true;
    returnTo.current = null;
    setTabState('inbox');
    setOpenId(null);
    setOpenItem({ id: paramItem });
  }, [paramItem]);
  const [inboxReload, setInboxReload] = useState(0);
  // fresh on open (the drawer's count may be a minute old)
  useEffect(() => {
    if (src) void probeInbox(src, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `src` is rebuilt per render; its key identifies it
  }, [src?.key]);
  // live `hui.routine` for this bot: the open list refetches (the probe hook refreshes the count)
  useEffect(() => {
    if (!src) return;
    return onRoutineEvent((e) => {
      if (routineEventMatches(e, src.profileId, src.bot)) setInboxReload((n) => n + 1);
    });
  }, [src]);
  const onUnread = useCallback((n: number) => {
    if (src) rememberUnread(src.key, n);
  }, [src]);

  const refresh = useCallback(
    async (pull = false) => {
      if (!src) return;
      const req = ++reqRef.current;
      if (pull) setRefreshing(true);
      try {
        const list = await src.list();
        if (req !== reqRef.current) return;
        rememberList(src.key, list);
        setLoad({ kind: 'ready', list });
      } catch (e) {
        if (req !== reqRef.current) return;
        const kind = routinesErrorKind(e);
        if (kind === 'forbidden') setLoad({ kind: 'forbidden' });
        else if (kind === 'off') setLoad({ kind: 'off' });
        else if (isRoutinesUnsupported(e)) setLoad({ kind: 'unsupported' });
        // a failed refresh keeps the list on screen; only an empty screen shows the error
        else setLoad((cur) => (cur.kind === 'ready' ? cur : { kind: 'error', message: describeError(e, t) }));
        if (pull) toast(t('routines.loadFailed', { message: describeError(e, t) }));
      } finally {
        if (pull && req === reqRef.current) setRefreshing(false);
      }
    },
    [src, t, toast],
  );
  // another connection / bot (notification tap while open): never show the previous one's list meanwhile
  const shownKey = useRef(src?.key);
  useEffect(() => {
    if (shownKey.current === src?.key) return;
    shownKey.current = src?.key;
    const hit = src ? cachedList(src.key) : undefined;
    setLoad(hit ? { kind: 'ready', list: hit } : { kind: 'loading' });
    setOpenId(null);
  }, [src]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const refreshAll = useCallback(async () => {
    if (!src) return;
    setInboxReload((n) => n + 1);
    await Promise.all([refresh(true), probeInbox(src, true)]);
  }, [src, refresh]);

  const close = useCallback(() => (router.canGoBack() ? router.back() : router.replace('/')), [router]);
  const back = useCallback(() => {
    const from = returnTo.current;
    returnTo.current = null;
    setOpenId(null);
    if (from) {
      setTabState('inbox');
      setOpenItem(from);
    } else setOpenItem(null);
  }, []);
  const inner = !!openId || (!!openItem && !!src?.inbox);
  useEscapeToClose(true, inner ? back : close);
  useEffect(() => {
    if (!inner) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      back();
      return true;
    });
    return () => sub.remove();
  }, [inner, back]);

  const list = load.kind === 'ready' ? load.list : null;
  const open = openId && list ? list.jobs.find((j) => j.id === openId) : undefined;
  // rights: the list's own answer, narrowed by the capabilities (the stricter wins)
  const caps = probe?.caps ?? null;
  const access: 'control' | 'read' = list?.access === 'control' && (!caps || canManage(caps.rights)) ? 'control' : 'read';
  const roReason = list ? readOnlyReason(access === 'control' ? 'manage' : list.rights, caps) : null;
  const readOnlyText = roReason === 'device' ? t('routines.readOnlyDevice') : roReason === 'server' ? t('routines.readOnly') : null;

  const replaceJob = useCallback(
    (job: RoutineJob) => {
      setLoad((cur) => {
        if (cur.kind !== 'ready') return cur;
        const next = { ...cur.list, jobs: cur.list.jobs.map((j) => (j.id === job.id ? job : j)) };
        if (src) rememberList(src.key, next);
        return { kind: 'ready', list: next };
      });
    },
    [src],
  );

  const act = useCallback(
    async (job: RoutineJob, action: JobAction) => {
      if (!src || busy) return;
      const fmt = { t, locale };
      if (action === 'run') {
        const resumes = isPaused(job);
        const ok = await confirmAsync(
          t('routines.confirm.runTitle'),
          t(resumes ? 'routines.confirm.runResumeBody' : 'routines.confirm.runBody', { name: job.name }),
          t(resumes ? 'routines.actions.runResume' : 'routines.confirm.run'),
          t('actions.cancel'),
        );
        if (!ok) return;
      }
      if (action === 'resume' && job.schedule.kind !== 'once' && job.nextRunAt && Date.parse(job.nextRunAt) <= Date.now()) {
        // Hermes keeps a slot that elapsed during the pause due (cron/jobs.py resume_job): say so before it runs
        const ok = await confirmAsync(t('routines.confirm.resumeTitle'), `${describeSchedule(job.schedule, fmt)}\n\n${t('routines.confirm.resumeCatchUp')}`, t('routines.confirm.resume'), t('actions.cancel'));
        if (!ok) return;
      }
      setBusy(job.id);
      try {
        const updated = await src.act(job.id, action, { resumePaused: action === 'run' && isPaused(job) });
        replaceJob(updated);
        toast(t(action === 'pause' ? 'routines.done.paused' : action === 'resume' ? 'routines.done.resumed' : 'routines.done.queued'));
      } catch (e) {
        const key = actionErrorKey(e);
        toast(key ? t(key) : t('routines.errors.action', { message: describeError(e, t) }));
        // rights may have changed (read-only now): the refreshed list drops the controls
        void refresh();
        if (routinesErrorKind(e) === 'readOnly' || routinesErrorKind(e) === 'forbidden') void probeInbox(src, true);
      } finally {
        setBusy(null);
      }
    },
    [src, busy, t, locale, replaceJob, toast, refresh],
  );

  // "Continue in chat": a NEW chat on this connection + bot, seeded with the result; nothing is sent
  const continueInChat = useCallback(
    (item: InboxItem) => {
      if (!profile) return;
      const job = list?.jobs.find((j) => j.id === item.jobId);
      const seed = continuationSeed(item, {
        t,
        formatDate: (ms) => formatDate(ms, { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' }),
        prompt: job?.prompt,
        bot,
      });
      try {
        controller.createBranch({ id: profile.id, kind: profile.kind }, { messages: seed.messages, seed: seed.messages.length, title: seed.title, bot: seed.bot });
        close();
        toast(t('routines.continue.done'));
        // after the switch: the chat that is open now takes the focus
        setTimeout(requestComposerFocus, 150);
      } catch (e) {
        toast(t('routines.continue.failed', { message: e instanceof Error ? e.message : String(e) }));
      }
    },
    [profile, list, t, formatDate, bot, controller, close, toast],
  );
  const openSchedule = useCallback((jobId: string) => {
    returnTo.current = openItem;
    setOpenItem(null);
    setTabState('schedules');
    setOpenId(jobId);
  }, [openItem]);

  const cardStyle = [styles.card, { backgroundColor: th.colors.surface, borderColor: th.colors.border, borderRadius: th.radii.card }];
  const inboxContent = (() => {
    if (!src) return null;
    if (inboxReady && src.inbox) {
      return <InboxView api={src.inbox} srcKey={src.key} caps={inboxReady.caps} demo={src.demo} reloadKey={inboxReload} onOpen={(item) => setOpenItem({ id: item.id, preview: item })} onUnread={onUnread} />;
    }
    const kind = probe?.availability.kind;
    if (kind === 'noBridge') return <Message title={t('routines.inbox.unavailable')} body={t('routines.inbox.noBridge')} />;
    if (kind === 'unsupported') return <Message title={t('routines.inbox.unavailable')} body={t('routines.inbox.oldBridge')} />;
    if (kind === 'off') return <Message title={t('routines.inbox.unavailable')} body={t('routines.inbox.off')} />;
    if (kind === 'forbidden') return <Message title={t('routines.inbox.unavailable')} body={t('routines.inbox.forbidden')} />;
    if (probeFailed) {
      return (
        <View style={styles.gap}>
          <Message title={t('routines.inbox.unavailable')} body={t('routines.inbox.loadFailed', { message: t('errors.network') })} tone="warning" />
          <Button label={t('actions.retry')} onPress={() => void probeInbox(src, true)} variant="secondary" />
        </View>
      );
    }
    return (
      <View accessible accessibilityLabel={t('routines.inbox.loading')} style={cardStyle}>
        <SkeletonLines lines={3} />
      </View>
    );
  })();

  const schedulesContent = (() => {
    if (load.kind === 'loading') {
      return (
        <View accessible accessibilityLabel={t('routines.loading')} style={cardStyle}>
          <SkeletonLines lines={3} />
        </View>
      );
    }
    if (load.kind === 'unsupported') return <Message title={t('routines.unsupported.title')} body={t('routines.unsupported.body')} />;
    if (load.kind === 'off' || load.kind === 'forbidden') {
      return (
        <Message title={t(`routines.${load.kind}.title`)} body={t(`routines.${load.kind}.body`, { bot: bot ?? DEFAULT_BOT })} testID={`routines-${load.kind}`}>
          <Button label={t('routines.askChat')} onPress={() => ask(t('routines.askChatPrompt'), 'send')} variant="secondary" size="small" testID="routines-ask-chat" />
        </Message>
      );
    }
    if (load.kind === 'error') {
      return (
        <View style={styles.gap}>
          <Message title={t('routines.title')} body={t('routines.loadFailed', { message: load.message })} tone="warning" />
          <Button label={t('actions.retry')} onPress={() => void refresh(true)} variant="secondary" />
        </View>
      );
    }
    if (load.list.jobs.length === 0) {
      return (
        <>
          <EmptyState />
          {readOnlyText ? <Footnote>{readOnlyText}</Footnote> : null}
        </>
      );
    }
    return (
      <>
        {groupJobs(load.list.jobs).map(({ group, jobs }) => (
          <View key={group}>
            <SectionTitle>{t(GROUP_KEYS[group])}</SectionTitle>
            <View style={styles.groupGap} />
            <Group>
              {jobs.map((job, i) => {
                const controls = controlsFor(job, access);
                const glyph: GlyphKind = isRunning(job) ? 'running' : groupOf(job);
                const schedule = describeSchedule(job.schedule, { t, locale });
                const [when, outcome] = rowStatus(job, t, formatRelative);
                const status = when ? `${when} · ${outcome}` : outcome;
                const action = controls.pause
                  ? { label: t('routines.actions.pause'), a11y: t('routines.actions.pauseA11y', { name: job.name }), onPress: () => void act(job, 'pause'), busy: busy === job.id }
                  : controls.resume
                    ? { label: t('routines.actions.resume'), a11y: t('routines.actions.resumeA11y', { name: job.name }), onPress: () => void act(job, 'resume'), busy: busy === job.id }
                    : undefined;
                return (
                  <RoutineRow
                    key={job.id}
                    testID={`routine-${job.id}`}
                    title={job.name}
                    schedule={schedule}
                    when={when}
                    outcome={outcome}
                    outcomeWarn={['failed', 'blocked', 'deliveryFailed'].includes(lastOutcome(job))}
                    glyph={glyph}
                    a11yLabel={t('routines.row.a11y', { name: job.name, state: t(GROUP_KEYS[groupOf(job)]), schedule, status })}
                    onPress={() => setOpenId(job.id)}
                    action={action}
                    last={i === jobs.length - 1}
                  />
                );
              })}
            </Group>
          </View>
        ))}
        <View style={styles.footer}>
          {readOnlyText ? <Footnote>{readOnlyText}</Footnote> : null}
          <Footnote>{t('routines.footer')}</Footnote>
        </View>
      </>
    );
  })();

  return (
    <View style={[styles.flex, { backgroundColor: th.colors.bg }]}>
      <View style={[styles.header, { paddingTop: Platform.OS === 'ios' ? 12 : insets.top + 8, borderBottomColor: th.colors.border }, titlebarInset > 0 && { paddingLeft: titlebarInset }]}>
        {inner ? (
          <Pressable onPress={back} hitSlop={10} accessibilityRole="button" style={styles.headerSide} testID="routines-back">
            <Text style={[textStyle(th, 'headline'), { color: th.colors.accentText, fontWeight: '400' }]} numberOfLines={1}>
              {t('settings.screen.back')}
            </Text>
          </Pressable>
        ) : (
          <View style={styles.headerSide} />
        )}
        <Text style={[styles.headerTitle, textStyle(th, 'headline'), { color: th.colors.text }]} numberOfLines={1} accessibilityRole="header">
          {t('routines.title')}
        </Text>
        <Pressable onPress={close} hitSlop={10} accessibilityRole="button" style={[styles.headerSide, { alignItems: 'flex-end' }]} testID="routines-done">
          <Text style={[textStyle(th, 'headline'), { color: th.colors.accentText }]} numberOfLines={1}>
            {t('settings.screen.done')}
          </Text>
        </Pressable>
      </View>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        refreshControl={src && !inner ? <RefreshControl refreshing={refreshing} onRefresh={() => void refreshAll()} /> : undefined}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.column}>
          {!src ? (
            <Message title={t('routines.title')} body={t('routines.noConnection')} />
          ) : openItem && src.inbox ? (
            <ResultView
              key={openItem.id}
              api={src.inbox}
              srcKey={src.key}
              id={openItem.id}
              preview={openItem.preview}
              botName={botName}
              hasSchedule={(jobId) => !!list?.jobs.some((j) => j.id === jobId)}
              onUnread={onUnread}
              onContinue={continueInChat}
              onOpenSchedule={openSchedule}
            />
          ) : open && list ? (
            <RoutineDetail key={open.id} job={open} access={access} readOnlyText={readOnlyText} src={src} busy={busy === open.id} onAct={(a) => void act(open, a)} />
          ) : (
            <>
              <View style={styles.botLine}>
                <Text style={[styles.flex, textStyle(th, 'callout'), { color: th.colors.muted }]} numberOfLines={1}>
                  {t('routines.bot', { name: botName })}
                </Text>
                <Button label={t('routines.refresh')} onPress={() => void refreshAll()} loading={refreshing} variant="tertiary" size="small" testID="routines-refresh" />
              </View>
              {src.demo ? <Footnote>{t('routines.demo')}</Footnote> : null}
              <View style={styles.tabs}>
                <RoutineTabs
                  value={tab}
                  onChange={setTab}
                  unread={unread}
                  labels={{ group: t('routines.tabs.label'), inbox: t('routines.tabs.inbox'), inboxA11y: t('routines.tabs.inboxA11y', { count: unread }), schedules: t('routines.tabs.schedules') }}
                />
              </View>
              {tab === 'inbox' ? inboxContent : schedulesContent}
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

/** Row status: [running > paused > next run ('' when completed), last outcome]. */
function Message({ title, body, tone, testID, children }: { title: string; body: string; tone?: 'warning'; testID?: string; children?: ReactNode }) {
  const th = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: th.colors.surface, borderColor: th.colors.border, borderRadius: th.radii.card }]} testID={testID}>
      <Text style={[textStyle(th, 'headline'), { color: th.colors.text }]} accessibilityRole="header">
        {title}
      </Text>
      <Text style={[styles.cardBody, textStyle(th, 'body'), { color: tone === 'warning' ? th.colors.warning : th.colors.muted }]}>{body}</Text>
      {children ? <View style={styles.messageActions}>{children}</View> : null}
    </View>
  );
}

function EmptyState() {
  const th = useTheme();
  const t = useT();
  return (
    <View style={[styles.card, styles.empty, { backgroundColor: th.colors.surface, borderColor: th.colors.border, borderRadius: th.radii.card }]} testID="routines-empty">
      <View style={[styles.emptyMark, { backgroundColor: th.colors.accentSoft }]}>
        <RoutineGlyph kind="active" size={28} />
      </View>
      <Text style={[textStyle(th, 'headline'), { color: th.colors.text, textAlign: 'center' }]} accessibilityRole="header">
        {t('routines.empty.title')}
      </Text>
      <Text style={[styles.cardBody, textStyle(th, 'body'), { color: th.colors.muted, textAlign: 'center' }]}>{t('routines.empty.body')}</Text>
      <Text style={[styles.cardBody, textStyle(th, 'caption'), { color: th.colors.subtle, textAlign: 'center' }]}>{t('routines.empty.later')}</Text>
    </View>
  );
}

function RoutineDetail({ job, access, readOnlyText, src, busy, onAct }: { job: RoutineJob; access: 'control' | 'read'; readOnlyText: string | null; src: RoutinesSource; busy: boolean; onAct(a: JobAction): void }) {
  const th = useTheme();
  const t = useT();
  const { locale, formatDate, formatRelative } = useLocale();
  const controls = controlsFor(job, access);
  const group = groupOf(job);
  const glyph: GlyphKind = isRunning(job) ? 'running' : group;
  const clock = serverClock(job);
  const abs = (iso: string | undefined): string | null => {
    const n = iso ? Date.parse(iso) : NaN;
    return Number.isFinite(n) ? `${formatDate(n, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} (${formatRelative(n)})` : null;
  };
  const next = isPaused(job) || job.state === 'completed' ? null : abs(job.nextRunAt);
  const lastAt = abs(job.lastRunAt);
  const outcome = lastOutcome(job);
  const deliver = (() => {
    const k = job.deliverKind;
    if (!k) return t('routines.deliver.unknown');
    if (k === 'local') return t('routines.deliver.local');
    if (k === 'origin') return t('routines.deliver.origin');
    if (k === 'bot-chat') return t('routines.deliver.botChat');
    return t('routines.deliver.targets', { targets: k.split(',').map((x) => (x === 'local' ? t('routines.deliver.local') : x === 'origin' ? t('routines.deliver.origin') : platformName(x))).join(', ') });
  })();
  const status = isRunning(job) ? t('routines.row.running') : t(GROUP_KEYS[group]);

  const [result, setResult] = useState<{ kind: 'idle' } | { kind: 'loading' } | { kind: 'done'; r: LastResult | null } | { kind: 'error'; message: string }>({ kind: 'idle' });
  const showResult = useCallback(async () => {
    setResult({ kind: 'loading' });
    try {
      setResult({ kind: 'done', r: await src.lastResult(job.id) });
    } catch (e) {
      setResult({ kind: 'error', message: describeError(e, t) });
    }
  }, [src, job.id, t]);

  return (
    <View>
      <View style={styles.detailHead} accessible accessibilityLabel={`${job.name}, ${status}`}>
        <RoutineGlyph kind={glyph} size={24} />
        <View style={styles.flex}>
          <Text style={[textStyle(th, 'title'), { color: th.colors.text }]} selectable>
            {job.name}
          </Text>
          <Text style={[textStyle(th, 'callout'), { color: group === 'attention' ? th.colors.warning : th.colors.muted }]}>{status}</Text>
        </View>
      </View>

      {controls.pause || controls.resume || controls.run ? (
        <View style={styles.actions}>
          {controls.pause ? <Button label={t('routines.actions.pause')} onPress={() => onAct('pause')} loading={busy} variant="secondary" grow testID="routine-pause" /> : null}
          {controls.resume ? <Button label={t('routines.actions.resume')} onPress={() => onAct('resume')} loading={busy} variant="secondary" grow testID="routine-resume" /> : null}
          {controls.run ? (
            <Button label={t(controls.runResumes ? 'routines.actions.runResume' : 'routines.actions.run')} onPress={() => onAct('run')} disabled={busy} variant="primary" icon="play" grow numberOfLines={2} testID="routine-run" />
          ) : null}
        </View>
      ) : access === 'read' && readOnlyText ? (
        <Footnote>{readOnlyText}</Footnote>
      ) : (
        <Footnote>{t('routines.detail.noControls')}</Footnote>
      )}

      <SectionTitle>{t('routines.detail.plan')}</SectionTitle>
      <View style={styles.groupGap} />
      <Group>
        <InfoRow label={t('routines.detail.when')} value={describeSchedule(job.schedule, { t, locale })} />
        <InfoRow
          label={t('routines.detail.zone')}
          value={clock.offsetMinutes === null ? t('routines.zone.unknown') : t('routines.zone.server', { offset: offsetLabel(clock.offsetMinutes) })}
        />
        {next ? <InfoRow label={t('routines.detail.next')} value={next} /> : null}
        {job.repeat && job.repeat.times ? <InfoRow label={t('routines.detail.repeat')} value={t('routines.detail.repeatValue', { completed: job.repeat.completed, times: job.repeat.times })} last /> : null}
      </Group>
      <Footnote>{clock.differsFromDevice ? `${t('routines.zone.differs')} ${t('routines.zone.note')}` : t('routines.zone.note')}</Footnote>

      <SectionTitle>{t('routines.detail.task')}</SectionTitle>
      <View style={styles.groupGap} />
      <Group>
        <View style={styles.task}>
          <Text style={[textStyle(th, 'body'), { color: job.prompt ? th.colors.text : th.colors.muted }]} selectable>
            {job.prompt || (job.noAgent ? t('routines.detail.script') : t('routines.detail.noTask'))}
          </Text>
        </View>
      </Group>

      <SectionTitle>{t('routines.detail.lastRun')}</SectionTitle>
      <View style={styles.groupGap} />
      <Group>
        <InfoRow label={t('routines.detail.status')} value={t(OUTCOME_KEYS[outcome])} tone={outcome === 'failed' || outcome === 'blocked' || outcome === 'deliveryFailed' ? 'warning' : undefined} last={!lastAt && !job.lastError && !job.lastDeliveryError} />
        {lastAt ? <InfoRow label={t('routines.detail.ranAt')} value={lastAt} last={!job.lastError && !job.lastDeliveryError} /> : null}
        {job.lastError ? <InfoRow label={t('routines.detail.error')} value={job.lastError} tone="warning" selectable last={!job.lastDeliveryError} /> : null}
        {job.lastDeliveryError ? <InfoRow label={t('routines.detail.deliveryError')} value={job.lastDeliveryError} tone="warning" selectable last /> : null}
      </Group>

      <SectionTitle>{t('routines.result.title')}</SectionTitle>
      <View style={styles.groupGap} />
      {result.kind === 'idle' ? (
        <Button label={t('routines.result.show')} onPress={() => void showResult()} variant="secondary" testID="routine-result" />
      ) : result.kind === 'loading' ? (
        <View accessible accessibilityLabel={t('routines.result.loading')} style={[styles.card, { backgroundColor: th.colors.surface, borderColor: th.colors.border, borderRadius: th.radii.card }]}>
          <SkeletonLines lines={4} />
        </View>
      ) : result.kind === 'error' ? (
        <Message title={t('routines.result.title')} body={t('routines.result.failed', { message: result.message })} tone="warning" />
      ) : result.r ? (
        <>
          <View style={[styles.card, { backgroundColor: th.colors.surface, borderColor: th.colors.border, borderRadius: th.radii.card }]}>
            <Markdown text={result.r.text} />
          </View>
          <Footnote>{t('routines.result.note', { when: result.r.at ? formatDate(result.r.at) : '' })}</Footnote>
        </>
      ) : (
        <Footnote>{t('routines.result.none')}</Footnote>
      )}

      <SectionTitle>{t('routines.detail.about')}</SectionTitle>
      <View style={styles.groupGap} />
      <Group>
        <InfoRow label={t('routines.detail.delivery')} value={deliver} />
        <InfoRow label={t('routines.detail.model')} value={job.model ?? t('routines.detail.modelDefault')} />
        {job.skills.length ? <InfoRow label={t('routines.detail.skills')} value={job.skills.join(', ')} /> : null}
        {job.createdAt && abs(job.createdAt) ? <InfoRow label={t('routines.detail.created')} value={formatDate(Date.parse(job.createdAt))} /> : null}
        <InfoRow label={t('routines.detail.origin')} value={job.originPlatform ? platformName(job.originPlatform) : t('routines.deliver.unknown')} last />
      </Group>
      <Footnote>{t('routines.detail.outside')}</Footnote>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  headerSide: { minWidth: 76 },
  headerTitle: { flex: 1, textAlign: 'center' },
  content: { paddingHorizontal: 16, paddingTop: 8 },
  column: { width: '100%', maxWidth: 720, alignSelf: 'center', gap: 6 },
  tabs: { marginTop: 6, marginBottom: 2 },
  botLine: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, marginLeft: 14 },
  groupGap: { height: 2 },
  card: { borderWidth: StyleSheet.hairlineWidth, padding: 16, marginTop: 8 },
  cardBody: { marginTop: 6 },
  messageActions: { marginTop: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  empty: { alignItems: 'center', paddingVertical: 28, paddingHorizontal: 20 },
  emptyMark: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  gap: { gap: 12 },
  footer: { marginTop: 10, gap: 4 },
  detailHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginTop: 12, marginHorizontal: 4 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 14, marginBottom: 4 },
  task: { paddingHorizontal: 14, paddingVertical: 12 },
});
