// Routines inbox tab: results of the bot's scheduled runs, newest first. Filter all / unread, "mark all as read",
// paging with the bridge's cursor. Cards show a bounded preview only; the full answer mounts in the result view.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../ui/primitives/Text';
import { Button, textStyle, useTheme } from '../ui';
import { SkeletonLines } from '../ui/primitives/Skeleton';
import { a11yState } from '../ui/lib/a11yState';
import { useLocale, useT, type TKey } from '../i18n';
import { useToast } from '../chat/Toast';
import { describeError } from '../hermes/stream';
import { Footnote, Group } from '../settings/ui';
import { appendPage, inboxOutcome, withAllRead, type InboxApi, type InboxFilter, type InboxOutcome, type InboxPage, type InboxSummary } from './inbox';
import { routinesErrorKind, type RoutinesCapabilities } from './rights';
import { InboxCard } from './RoutineParts';

const PAGE = 30;

const STATUS_KEYS: Record<InboxOutcome, TKey> = {
  ok: 'routines.inbox.status.ok',
  failed: 'routines.inbox.status.failed',
  blocked: 'routines.inbox.status.blocked',
  silent: 'routines.inbox.status.silent',
  deliveryFailed: 'routines.inbox.status.deliveryFailed',
};
export const inboxStatusKey = (s: Pick<InboxSummary, 'status' | 'deliveryFailed'>): TKey => STATUS_KEYS[inboxOutcome(s)];

/** last page per bot + filter: the list is there at once when coming back from a result (refreshed behind it) */
const pageCache = new Map<string, InboxPage>();

/** Optimistic read flag in the cached pages of a bot (result view opened / marked unread). */
export function patchCachedRead(srcKey: string, id: string, read: boolean): void {
  for (const [k, page] of pageCache) {
    if (!k.startsWith(`${srcKey}|`)) continue;
    pageCache.set(k, { ...page, items: page.items.map((i) => (i.id === id ? { ...i, read } : i)) });
  }
}

type State = { kind: 'loading' } | { kind: 'ready'; page: InboxPage } | { kind: 'error'; message: string };

