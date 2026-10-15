import { memo, useMemo, useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../theme';
import { useHui } from '../primitives/context';
import { HText, InlineText, PressableScale, Surface } from '../primitives/basics';
import { Icon } from '../primitives/Icon';
import { Skeleton } from '../primitives/Skeleton';
import { TableSkeleton } from '../skeletons';
import { asArray, asOptString, asString, clamp, isNumericCell, parseCellNumber } from '../lib/format';
import { NUMERIC_COLUMN_SHARE, TABLE_COLLAPSED_ROWS as COLLAPSED_ROWS, cellMinWidth, fitMinWidth, headerMinWidth, keepArrayIdentity, keepTogether, numericCellMinWidth, scrollEdges, sortTableRows, tableCardMode, tableLayoutMode, visibleTableRows, type ScrollEdges, type TableLayoutPref } from '../lib/tableMath';
import { NARROW_TEXT_PROPS } from '../lib/textWrap';
import type { HuiTable } from '../types';
import type { NodeProps } from './content';
import { ProvenanceChip } from './modules/ProvenanceChip';
import { useLocale, useT } from '../../i18n';

const MAX_COLS = 12;
const MAX_ROWS = 200;

// Wrap header labels at spaces only (web would otherwise break inside a word when the cell is tight).
const NO_MIDWORD_BREAK = (Platform.OS === 'web' ? { wordBreak: 'normal', overflowWrap: 'normal', hyphens: 'none' } : null) as object | null;

type Cell = string | number | null;

function cellText(c: Cell | undefined): string {
  if (c === null || c === undefined) return '–';
  return typeof c === 'number' ? String(c).replace('.', ',') : c;
}

export function Table({ node, bare }: NodeProps<HuiTable> & { bare?: boolean }) {
  const { locale } = useLocale();
  const tr = useT();
  const t = useTheme();
  const { streaming } = useHui();
  // app font size × OS font scale: Android at 1.3 needs ~30 % wider columns for the same words
  const fontScale = t.fontScale * (useWindowDimensions().fontScale || 1);
  // memoised: a fresh array per render invalidated widths and every row (GPT review #17)
  const columns = useMemo(() => asArray(node.columns).slice(0, MAX_COLS).map((c) => asString(c)), [node.columns]);
  // per raw row cache: while streaming, structurally shared (unchanged) rows keep their identity, so the
  // memoised rows below skip them
  const rowCache = useRef(new WeakMap<object, { w: number; cells: Cell[] }>());
  const rows: Cell[][] = useMemo(() => {
    const w = Math.max(columns.length, 1);
    return asArray(node.rows)
      .slice(0, MAX_ROWS)
      .filter(Array.isArray)
      .map((r) => {
        const hit = rowCache.current.get(r as object);
        if (hit && hit.w === w) return hit.cells;
        const cells = (r as unknown[]).slice(0, w).map((c) => (typeof c === 'string' || typeof c === 'number' ? c : null));
        rowCache.current.set(r as object, { w, cells });
        return cells;
      });
  }, [node.rows, columns.length]);
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null);
  const [layoutPref, setLayoutPref] = useState<TableLayoutPref>(null);
  const [expanded, setExpanded] = useState(false);
  const [viewport, setViewport] = useState(0);
  const [contentW, setContentW] = useState(0);
  // only the edge booleans live in state: scrolling re-renders when an edge appears/disappears, not per event
  const [edges, setEdges] = useState<ScrollEdges>({ scrolled: false, atEnd: false });
  const scrollX = useRef(0);
  const scrollRef = useRef<ScrollView>(null);

  const ncols = Math.max(columns.length, ...rows.map((r) => r.length), 0);

  // `numeric` / `widths` keep their identity while their VALUES stay the same: every streaming rebuild makes new
  // `rows`, and fresh arrays here would re-render every memoised TableRow
  const numericRef = useRef<boolean[] | undefined>(undefined);
  const numeric = useMemo(
    () =>
      (numericRef.current = keepArrayIdentity(
        numericRef.current,
        Array.from({ length: ncols }, (_, ci) => {
          const vals = rows.map((r) => r[ci]).filter((v) => v !== null && v !== undefined && v !== '');
          return vals.length > 0 && vals.filter(isNumericCell).length / vals.length >= NUMERIC_COLUMN_SHARE;
        }),
      )),
    [rows, ncols],
  );

  // per column: the width its unbreakable cells (numbers, ranges, short labels, longest word) need on one line
  const keepRef = useRef<number[] | undefined>(undefined);
  const keep = useMemo(
    () =>
      (keepRef.current = keepArrayIdentity(
        keepRef.current,
        Array.from({ length: ncols }, (_, ci) => cellMinWidth(rows.slice(0, 50).map((r) => cellText(r[ci])), fontScale)),
      )),
    [rows, ncols, fontScale],
  );

  const widthsRef = useRef<number[] | undefined>(undefined);
  const widths = useMemo(
    () =>
      (widthsRef.current = keepArrayIdentity(
        widthsRef.current,
        Array.from({ length: ncols }, (_, ci) => {
          const headLen = (columns[ci] ?? '').length;
          const lens = rows.slice(0, 50).map((r) => cellText(r[ci]).length);
          const maxLen = Math.max(headLen * 1.05, ...lens, 3);
          const base = clamp(Math.round(maxLen * 7.4 * fontScale + 28), numeric[ci] ? 72 : 88, Math.round(220 * fontScale));
          // never narrower than the longest header word + sort arrow (no mid-word wrapping)
          const minW = Math.max(base, headerMinWidth(columns[ci] ?? '', fontScale), keep[ci] ?? 0);
          // numbers are never clipped: the column is at least as wide as its widest value
          return numeric[ci] ? Math.max(minW, numericCellMinWidth(rows.map((r) => cellText(r[ci])), fontScale)) : minW;
        }),
      )),
    [rows, columns, ncols, numeric, keep, fontScale],
  );

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const { col, dir } = sort;
    return sortTableRows(rows, col, dir, !!numeric[col], locale, parseCellNumber);
  }, [rows, sort, locale, numeric]);

  if (!columns.length && !rows.length) return streaming ? <TableSkeleton /> : null;

  const totalW = widths.reduce((a, b) => a + b, 0);
  // Decided from the OUTER width (onLayout of the wrapper, never inside the horizontal ScrollView):
  // fill the viewport (text wraps) whenever all columns fit at their minimum; a phone grid that cannot fit
  // becomes a stack of row cards (toggle back via "Als Tabelle"); scroll sideways only beyond that.
  const mode = tableLayoutMode(viewport, widths, numeric, columns, layoutPref, fontScale, keep);
  const fill = mode === 'fill' || mode === 'measuring';
  const cards = mode === 'cards';
  const cardsAvailable = cards || (mode === 'scroll' && tableCardMode(viewport, false, ncols, 'cards'));
  const toggleSort = (ci: number) => setSort((s) => (s?.col === ci ? (s.dir === 1 ? { col: ci, dir: -1 } : null) : { col: ci, dir: 1 }));
  // UX7: ≤ 10 rows never collapse; longer tables show the first 8
  const visible = sorted.slice(0, visibleTableRows(sorted.length, expanded));
  const hidden = sorted.length - visible.length;
  const caption = asOptString(node.caption);
  const overflowRight = contentW > viewport + 2 && !scrollEdges(scrollX.current, viewport, contentW).atEnd;

  // Fill mode: explicit basis 0 so every row splits the width by `widths` alone. With bare
  // `flex: n`, Android sized cells from their content, so columns drifted from row to row.
  const cellStyle = (ci: number) => tableCellStyle(t.spacing, fill, widths, numeric, columns, ci, fontScale, keep);

  const header = (
    <View style={{ flexDirection: 'row', backgroundColor: t.colors.surfaceAlt, borderBottomWidth: 1, borderColor: t.colors.border }}>
      {Array.from({ length: ncols }, (_, ci) => {
        const active = sort?.col === ci;
        return (
          <PressableScale
            key={ci}
            haptic="selection"
            scaleTo={1}
            disabled={streaming}
            accessibilityLabel={tr('ui.table.sortBy', { column: columns[ci] ?? '' })}
            onPress={() => toggleSort(ci)}
            style={[cellStyle(ci), { flexDirection: 'row', alignItems: 'center', gap: 4, justifyContent: numeric[ci] ? 'flex-end' : 'flex-start' }]}
          >
            <HText {...NARROW_TEXT_PROPS} variant="caption" weight="600" color={active ? 'text' : 'muted'} numberOfLines={2} ellipsizeMode="tail" style={[{ flexShrink: 1, minWidth: 0, textAlign: numeric[ci] ? 'right' : 'left' }, NO_MIDWORD_BREAK]}>
              {columns[ci] ?? ''}
            </HText>
            {active ? (
              <View style={{ flexShrink: 0, transform: [{ rotate: sort!.dir === 1 ? '180deg' : '0deg' }] }}>
                <Icon name="chevronDown" size={12} color={t.colors.text} strokeWidth={2.25} />
              </View>
            ) : null}
          </PressableScale>
        );
      })}
    </View>
  );

  const body = (
    // fill: a plain block that takes the outer width (cells split it by flex); scroll: the fixed column sum
    <View style={fill ? { alignSelf: 'stretch' } : { width: totalW }}>
      {header}
      {visible.map((r, ri) => (
        <TableRow
          key={ri}
          r={r}
          first={ri === 0}
          ncols={ncols}
          fill={fill}
          widths={widths}
          numeric={numeric}
          columns={columns}
          fontScale={fontScale}
          keep={keep}
          skeletonTail={streaming && !sort && ri === visible.length - 1}
        />
      ))}
      {streaming && !expanded && visible.length < COLLAPSED_ROWS ? (
        <View style={{ flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.colors.borderStrong }}>
          {Array.from({ length: Math.max(ncols, 1) }, (_, ci) => (
            <View key={ci} style={cellStyle(ci)}>
              <Skeleton height={10} width={ci === 0 ? '80%' : '60%'} style={{ marginVertical: 5 }} />
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );

  // cards mode: sorting stays available as a compact one-line picker (same cycle as the grid header)
  const sortPicker = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <HText variant="caption" color="muted">
        {tr('ui.table.sortLabel')}
      </HText>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingRight: 2 }}>
        {Array.from({ length: ncols }, (_, ci) => {
          const active = sort?.col === ci;
          return (
            <PressableScale
              key={ci}
              haptic="selection"
              scaleTo={0.97}
              disabled={streaming}
              accessibilityLabel={tr('ui.table.sortBy', { column: columns[ci] ?? '' })}
              accessibilityState={{ selected: active }}
              onPress={() => toggleSort(ci)}
              style={[
                styles.sortChip,
                {
                  borderColor: active ? t.colors.accent : t.colors.borderStrong,
                  backgroundColor: active ? t.colors.accentSoft : 'transparent',
                  borderRadius: t.radii.pill,
                },
              ]}
            >
              <HText variant="caption" weight="600" style={{ color: active ? t.colors.accent : t.colors.muted }} numberOfLines={1}>
                {columns[ci] ?? ''}
              </HText>
              {active ? (
                <View style={{ transform: [{ rotate: sort!.dir === 1 ? '180deg' : '0deg' }] }}>
                  <Icon name="chevronDown" size={12} color={t.colors.accent} strokeWidth={2.25} />
                </View>
              ) : null}
            </PressableScale>
          );
        })}
      </ScrollView>
    </View>
  );

  const cardsBody = (
    <View style={{ padding: t.spacing.m, gap: t.spacing.m }}>
      {sortPicker}
      {visible.map((r, ri) => (
        <TableCard key={ri} r={r} ncols={ncols} numeric={numeric} columns={columns} skeletonTail={streaming && !sort && ri === visible.length - 1} />
      ))}
      {streaming && !expanded && visible.length < COLLAPSED_ROWS ? (
        <Surface depth={1}>
          <View style={{ gap: 6 }}>
            <Skeleton height={10} width="80%" />
            <Skeleton height={10} width="60%" />
          </View>
        </Surface>
      ) : null}
    </View>
  );

  const layoutToggle = cardsAvailable ? (
    <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: t.spacing.m, paddingTop: t.spacing.s }}>
      <PressableScale
        haptic="selection"
        scaleTo={0.97}
        accessibilityRole="button"
        accessibilityLabel={cards ? tr('ui.table.asTable') : tr('ui.table.asCards')}
        onPress={() => setLayoutPref(cards ? 'grid' : 'cards')}
        style={{ minHeight: 32, paddingHorizontal: 10, justifyContent: 'center' }}
      >
        <HText variant="caption" weight="600" color="accent">
          {cards ? tr('ui.table.asTable') : tr('ui.table.asCards')}
        </HText>
      </PressableScale>
    </View>
  ) : null;

  const table = (
    // the outer width is the only input of the layout decision; first frame (not measured yet) stays invisible
    <View onLayout={(e) => setViewport(Math.round(e.nativeEvent.layout.width))} style={mode === 'measuring' ? { opacity: 0 } : null}>
      {layoutToggle}
      {cards ? cardsBody : fill ? body : (
      <View>
        <ScrollView
          ref={scrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          scrollEventThrottle={32}
          onScroll={(e) => {
            scrollX.current = e.nativeEvent.contentOffset.x;
            const next = scrollEdges(scrollX.current, viewport, contentW);
            // same booleans → no state change, no re-render of the table
            setEdges((p) => (p.scrolled === next.scrolled && p.atEnd === next.atEnd ? p : next));
          }}
          onContentSizeChange={(w) => setContentW(w)}
          nestedScrollEnabled
        >
          {body}
        </ScrollView>
        {overflowRight ? (
          // B5: wider than the viewport → right-edge fade + a small "→" until the user scrolled
          // the fade lets touches through; the "→" itself scrolls right (it used to pass the tap to the sort header)
          <View pointerEvents="box-none" style={styles.edgeRight}>
            <LinearGradient
              pointerEvents="none"
              colors={[t.colors.surface + '00', t.colors.surface]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={StyleSheet.absoluteFill}
            />
            {!edges.scrolled ? (
              <PressableScale
                haptic="light"
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={tr('ui.table.scrollRight')}
                onPress={() => scrollRef.current?.scrollTo({ x: Math.min(contentW - viewport, scrollX.current + viewport * 0.8), animated: true })}
                style={[styles.moreHint, { backgroundColor: t.colors.surfaceAlt, borderColor: t.colors.border }]}
              >
                <Icon name="arrowRight" size={12} color={t.colors.muted} strokeWidth={2.25} />
              </PressableScale>
            ) : null}
          </View>
        ) : null}
        {edges.scrolled ? (
          // scrolled: a soft shadow on the left edge shows there is more to the left
          <LinearGradient
            pointerEvents="none"
            colors={[t.dark ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.10)', 'rgba(0,0,0,0)']}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={styles.edgeLeft}
          />
        ) : null}
      </View>
      )}
      {hidden > 0 || (expanded && sorted.length > COLLAPSED_ROWS) ? (
        <PressableScale
          haptic="selection"
          scaleTo={0.99}
          onPress={() => setExpanded((x) => !x)}
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: t.spacing.m, borderTopWidth: 1, borderColor: t.colors.border }}
        >
          <HText variant="caption" weight="500" color="accent">
            {expanded ? tr('ui.table.showLess') : tr('ui.table.showAll', { n: sorted.length })}
          </HText>
          <View style={{ transform: [{ rotate: expanded ? '180deg' : '0deg' }] }}>
            <Icon name="chevronDown" size={14} color={t.colors.accent} />
          </View>
        </PressableScale>
      ) : null}
    </View>
  );

  return (
    <View style={{ gap: t.spacing.s }}>
      {caption ? <InlineText variant="bodyStrong" text={caption} /> : null}
      {bare ? table : <Surface padded={false}>{table}</Surface>}
      <ProvenanceChip node={node} />
    </View>
  );
}

