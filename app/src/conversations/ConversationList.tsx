/**
 * ConversationList – the content of the drawer (usable on its own as a screen): search field,
 * "New chat", grouped list (pinned / today / yesterday / last 7 days / older), long-press or
 * "⋯" actions (rename, pin, archive, delete with confirm), selection mode for deleting / archiving many chats at once
 * ("Auswählen" / long press → ticks, filters, "Archivieren", "Löschen (n)" with warning + undo toast). Archived chats
 * (local only) sit in a collapsible "Archiv" section at the bottom; search still finds them.
 */
import { useSurfaceBackground } from '../desktop/chrome';
import { useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { BackHandler, Modal, Pressable, SectionList, StyleSheet, View } from 'react-native';
import { TextInput } from '../ui/primitives/Text';
import { noOutline, webNoTab } from '../ui/lib/webStyle';
import Animated, { FadeOut, ReduceMotion } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useT, type TFn, type TKey } from '../i18n';
import { Badge, Button, haptic, HText, Icon, useTheme } from '../ui';
import { Loader } from '../ui/loaders';
import { applyListFilter, EMPTY_SELECTION, selectableIds, selectionReducer } from './bulkDelete';
import { filterDrawer, shownInDrawer } from './drawerFilter';
import { useDrawerView } from './useDrawerView';
import { BulkDeleteDialog, SelectionBox, useRunningIds } from './BulkDeleteDialog';
import { useConversations } from './ConversationsProvider';
import { SelectionBottomBar, SelectionHeader, type SelectionFilters } from './SelectionBars';
import { localizePreview } from './messages';
import { displayTitle } from './title';
import { unreadStore } from '../background/noticeState';
import { GROUP_KEYS, groupConversations } from './group';
import { ConvIcon } from './icons';
import { type ConversationMeta, type ProfileKind, type SearchHit } from './types';
import { a11yState } from '../ui/lib/a11yState';

const KIND_KEYS: Record<ProfileKind, TKey> = {
  hermes: 'conversations.profileKind.hermes',
  demo: 'conversations.profileKind.demo',
};

/** badge text per backend (unknown kinds read as Hermes) */
function kindLabel(tr: TFn, kind: ProfileKind): string {
  return tr(KIND_KEYS[kind] ?? KIND_KEYS.hermes);
}

/** badge colour per non-Hermes backend */
const KIND_TONE: Record<ProfileKind, 'accent' | 'neutral' | 'success' | 'warning' | 'danger'> = {
  hermes: 'accent',
  demo: 'neutral',
};
import type { OlderSessions, RemoteActions } from './hermesSync';
import { useEscapeToClose } from '../ui/lib/useEscapeToClose';


export type ConversationListProps = {
  /** user picked a conversation (shell: switch profile if needed, setActiveId, close drawer) */
  onSelect: (meta: ConversationMeta) => void;
  /** "Neuer Chat" pressed (shell: create(activeProfile), setActiveId, close drawer) */
  onNewChat: () => void;
  /** a conversation was deleted (e.g. to leave it when it was the open one) */
  onDeleted?: (id: string) => void;
  activeId?: string;
  /** optional display name for a profile id, shown next to the badge */
  profileName?: (profileId: string) => string | undefined;
  /** apply safe-area insets (true inside the drawer) */
  safeArea?: boolean;
  /** shows an "Einstellungen" row at the bottom */
  onOpenSettings?: () => void;
  /**
   * Hermes session sync (`useHermesSessionSync(...).remote`): source badges (Telegram/CLI/App),
   * rename → PATCH title, delete → "Nur aus Liste entfernen" / "In Hermes löschen". Omit = local only.
   */
  remote?: RemoteActions;
  /**
   * older sessions on the server (`useHermesSessionSync(...).older`): loaded when the list is scrolled to its end, and
   * by the "Ältere Chats laden" row at the bottom. Omit = no paging.
   */
  older?: OlderSessions;
  /** bump to focus the search field (⌘/Ctrl+K) */
  searchFocus?: number;
  /** row above the search field (wide-screen sidebar: collapse button) */
  header?: ReactNode;
  /** chats were archived (e.g. to leave the open one) */
  onArchived?: (ids: string[]) => void;
};

