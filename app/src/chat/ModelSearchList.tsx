/**
 * Searchable, virtualised model list (in-chat ModelPicker sheet + profile editor). Search field on
 * top (fuzzy over id/name/group, modelSearch.ts), favorites + recents first, sections per provider,
 * capability badges, star to pin. Web: ↑/↓ move the highlight, Enter picks, Esc closes.
 */
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Platform, Pressable, StyleSheet, Text, TextInput, View, type NativeSyntheticEvent, type TextInputKeyPressEventData } from 'react-native';
import { useT, type TKey } from '../i18n';
import { useTheme } from '../ui';
import { Icon, type IconName } from './icons';
import { buildRows, nextModelRow, type ModelBadge, type ModelEntry, type ModelPrefs, type ModelRow } from './modelSearch';

const HEADER_H = 32;
const ROW_H = 58;

const BADGE_ICON: Record<ModelBadge, IconName> = { vision: 'eye', tools: 'tool', reasoning: 'spark', web: 'globe', fast: 'bolt' };
const BADGE_KEY: Record<ModelBadge, TKey> = {
  vision: 'chat.modelPicker.badge.vision',
  tools: 'chat.modelPicker.badge.tools',
  reasoning: 'chat.modelPicker.badge.reasoning',
  web: 'chat.modelPicker.badge.web',
  fast: 'chat.modelPicker.badge.fast',
};

export type ModelSearchListProps = {
  entries: readonly ModelEntry[];
  /** id of the active choice (undefined = the "Standard" row) */
  selected: string | undefined;
  onPick(id: string | undefined): void;
  prefs: ModelPrefs;
  onToggleFavorite(id: string): void;
  loading?: boolean;
  error?: string | null;
  onRetry?(): void;
  /** fixed list height (virtualisation needs a bounded box) */
  height: number;
  autoFocus?: boolean;
  /** Esc on web */
  onEscape?(): void;
  /** offer "use <query>" when nothing matches (servers without a model list) */
  allowCustom?: boolean;
  /** search text to start with ("/model <name>" in the composer) */
  initialQuery?: string;
};