function tableCellStyle(spacing: { m: number; s: number }, fill: boolean, widths: readonly number[], numeric: readonly boolean[], columns: readonly string[], ci: number, fontScale: number, keep: readonly number[]) {
  return {
    // fill: basis 0 + grow by the width estimate; only valid because a fill table is never inside a horizontal
    // ScrollView (there the row has no definite width and Yoga sizes each cell to its one-line content)
    ...(fill ? { flexGrow: widths[ci], flexShrink: 1, flexBasis: 0, minWidth: fitMinWidth(widths, numeric, columns, ci, fontScale, keep) } : { width: widths[ci] }),
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.s + 2,
  };
}

/** One body row; memoised so scrolling / sibling-row streaming updates skip unchanged rows. */
const TableRow = memo(function TableRow({ r, first, ncols, fill, widths, numeric, columns, fontScale, keep, skeletonTail }: { r: Cell[]; first: boolean; ncols: number; fill: boolean; widths: number[]; numeric: boolean[]; columns: string[]; fontScale: number; keep: number[]; skeletonTail: boolean }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', borderTopWidth: first ? 0 : StyleSheet.hairlineWidth, borderColor: t.colors.borderStrong }}>
      {Array.from({ length: ncols }, (_, ci) => (
        <View key={ci} style={tableCellStyle(t.spacing, fill, widths, numeric, columns, ci, fontScale, keep)}>
          {skeletonTail && r[ci] === undefined ? (
            <Skeleton height={10} width="60%" style={{ marginVertical: 5, alignSelf: numeric[ci] ? 'flex-end' : 'flex-start' }} />
          ) : (
            <InlineText
              {...NARROW_TEXT_PROPS}
              variant="callout"
              tabular={numeric[ci]}
              weight={ci === 0 && !numeric[0] ? '500' : undefined}
              color={r[ci] === null || r[ci] === undefined ? 'subtle' : 'text'}
              style={{ flexShrink: 1, textAlign: numeric[ci] ? 'right' : 'left' }}
              text={keepTogether(cellText(r[ci]))}
            />
          )}
        </View>
      ))}
    </View>
  );
});

