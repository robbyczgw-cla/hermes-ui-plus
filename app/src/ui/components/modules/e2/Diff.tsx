/**
 * `diff` – unified diff of one or more files. Per file: a header (status letter, path, +/- counts, copy patch, collapse),
 * hunks with old / new line numbers, add / remove / context colours, intra-line word highlight for changed lines paired
 * by likeness, long unchanged runs folded ("… 42 unchanged lines", tap opens). Unified on phones, a Unified / Split
 * switch from ~720 dp. Long-press a line (web: click its number) to comment; comments go back as one message (review.tsx).
 *
 * Streaming: the `patch` text is parsed incrementally (diffModel.createDiffParser), finished rows keep their identity
 * and render in memo'd chunks of 40 rows; files with more than VIRTUALIZE_ROWS rows scroll in a virtualized list.
 */
import { memo, useCallback, useMemo, useRef, useState, type ReactElement } from 'react';
import { Platform, View, type FlatList, type LayoutChangeEvent } from 'react-native';
import { Text } from '../../../primitives/Text';
import { useTheme } from '../../../theme';
import { useHui } from '../../../primitives/context';
import { HText, PressableScale } from '../../../primitives/basics';
import { Icon } from '../../../primitives/Icon';
import { CodeSkeleton } from '../../../skeletons';
import { useT } from '../../../../i18n';
import { usePreference } from '../../../../settings/PreferencesProvider';
import { EdgeScroll } from '../../EdgeScroll';
import type { HuiDiff } from '../../../types';
import {
  chunkRows,
  collapsedByDefault,
  createDiffParser,
  diffTotals,
  fileFromJson,
  filePatchText,
  fileRows,
  foldLines,
  maxLineChars,
  splitPath,
  splitRows,
  type DiffFileModel,
  type DiffParser,
  type DiffRow,
  type FoldRow,
  type LineRow,
  type SplitRow,
} from './diffModel.ts';
import { CHUNK_ROWS, ChunkList, CopyButton, Counts, StatusLetter, VIRTUALIZE_ROWS, sameItems, useCodeStyles, type CodeStyles } from './parts';
import { CommentBubble, CommentComposer, ReviewBar, useReviewComments, type CommentTarget, type ReviewApi } from './review';
import { useCaptureMode } from '../../../lib/capture';

/** react-native-web ignores `onLongPress` on Text: on the web a click on the line number / sign column comments instead */
const WEB = Platform.OS === 'web';

/** from this measured width the Unified / Split switch shows */
export const SPLIT_MIN_WIDTH = 720;
/** files open by default while the whole diff stays below this many lines (else only the first few) */
const OPEN_ALL_LINES = 800;
const OPEN_FIRST = 4;
const EMPTY_FILES: DiffFileModel[] = [];
const EMPTY_SET: ReadonlySet<string> = new Set();