type Dialog =
  | { kind: 'menu' | 'rename' | 'delete'; meta: ConversationMeta }
  | { kind: 'notice'; meta: ConversationMeta; text: string }
  | null;

export function ConversationList({ onSelect, onNewChat, onDeleted, activeId, profileName, safeArea = true, onOpenSettings, remote, older, searchFocus, header, onArchived }: ConversationListProps) {
  const t = useTheme();
  const tr = useT();
  const api = useConversations();
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<SearchHit[]>([]);
  const [now] = useState(() => Date.now());
  const [dialog, setDialog] = useState<Dialog>(null);
  const reqRef = useRef(0);
  const searchRef = useRef<TextInput>(null);
  useEffect(() => {
    if (!searchFocus) return;
    // after the drawer's slide-in started (a focus during the mount frame is dropped on web)
    const id = setTimeout(() => searchRef.current?.focus(), 60);
    return () => clearTimeout(id);
  }, [searchFocus]);
  // selection mode (bulk delete)
  const [sel, dispatchSel] = useReducer(selectionReducer, EMPTY_SELECTION);
  const [filters, setFilters] = useState<SelectionFilters>({ old: false, profile: false });
  const [bulkOpen, setBulkOpen] = useState(false);
  const running = useRunningIds();
  // what the drawer lists – list and search alike (drawerFilter.ts; the desktop menus use the same rule): this build's
  // kinds, Settings → Chat → "Chats" (chatScope.ts)
  const view = useDrawerView();

  // debounced async search (title + message text)
  const { search, list } = api;
  useEffect(() => {
    const q = query.trim();
    const req = ++reqRef.current;
    if (!q) return;
    const h = setTimeout(() => {
      void search(q).then((r) => {
        if (reqRef.current === req) setResult(r);
      });
    }, 180);
    return () => clearTimeout(h);
    // re-run when the list changes (rename/delete while searching)
  }, [query, search, list]);
  const rawHits = query.trim() ? result : null;
  // chats of kinds this build hides (flavor.ts) stay on disk but are neither listed nor found
  const filteredHits = useMemo(() => (rawHits ? rawHits.filter((h) => shownInDrawer(h.meta, view)) : rawHits), [rawHits, view]);
  const allVisible = useMemo(() => filterDrawer(api.list, view), [api.list, view]);
  // selection filters: "Älter als 7 Tage", "Nur dieses Profil" (= profile of the open chat)
  const activeProfileId = activeId ? api.get(activeId)?.profileId : undefined;
  const listFilter = useMemo(
    () => (sel.active ? { olderThanDays: filters.old ? 7 : undefined, profileId: filters.profile ? activeProfileId : undefined } : {}),
    [sel.active, filters, activeProfileId],
  );
  const visible = useMemo(() => applyListFilter(allVisible, listFilter, now), [allVisible, listFilter, now]);
  // "Archiv" (local only): out of the groups, in a collapsible section at the bottom
  const [archiveOpen, setArchiveOpen] = useState(false);
  const mainVisible = useMemo(() => visible.filter((c) => !c.archived), [visible]);
  const archivedVisible = useMemo(() => visible.filter((c) => c.archived), [visible]);
  const hits = useMemo(() => (filteredHits && sel.active ? filteredHits.filter((h) => applyListFilter([h.meta], listFilter, now).length) : filteredHits), [filteredHits, sel.active, listFilter, now]);
  const shown = useMemo(
    () => (hits ? hits.map((h) => h.meta) : archiveOpen ? [...mainVisible, ...archivedVisible] : mainVisible),
    [hits, mainVisible, archivedVisible, archiveOpen],
  );
  const selectable = useMemo(() => selectableIds(shown, (id) => running.has(id)), [shown, running]);
  const allSelected = selectable.length > 0 && selectable.every((id) => sel.selected.has(id));

  // ticks only for rows that are shown and not running (filter changed, deleted elsewhere, turn started)
  useEffect(() => {
    if (sel.active) dispatchSel({ type: 'retain', ids: shown.filter((c) => !running.has(c.id)).map((c) => c.id) });
  }, [sel.active, shown, running]);

  // Android back / drawer back gesture leaves selection mode first
  useEffect(() => {
    if (!sel.active) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      dispatchSel({ type: 'exit' });
      return true;
    });
    return () => sub.remove();
  }, [sel.active]);

  const toggle = (id: string) => {
    if (running.has(id)) return;
    haptic('selection');
    dispatchSel({ type: 'toggle', id });
  };
  const enterSelection = (id?: string) => {
    haptic('medium');
    dispatchSel({ type: 'enter', id: id && !running.has(id) ? id : undefined });
  };
  const selectedMetas = useMemo(() => api.list.filter((c) => sel.selected.has(c.id)), [api.list, sel.selected]);
  const allArchived = selectedMetas.length > 0 && selectedMetas.every((c) => c.archived);
  const archiveSelected = () => {
    const ids = selectedMetas.map((c) => c.id);
    if (!ids.length) return;
    haptic('light');
    api.archive(ids, !allArchived);
    dispatchSel({ type: 'exit' });
    if (!allArchived) onArchived?.(ids);
  };

  const sections = useMemo(() => {
    if (hits) return [{ key: 'search', title: hits.length ? tr('conversations.list.hits', { count: hits.length }) : '', archive: false, data: hits.map((h) => ({ meta: h.meta, snippet: h.snippet })) }];
    const groups = groupConversations(mainVisible, now).map((g) => ({ key: g.key as string, title: tr(GROUP_KEYS[g.key]), archive: false, data: g.items.map((meta) => ({ meta, snippet: undefined as string | undefined })) }));
    if (archivedVisible.length) {
      groups.push({ key: 'archive', title: '', archive: true, data: archiveOpen ? archivedVisible.map((meta) => ({ meta, snippet: undefined as string | undefined })) : [] });
    }
    return groups;
  }, [mainVisible, archivedVisible, archiveOpen, hits, now, tr]);

  const Wrapper = safeArea ? SafeAreaView : View;
  // macOS app: no own background inside the translucent sidebar (desktop/chrome.ts)
  const surfaceBg = useSurfaceBackground(t.colors.bg);
  const searching = query.trim().length > 0;
  // empty state: first line is the title, the rest a hint ("No chats yet.\nStart with “New chat”.")
  const [emptyTitle, ...emptyRest] = (searching ? tr('conversations.list.noHits') : tr('conversations.list.empty')).split('\n');
  const emptyBody = emptyRest.join(' ').trim();
  // older chats on the server: not while searching / selecting (the row would page for results nobody sees)
  const pager = older?.available && !hits && !sel.active ? older : undefined;
  const loadOlder = pager?.load;
  // scrolled to the end (also: the list is shorter than the drawer) → next page; a failed attempt waits for a tap
  const onEndReached = pager && !pager.loading && !pager.error ? loadOlder : undefined;

  return (
    <Wrapper style={[styles.root, { backgroundColor: surfaceBg }]} edges={['top', 'bottom']}>
      {header}
      <View style={styles.top}>
        <View style={[styles.search, { backgroundColor: t.colors.surfaceAlt, borderRadius: t.radii.control }]}>
          <ConvIcon name="search" size={16} color={t.colors.subtle} />
          <TextInput
            ref={searchRef}
            value={query}
            onChangeText={setQuery}
            placeholder={tr('conversations.list.search')}
            placeholderTextColor={t.colors.subtle}
            style={[t.typography.body, styles.input, { color: t.colors.text, fontFamily: t.fonts.sans }]}
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="none"
            accessibilityLabel={tr('conversations.list.search')}
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityRole="button" accessibilityLabel={tr('conversations.list.clearSearch')}>
              <Icon name="x" size={16} color={t.colors.subtle} />
            </Pressable>
          ) : null}
        </View>
        {sel.active ? (
          <SelectionHeader
            count={sel.selected.size}
            onDone={() => dispatchSel({ type: 'exit' })}
            filters={filters}
            onFilters={setFilters}
            profileFilter={!!activeProfileId}
          />
        ) : (
          <Animated.View exiting={FadeOut.duration(120).reduceMotion(ReduceMotion.System)} style={styles.topRow}>
            <Button label={tr('conversations.list.newChat')} icon="plus" variant="primary" grow onPress={onNewChat} />
            {allVisible.length ? (
              <Button label={tr('conversations.list.select')} icon={(color, size) => <ConvIcon name="select" size={size} color={color} />} accessibilityHint={tr('conversations.list.selectHint')} onPress={() => enterSelection()} />
            ) : null}
          </Animated.View>
        )}
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.meta.id}
        keyboardShouldPersistTaps="handled"
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ paddingBottom: 24 }}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.5}
        ListFooterComponent={pager ? <OlderRow loading={pager.loading} error={pager.error} onPress={pager.load} /> : null}
        renderSectionHeader={({ section }) =>
          section.archive ? (
            <ArchiveHeader count={archivedVisible.length} open={archiveOpen} onToggle={() => setArchiveOpen((o) => !o)} />
          ) : section.title ? (
            <HText variant="caption" weight="600" color="subtle" style={styles.sectionTitle}>
              {section.title}
            </HText>
          ) : null
        }
        renderItem={({ item }) => (
          <Row
            meta={item.meta}
            snippet={item.snippet}
            active={item.meta.id === activeId}
            profileName={profileName?.(item.meta.profileId)}
            source={remote?.sourceLabel(item.meta)}
            archivedBadge={!!hits && !!item.meta.archived}
            selecting={sel.active}
            selected={sel.selected.has(item.meta.id)}
            running={running.has(item.meta.id)}
            onPress={() => (sel.active ? toggle(item.meta.id) : onSelect(item.meta))}
            // the finger is down: start reading the transcript now, the tap lands ~100 ms later
            onPressIn={sel.active ? undefined : () => api.prefetch(item.meta.id)}
            onLongPress={() => (sel.active ? toggle(item.meta.id) : enterSelection(item.meta.id))}
            onMenu={() => setDialog({ kind: 'menu', meta: item.meta })}
          />
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <ConvIcon name="chat" size={28} color={t.colors.subtle} />
            <HText variant="heroCompact" align="center">
              {emptyTitle}
            </HText>
            {emptyBody ? (
              <HText variant="body" color="muted" align="center">
                {emptyBody}
              </HText>
            ) : null}
          </View>
        }
      />

      {sel.active ? (
        <SelectionBottomBar
          count={sel.selected.size}
          allSelected={allSelected}
          canSelectAll={selectable.length > 0}
          onSelectAll={() => dispatchSel({ type: 'selectAll', ids: selectable })}
          onSelectNone={() => dispatchSel({ type: 'clear' })}
          onDelete={() => setBulkOpen(true)}
          onArchive={archiveSelected}
          restore={allArchived}
        />
      ) : null}

      {bulkOpen ? (
        <BulkDeleteDialog
          mode="selection"
          candidates={selectedMetas}
          remote={remote}
          onCancel={() => setBulkOpen(false)}
          onDone={() => {
            setBulkOpen(false);
            dispatchSel({ type: 'exit' });
          }}
        />
      ) : null}

      {onOpenSettings && !sel.active ? (
        <Pressable
          onPress={onOpenSettings}
          testID="drawer-settings"
          accessibilityRole="button"
          accessibilityLabel={tr('conversations.list.settings')}
          style={({ pressed }) => [styles.footer, { borderTopColor: t.colors.border }, pressed && { backgroundColor: t.colors.surfacePressed }]}
        >
          <ConvIcon name="settings" size={18} color={t.colors.muted} />
          <HText variant="callout" color="muted">
            {tr('conversations.list.settings')}
          </HText>
        </Pressable>
      ) : null}

      <Dialogs
        dialog={dialog}
        close={() => setDialog(null)}
        setDialog={setDialog}
        onSelectMode={(m) => enterSelection(m.id)}
        onPin={(m) => api.pin(m.id)}
        onArchive={(m) => {
          api.archive(m.id, !m.archived);
          if (!m.archived) onArchived?.([m.id]);
        }}
        onRename={(m, title) => {
          api.rename(m.id, title);
          if (remote?.isSynced(m)) {
            remote.rename(m, title).catch((e: unknown) =>
              setDialog({ kind: 'notice', meta: m, text: tr('conversations.notice.renameLocalOnly', { message: e instanceof Error ? e.message : String(e) }) })
            );
          }
        }}
        synced={(m) => !!remote?.isSynced(m)}
        canDeleteRemote={(m) => !!remote?.canDeleteRemote(m)}
        onDelete={(m) => {
          // a synced chat removed only locally must not come back with the next sync
          if (remote?.isSynced(m)) api.hideRemote(m.id);
          else api.remove(m.id);
          onDeleted?.(m.id);
        }}
        onDeleteRemote={async (m) => {
          if (!remote) return tr('conversations.notice.noConnection');
          try {
            await remote.deleteRemote(m);
            onDeleted?.(m.id);
            return null;
          } catch (e) {
            return e instanceof Error ? e.message : String(e);
          }
        }}
      />
    </Wrapper>
  );
}

