/**
 * `terminal` – a command and its output. Header: title / cwd and a status badge (running · ✓ done · exit N, with the
 * duration). The `$ command` line with copy. Output on the code background with ANSI SGR colours, `\r` progress lines
 * and a live tail while running; long output shows its last 40 lines with "Show all N lines" (very long output then
 * scrolls in a virtualized list). Copy output (plain text, no escapes).
 *
 * Live: `output` may grow on every update (answer stream or tool events); terminalModel parses only the appended chars.
 * With `outputStart` (a retained tail window whose head is dropped by the host) earlier lines are kept.
 */
import { memo, useMemo, useRef, useState } from 'react';
import { View, type TextStyle } from 'react-native';
import { Text } from '../../../primitives/Text';
import { useTheme } from '../../../theme';
import { useHui } from '../../../primitives/context';
import { HText, PressableScale } from '../../../primitives/basics';
import { Icon } from '../../../primitives/Icon';
import { CodeSkeleton } from '../../../skeletons';
import { ensureContrast } from '../../../color';
import { useT } from '../../../../i18n';
import { usePreference } from '../../../../settings/PreferencesProvider';
import { EdgeScroll } from '../../EdgeScroll';
import type { HuiTerminal } from '../../../types';
import { TERM_SHOW_ALL_MIN, ansiColor, createTermParser, formatDuration, plainText, terminalState, visibleLines, type TermLine, type TermParser, type TermStyle } from './terminalModel.ts';
import { chunkRows } from './diffModel.ts';
import { CHUNK_ROWS, ChunkList, CopyButton, VIRTUALIZE_ROWS, sameItems, useCodeStyles, type CodeStyles } from './parts';

export function Terminal({ node }: { node: Partial<HuiTerminal> }) {
  const t = useTheme();
  const tr = useT();
  const { streaming } = useHui();
  const cs = useCodeStyles();
  const parser = useRef<TermParser | null>(null);
  const output = typeof node.output === 'string' ? node.output : '';
  const snap = useMemo(() => {
    parser.current ??= createTermParser();
    return parser.current.update(output, typeof node.outputStart === 'number' ? node.outputStart : undefined);
  }, [output, node.outputStart]);
  const [expanded, setExpanded] = useState(false);
  // Settings → "Wrap code": long output lines wrap instead of scrolling sideways
  const wrap = usePreference('codeWrap');
  const state = terminalState(node, streaming);
  const { lines, hidden } = useMemo(() => visibleLines(snap, expanded), [snap, expanded]);
  const chunks = useMemo(() => chunkRows(lines, CHUNK_ROWS), [lines]);
  const spanStyles = useMemo(() => styleTable(snap.styles, t.dark, t.colors.codeBg, t.colors.codeText), [snap.styles, t.dark, t.colors.codeBg, t.colors.codeText]);
  const command = node.command;
  if (!command && !output) {
    return streaming || state === 'running' ? (
      <View accessible accessibilityLabel={tr('ui.terminal.loading')}>
        <CodeSkeleton />
      </View>
    ) : null;
  }
  const total = lines.length + hidden;
  const virtual = expanded && lines.length > VIRTUALIZE_ROWS;
  const statusText = badgeText(state, node, tr);

  return (
    <View style={{ borderRadius: t.radii.m, borderWidth: 1, borderColor: t.colors.border, overflow: 'hidden', backgroundColor: t.colors.codeBg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: t.spacing.m, paddingRight: 4, minHeight: 36, backgroundColor: t.colors.surface, borderBottomWidth: 1, borderColor: t.colors.border }}>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <HText variant="caption" weight="600" color="muted" style={{ fontFamily: cs.code.fontFamily }}>
            {'>_'}
          </HText>
          <HText variant="caption" color="muted" numberOfLines={1} ellipsizeMode="head" style={{ flexShrink: 1 }}>
            {node.title ?? node.cwd ?? tr('ui.terminal.title')}
          </HText>
        </View>
        <StatusBadge state={state} text={statusText} />
        <CopyButton compact text={() => plainText(snap)} label={tr('ui.terminal.copyOutput')} disabled={!output} />
      </View>
      {command ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: t.spacing.m, paddingRight: 4, paddingVertical: 4, gap: 6, borderBottomWidth: output ? 1 : 0, borderColor: t.colors.border }}>
          <Text style={[cs.code, { color: t.colors.success, fontWeight: '700' }]} importantForAccessibility="no" accessibilityElementsHidden>
            $
          </Text>
          <Text style={[cs.code, { flex: 1, fontWeight: '600' }]} selectable accessibilityLabel={statusText ? tr('ui.terminal.a11yStatus', { command, status: statusText }) : undefined}>
            {command}
          </Text>
          <CopyButton compact text={command} label={tr('ui.terminal.copyCommand')} />
        </View>
      ) : null}
      {hidden > 0 || node.truncated ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: t.spacing.m, paddingTop: 6 }}>
          <HText variant="micro" color="subtle" style={{ flex: 1 }}>
            {[node.truncated ? tr('ui.terminal.truncated') : '', hidden > 0 ? `… ${tr('ui.terminal.hidden', { count: hidden })}` : ''].filter(Boolean).join(' · ')}
          </HText>
        </View>
      ) : null}
      {output ? (
        wrap ? (
          <View style={{ paddingHorizontal: t.spacing.m, paddingVertical: 8 }}>
            <ChunkList chunks={chunks} virtual={virtual} maxHeight={480} renderChunk={(c, i) => <OutChunk key={i} lines={c} cs={cs} styles={spanStyles} />} />
          </View>
        ) : (
          <EdgeScroll fadeColor={t.colors.codeBg} hintLabel={tr('chat.code.scrollRight')} contentContainerStyle={{ flexGrow: 1, paddingHorizontal: t.spacing.m, paddingVertical: 8 }}>
            <ChunkList
              chunks={chunks}
              virtual={virtual}
              maxHeight={480}
              width={virtual ? Math.ceil(maxChars(lines) * cs.charW) + 8 : undefined}
              renderChunk={(c, i) => <OutChunk key={i} lines={c} cs={cs} styles={spanStyles} />}
            />
          </EdgeScroll>
        )
      ) : !streaming && state !== 'running' ? (
        <HText variant="caption" color="subtle" style={{ padding: t.spacing.m }}>
          {tr('ui.terminal.noOutput')}
        </HText>
      ) : null}
      {total > TERM_SHOW_ALL_MIN ? (
        <PressableScale
          haptic="selection"
          scaleTo={0.99}
          onPress={() => setExpanded((x) => !x)}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          style={{ alignItems: 'center', paddingVertical: t.spacing.s, borderTopWidth: 1, borderColor: t.colors.border, backgroundColor: t.colors.surface }}
        >
          <HText variant="caption" color="accent" weight="500">
            {expanded ? tr('ui.terminal.showLess') : tr('ui.terminal.showAll', { count: total })}
          </HText>
        </PressableScale>
      ) : null}
    </View>
  );
}

