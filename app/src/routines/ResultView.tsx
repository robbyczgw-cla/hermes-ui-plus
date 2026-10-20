// Routines result view: one run's full answer, drawn by the chat's own answer renderer (markdown + hui cards, copy /
// share / read aloud), with a safe action host: nothing is sent from here (inboxActions.ts). Opening it marks the
// result read. "Continue in chat" seeds a new chat (RoutinesScreen does that); nothing is sent automatically.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../ui/primitives/Text';
import { Button, textStyle, useTheme } from '../ui';
import { SkeletonLines } from '../ui/primitives/Skeleton';
import { useLocale, useT } from '../i18n';
import { useToast } from '../chat/Toast';
import { Icon } from '../chat/icons';
import { AssistantMessage, type ActionHandler } from '../chat/MessageItem';
import { useActionRunner } from '../actions';
import { describeError } from '../hermes/stream';
import type { ChatMessage } from '../hermes/types';
import { Footnote, Group, SectionTitle } from '../settings/ui';
import { inboxOutcome, type InboxApi, type InboxItem, type InboxSummary } from './inbox';
import { inboxActionDecision } from './inboxActions';
import { routinesErrorKind } from './rights';
import { InfoRow, RoutineGlyph, outcomeGlyph } from './RoutineParts';
import { inboxStatusKey, patchCachedRead } from './InboxView';

type State = { kind: 'loading' } | { kind: 'ready'; item: InboxItem } | { kind: 'error'; message: string; gone: boolean };

const noop = () => {};