export function Diff({ node }: { node: Partial<HuiDiff> }) {
  const t = useTheme();
  const tr = useT();
  const { streaming } = useHui();
  const parser = useRef<DiffParser | null>(null);
  const patch = typeof node.patch === 'string' ? node.patch : '';
  const patchFiles = useMemo(() => {
    if (!patch) return EMPTY_FILES;
    parser.current ??= createDiffParser();
    return parser.current.update(patch, !streaming);
  }, [patch, streaming]);
  const jsonFiles = useMemo(() => (Array.isArray(node.files) ? node.files.map((f, i) => fileFromJson(f, i)) : EMPTY_FILES), [node.files]);
  const files = useMemo(() => (!jsonFiles.length ? patchFiles : !patchFiles.length ? jsonFiles : [...patchFiles, ...jsonFiles]), [patchFiles, jsonFiles]);
  const [w, setW] = useState(0);
  const [splitPref, setSplitPref] = useState<boolean | null>(null);
  const wide = w >= SPLIT_MIN_WIDTH;
  const split = wide && (splitPref ?? node.view === 'split');
  const review = useReviewComments();
  const [toggled, setToggled] = useState<ReadonlySet<string>>(EMPTY_SET);
  const totals = useMemo(() => diffTotals(files), [files]);
  const toggle = useCallback((key: string) => setToggled((s) => {
    const n = new Set(s);
    if (n.has(key)) n.delete(key);
    else n.add(key);
    return n;
  }), []);

  if (!files.length) {
    return streaming ? (
      <View accessible accessibilityLabel={tr('ui.diff.loading')}>
        <CodeSkeleton />
      </View>
    ) : null;
  }
  const big = totals.additions + totals.deletions > OPEN_ALL_LINES;
  const onLayout = (e: LayoutChangeEvent) => {
    const nw = Math.round(e.nativeEvent.layout.width);
    if (nw !== w) setW(nw);
  };
  const showHeader = !!node.title || files.length > 1 || wide;

  return (
    <View style={{ gap: t.spacing.s }} onLayout={onLayout}>
      {showHeader ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.s, flexWrap: 'wrap' }}>
          <View style={{ flex: 1, minWidth: 160, gap: 2 }}>
            {node.title ? (
              <HText variant="headline" accessibilityRole="header">
                {node.title}
              </HText>
            ) : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.s }}>
              <HText variant="caption" color="muted">
                {tr('ui.diff.files', { count: files.length })}
              </HText>
              <Counts additions={totals.additions} deletions={totals.deletions} />
            </View>
          </View>
          {wide ? <LayoutSwitch split={split} onChange={setSplitPref} /> : null}
        </View>
      ) : null}
      {files.map((f, i) => {
        const def = !collapsedByDefault(f) && (!big || i < OPEN_FIRST);
        const open = toggled.has(f.key) ? !def : def;
        return <DiffFileView key={f.key} file={f} open={open} onToggle={toggle} split={split} streaming={streaming} review={review} />;
      })}
      <ReviewBar api={review} />
    </View>
  );
}

function LayoutSwitch({ split, onChange }: { split: boolean; onChange: (split: boolean) => void }) {
  const t = useTheme();
  const tr = useT();
  const opt = (value: boolean, label: string) => (
    <PressableScale
      haptic="selection"
      onPress={() => onChange(value)}
      accessibilityRole="radio"
      accessibilityState={{ selected: split === value, checked: split === value }}
      style={{ paddingHorizontal: 12, height: 28, justifyContent: 'center', borderRadius: t.radii.pill, backgroundColor: split === value ? t.colors.surface : 'transparent' }}
    >
      <HText variant="caption" weight={split === value ? '600' : '400'} color={split === value ? 'text' : 'muted'}>
        {label}
      </HText>
    </PressableScale>
  );
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={tr('ui.diff.layout')} style={{ flexDirection: 'row', padding: 2, borderRadius: t.radii.pill, backgroundColor: t.colors.surfaceAlt }}>
      {opt(false, tr('ui.diff.unified'))}
      {opt(true, tr('ui.diff.split'))}
    </View>
  );
}

export type DiffFileViewProps = {
  file: DiffFileModel;
  open: boolean;
  onToggle?: (key: string) => void;
  split: boolean;
  streaming?: boolean;
  review?: ReviewApi;
  /** extra controls at the end of the header (the review's Viewed check) */
  headerRight?: ReactElement | null;
  /** the rows are the scroll container of a sheet: always virtualized, flex 1 */
  fill?: boolean;
  /** fill mode: scroll handle (review keys jump between changes) */
  listRef?: React.RefObject<FlatList<unknown[]> | null>;
  /** sticky header look (review sheet) */
  sticky?: boolean;
};

