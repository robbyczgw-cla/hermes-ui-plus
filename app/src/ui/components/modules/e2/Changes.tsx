/**
 * `changes` – files touched by an agent turn: a summary (N files changed, +a −d, change bar, "k of N viewed"), one row
 * per file (Viewed check, status letter, path, +/- counts) and a "<agent> only" filter when the list mixes the agent's
 * files with others. Tapping a file (or "Review") opens the review sheet at it: every diff in ONE virtualized list with
 * sticky file headers, Viewed per file (kept on this device until that file's diff changes), j / k = next / previous
 * file, n / p = next / previous change (web, desktop), inline comments → "Request changes" as one message.
 */
import { memo, useCallback, useMemo, useRef, useState, type ReactElement } from 'react';
import { FlatList, Platform, View, useWindowDimensions } from 'react-native';
import { useTheme } from '../../../theme';
import { useHui } from '../../../primitives/context';
import { HText, PressableScale, Surface } from '../../../primitives/basics';
import { Icon } from '../../../primitives/Icon';
import { SheetModal } from '../../../primitives/Sheet';
import { ListSkeleton } from '../../../skeletons';
import { useNodeState } from '../../../../nodestate/useNodeState';
import { useT } from '../../../../i18n';
import type { HuiChanges } from '../../../types';
import { CHANGES_PREVIEW, readChanges, type ChangeRow } from './changesModel.ts';
import { chunkRows, createDiffParser, filePatchText, fileRows, splitPath, splitRows, type DiffFileModel, type DiffParser, type DiffRow, type SplitRow } from './diffModel.ts';
import { changeCells, fingerprint } from './pocketDiff.ts';
import { Counts, StatusLetter, useCodeStyles, useReviewKeys, type ReviewKey } from './parts';
import { FileHeader, SPLIT_MIN_WIDTH, gutterWidth, openFolds, renderDiffChunk } from './Diff';
import { ReviewBar, useReviewComments } from './review';
import { useCaptureMode } from '../../../lib/capture';

type Viewed = Record<string, string>;
const EMPTY_FILES: DiffFileModel[] = [];

const fpCache = new WeakMap<DiffFileModel, string>();

/** fingerprint of what a file's Viewed mark refers to (its diff, else its counts); cached per diff object */
function fileFp(r: ChangeRow): string {
  if (!r.diff) return fingerprint(`${r.status}:${r.additions ?? '-'}:${r.deletions ?? '-'}`);
  let fp = fpCache.get(r.diff);
  if (fp === undefined) fpCache.set(r.diff, (fp = fingerprint(filePatchText(r.diff))));
  return fp;
}