export function InboxView({
  api,
  srcKey,
  caps,
  demo,
  reloadKey,
  onOpen,
  onUnread,
}: {
  api: InboxApi;
  srcKey: string;
  caps: RoutinesCapabilities;
  demo: boolean;
  /** bumped by the screen (pull to refresh, live `hui.routine` event) */
  reloadKey: number;
  onOpen(item: InboxSummary): void;
  onUnread(n: number): void;
}) {
  const th = useTheme();
  const t = useT();
  const { formatDate, formatRelative } = useLocale();
  const toast = useToast();
  const [filter, setFilter] = useState<InboxFilter>('all');
  const cacheKey = `${srcKey}|${filter}`;
  const [state, setState] = useState<State>(() => {
    const hit = pageCache.get(cacheKey);
    return hit ? { kind: 'ready', page: hit } : { kind: 'loading' };
  });
  const [more, setMore] = useState(false);
  const [marking, setMarking] = useState(false);
  const req = useRef(0);

  const load = useCallback(async () => {
    const r = ++req.current;
    try {
      const page = await api.list({ filter, limit: PAGE });
      if (r !== req.current) return;
      pageCache.set(cacheKey, page);
      setState({ kind: 'ready', page });
      onUnread(page.unreadCount);
    } catch (e) {
      if (r !== req.current) return;
      setState((cur) => (cur.kind === 'ready' ? cur : { kind: 'error', message: describeError(e, t) }));
    }
  }, [api, filter, cacheKey, onUnread, t]);

  useEffect(() => {
    const hit = pageCache.get(cacheKey);
    setState(hit ? { kind: 'ready', page: hit } : { kind: 'loading' });
    void load();
    // reloadKey: refresh on demand
  }, [cacheKey, load, reloadKey]);

  const loadMore = useCallback(async () => {
    if (state.kind !== 'ready' || !state.page.nextCursor || more) return;
    setMore(true);
    const r = req.current;
    try {
      const next = await api.list({ filter, limit: PAGE, before: state.page.nextCursor });
      if (r !== req.current) return;
      setState((cur) => {
        if (cur.kind !== 'ready') return cur;
        const page = appendPage(cur.page, next);
        pageCache.set(cacheKey, page);
        return { kind: 'ready', page };
      });
      onUnread(next.unreadCount);
    } catch (e) {
      toast(t('routines.inbox.loadFailed', { message: describeError(e, t) }));
    } finally {
      setMore(false);
    }
  }, [state, more, api, filter, cacheKey, onUnread, toast, t]);

  const markAll = useCallback(async () => {
    if (marking) return;
    setMarking(true);
    try {
      const r = await api.readAll();
      setState((cur) => {
        if (cur.kind !== 'ready') return cur;
        const page = filter === 'unread' ? { items: [], unreadCount: 0, nextCursor: null } : withAllRead(cur.page);
        pageCache.set(cacheKey, page);
        return { kind: 'ready', page };
      });
      onUnread(r.unreadCount);
      toast(t('routines.inbox.markedAllRead'));
    } catch (e) {
      const kind = routinesErrorKind(e);
      toast(kind === 'readOnly' ? t('routines.errors.readOnly') : kind === 'forbidden' ? t('routines.errors.forbidden') : t('routines.errors.action', { message: describeError(e, t) }));
    } finally {
      setMarking(false);
    }
  }, [marking, api, filter, cacheKey, onUnread, toast, t]);

  const unread = state.kind === 'ready' ? state.page.unreadCount : 0;
  const filters: { v: InboxFilter; label: string }[] = [
    { v: 'all', label: t('routines.inbox.filterAll') },
    { v: 'unread', label: t('routines.inbox.filterUnread') },
  ];

  return (
    <View style={styles.wrap}>
      <View style={styles.toolbar}>
        <View style={styles.filters} accessibilityRole="radiogroup" accessibilityLabel={t('routines.inbox.filterLabel')}>
          {filters.map((f) => {
            const sel = f.v === filter;
            return (
              <Pressable
                key={f.v}
                onPress={() => setFilter(f.v)}
                accessibilityRole="radio"
                {...a11yState({ checked: sel, selected: sel })}
                testID={`routines-filter-${f.v}`}
                style={({ pressed }) => [styles.chip, { backgroundColor: sel ? th.colors.accentSoft : th.colors.surfaceAlt, borderRadius: th.radii.inline, opacity: pressed ? 0.7 : 1 }]}
              >
                <Text style={[textStyle(th, 'caption'), { color: sel ? th.colors.accentText : th.colors.text, fontWeight: sel ? '600' : '400' }]} numberOfLines={1}>
                  {f.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {unread > 0 ? <Button label={t('routines.inbox.markAllRead')} onPress={() => void markAll()} loading={marking} variant="tertiary" size="small" testID="routines-read-all" /> : null}
      </View>

      {state.kind === 'loading' ? (
        <View accessible accessibilityLabel={t('routines.inbox.loading')} style={[styles.card, { backgroundColor: th.colors.surface, borderColor: th.colors.border, borderRadius: th.radii.card }]}>
          <SkeletonLines lines={4} />
        </View>
      ) : state.kind === 'error' ? (
        <View style={styles.gap}>
          <Text style={[textStyle(th, 'body'), styles.pad, { color: th.colors.warning }]}>{t('routines.inbox.loadFailed', { message: state.message })}</Text>
          <Button label={t('actions.retry')} onPress={() => void load()} variant="secondary" />
        </View>
      ) : state.page.items.length === 0 ? (
        filter === 'unread' ? (
          <Text style={[textStyle(th, 'body'), styles.pad, { color: th.colors.muted }]} testID="routines-inbox-empty">
            {t('routines.inbox.emptyUnread')}
          </Text>
        ) : (
          <View style={[styles.card, { backgroundColor: th.colors.surface, borderColor: th.colors.border, borderRadius: th.radii.card }]} testID="routines-inbox-empty">
            <Text style={[textStyle(th, 'headline'), { color: th.colors.text }]} accessibilityRole="header">
              {t('routines.inbox.emptyTitle')}
            </Text>
            <Text style={[styles.cardBody, textStyle(th, 'body'), { color: th.colors.muted }]}>{t('routines.inbox.emptyBody')}</Text>
          </View>
        )
      ) : (
        <>
          <Group>
            {state.page.items.map((item, i) => {
              const at = Date.parse(item.finishedAt);
              const when = Number.isFinite(at) ? formatRelative(at) : '';
              const abs = Number.isFinite(at) ? formatDate(at, { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' }) : '';
              const status = t(inboxStatusKey(item));
              const summary = item.summary || (item.status === 'failed' ? '' : t('routines.inbox.noSummary'));
              const label = t('routines.inbox.cardA11y', { title: item.title, status, when: abs || when, summary: item.summary });
              return (
                <InboxCard
                  key={item.id}
                  testID={`routines-item-${item.id}`}
                  title={item.title}
                  when={when}
                  status={status}
                  outcome={inboxOutcome(item)}
                  summary={summary}
                  unread={!item.read}
                  a11yLabel={item.read ? label : `${t('routines.inbox.unread')}. ${label}`}
                  onPress={() => onOpen(item)}
                  last={i === state.page.items.length - 1}
                />
              );
            })}
          </Group>
          {state.page.nextCursor ? <Button label={t('routines.inbox.more')} onPress={() => void loadMore()} loading={more} variant="secondary" testID="routines-inbox-more" /> : null}
        </>
      )}
      <View style={styles.footer}>
        {demo ? <Footnote>{t('routines.inbox.demo')}</Footnote> : null}
        {!caps.inbox.durable && !demo ? <Footnote>{t('routines.inbox.memoryOnly')}</Footnote> : null}
        {caps.inbox.retentionDays ? <Footnote>{t('routines.inbox.retention', { days: caps.inbox.retentionDays })}</Footnote> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  toolbar: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 6, minHeight: 36 },
  filters: { flex: 1, flexDirection: 'row', gap: 6, marginLeft: 4 },
  chip: { paddingHorizontal: 12, paddingVertical: 7 },
  card: { borderWidth: StyleSheet.hairlineWidth, padding: 16 },
  cardBody: { marginTop: 6 },
  gap: { gap: 12 },
  pad: { marginHorizontal: 14, marginTop: 4 },
  footer: { marginTop: 6, gap: 4 },
});