/** One file: header + rows. Also used by the changes review sheet. */
export const DiffFileView = memo(function DiffFileView({ file, open, onToggle, split, streaming = false, review, headerRight, fill, listRef }: DiffFileViewProps) {
  const t = useTheme();
  const tr = useT();
  const cs = useCodeStyles();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(EMPTY_SET);
  const [w, setW] = useState(0);
  // Settings → "Wrap code" (like Markdown code blocks); the review sheet (fill) always wraps: one list, no side scroll.
  // A file with an open composer or comments wraps too: inside a side scroller they would be as wide as the longest line.
  const prefix = file.key + '|';
  const commenting = !!review && (!!review.editing?.id.startsWith(prefix) || review.comments.some((c) => c.id.startsWith(prefix)));
  const wrap = usePreference('codeWrap') || !!fill || commenting;
  const rows = useMemo(() => (open ? openFolds(fileRows(file, expanded), expanded) : []), [file, expanded, open]);
  const items: (DiffRow | SplitRow)[] = useMemo(() => (split ? splitRows(rows) : rows), [rows, split]);
  const chunks = useMemo(() => chunkRows(items, CHUNK_ROWS), [items]);
  const gutterW = gutterWidth(file, cs);
  const virtual = !!fill || items.length > VIRTUALIZE_ROWS;
  const onFold = useCallback((key: string) => setExpanded((s) => new Set(s).add(key)), []);
  const commentsOn = !!review?.enabled;

  const renderChunk = (c: (DiffRow | SplitRow)[], i: number) => renderDiffChunk({ rows: c, index: i, file, split, wrap, cs, gutterW, review: commentsOn ? review : undefined, onFold });

  const maxChars = useMemo(() => (virtual && !split && !wrap ? maxLineChars(rows) : 0), [virtual, split, wrap, rows]);
  const contentW = Math.max(w, Math.ceil(gutterW * 2 + 18 + maxChars * cs.charW + 16));
  const body = !open ? null : file.binary ? (
    <Note text={tr('ui.diff.binary')} />
  ) : !items.length ? (
    streaming ? null : <Note text={tr('ui.diff.noChanges')} />
  ) : split || wrap ? (
    <ChunkList chunks={chunks} renderChunk={renderChunk} virtual={virtual} fill={fill} listRef={listRef as never} />
  ) : (
    <EdgeScroll fadeColor={t.colors.codeBg} hintLabel={tr('chat.code.scrollRight')} contentContainerStyle={{ flexGrow: 1 }}>
      <ChunkList chunks={chunks} renderChunk={renderChunk} virtual={virtual} width={virtual ? contentW : undefined} />
    </EdgeScroll>
  );

  return (
    <View
      onLayout={(e) => {
        const nw = Math.round(e.nativeEvent.layout.width);
        if (nw !== w) setW(nw);
      }}
      style={[{ borderRadius: t.radii.m, borderWidth: 1, borderColor: t.colors.border, overflow: 'hidden', backgroundColor: t.colors.codeBg }, fill ? { flex: 1 } : null]}
    >
      <FileHeader file={file} open={open} onToggle={onToggle} streaming={streaming} headerRight={headerRight} />
      {body}
    </View>
  );
});

/** File header: chevron, status letter, path (directory muted), +/- counts, extra controls, copy patch. */
export function FileHeader({ file, open, onToggle, streaming = false, headerRight }: { file: DiffFileModel; open: boolean; onToggle?: (key: string) => void; streaming?: boolean; headerRight?: ReactElement | null }) {
  const capture = useCaptureMode(); // share-as-image: no app-only controls
  const t = useTheme();
  const tr = useT();
  const cs = useCodeStyles();
  const { dir, name } = splitPath(file.path);
  const title = file.oldPath && file.oldPath !== file.path ? `${file.oldPath} → ${file.path}` : file.path;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 6, paddingRight: 2, minHeight: 40, backgroundColor: t.colors.surface, borderBottomWidth: open ? 1 : 0, borderColor: t.colors.border }}>
        <PressableScale
          haptic="selection"
          scaleTo={0.99}
          onPress={onToggle ? () => onToggle(file.key) : undefined}
          disabled={!onToggle}
          dimDisabled={false}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={`${title}, ${tr(`ui.diff.status.${file.status}`)}, ${tr('ui.diff.counts', { added: file.additions, removed: file.deletions })}`}
          accessibilityHint={onToggle ? tr(open ? 'ui.diff.collapseA11y' : 'ui.diff.expandA11y', { path: file.path }) : undefined}
          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, minWidth: 0 }}
        >
          {onToggle && !capture ? <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} color={t.colors.muted} /> : null}
          <StatusLetter status={file.status} />
          <Text numberOfLines={1} ellipsizeMode="head" style={{ flexShrink: 1, fontFamily: cs.code.fontFamily, fontSize: cs.code.fontSize, color: t.colors.muted }}>
            {file.oldPath && file.oldPath !== file.path ? `${file.oldPath} → ` : ''}
            {dir}
            <Text style={{ color: t.colors.text, fontWeight: '600' }}>{name || title}</Text>
          </Text>
          <Counts additions={file.additions} deletions={file.deletions} />
        </PressableScale>
        {headerRight}
        <CopyButton compact text={() => filePatchText(file)} label={tr('ui.diff.copyPatch')} a11y={tr('ui.diff.copyPatchA11y', { path: file.path })} disabled={streaming} />
      </View>
  );
}