/** "Ältere Chats laden" at the end of the list (pages through older Hermes sessions, sessionPaging.ts) */
function OlderRow({ loading, error, onPress }: { loading: boolean; error?: string; onPress: () => void }) {
  const t = useTheme();
  const tr = useT();
  const label = loading ? tr('conversations.list.loadingOlder') : tr('conversations.list.loadOlder');
  return (
    <View style={styles.olderWrap}>
      <Pressable
        onPress={onPress}
        disabled={loading}
        accessibilityRole="button"
        accessibilityLabel={label}
        {...a11yState({ busy: loading, disabled: loading })}
        style={({ pressed }) => [styles.olderRow, { borderRadius: t.radii.pill, backgroundColor: pressed ? t.colors.surfacePressed : t.colors.surfaceAlt }]}
      >
        {loading ? <Loader kind="dots" size={16} /> : <ConvIcon name="chevronDown" size={16} color={t.colors.muted} />}
        <HText variant="callout" color="muted">
          {label}
        </HText>
      </Pressable>
      {error && !loading ? (
        <HText variant="caption" color="muted" align="center">
          {tr('conversations.list.olderFailed', { message: error })}
        </HText>
      ) : null}
    </View>
  );
}

function Row({
  meta,
  snippet,
  active,
  profileName,
  source,
  archivedBadge,
  selecting,
  selected,
  running,
  onPress,
  onPressIn,
  onLongPress,
  onMenu,
}: {
  meta: ConversationMeta;
  snippet?: string;
  active: boolean;
  profileName?: string;
  /** Hermes session source badge (Telegram / CLI / App) */
  source?: string;
  /** search hit of an archived chat: "Archiviert" badge */
  archivedBadge?: boolean;
  /** selection mode: tap toggles, a tick box replaces "⋯" */
  selecting?: boolean;
  selected?: boolean;
  /** a turn is running: cannot be ticked */
  running?: boolean;
  onPress: () => void;
  onPressIn?: () => void;
  onLongPress: () => void;
  onMenu: () => void;
}) {
  const t = useTheme();
  const tr = useT();
  const sub = localizePreview(snippet ?? meta.preview, tr);
  // "neue Antwort" until the chat is opened (background/noticeState); "läuft" while its turn streams
  const unreadSet = useSyncExternalStore(unreadStore.subscribe, unreadStore.get, unreadStore.get);
  const unread = !active && unreadSet.has(meta.id);
  // the "⋯" button is a sibling of the row button (nested <button>s are invalid on web)
  return (
    <View style={[styles.row, { backgroundColor: active ? t.colors.surfaceAlt : 'transparent', borderRadius: t.radii.control }]}>
      {selecting ? (
        <View style={styles.check} pointerEvents="none">
          <SelectionBox checked={!!selected} disabled={running} />
        </View>
      ) : null}
      <Pressable
        onPress={onPress}
        onPressIn={onPressIn}
        onLongPress={onLongPress}
        delayLongPress={350}
        disabled={selecting && running}
        accessibilityRole={selecting ? 'checkbox' : 'button'}
        {...a11yState(selecting ? { checked: !!selected, disabled: !!running } : undefined)}
        accessibilityLabel={tr('conversations.list.rowLabel', {
          title: displayTitle(meta.title, tr('conversations.list.newChat')),
          source: (source ?? kindLabel(tr, meta.profileKind)) + (meta.hermesProfile ? `, ${tr('bots.drawer.badgeA11y', { name: meta.hermesProfile })}` : ''),
        })}
        accessibilityHint={selecting ? (running ? tr('conversations.list.running') : tr('conversations.list.rowSelectHint')) : tr('conversations.list.rowHint')}
        style={({ pressed }) => [styles.rowMain, selecting && styles.rowMainSelecting, pressed && !active && { backgroundColor: t.colors.surfacePressed, borderRadius: t.radii.control }]}
      >
        <View style={styles.titleLine}>
          {meta.pinned ? <ConvIcon name="pin" size={13} color={t.colors.subtle} /> : null}
          <HText variant="bodyStrong" numberOfLines={1} style={styles.flex}>
            {displayTitle(meta.title, tr('conversations.list.newChat'))}
          </HText>
          {running ? (
            <View style={styles.liveTag} accessibilityLabel={tr('chat.background.running')}>
              <View style={[styles.liveDot, { backgroundColor: t.colors.accent }]} />
              <HText variant="micro" color="subtle">
                {tr('chat.background.running')}
              </HText>
            </View>
          ) : unread ? (
            <View style={[styles.liveDot, { backgroundColor: t.colors.accent }]} accessibilityLabel={tr('chat.background.unread')} />
          ) : null}
        </View>
        {sub ? (
          <HText variant="caption" color="muted" numberOfLines={1}>
            {sub}
          </HText>
        ) : null}
        <View style={styles.badges}>
          <Badge
            label={source ?? kindLabel(tr, meta.profileKind)}
            tone={meta.profileKind !== 'hermes' ? KIND_TONE[meta.profileKind] : source && meta.remote?.source !== 'api_server' ? 'success' : 'accent'}
          />
          {/* Hermes bot (profile) of the chat, only when not the default one (hermes/bots.ts) */}
          {meta.hermesProfile ? <Badge label={meta.hermesProfile} tone="neutral" /> : null}
          {archivedBadge ? <Badge label={tr('menus.archive.badge')} tone="neutral" /> : null}
          {profileName ? (
            <HText variant="micro" color="subtle" numberOfLines={1} style={styles.flex}>
              {profileName}
            </HText>
          ) : null}
        </View>
      </Pressable>
      {selecting ? null : (
        <Pressable onPress={onMenu} hitSlop={4} style={styles.more} accessibilityRole="button" accessibilityLabel={tr('conversations.list.moreActions')}>
          <ConvIcon name="more" size={18} color={t.colors.subtle} />
        </Pressable>
      )}
    </View>
  );
}