export function ResultView({
  api,
  srcKey,
  id,
  preview,
  botName,
  hasSchedule,
  onUnread,
  onContinue,
  onOpenSchedule,
}: {
  api: InboxApi;
  srcKey: string;
  id: string;
  /** the list's summary: header at once while the full item loads */
  preview?: InboxSummary;
  botName: string;
  /** the Routine is still in the schedules list ("View schedule") */
  hasSchedule(jobId: string): boolean;
  onUnread(n: number): void;
  onContinue(item: InboxItem): void;
  onOpenSchedule(jobId: string): void;
}) {
  const th = useTheme();
  const t = useT();
  const { formatDate, formatRelative } = useLocale();
  const toast = useToast();
  const run = useActionRunner();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [reload, setReload] = useState(0);
  const [read, setRead] = useState<boolean | null>(null);

  useEffect(() => {
    let live = true;
    api.get(id).then(
      (item) => {
        if (!live) return;
        setState({ kind: 'ready', item });
        setRead(true);
        if (item.read) return;
        // opened = read (owner-wide on the bridge); a refusal (read-only device) leaves it unread without a fuss
        patchCachedRead(srcKey, id, true);
        api.setRead(id, true).then(
          (r) => onUnread(r.unreadCount),
          () => {
            patchCachedRead(srcKey, id, false);
            if (live) setRead(false);
          },
        );
      },
      (e: unknown) => {
        if (live) setState({ kind: 'error', message: describeError(e, t), gone: routinesErrorKind(e) === 'notFound' });
      },
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per item (and on retry)
  }, [api, id, reload]);

  const markUnread = useCallback(async () => {
    try {
      const r = await api.setRead(id, false);
      patchCachedRead(srcKey, id, false);
      setRead(false);
      onUnread(r.unreadCount);
      toast(t('routines.run.markedUnread'));
    } catch (e) {
      const kind = routinesErrorKind(e);
      toast(kind === 'readOnly' ? t('routines.errors.readOnly') : t('routines.errors.action', { message: describeError(e, t) }));
    }
  }, [api, id, srcKey, onUnread, toast, t]);

  // safe action host: device actions through the app's runner (validated, confirmed); sending is not possible here
  const onAction = useCallback<ActionHandler>(
    (action) => {
      const d = inboxActionDecision(action);
      if (d.kind === 'run') {
        void run(d.action);
        return true;
      }
      if (d.kind === 'needsChat') toast(t('routines.run.actionNeedsChat'));
      return false;
    },
    [run, toast, t],
  );

  const item = state.kind === 'ready' ? state.item : null;
  const head = item ?? preview;
  const message = useMemo<ChatMessage | null>(() => {
    if (!item || !item.text.trim()) return null;
    const at = Date.parse(item.finishedAt);
    return { id: item.id, role: 'assistant', text: item.text, tools: [], status: 'done', createdAt: Number.isFinite(at) ? at : item.createdAt, finishReason: 'stop' };
  }, [item]);

  const at = head ? Date.parse(head.finishedAt) : NaN;
  const ranAt = Number.isFinite(at) ? `${formatDate(at, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} (${formatRelative(at)})` : '';
  const outcome = head ? inboxOutcome(head) : 'ok';
  const status = head ? t(inboxStatusKey(head)) : '';
  const warn = outcome === 'failed' || outcome === 'blocked' || outcome === 'deliveryFailed';

  return (
    <View>
      {head ? (
        <View style={styles.head} accessible accessibilityLabel={`${head.title}, ${status}`}>
          <RoutineGlyph kind={outcomeGlyph(outcome)} size={24} />
          <View style={styles.flex}>
            <Text style={[textStyle(th, 'title'), { color: th.colors.text }]} selectable>
              {head.title}
            </Text>
            <Text style={[textStyle(th, 'callout'), { color: warn ? th.colors.warning : th.colors.muted }]}>{status}</Text>
          </View>
        </View>
      ) : null}

      {item ? (
        <View style={styles.actions}>
          <Button label={t('routines.continue.action')} accessibilityHint={t('routines.continue.hint')} onPress={() => onContinue(item)} variant="primary" icon={(color, size) => <Icon name="branch" size={size} color={color} />} grow numberOfLines={2} testID="routine-continue" />
          {hasSchedule(item.jobId) ? <Button label={t('routines.run.openSchedule')} onPress={() => onOpenSchedule(item.jobId)} variant="secondary" grow numberOfLines={2} testID="routine-open-schedule" /> : null}
        </View>
      ) : null}

      {head ? (
        <>
          <View style={styles.groupGap} />
          <Group>
            <InfoRow label={t('routines.run.ranAt')} value={ranAt || '–'} />
            <InfoRow label={t('routines.run.bot')} value={botName} />
            <InfoRow label={t('routines.run.status')} value={status} tone={warn ? 'warning' : undefined} last={!item?.error} />
            {item?.error ? <InfoRow label={t('routines.run.error')} value={item.error} tone="warning" selectable last /> : null}
          </Group>
        </>
      ) : null}

      <SectionTitle>{t('routines.run.result')}</SectionTitle>
      <View style={styles.groupGap} />
      {state.kind === 'loading' ? (
        <View accessible accessibilityLabel={t('routines.run.loading')} style={[styles.card, { backgroundColor: th.colors.surface, borderColor: th.colors.border, borderRadius: th.radii.card }]}>
          <SkeletonLines lines={5} />
        </View>
      ) : state.kind === 'error' ? (
        <View style={styles.gap}>
          <Text style={[textStyle(th, 'body'), styles.pad, { color: th.colors.warning }]}>{state.gone ? t('routines.run.notFound') : t('routines.run.loadFailed', { message: state.message })}</Text>
          {state.gone ? null : <Button
              label={t('actions.retry')}
              onPress={() => {
                setState({ kind: 'loading' });
                setReload((n) => n + 1);
              }}
              variant="secondary"
            />}
        </View>
      ) : message ? (
        <View style={styles.answer} testID="routine-result-body">
          <AssistantMessage message={message} isLast={false} onAction={onAction} onRetry={noop} voiceConn={null} />
        </View>
      ) : (
        <Text style={[textStyle(th, 'body'), styles.pad, { color: th.colors.muted }]}>{t('routines.run.noText')}</Text>
      )}

      {item ? (
        <View style={styles.footer}>
          {item.truncated ? <Footnote>{t('routines.run.truncated')}</Footnote> : null}
          {item.hasRich ? <Footnote>{t('routines.run.note')}</Footnote> : null}
          {read ? <Button label={t('routines.run.markUnread')} onPress={() => void markUnread()} variant="tertiary" size="small" testID="routine-mark-unread" /> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginTop: 12, marginHorizontal: 4 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 14, marginBottom: 4 },
  groupGap: { height: 8 },
  card: { borderWidth: StyleSheet.hairlineWidth, padding: 16, marginTop: 8 },
  answer: { marginTop: 4, paddingHorizontal: 4 },
  gap: { gap: 12 },
  pad: { marginHorizontal: 14, marginTop: 4 },
  footer: { marginTop: 10, gap: 6, alignItems: 'flex-start' },
});