export function Changes({ node }: { node: Partial<HuiChanges> }) {
  const capture = useCaptureMode(); // share-as-image: no app-only controls
  const t = useTheme();
  const tr = useT();
  const { streaming } = useHui();
  // a combined `patch` that grows while the answer streams is parsed incrementally (only its new lines)
  const parser = useRef<DiffParser | null>(null);
  const patch = typeof node.patch === 'string' ? node.patch : '';
  const patchFiles = useMemo(() => (patch ? (parser.current ??= createDiffParser()).update(patch, !streaming) : EMPTY_FILES), [patch, streaming]);
  const model = useMemo(() => readChanges(node, patchFiles), [node, patchFiles]);
  const [viewed, setViewed] = useNodeState<Viewed>(node.id ?? 'changes', {});
  const [agentOnly, setAgentOnly] = useState(false);
  const [all, setAll] = useState(false);
  const [sheetAt, setSheetAt] = useState<string | null>(null);
  const fps = useMemo(() => new Map(model.rows.map((r) => [r.key, fileFp(r)])), [model.rows]);
  const isViewed = useCallback((r: ChangeRow) => viewed[r.path] !== undefined && viewed[r.path] === fps.get(r.key), [viewed, fps]);
  const toggleViewed = useCallback(
    (r: ChangeRow) =>
      setViewed((v) => {
        const n = { ...v };
        if (n[r.path] === fps.get(r.key)) delete n[r.path];
        else n[r.path] = fps.get(r.key)!;
        return n;
      }),
    [setViewed, fps],
  );
  const mixed = model.rows.some((r) => r.byAgent === true) && model.rows.some((r) => r.byAgent !== true);
  const rows = useMemo(() => (mixed && agentOnly ? model.rows.filter((r) => r.byAgent === true) : model.rows), [model.rows, mixed, agentOnly]);
  const agent = node.agent ?? tr('ui.changes.agent');

  if (!model.rows.length) {
    return streaming ? (
      <View accessible accessibilityLabel={tr('ui.changes.loading')}>
        <ListSkeleton />
      </View>
    ) : null;
  }
  const shown = all || rows.length <= CHANGES_PREVIEW + 2 ? rows : rows.slice(0, CHANGES_PREVIEW);
  // only files with a diff can be marked viewed
  const reviewable = rows.filter((r) => r.diff);
  const done = reviewable.filter(isViewed).length;
  const anyDiff = reviewable.length > 0;

  return (
    <Surface style={{ gap: t.spacing.m }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: t.spacing.s }}>
        <View style={{ flex: 1, gap: 2 }}>
          <HText variant="headline" accessibilityRole="header">
            {model.title ?? tr('ui.changes.title', { count: model.rows.length })}
          </HText>
          {model.summary ? (
            <HText variant="caption" color="muted">
              {model.summary}
            </HText>
          ) : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.s, marginTop: 2 }}>
            <Counts additions={model.additions} deletions={model.deletions} />
            <Bar additions={model.additions} deletions={model.deletions} />
            {anyDiff ? (
              <HText variant="caption" color="subtle" tabular>
                {tr('ui.changes.viewedCount', { done, count: reviewable.length })}
              </HText>
            ) : null}
          </View>
        </View>
        {anyDiff && !streaming && !capture ? (
          <PressableScale
            haptic="light"
            onPress={() => setSheetAt(rows.find((r) => r.diff && !isViewed(r))?.key ?? rows.find((r) => r.diff)!.key)}
            accessibilityLabel={tr('ui.changes.reviewA11y')}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, height: 32, borderRadius: t.radii.pill, backgroundColor: t.colors.accentSoft }}
          >
            <HText variant="caption" weight="600" color="accent">
              {tr('ui.changes.review')}
            </HText>
            <Icon name="chevronRight" size={14} color={t.colors.accent} />
          </PressableScale>
        ) : null}
      </View>
      {mixed ? <AgentFilter agent={agent} on={agentOnly} onChange={setAgentOnly} /> : null}
      <View>
        {shown.map((r, i) => (
          <FileRow key={r.key} r={r} first={i === 0} viewed={isViewed(r)} onViewed={toggleViewed} onOpen={r.diff && !streaming ? () => setSheetAt(r.key) : undefined} />
        ))}
      </View>
      {shown.length < rows.length || all ? (
        rows.length > CHANGES_PREVIEW + 2 ? (
          <PressableScale haptic="selection" scaleTo={0.99} onPress={() => setAll((x) => !x)} accessibilityRole="button" accessibilityState={{ expanded: all }} style={{ alignItems: 'center', paddingVertical: 4 }}>
            <HText variant="caption" color="accent" weight="500">
              {all ? tr('ui.changes.showLess') : tr('ui.changes.showAll', { count: rows.length })}
            </HText>
          </PressableScale>
        ) : null
      ) : null}
      {sheetAt !== null ? (
        <ReviewSheet rows={rows.filter((r) => r.diff)} startKey={sheetAt} onClose={() => setSheetAt(null)} isViewed={isViewed} onViewed={toggleViewed} title={model.title ?? tr('ui.changes.title', { count: model.rows.length })} />
      ) : null}
    </Surface>
  );
}