function Dialogs({
  dialog,
  close,
  setDialog,
  onSelectMode,
  onPin,
  onArchive,
  onRename,
  onDelete,
  synced,
  canDeleteRemote,
  onDeleteRemote,
}: {
  dialog: Dialog;
  close: () => void;
  setDialog: (d: Dialog) => void;
  /** "Auswählen": selection mode with this chat ticked */
  onSelectMode: (m: ConversationMeta) => void;
  onPin: (m: ConversationMeta) => void;
  /** "Archivieren" / "Aus dem Archiv holen" (local only) */
  onArchive: (m: ConversationMeta) => void;
  onRename: (m: ConversationMeta, title: string) => void;
  onDelete: (m: ConversationMeta) => void;
  synced: (m: ConversationMeta) => boolean;
  /** "In Hermes löschen" only for the app's own sessions */
  canDeleteRemote: (m: ConversationMeta) => boolean;
  /** resolves to an error text, or null on success */
  onDeleteRemote: (m: ConversationMeta) => Promise<string | null>;
}) {
  const t = useTheme();
  const tr = useT();
  const [busy, setBusy] = useState(false);
  useEscapeToClose(!!dialog, close); // web: Esc closes the menu / dialog before the drawer
  if (!dialog) return null;
  const m = dialog.meta;

  const item = (label: string, icon: 'edit' | 'pin' | 'trash' | 'select' | 'archive', onPress: () => void, danger = false) => (
    <Pressable
      key={label}
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.menuItem, { backgroundColor: pressed ? t.colors.surfacePressed : 'transparent' }]}
    >
      <ConvIcon name={icon} size={18} color={danger ? t.colors.danger : t.colors.text} />
      <HText variant="body" style={{ color: danger ? t.colors.danger : t.colors.text }}>
        {label}
      </HText>
    </Pressable>
  );

  return (
    <Modal transparent animationType="fade" visible onRequestClose={close} statusBarTranslucent>
      {/* backdrop button behind the dialog (sibling): a wrapping scrim merged the menu items into one VoiceOver "Close" element */}
      <View style={[styles.scrim, { backgroundColor: t.colors.overlay }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityRole="button" accessibilityLabel={tr('actions.close')} {...webNoTab} />
        <View
          onAccessibilityEscape={close}
          style={[styles.dialog, { backgroundColor: t.colors.surface, borderColor: t.colors.border, borderRadius: t.radii.card }, t.shadows.lg]}
        >
          {dialog.kind === 'menu' ? (
            <>
              <HText variant="headline" numberOfLines={1} style={styles.dialogTitle}>
                {displayTitle(m.title, tr('conversations.list.newChat'))}
              </HText>
              {item(tr('conversations.menu.rename'), 'edit', () => setDialog({ kind: 'rename', meta: m }))}
              {item(m.pinned ? tr('conversations.menu.unpin') : tr('conversations.menu.pin'), 'pin', () => {
                onPin(m);
                close();
              })}
              {item(m.archived ? tr('menus.chat.unarchive') : tr('menus.chat.archive'), 'archive', () => {
                onArchive(m);
                close();
              })}
              {item(tr('conversations.menu.select'), 'select', () => {
                onSelectMode(m);
                close();
              })}
              {item(tr('conversations.menu.delete'), 'trash', () => setDialog({ kind: 'delete', meta: m }), true)}
            </>
          ) : null}

          {dialog.kind === 'rename' ? (
            <RenameBody
              initial={m.title}
              onCancel={close}
              onSave={(title) => {
                onRename(m, title);
                close();
              }}
            />
          ) : null}

          {/* foreign sessions (Telegram/CLI/cron/other clients): only hidden locally – never deleted in Hermes */}
          {dialog.kind === 'delete' && synced(m) ? (
            <>
              <HText variant="headline" style={styles.dialogTitle}>
                {tr('conversations.delete.title')}
              </HText>
              <HText variant="callout" color="muted" style={styles.dialogBody}>
                {!canDeleteRemote(m)
                  ? tr('conversations.delete.fromSource', {
                      title: m.title,
                      source: tr(
                        m.remote?.source === 'telegram'
                          ? 'conversations.delete.sourceTelegram'
                          : m.remote?.source === 'cli'
                            ? 'conversations.delete.sourceCli'
                            : 'conversations.delete.sourceOther',
                      ),
                    })
                  : tr('conversations.delete.inHermes', { title: m.title, remoteAction: tr('conversations.delete.remoteAction') })}
              </HText>
              <View style={styles.btnCol}>
                <Button
                  label={tr('conversations.delete.removeLocal')}
                  numberOfLines={2}
                  disabled={busy}
                  onPress={() => {
                    onDelete(m);
                    close();
                  }}
                />
                {canDeleteRemote(m) ? (
                  <Button
                    label={busy ? tr('conversations.delete.remoteBusy') : tr('conversations.delete.remoteAction')}
                    variant="primary"
                    tone="seal"
                    numberOfLines={2}
                    disabled={busy}
                  onPress={() => {
                    setBusy(true);
                    void onDeleteRemote(m).then((err) => {
                      setBusy(false);
                      if (err) setDialog({ kind: 'notice', meta: m, text: tr('conversations.notice.deleteFailed', { message: err }) });
                      else close();
                    });
                  }}
                  />
                ) : null}
                <Button label={tr('actions.cancel')} variant="tertiary" onPress={close} disabled={busy} />
              </View>
            </>
          ) : null}

          {dialog.kind === 'notice' ? (
            <>
              <HText variant="headline" style={styles.dialogTitle}>
                Hermes
              </HText>
              <HText variant="callout" color="muted" style={styles.dialogBody}>
                {dialog.text}
              </HText>
              <View style={styles.btnRow}>
                <Button label={tr('actions.ok')} variant="primary" onPress={close} />
              </View>
            </>
          ) : null}

          {dialog.kind === 'delete' && !synced(m) ? (
            <>
              <HText variant="headline" style={styles.dialogTitle}>
                {tr('conversations.delete.title')}
              </HText>
              <HText variant="callout" color="muted" style={styles.dialogBody}>
                {tr('conversations.delete.localOnly', { title: m.title })}
              </HText>
              <View style={styles.btnRow}>
                <Button label={tr('actions.cancel')} variant="tertiary" onPress={close} />
                <Button
                  label={tr('actions.delete')}
                  variant="primary"
                  tone="seal"
                  onPress={() => {
                    onDelete(m);
                    close();
                  }}
                />
              </View>
            </>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

function RenameBody({ initial, onCancel, onSave }: { initial: string; onCancel: () => void; onSave: (title: string) => void }) {
  const t = useTheme();
  const tr = useT();
  const [draft, setDraft] = useState(initial);
  return (
    <>
      <HText variant="headline" style={styles.dialogTitle}>
        {tr('conversations.rename.title')}
      </HText>
      <TextInput
        value={draft}
        onChangeText={setDraft}
        autoFocus
        selectTextOnFocus
        maxLength={80}
        returnKeyType="done"
        onSubmitEditing={() => draft.trim() && onSave(draft)}
        style={[t.typography.body, styles.renameInput, { color: t.colors.text, borderColor: t.colors.borderControl, backgroundColor: t.colors.surfaceAlt, borderRadius: t.radii.control, fontFamily: t.fonts.sans }]}
        accessibilityLabel={tr('conversations.rename.field')}
      />
      <View style={styles.btnRow}>
        <Button label={tr('actions.cancel')} variant="tertiary" onPress={onCancel} />
        <Button label={tr('actions.save')} variant="primary" disabled={!draft.trim()} onPress={() => onSave(draft)} />
      </View>
    </>
  );
}

/** collapsible "Archiv (n)" section header at the bottom of the list */
function ArchiveHeader({ count, open, onToggle }: { count: number; open: boolean; onToggle: () => void }) {
  const t = useTheme();
  const tr = useT();
  return (
    <Pressable
      onPress={() => {
        haptic('selection');
        onToggle();
      }}
      accessibilityRole="button"
      {...a11yState({ expanded: open })}
      accessibilityLabel={tr('menus.archive.sectionA11y', { count })}
      accessibilityHint={open ? tr('menus.archive.collapseHint') : tr('menus.archive.expandHint')}
      style={({ pressed }) => [styles.archiveHead, { borderRadius: t.radii.control }, pressed && { backgroundColor: t.colors.surfacePressed }]}
    >
      <ConvIcon name="archive" size={16} color={t.colors.subtle} />
      <HText variant="caption" weight="600" color="subtle" style={styles.flex}>
        {`${tr('menus.archive.section')} (${count})`}
      </HText>
      <ConvIcon name={open ? 'chevronDown' : 'chevronRight'} size={15} color={t.colors.subtle} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  top: { paddingHorizontal: 12, paddingTop: 12, gap: 10 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, height: 40 },
  input: { flex: 1, paddingVertical: 0, height: 40, ...noOutline },
  topRow: { flexDirection: 'row', gap: 8 },
  check: { width: 40, alignItems: 'center', justifyContent: 'center', paddingLeft: 6 },
  rowMainSelecting: { paddingLeft: 4, paddingRight: 8 },
  sectionTitle: { paddingHorizontal: 18, paddingTop: 16, paddingBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'stretch', marginHorizontal: 6, paddingRight: 4, minHeight: 64 },
  rowMain: { flex: 1, gap: 2, paddingLeft: 12, paddingVertical: 8, justifyContent: 'center' },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveTag: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  badges: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  more: { width: 44, alignItems: 'center', justifyContent: 'center' },
  archiveHead: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, marginTop: 12, marginHorizontal: 6, paddingHorizontal: 12 },
  empty: { alignItems: 'center', gap: 10, paddingTop: 48, paddingHorizontal: 24 },
  olderWrap: { paddingHorizontal: 12, paddingTop: 8, gap: 6 },
  olderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 40, paddingVertical: 6, paddingHorizontal: 16 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, minHeight: 52, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth },
  scrim: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  dialog: { width: '100%', maxWidth: 340, paddingVertical: 8, borderWidth: StyleSheet.hairlineWidth },
  dialogTitle: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 8 },
  dialogBody: { paddingHorizontal: 18, paddingBottom: 12 },
  // text-holding rows: minHeight (not height) so a label wrapped by large system text grows the box
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, minHeight: 48, paddingVertical: 8 },
  renameInput: { marginHorizontal: 18, marginBottom: 14, paddingHorizontal: 12, height: 44, borderWidth: StyleSheet.hairlineWidth },
  btnRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingBottom: 10, justifyContent: 'flex-end' },
  btnCol: { gap: 8, paddingHorizontal: 14, paddingBottom: 10, alignItems: 'stretch' },
});