function Note({ text }: { text: string }) {
  const t = useTheme();
  return (
    <HText variant="caption" color="muted" style={{ padding: t.spacing.m }}>
      {text}
    </HText>
  );
}

function maxLineNo(f: DiffFileModel): number {
  let m = 0;
  for (const h of f.hunks) {
    const last = h.lines[h.lines.length - 1];
    m = Math.max(m, h.oldStart + h.lines.length, h.newStart + h.lines.length, last?.oldNo ?? 0, last?.newNo ?? 0);
  }
  return m;
}

/** an opened fold is replaced by its lines (fileRows already skips folding opened keys; this is a safety net) */
export function openFolds(rows: DiffRow[], expanded: ReadonlySet<string>): DiffRow[] {
  if (!expanded.size || !rows.some((r) => r.t === 'fold' && expanded.has(r.key))) return rows;
  const out: DiffRow[] = [];
  for (const r of rows) {
    if (r.t === 'fold' && expanded.has(r.key)) out.push(...foldLines(r));
    else out.push(r);
  }
  return out;
}

/** gutter width (dp) of a file's line numbers */
export function gutterWidth(file: DiffFileModel, cs: CodeStyles): number {
  return file.numbered ? Math.max(2, String(maxLineNo(file)).length) * cs.charW + 10 : 0;
}

/** one memo'd chunk of rows with the comments that sit in it */
export function renderDiffChunk({ rows, index, file, split, wrap = false, cs, gutterW, review, onFold }: { rows: (DiffRow | SplitRow)[]; index: number; file: DiffFileModel; split: boolean; wrap?: boolean; cs: CodeStyles; gutterW: number; review?: ReviewApi; onFold: (key: string) => void }): ReactElement {
  let sig = '';
  let editing: CommentTarget | null = null;
  if (review && (review.byRow.size || review.editing)) {
    for (const r of rows) {
      const id = `${file.key}|${r.key}`;
      const cm = review.byRow.get(id);
      if (cm) sig += id + cm.map((x) => x.text).join('\u0001') + '\u0002';
      if (review.editing?.id === id) editing = review.editing;
    }
  }
  return <Chunk key={index} rows={rows} split={split} wrap={wrap} cs={cs} gutterW={gutterW} numbered={file.numbered} fileKey={file.key} path={file.path} review={review} sig={sig} editing={editing} onFold={onFold} />;
}

type ChunkProps = {
  rows: (DiffRow | SplitRow)[];
  split: boolean;
  /** long lines wrap under their text (no side scroll) */
  wrap: boolean;
  cs: CodeStyles;
  gutterW: number;
  numbered: boolean;
  fileKey: string;
  path: string;
  review?: ReviewApi;
  /** comments in this chunk (changes re-render it) */
  sig: string;
  editing: CommentTarget | null;
  onFold: (key: string) => void;
};

