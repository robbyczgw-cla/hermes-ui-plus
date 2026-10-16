/**
 * Shared pieces of the coding views (diff, terminal, changes): code text styles from the theme, a copy button with the
 * "Copied" flash, a status letter badge, the chunked / virtualized line list and the j/k/n/p review keys (web).
 */
import { useEffect, useMemo, useRef, type ReactElement } from 'react';
import { FlatList, Platform, View, type TextStyle } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useTheme, type Theme } from '../../../theme';
import { scaleFont } from '../../../themes';
import { HText, PressableScale } from '../../../primitives/basics';
import { Icon } from '../../../primitives/Icon';
import { haptic } from '../../../primitives/haptics';
import { useCopiedFlash } from '../../../lib/useCopiedFlash';
import { withAlpha } from '../../../color';
import { useT } from '../../../../i18n';
import type { HuiFileStatus } from '../../../types';
import { useCaptureMode } from '../../../lib/capture';

export type CodeStyles = {
  code: TextStyle;
  gutter: TextStyle;
  /** line height (dp) of one code row */
  lineHeight: number;
  /** estimated width of one monospace char (dp) */
  charW: number;
  addBg: string;
  delBg: string;
  addHl: string;
  delHl: string;
  addSign: string;
  delSign: string;
  hunkBg: string;
  foldBg: string;
};

/** monospace code text at 12.5 / 18 × the app font size, diff tints from the theme's success / danger */
export function codeStyles(t: Theme): CodeStyles {
  const f = scaleFont(12.5, 18, t.fontScale);
  const code: TextStyle = { fontFamily: t.fonts.mono, fontSize: f.fontSize, lineHeight: f.lineHeight, color: t.colors.codeText };
  return {
    code,
    gutter: { ...code, color: t.colors.subtle, textAlign: 'right' },
    lineHeight: f.lineHeight,
    charW: f.fontSize * 0.62,
    addBg: withAlpha(t.colors.success, t.dark ? 0.16 : 0.11),
    delBg: withAlpha(t.colors.danger, t.dark ? 0.16 : 0.1),
    addHl: withAlpha(t.colors.success, t.dark ? 0.42 : 0.3),
    delHl: withAlpha(t.colors.danger, t.dark ? 0.42 : 0.28),
    addSign: t.colors.success,
    delSign: t.colors.danger,
    hunkBg: withAlpha(t.colors.info, t.dark ? 0.12 : 0.08),
    foldBg: t.dark ? t.colors.surfacePressed : t.colors.surfaceAlt,
  };
}

export function useCodeStyles(): CodeStyles {
  const t = useTheme();
  return useMemo(() => codeStyles(t), [t]);
}

/** Small copy button ("Copy" → "Copied ✓" for a moment). `text` is read on press (a function for lazy texts). */
function CopyButtonInner({ text, label, a11y, disabled, compact }: { text: string | (() => string); label: string; a11y?: string; disabled?: boolean; compact?: boolean }) {
  const t = useTheme();
  const tr = useT();
  const [copied, flash] = useCopiedFlash();
  const copy = () => {
    Clipboard.setStringAsync(typeof text === 'function' ? text() : text).catch(() => {});
    haptic('success');
    flash();
  };
  return (
    <PressableScale
      haptic={false}
      onPress={copy}
      disabled={disabled}
      hitSlop={6}
      accessibilityLabel={a11y ?? label}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: compact ? 4 : 8, height: 28, borderRadius: t.radii.s }}
    >
      <Icon name={copied ? 'check' : 'copy'} size={14} color={copied ? t.colors.success : t.colors.muted} />
      {compact ? null : (
        <HText variant="caption" style={{ color: copied ? t.colors.success : t.colors.muted }} numberOfLines={1}>
          {copied ? tr('actions.copied') : label}
        </HText>
      )}
    </PressableScale>
  );
}

/** status → badge colours: new = success, deleted = danger, renamed = info, modified = warning */
export function statusColors(t: Theme, s: HuiFileStatus): { bg: string; fg: string } {
  if (s === 'added') return { bg: t.colors.successSoft, fg: t.colors.success };
  if (s === 'deleted') return { bg: t.colors.dangerSoft, fg: t.colors.danger };
  if (s === 'renamed') return { bg: t.colors.infoSoft, fg: t.colors.info };
  return { bg: t.colors.warningSoft, fg: t.colors.warning };
}