function Bar({ additions, deletions }: { additions: number; deletions: number }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 2 }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      {changeCells(additions, deletions).map((c, i) => (
        <View key={i} style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: c === 'add' ? t.colors.success : c === 'del' ? t.colors.danger : t.colors.borderStrong }} />
      ))}
    </View>
  );
}

function AgentFilter({ agent, on, onChange }: { agent: string; on: boolean; onChange: (on: boolean) => void }) {
  const t = useTheme();
  const tr = useT();
  return (
    <PressableScale
      haptic="selection"
      onPress={() => onChange(!on)}
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, height: 28, borderRadius: t.radii.pill, borderWidth: 1, borderColor: on ? t.colors.accent : t.colors.border, backgroundColor: on ? t.colors.accentSoft : 'transparent' }}
    >
      {on ? <Icon name="check" size={12} color={t.colors.accent} /> : null}
      <HText variant="caption" weight="500" color={on ? 'accent' : 'muted'}>
        {tr('ui.changes.agentOnly', { agent })}
      </HText>
    </PressableScale>
  );
}

function ViewedCheck({ checked, path, onPress, label }: { checked: boolean; path: string; onPress: () => void; label?: boolean }) {
  const t = useTheme();
  const tr = useT();
  return (
    <PressableScale
      haptic="selection"
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={tr('ui.changes.viewedA11y', { path })}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: label ? 8 : 2, height: 28 }}
    >
      <View style={{ width: 18, height: 18, borderRadius: 5, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', borderColor: checked ? t.colors.accent : t.colors.borderStrong, backgroundColor: checked ? t.colors.accent : 'transparent' }}>
        {checked ? <Icon name="check" size={12} color={t.colors.onAccent} strokeWidth={2.5} /> : null}
      </View>
      {label ? (
        <HText variant="caption" color={checked ? 'accent' : 'muted'}>
          {tr('ui.changes.viewed')}
        </HText>
      ) : null}
    </PressableScale>
  );
}

const FileRow = memo(function FileRow({ r, first, viewed, onViewed, onOpen }: { r: ChangeRow; first: boolean; viewed: boolean; onViewed: (r: ChangeRow) => void; onOpen?: () => void }) {
  const capture = useCaptureMode(); // share-as-image: no app-only controls
  const t = useTheme();
  const tr = useT();
  const cs = useCodeStyles();
  const { dir, name } = splitPath(r.path);
  const status = tr(`ui.diff.status.${r.status}`);
  const counts = r.additions !== undefined || r.deletions !== undefined ? tr('ui.diff.counts', { added: r.additions ?? 0, removed: r.deletions ?? 0 }) : '';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderTopWidth: first ? 0 : 1, borderColor: t.colors.border, opacity: viewed ? 0.6 : 1 }}>
      {r.diff ? <ViewedCheck checked={viewed} path={r.path} onPress={() => onViewed(r)} /> : null}
      <PressableScale
        haptic="selection"
        scaleTo={0.99}
        disabled={!onOpen}
        dimDisabled={false}
        onPress={onOpen}
        accessibilityLabel={[r.oldPath ? `${r.oldPath} → ${r.path}` : r.path, status, counts].filter(Boolean).join(', ')}
        accessibilityHint={onOpen ? tr('ui.changes.openHint') : undefined}
        style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, minWidth: 0 }}
      >
        <StatusLetter status={r.status} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <HText numberOfLines={1} ellipsizeMode="head" style={{ fontFamily: cs.code.fontFamily, fontSize: cs.code.fontSize, lineHeight: cs.lineHeight, color: t.colors.muted }}>
            {dir}
            <HText style={{ fontFamily: cs.code.fontFamily, fontSize: cs.code.fontSize, fontWeight: '600', color: t.colors.text, textDecorationLine: r.status === 'deleted' ? 'line-through' : 'none' }}>{name}</HText>
          </HText>
          {r.oldPath && r.oldPath !== r.path ? (
            <HText variant="micro" color="subtle" numberOfLines={1} ellipsizeMode="head">
              {`← ${r.oldPath}`}
            </HText>
          ) : null}
        </View>
        <Counts additions={r.additions} deletions={r.deletions} />
        {onOpen && !capture ? <Icon name="chevronRight" size={14} color={t.colors.subtle} /> : null}
      </PressableScale>
    </View>
  );
});