const Chunk = memo(
  function Chunk({ rows, split, wrap, cs, gutterW, numbered, fileKey, path, review, editing, onFold }: ChunkProps) {
    return (
      <>
        {rows.map((r) => {
          const id = `${fileKey}|${r.key}`;
          const comments = review?.byRow.get(id);
          const row =
            r.t === 'hunk' ? (
              <HunkHeader key={r.key} range={r.range} section={r.section} cs={cs} />
            ) : r.t === 'fold' ? (
              <Fold key={r.key} f={r} cs={cs} onFold={onFold} />
            ) : r.t === 'pair' ? (
              <PairView key={r.key} left={r.left} right={r.right} cs={cs} gutterW={gutterW} numbered={numbered} onComment={review ? (lr) => review.startComment(target(id, path, lr)) : undefined} />
            ) : (
              <LineView key={r.key} r={r} cs={cs} gutterW={gutterW} numbered={numbered} wrap={wrap} onComment={review ? () => review.startComment(target(id, path, r)) : undefined} />
            );
          if (!comments && editing?.id !== id) return row;
          return (
            <View key={r.key}>
              {row}
              {comments?.map((c) => <CommentBubble key={c.text} c={c} api={review!} />)}
              {editing?.id === id && review ? <CommentComposer api={review} initial={comments?.[0]?.text} /> : null}
            </View>
          );
        })}
      </>
    );
  },
  (a, b) =>
    sameItems(a.rows, b.rows) && a.split === b.split && a.wrap === b.wrap && a.cs === b.cs && a.gutterW === b.gutterW && a.numbered === b.numbered && a.sig === b.sig && a.editing === b.editing && !!a.review === !!b.review,
);

function target(id: string, path: string, r: LineRow): CommentTarget {
  const l = r.line;
  const side = l.kind === 'del' ? 'old' : 'new';
  return { id, path, line: side === 'old' ? l.oldNo : (l.newNo ?? l.oldNo), side, code: l.text };
}

function HunkHeader({ range, section, cs }: { range: string; section?: string; cs: CodeStyles }) {
  const t = useTheme();
  return (
    <View style={{ backgroundColor: cs.hunkBg, paddingHorizontal: 10, paddingVertical: 3 }} accessibilityRole="header">
      <Text numberOfLines={1} style={[cs.code, { color: t.colors.muted }]}>
        {range}
        {section ? <Text style={{ color: t.colors.subtle }}>{'  ' + section}</Text> : null}
      </Text>
    </View>
  );
}

function Fold({ f, cs, onFold }: { f: FoldRow; cs: CodeStyles; onFold: (key: string) => void }) {
  const capture = useCaptureMode(); // share-as-image: no app-only controls
  const t = useTheme();
  const tr = useT();
  return (
    <PressableScale
      haptic="selection"
      scaleTo={0.995}
      onPress={() => onFold(f.key)}
      accessibilityRole="button"
      accessibilityLabel={tr('ui.diff.foldA11y', { count: f.count })}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: cs.foldBg }}
    >
      {capture ? null : <Icon name="chevronDown" size={12} color={t.colors.muted} />}
      <Text style={[cs.code, { color: t.colors.muted }]}>{`… ${tr('ui.diff.fold', { count: f.count })}`}</Text>
    </PressableScale>
  );
}

function signOf(kind: string): string {
  return kind === 'add' ? '+' : kind === 'del' ? '−' : ' ';
}

function CodeText({ r, cs, flex }: { r: LineRow; cs: CodeStyles; flex?: boolean }) {
  const t = useTheme();
  const l = r.line;
  if (l.kind === 'meta') return <Text style={[cs.code, { color: t.colors.subtle, fontStyle: 'italic' }, flex ? { flex: 1 } : null]}>{l.text}</Text>;
  const hl = l.kind === 'add' ? cs.addHl : cs.delHl;
  return (
    <Text style={[cs.code, flex ? { flex: 1, flexShrink: 1 } : null, { paddingRight: 12 }]}>
      {r.words ? r.words.map((s, i) => (s.hl ? <Text key={i} style={{ backgroundColor: hl, borderRadius: 2 }}>{s.text}</Text> : s.text)) : l.text || ' '}
    </Text>
  );
}

function useLineLabels() {
  const tr = useT();
  return useMemo(() => ({ add: tr('ui.diff.lineAdd'), del: tr('ui.diff.lineDel'), ctx: tr('ui.diff.lineCtx'), comment: tr('ui.diff.comment') }), [tr]);
}