function maxChars(lines: readonly TermLine[]): number {
  let m = 0;
  for (const l of lines) if (l.text.length > m) m = l.text.length;
  return m;
}

type Tr = ReturnType<typeof useT>;

function durationText(ms: number, tr: Tr): string {
  const d = formatDuration(ms);
  if ('unit' in d) return d.unit === 'ms' ? tr('ui.terminal.ms', { n: d.n }) : tr('ui.terminal.s', { n: d.n });
  if ('s' in d) return tr('ui.terminal.minSec', { m: d.m, s: d.s });
  return tr('ui.terminal.hourMin', { h: d.h, m: d.m });
}

function badgeText(state: ReturnType<typeof terminalState>, n: Partial<HuiTerminal>, tr: Tr): string {
  const dur = typeof n.durationMs === 'number' ? durationText(n.durationMs, tr) : '';
  const head = state === 'running' ? tr('ui.terminal.running') : state === 'ok' ? (n.exitCode !== undefined && n.exitCode !== 0 ? tr('ui.terminal.exit', { code: n.exitCode }) : tr('ui.terminal.ok')) : state === 'failed' ? (n.exitCode !== undefined ? tr('ui.terminal.exit', { code: n.exitCode }) : tr('ui.terminal.exit', { code: '?' })) : '';
  return [head, dur].filter(Boolean).join(' · ');
}

function StatusBadge({ state, text }: { state: ReturnType<typeof terminalState>; text: string }) {
  const t = useTheme();
  if (!text) return null;
  const [bg, fg] = state === 'ok' ? [t.colors.successSoft, t.colors.success] : state === 'failed' ? [t.colors.dangerSoft, t.colors.danger] : state === 'running' ? [t.colors.infoSoft, t.colors.info] : [t.colors.surfaceAlt, t.colors.muted];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, height: 22, borderRadius: t.radii.pill, backgroundColor: bg }} accessibilityLiveRegion="polite">
      {state === 'running' ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: fg }} /> : state === 'ok' ? <Icon name="check" size={12} color={fg} /> : state === 'failed' ? <Icon name="x" size={12} color={fg} /> : null}
      <HText variant="micro" style={{ color: fg }} tabular numberOfLines={1}>
        {text}
      </HText>
    </View>
  );
}

/** style table → RN text styles: palette colours kept readable on the code background (≥ 3:1) */
function styleTable(styles: readonly TermStyle[], dark: boolean, bg: string, text: string): TextStyle[] {
  return styles.map((s) => {
    const o: TextStyle = {};
    let fg = s.fg !== undefined ? ansiColor(s.fg, dark) : undefined;
    let back = s.bg !== undefined ? ansiColor(s.bg, dark) : undefined;
    if (s.inverse) {
      const f = fg ?? text;
      fg = back ?? bg;
      back = f;
    }
    if (fg) o.color = ensureContrast(fg, back ?? bg, 3);
    if (back) o.backgroundColor = back;
    if (s.bold) o.fontWeight = '700';
    if (s.dim) o.opacity = 0.7;
    if (s.italic) o.fontStyle = 'italic';
    if (s.underline) o.textDecorationLine = 'underline';
    return o;
  });
}

const OutChunk = memo(
  function OutChunk({ lines, cs, styles }: { lines: TermLine[]; cs: CodeStyles; styles: TextStyle[] }) {
    return (
      <Text style={cs.code} selectable>
        {lines.map((l, i) => (
          <Text key={l.key}>
            {l.spans.map((s, k) => (s.s === 0 ? s.text : <Text key={k} style={styles[s.s]}>{s.text}</Text>))}
            {i < lines.length - 1 ? '\n' : ''}
          </Text>
        ))}
      </Text>
    );
  },
  (a, b) => sameItems(a.lines, b.lines) && a.cs === b.cs && a.styles === b.styles,
);