export function ModelSearchList({ entries, selected, onPick, prefs, onToggleFavorite, loading, error, onRetry, height, autoFocus, onEscape, allowCustom, initialQuery }: ModelSearchListProps) {
  const th = useTheme();
  const tr = useT();
  const [query, setQuery] = useState(initialQuery ?? '');
  const listRef = useRef<FlatList<ModelRow>>(null);
  const titles = useMemo(() => ({ favorites: tr('chat.modelPicker.favorites'), recents: tr('chat.modelPicker.recents'), other: tr('chat.modelPicker.other') }), [tr]);
  const rows = useMemo(() => buildRows(entries, query, prefs, titles), [entries, query, prefs, titles]);
  const offsets = useMemo(() => {
    const o: number[] = [];
    let y = 0;
    for (const r of rows) {
      o.push(y);
      y += r.type === 'header' ? HEADER_H : ROW_H;
    }
    return o;
  }, [rows]);

  // keyboard highlight (web): first selectable row for a new query, moved by ↑/↓ afterwards
  const [moved, setMoved] = useState<{ query: string; index: number } | null>(null);
  const hl = moved && moved.query === query ? moved.index : query.trim() ? nextModelRow(rows, -1, 1) : -1;

  const move = (dir: 1 | -1) => {
    const n = nextModelRow(rows, hl, dir);
    if (n >= 0 && n < rows.length) listRef.current?.scrollToIndex({ index: n, viewPosition: 0.5, animated: false });
    setMoved({ query, index: n });
  };

  const onKeyPress = (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
    const key = e.nativeEvent.key;
    const prevent = () => (e as unknown as { preventDefault?: () => void }).preventDefault?.();
    if (key === 'ArrowDown') {
      prevent();
      move(1);
    } else if (key === 'ArrowUp') {
      prevent();
      move(-1);
    } else if (key === 'Escape') {
      // handled here → the window Esc stack (sheet / settings underneath) must not close a layer too
      if (query) {
        prevent();
        setQuery('');
      } else if (onEscape) {
        prevent();
        onEscape();
      }
    }
  };

  const submit = () => {
    const r = hl >= 0 ? rows[hl] : rows.find((x) => x.type === 'model' && !x.entry.disabled);
    if (r?.type === 'model' && !r.entry.disabled) onPick(r.entry.id);
    else if (allowCustom && query.trim()) onPick(query.trim());
  };

  const realCount = entries.filter((e) => !e.pinned).length;
  const q = query.trim();
  const empty = q && rows.length === 0;

  const renderItem = useCallback(
    ({ item, index }: { item: ModelRow; index: number }) =>
      item.type === 'header' ? (
        <View style={[styles.header, { height: HEADER_H }]} accessibilityRole="header">
          <Text style={[styles.headerText, { color: th.colors.subtle }]} numberOfLines={1}>
            {item.title.toUpperCase()}
          </Text>
          {item.count !== undefined ? <Text style={[styles.headerCount, { color: th.colors.subtle }]}>{item.count}</Text> : null}
        </View>
      ) : (
        <ModelRowView
          entry={item.entry}
          favorite={item.favorite}
          active={(item.entry.id ?? undefined) === selected}
          highlighted={index === hl}
          onPick={onPick}
          onToggleFavorite={onToggleFavorite}
        />
      ),
    [th, selected, hl, onPick, onToggleFavorite]
  );

  return (
    <View>
      <View style={[styles.search, { backgroundColor: th.colors.surfaceAlt, borderRadius: th.radii.m }]}>
        <Icon name="search" size={17} color={th.colors.muted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={realCount > 0 ? tr('chat.modelPicker.searchCount', { count: realCount }) : tr('chat.modelPicker.search')}
          placeholderTextColor={th.colors.subtle}
          style={[styles.input, { color: th.colors.text }, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null]}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus={autoFocus}
          returnKeyType="done"
          onKeyPress={onKeyPress}
          onSubmitEditing={submit}
          blurOnSubmit={false}
          accessibilityLabel={tr('chat.modelPicker.search')}
        />
        {query ? (
          <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityRole="button" accessibilityLabel={tr('chat.modelPicker.clear')}>
            <Icon name="close" size={15} color={th.colors.muted} />
          </Pressable>
        ) : loading ? (
          <ActivityIndicator size="small" color={th.colors.muted} />
        ) : null}
      </View>
      {error ? (
        <View style={styles.state}>
          <Text style={[styles.stateText, { color: th.colors.danger }]} numberOfLines={3}>
            {tr('chat.modelPicker.loadFailedDetail', { error })}
          </Text>
          {onRetry ? (
            <Pressable onPress={onRetry} accessibilityRole="button" hitSlop={8}>
              <Text style={{ color: th.colors.accent, fontSize: 14, fontWeight: '600' }}>{tr('chat.modelPicker.retry')}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <FlatList
        ref={listRef}
        style={{ height }}
        data={rows}
        keyExtractor={(r) => r.key}
        renderItem={renderItem}
        getItemLayout={(_, index) => ({ length: rows[index]?.type === 'header' ? HEADER_H : ROW_H, offset: offsets[index] ?? 0, index })}
        initialNumToRender={14}
        maxToRenderPerBatch={20}
        windowSize={7}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onScrollToIndexFailed={() => {}}
        ListEmptyComponent={
          empty ? (
            <View style={styles.state}>
              <Text style={[styles.stateText, { color: th.colors.muted }]}>{tr('chat.modelPicker.noMatch', { query: q })}</Text>
              {allowCustom ? (
                <Pressable onPress={() => onPick(q)} accessibilityRole="button" hitSlop={8}>
                  <Text style={{ color: th.colors.accent, fontSize: 14, fontWeight: '600' }}>{tr('chat.modelPicker.useCustom', { model: q })}</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null
        }
        ListFooterComponent={
          !q && !error && realCount === 0 ? (
            <View style={styles.state}>
              {loading ? (
                <Text style={[styles.stateText, { color: th.colors.muted }]}>{tr('chat.modelPicker.loading')}</Text>
              ) : (
                <Text style={[styles.stateText, { color: th.colors.muted }]}>{tr('chat.modelPicker.noMore')}</Text>
              )}
            </View>
          ) : null
        }
      />
    </View>
  );
}

const ModelRowView = memo(function ModelRowView({
  entry,
  favorite,
  active,
  highlighted,
  onPick,
  onToggleFavorite,
}: {
  entry: ModelEntry;
  favorite: boolean;
  active: boolean;
  highlighted: boolean;
  onPick(id: string | undefined): void;
  onToggleFavorite(id: string): void;
}) {
  const th = useTheme();
  const tr = useT();
  const badges = entry.badges ?? [];
  const badgeText = badges.map((b) => tr(BADGE_KEY[b])).join(', ');
  return (
    <View style={[styles.rowWrap, { height: ROW_H }]}>
      <Pressable
        onPress={() => onPick(entry.id)}
        disabled={entry.disabled}
        accessibilityRole="button"
        accessibilityState={{ selected: active, disabled: !!entry.disabled }}
        accessibilityLabel={[tr('chat.modelPicker.option.a11y', { label: entry.label }), entry.detail, badgeText].filter(Boolean).join(', ')}
        style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
          styles.row,
          { borderRadius: th.radii.m, opacity: entry.disabled ? 0.45 : 1 },
          (pressed || active || highlighted || hovered) && { backgroundColor: active ? th.colors.surfaceAlt : th.colors.surfacePressed },
          highlighted && { borderWidth: 1, borderColor: th.colors.borderStrong },
        ]}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={styles.titleLine}>
            <Text style={[styles.rowTitle, { color: th.colors.text }]} numberOfLines={1}>
              {entry.label}
            </Text>
            {badges.map((b) => (
              <View key={b} style={styles.badge}>
                <Icon name={BADGE_ICON[b]} size={13} color={th.colors.muted} strokeWidth={1.8} />
              </View>
            ))}
          </View>
          {entry.detail ? (
            <Text style={[styles.rowDetail, { color: th.colors.muted }]} numberOfLines={1}>
              {entry.detail}
            </Text>
          ) : null}
        </View>
        {active ? <Icon name="check" size={18} color={th.colors.accent} strokeWidth={2.2} /> : null}
      </Pressable>
      {entry.id && !entry.pinned ? (
        <Pressable
          onPress={() => onToggleFavorite(entry.id as string)}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityState={{ checked: favorite }}
          accessibilityLabel={favorite ? tr('chat.modelPicker.unfavorite', { label: entry.label }) : tr('chat.modelPicker.favorite', { label: entry.label })}
          style={styles.star}
        >
          <Icon name={favorite ? 'starFilled' : 'star'} size={17} color={favorite ? th.colors.accent : th.colors.subtle} />
        </Pressable>
      ) : (
        <View style={styles.star} />
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, height: 42, marginHorizontal: 4, marginBottom: 6 },
  input: { flex: 1, fontSize: 15.5, paddingVertical: 0, height: 42 },
  header: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 12, paddingBottom: 6, gap: 6 },
  headerText: { fontSize: 11.5, fontWeight: '600', letterSpacing: 0.6, flexShrink: 1 },
  headerCount: { fontSize: 11.5 },
  rowWrap: { flexDirection: 'row', alignItems: 'center' },
  row: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, height: ROW_H - 4 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 5, minWidth: 0 },
  rowTitle: { fontSize: 15.5, fontWeight: '500', flexShrink: 1 },
  rowDetail: { fontSize: 12.5, marginTop: 1 },
  badge: { opacity: 0.9 },
  star: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  state: { paddingHorizontal: 12, paddingVertical: 14, gap: 8, alignItems: 'flex-start' },
  stateText: { fontSize: 13.5 },
});