/** One row as a phone card: first column as the title, the rest as "Header: value" lines (memoised like TableRow). */
const TableCard = memo(function TableCard({ r, ncols, numeric, columns, skeletonTail }: { r: Cell[]; ncols: number; numeric: boolean[]; columns: string[]; skeletonTail: boolean }) {
  const missing = (ci: number) => r[ci] === null || r[ci] === undefined;
  return (
    <Surface depth={1}>
      <View style={{ gap: 4 }}>
        {skeletonTail && r[0] === undefined ? (
          <Skeleton height={12} width="70%" />
        ) : (
          <InlineText {...NARROW_TEXT_PROPS} variant="bodyStrong" tabular={numeric[0]} color={missing(0) ? 'subtle' : 'text'} text={keepTogether(cellText(r[0]))} />
        )}
        {Array.from({ length: Math.max(0, ncols - 1) }, (_, k) => {
          const ci = k + 1;
          const head = columns[ci] ?? '';
          return (
            <View key={ci} style={{ flexDirection: 'row', gap: 6 }}>
              {skeletonTail && r[ci] === undefined ? (
                <Skeleton height={10} width="55%" style={{ marginVertical: 4 }} />
              ) : (
                <>
                  {head ? (
                    <HText {...NARROW_TEXT_PROPS} variant="caption" color="muted" style={{ maxWidth: '45%', flexShrink: 1 }}>
                      {`${head}:`}
                    </HText>
                  ) : null}
                  <InlineText {...NARROW_TEXT_PROPS} variant="callout" tabular={numeric[ci]} color={missing(ci) ? 'subtle' : 'text'} style={{ flex: 1, minWidth: 0 }} text={keepTogether(cellText(r[ci]))} />
                </>
              )}
            </View>
          );
        })}
      </View>
    </Surface>
  );
});

const styles = StyleSheet.create({
  sortChip: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 30, paddingHorizontal: 10, borderWidth: 1 },
  edgeRight: { position: 'absolute', right: 0, top: 0, bottom: 0, width: 40, alignItems: 'flex-end', justifyContent: 'flex-start' },
  moreHint: { marginTop: 9, marginRight: 4, width: 20, height: 20, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  edgeLeft: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 10 },
});