function LineView({ r, cs, gutterW, numbered, wrap, onComment }: { r: LineRow; cs: CodeStyles; gutterW: number; numbered: boolean; wrap: boolean; onComment?: () => void }) {
  const t = useTheme();
  const labels = useLineLabels();
  const l = r.line;
  const bg = l.kind === 'add' ? cs.addBg : l.kind === 'del' ? cs.delBg : undefined;
  const no = l.newNo ?? l.oldNo;
  return (
    <View
      style={{ flexDirection: 'row', backgroundColor: bg }}
      accessible
      accessibilityLabel={`${no !== undefined ? no + ' ' : ''}${l.kind === 'add' ? labels.add : l.kind === 'del' ? labels.del : labels.ctx}: ${l.text}`}
      accessibilityActions={onComment ? [{ name: 'longpress', label: labels.comment }] : undefined}
      onAccessibilityAction={onComment ? () => onComment() : undefined}
    >
      {numbered ? (
        <>
          <Text onPress={WEB ? onComment : undefined} style={[cs.gutter, { width: gutterW, flexShrink: 0 }]}>{l.oldNo ?? ''}</Text>
          <Text onPress={WEB ? onComment : undefined} style={[cs.gutter, { width: gutterW, flexShrink: 0 }]}>{l.newNo ?? ''}</Text>
        </>
      ) : null}
      <Text
        onLongPress={onComment}
        onPress={WEB ? onComment : undefined}
        style={[cs.code, { width: 18, flexShrink: 0, textAlign: 'center', color: l.kind === 'add' ? cs.addSign : l.kind === 'del' ? cs.delSign : t.colors.subtle }]}
      >
        {signOf(l.kind)}
      </Text>
      <Text onLongPress={onComment} suppressHighlighting style={wrap ? { flex: 1, flexShrink: 1 } : undefined}>
        <CodeText r={r} cs={cs} />
      </Text>
    </View>
  );
}

function Half({ r, cs, gutterW, numbered, side, onComment }: { r?: LineRow; cs: CodeStyles; gutterW: number; numbered: boolean; side: 'old' | 'new'; onComment?: (r: LineRow) => void }) {
  const t = useTheme();
  if (!r) return <View style={{ flex: 1, backgroundColor: cs.foldBg, opacity: 0.5 }} />;
  const l = r.line;
  const kind = l.kind === 'ctx' ? 'ctx' : l.kind;
  const bg = kind === 'add' ? cs.addBg : kind === 'del' ? cs.delBg : undefined;
  const no = side === 'old' ? l.oldNo : l.newNo;
  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: bg, minWidth: 0 }}>
      {numbered ? <Text onPress={WEB && onComment ? () => onComment(r) : undefined} style={[cs.gutter, { width: gutterW, paddingRight: 4, flexShrink: 0 }]}>{no ?? ''}</Text> : null}
      <Text onPress={WEB && onComment ? () => onComment(r) : undefined} style={[cs.code, { width: 16, flexShrink: 0, textAlign: 'center', color: kind === 'add' ? cs.addSign : kind === 'del' ? cs.delSign : t.colors.subtle }]}>
        {signOf(kind)}
      </Text>
      <Text onLongPress={onComment ? () => onComment(r) : undefined} style={{ flex: 1, flexShrink: 1 }} suppressHighlighting>
        <CodeText r={r} cs={cs} />
      </Text>
    </View>
  );
}

function PairView({ left, right, cs, gutterW, numbered, onComment }: { left?: LineRow; right?: LineRow; cs: CodeStyles; gutterW: number; numbered: boolean; onComment?: (r: LineRow) => void }) {
  const t = useTheme();
  const labels = useLineLabels();
  const same = left === right;
  const a11y = [left && !same ? `${left.line.oldNo ?? ''} ${labels.del}: ${left.line.text}` : '', right ? `${right.line.newNo ?? ''} ${same ? labels.ctx : labels.add}: ${right.line.text}` : ''].filter(Boolean).join('; ');
  return (
    <View
      style={{ flexDirection: 'row' }}
      accessible
      accessibilityLabel={a11y}
      accessibilityActions={onComment ? [{ name: 'longpress', label: labels.comment }] : undefined}
      onAccessibilityAction={onComment ? () => onComment((right ?? left)!) : undefined}
    >
      <Half r={left} cs={cs} gutterW={gutterW} numbered={numbered} side="old" onComment={onComment} />
      <View style={{ width: 1, backgroundColor: t.colors.border }} />
      <Half r={right} cs={cs} gutterW={gutterW} numbered={numbered} side="new" onComment={onComment} />
    </View>
  );
}