/** A / M / D / R in a small rounded square */
export function StatusLetter({ status }: { status: HuiFileStatus }) {
  const t = useTheme();
  const c = statusColors(t, status);
  const letter = status === 'added' ? 'A' : status === 'deleted' ? 'D' : status === 'renamed' ? 'R' : 'M';
  return (
    <View style={{ width: 18, height: 18, borderRadius: 5, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <HText variant="micro" weight="700" style={{ color: c.fg, lineHeight: 14 }}>
        {letter}
      </HText>
    </View>
  );
}

/** "+12 −3" in success / danger colours */
export function Counts({ additions, deletions }: { additions?: number; deletions?: number }) {
  // a zero side says nothing ("+4", not "+4 −0"; a pure rename shows no counts)
  if (additions === 0 && deletions !== undefined && deletions > 0) additions = undefined;
  if (deletions === 0 && additions !== undefined && additions > 0) deletions = undefined;
  if (additions === 0 && deletions === 0) return null;
  if (additions === undefined && deletions === undefined) return null;
  return (
    <HText variant="caption" tabular numberOfLines={1} importantForAccessibility="no" accessibilityElementsHidden>
      {additions !== undefined ? <HText variant="caption" color="success" weight="600" tabular>{`+${additions}`}</HText> : null}
      {additions !== undefined && deletions !== undefined ? ' ' : null}
      {deletions !== undefined ? <HText variant="caption" color="danger" weight="600" tabular>{`−${deletions}`}</HText> : null}
    </HText>
  );
}

/** Rows in chunks: up to this many rows render plainly inside the chat; above, a virtualized list with its own scroll. */
export const VIRTUALIZE_ROWS = 400;
export const CHUNK_ROWS = 40;

/**
 * Chunks of rows, each rendered by `renderChunk` (memo'd by the caller). Few chunks: plain views (they scroll with the
 * chat). Many (`virtual`): a FlatList with a fixed max height that scrolls itself and mounts only visible chunks.
 * `width` sizes the list inside a horizontal scroll view (unwrapped code).
 */
export function ChunkList<T>({
  chunks,
  renderChunk,
  virtual,
  maxHeight,
  width,
  fill,
  listRef,
  initialIndex,
}: {
  chunks: T[][];
  renderChunk: (rows: T[], index: number) => ReactElement;
  virtual: boolean;
  maxHeight?: number;
  width?: number;
  /** the list is the scroll container of a sheet (flex: 1, no max height) */
  fill?: boolean;
  listRef?: React.RefObject<FlatList<T[]> | null>;
  initialIndex?: number;
}) {
  // flexGrow: inside a horizontal scroller the rows (and their add / remove backgrounds) span at least its width
  if (!virtual) return <View style={[{ flexGrow: 1 }, width ? { width } : null]}>{chunks.map((c, i) => <View key={i}>{renderChunk(c, i)}</View>)}</View>;
  return (
    <FlatList
      ref={listRef}
      data={chunks}
      renderItem={({ item, index }) => renderChunk(item, index)}
      keyExtractor={(_, i) => String(i)}
      style={[fill ? { flex: 1 } : { maxHeight: maxHeight ?? 520 }, width ? { width } : null]}
      nestedScrollEnabled
      initialNumToRender={3}
      maxToRenderPerBatch={2}
      windowSize={5}
      initialScrollIndex={initialIndex}
      onScrollToIndexFailed={() => {}}
      removeClippedSubviews={Platform.OS === 'android'}
      showsVerticalScrollIndicator
    />
  );
}

/** a memo'd chunk compares its rows by identity (finished rows keep theirs while an answer streams) */
export function sameItems<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export type ReviewKey = 'nextFile' | 'prevFile' | 'nextChange' | 'prevChange';

/** j / k (next / previous file), n / p (next / previous change) on web and the desktop app; not while typing */
export function useReviewKeys(handler: (k: ReviewKey) => void, enabled: boolean): void {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  }, [handler]);
  useEffect(() => {
    if (Platform.OS !== 'web' || !enabled || typeof document === 'undefined') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      const k = e.key === 'j' ? 'nextFile' : e.key === 'k' ? 'prevFile' : e.key === 'n' ? 'nextChange' : e.key === 'p' ? 'prevChange' : null;
      if (!k) return;
      e.preventDefault();
      ref.current(k);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [enabled]);
}

/** share-as-image (capture mode): an app-only control, not part of the picture */
export function CopyButton(props: Parameters<typeof CopyButtonInner>[0]) {
  return useCaptureMode() ? null : <CopyButtonInner {...props} />;
}