// ───────────────────────── review sheet ─────────────────────────

type Item = { t: 'head'; row: ChangeRow; key: string } | { t: 'rows'; row: ChangeRow; rows: (DiffRow | SplitRow)[]; index: number; key: string; changes: number; last: boolean };

/** review chunks are small, so n / p land close to the change */
const REVIEW_CHUNK = 20;

function ReviewSheet({ rows, startKey, onClose, isViewed, onViewed, title }: { rows: ChangeRow[]; startKey: string; onClose: () => void; isViewed: (r: ChangeRow) => boolean; onViewed: (r: ChangeRow) => void; title: string }) {
  const t = useTheme();
  const tr = useT();
  const cs = useCodeStyles();
  const { width, height } = useWindowDimensions();
  const split = width >= SPLIT_MIN_WIDTH + 80;
  const review = useReviewComments();
  const [folds, setFolds] = useState<ReadonlySet<string>>(new Set());
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const list = useRef<FlatList<Item>>(null);
  const cursor = useRef(0);
  const onFold = useCallback((key: string) => setFolds((s) => new Set(s).add(key)), []);

  const items = useMemo(() => {
    const out: Item[] = [];
    for (const r of rows) {
      out.push({ t: 'head', row: r, key: 'h' + r.key });
      const open = !isViewed(r) && !closed.has(r.key);
      if (!open || !r.diff) continue;
      const base = openFolds(fileRows(r.diff, folds), folds);
      const rs: (DiffRow | SplitRow)[] = split ? splitRows(base) : base;
      const chunks = chunkRows(rs, REVIEW_CHUNK);
      chunks.forEach((c, i) => {
        let changes = 0;
        for (let k = 0; k < c.length; k++) {
          const x = c[k];
          const changed = (y: DiffRow | SplitRow | undefined) =>
            !!y && ((y.t === 'line' && (y.line.kind === 'add' || y.line.kind === 'del')) || (y.t === 'pair' && (y.left?.line.kind === 'del' || y.right?.line.kind === 'add')));
          if (changed(x) && !changed(k > 0 ? c[k - 1] : undefined)) changes++;
        }
        out.push({ t: 'rows', row: r, rows: c, index: i, key: `${r.key}:${i}`, changes, last: i === chunks.length - 1 });
      });
    }
    return out;
  }, [rows, isViewed, closed, folds, split]);
  const heads = useMemo(() => items.flatMap((it, i) => (it.t === 'head' ? [i] : [])), [items]);
  const changeAt = useMemo(() => items.flatMap((it, i) => (it.t === 'rows' && it.changes > 0 ? [i] : [])), [items]);
  const startIndex = Math.max(0, items.findIndex((it) => it.t === 'head' && it.row.key === startKey));

  const jump = useCallback((targets: number[], dir: 1 | -1) => {
    if (!targets.length) return;
    const cur = cursor.current;
    const next = dir > 0 ? (targets.find((i) => i > cur) ?? targets[targets.length - 1]) : ([...targets].reverse().find((i) => i < cur) ?? targets[0]);
    cursor.current = next;
    list.current?.scrollToIndex({ index: next, animated: true, viewPosition: 0 });
  }, []);
  const onKey = useCallback(
    (k: ReviewKey) => {
      if (k === 'nextFile') jump(heads, 1);
      else if (k === 'prevFile') jump(heads, -1);
      else if (k === 'nextChange') jump(changeAt, 1);
      else jump(changeAt, -1);
    },
    [jump, heads, changeAt],
  );
  useReviewKeys(onKey, true);
  // n / p / j / k continue from the first visible item
  const onViewable = useRef(({ viewableItems }: { viewableItems: { index: number | null }[] }) => {
    const first = viewableItems.find((v) => v.index !== null);
    if (first && first.index !== null) cursor.current = first.index;
  }).current;
  const done = rows.filter(isViewed).length;

  const renderItem = ({ item }: { item: Item }): ReactElement => {
    if (item.t === 'head') {
      const r = item.row;
      const v = isViewed(r);
      const open = !v && !closed.has(r.key);
      return (
        // sticky: an opaque strip in the sheet colour (SheetModal) above the card, so rows scrolling under it do not show through
        <View style={{ backgroundColor: t.dark ? t.colors.surface : t.colors.bg, paddingTop: 8 }}>
          <View style={[{ borderRadius: t.radii.m, borderWidth: 1, borderColor: t.colors.border, overflow: 'hidden' }, open ? { borderBottomLeftRadius: 0, borderBottomRightRadius: 0 } : null]}>
            <FileHeader
              file={r.diff!}
              open={open}
              onToggle={() =>
                setClosed((s) => {
                  const n = new Set(s);
                  if (n.has(r.key)) n.delete(r.key);
                  else n.add(r.key);
                  return n;
                })
              }
              headerRight={<ViewedCheck checked={v} path={r.path} onPress={() => onViewed(r)} label={width >= 480} />}
            />
          </View>
        </View>
      );
    }
    return (
      // the file's rows continue its header card; the last chunk closes it
      <View
        style={[
          { backgroundColor: t.colors.codeBg, borderLeftWidth: 1, borderRightWidth: 1, borderColor: t.colors.border, overflow: 'hidden' },
          item.last ? { borderBottomWidth: 1, borderBottomLeftRadius: t.radii.m, borderBottomRightRadius: t.radii.m, marginBottom: 4 } : null,
        ]}
      >
        {renderDiffChunk({ rows: item.rows, index: item.index, file: item.row.diff!, split, wrap: true, cs, gutterW: gutterWidth(item.row.diff!, cs), review: review.enabled ? review : undefined, onFold })}
      </View>
    );
  };

  return (
    <SheetModal visible onClose={onClose} closeLabel={tr('actions.close')} label={title} maxWidth={1200} maxHeight="94%" style={{ height: Math.round(height * (width >= 900 ? 0.86 : 0.92)), paddingHorizontal: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.s, paddingBottom: 6 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <HText variant="headline" numberOfLines={1} accessibilityRole="header">
            {title}
          </HText>
          <HText variant="caption" color="muted" numberOfLines={2}>
            {tr('ui.changes.viewedCount', { done, count: rows.length })}
            {review.enabled ? `  ·  ${tr(Platform.OS === 'web' ? 'ui.diff.commentHintWeb' : 'ui.diff.commentHint')}` : ''}
            {Platform.OS === 'web' ? `  ·  ${tr('ui.changes.keys')}` : ''}
          </HText>
        </View>
        <PressableScale haptic="selection" onPress={onClose} hitSlop={8} accessibilityLabel={tr('ui.changes.close')} style={{ padding: 6 }}>
          <Icon name="x" size={18} color={t.colors.muted} />
        </PressableScale>
      </View>
      <FlatList
        ref={list}
        style={{ flex: 1 }}
        data={items}
        keyExtractor={(it) => it.key}
        renderItem={renderItem}
        extraData={review}
        stickyHeaderIndices={heads}
        initialScrollIndex={startIndex > 0 ? startIndex : undefined}
        onScrollToIndexFailed={(e) => setTimeout(() => list.current?.scrollToIndex({ index: e.index, animated: false }), 60)}
        initialNumToRender={12}
        windowSize={7}
        onViewableItemsChanged={onViewable}
      />
      <ReviewBar api={review} />
    </SheetModal>
  );
}
