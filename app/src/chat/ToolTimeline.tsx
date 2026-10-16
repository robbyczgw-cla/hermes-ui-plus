/**
 * "Werkzeug-Details: Ausführlich" – per assistant message:
 * - <ToolTimelinePanel/>  expandable "Werkzeuge & Ablauf" timeline (collapsed unless the user opens it; while
 *                         streaming the header shows one live status line that updates in place → no layout jump)
 * - <TurnFooter/>         one muted line: tools · time (+ tokens · cache share in verbose mode)
 * - <ToolDetailSheet/>    bottom sheet with meta, links and pretty-printed raw input/output
 * Pure mapping lives in toolTimeline.ts.
 */
import { memo, useEffect, useMemo, useState } from 'react';
import { Animated, LayoutAnimation, Linking, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../ui/primitives/Text';
import type { ChatMessage } from '../hermes';
import type { ProgressNote } from '../hermes/progressNotes';
import { useI18n } from '../i18n';
import { formatNumber } from '../i18n/core';
import { Button, SheetGrabber, SheetModal, useCopiedFlash, useTheme } from '../ui';
import { useCopy } from './actions';
import { Icon } from './icons';
import { safeHref } from './markdown';
import {
  buildTimeline,
  footerParts,
  liveStatus,
  formatElapsed,
  linkDomain,
  type Fmt,
  rowDetail,
  timelineDone,
  timelineHeader,
  truncateText,
  type DetailSection,
  type TimelineRow,
} from './toolTimeline';
import { a11yState } from '../ui/lib/a11yState';

const NATIVE = Platform.OS !== 'web';

/** translate function + locale for the pure helpers in toolTimeline.ts */
function useFmt(): Fmt {
  const { t, locale } = useI18n();
  return useMemo(() => ({ t, locale }), [t, locale]);
}

/** Re-render once per `ms` while `active` (live durations of running steps). */
function useNow(active: boolean, ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const first = setTimeout(() => setNow(Date.now()), 0);
    const h = setInterval(() => setNow(Date.now()), ms);
    return () => {
      clearTimeout(first);
      clearInterval(h);
    };
  }, [active, ms]);
  return now;
}

// ------------------------------------------------------------------ panel

const NO_NOTES: readonly ProgressNote[] = [];

export const ToolTimelinePanel = memo(function ToolTimelinePanel({
  message,
  onOpen,
  notes = NO_NOTES,
}: {
  message: ChatMessage;
  onOpen(key: string): void;
  /** interim notes of the agent (hermes/progressNotes.ts): status rows + "Alle Zwischenschritte" */
  notes?: readonly ProgressNote[];
}) {
  const t = useTheme();
  const { t: tr, locale } = useFmt();
  const streaming = message.status === 'streaming';
  const anyRunning = streaming && message.tools.some((x) => x.status === 'running');
  const now = useNow(anyRunning);
  const rows = useMemo(
    () => buildTimeline(message, tr, now, { notes }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [message.tools, message.trace, message.route, message.reasoning, message.status, message.approval, now, tr, notes],
  );
  // never auto-expands (streaming → done used to collapse it and jump the text); the user's choice is kept
  const [userOpen, setUserOpen] = useState(false);
  if (!rows.length) return null;
  const open = userOpen;
  const header = streaming && !open ? (liveStatus(rows) ?? timelineHeader(rows, tr)) : timelineHeader(rows, tr);
  const errors = rows.some((r) => r.state === 'error');

  const toggle = () => {
    if (NATIVE) LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setUserOpen(!open);
  };

  return (
    <View style={[styles.panel, { borderColor: t.colors.border, borderRadius: t.radii.control, backgroundColor: t.dark ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.015)' }]}>
      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        {...a11yState({ expanded: open })}
        accessibilityLabel={tr('chat.toolTimeline.panel.a11y', { header })}
        style={({ pressed }) => [styles.head, pressed && { opacity: 0.6 }]}
        hitSlop={4}
      >
        <Icon name="tool" size={15} color={t.colors.muted} />
        <View style={styles.headText}>
          <Text style={[t.typography.callout, styles.headTitle, { color: t.colors.text }]} numberOfLines={1}>
            {tr('chat.toolTimeline.panel.title')}
          </Text>
          <Text style={[t.typography.caption, styles.headMeta, { color: errors ? t.colors.danger : t.colors.muted }]} numberOfLines={1}>
            {header}
            {timelineDone(message, rows) ? ' ✓' : ''}
          </Text>
        </View>
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={15} color={t.colors.muted} />
      </Pressable>
      {open ? (
        <View style={styles.rows}>
          {rows.map((r, i) => (
            <Row key={r.key} row={r} fmt={{ t: tr, locale }} last={i === rows.length - 1} onOpen={onOpen} />
          ))}
          {notes.length ? (
            <View style={styles.notesInPanel}>
              <ProgressNotesDisclosure notes={notes} />
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
});

const Row = memo(
  function Row({ row, last, onOpen, fmt }: { row: TimelineRow; last: boolean; onOpen(key: string): void; fmt: Fmt }) {
    const t = useTheme();
    const { t: tr, locale } = fmt;
    const running = row.state === 'running' || row.state === 'waiting';
    const color = row.state === 'error' ? t.colors.danger : t.colors.text;
    return (
      <Pressable
        onPress={() => onOpen(row.key)}
        accessibilityRole="button"
        accessibilityLabel={tr('chat.toolTimeline.row.a11y', {
          text: `${row.title}${row.summary ? `, ${row.summary}` : ''}${row.durationMs !== undefined ? `, ${formatElapsed(row.durationMs, locale)}` : ''}`,
        })}
        style={({ pressed }) => [styles.row, pressed && { backgroundColor: t.colors.surfacePressed }]}
      >
        <View style={styles.rail}>
          <View style={[styles.iconDot, { backgroundColor: row.state === 'error' ? t.colors.dangerSoft : row.state === 'waiting' ? t.colors.warningSoft : t.colors.surfaceAlt }]}>
            {row.iconName ? <Icon name={row.iconName} size={14} color={row.state === 'error' ? t.colors.danger : t.colors.muted} /> : <Text style={t.typography.caption}>{row.icon}</Text>}
          </View>
          {!last ? <View style={[styles.line, { backgroundColor: t.colors.border }]} /> : null}
        </View>
        <View style={styles.body}>
          <View style={styles.titleLine}>
            <Text style={[t.typography.callout, styles.title, { color }]} numberOfLines={1}>
              {row.title}
            </Text>
            {running ? <Pulse color={row.state === 'waiting' ? t.colors.warning : t.colors.accent} /> : null}
            {row.state === 'error' ? <Icon name="alert" size={13} color={t.colors.danger} /> : null}
            <View style={{ flex: 1 }} />
            {row.durationMs !== undefined ? (
              <Text style={[t.typography.caption, styles.dur, { color: running ? t.colors.text : t.colors.muted }]}>{formatElapsed(row.durationMs, locale)}</Text>
            ) : null}
          </View>
          {row.summary ? (
            <Text style={[t.typography.caption, styles.summary, { color: t.colors.muted }]} numberOfLines={2}>
              {row.summary}
            </Text>
          ) : null}
          {row.sub ? (
            <Text style={[t.typography.caption, styles.sub, { color: t.colors.subtle }]} numberOfLines={1}>
              {row.sub}
            </Text>
          ) : null}
          <Text style={[t.typography.micro, styles.offset, { color: t.colors.subtle }]}>+{formatElapsed(row.offsetMs, locale)}</Text>
        </View>
      </Pressable>
    );
  },
  (a, b) =>
    a.last === b.last &&
    a.onOpen === b.onOpen &&
    a.fmt.t === b.fmt.t &&
    a.fmt.locale === b.fmt.locale &&
    a.row.key === b.row.key &&
    a.row.title === b.row.title &&
    a.row.summary === b.row.summary &&
    a.row.sub === b.row.sub &&
    a.row.state === b.row.state &&
    a.row.icon === b.row.icon &&
    a.row.iconName === b.row.iconName &&
    a.row.durationMs === b.row.durationMs &&
    a.row.offsetMs === b.row.offsetMs,
);

function Pulse({ color }: { color: string }) {
  const [v] = useState(() => new Animated.Value(0.35));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 600, useNativeDriver: NATIVE }),
        Animated.timing(v, { toValue: 0.35, duration: 600, useNativeDriver: NATIVE }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [v]);
  return <Animated.View style={[styles.pulse, { backgroundColor: color, opacity: v }]} />;
}

// ------------------------------------------------------------------ interim notes

/**
 * "Alle Zwischenschritte (n)": the agent's interim notes in full (they are not part of the answer body,
 * hermes/progressNotes.ts). Collapsed by default; inside the timeline panel or above the answer.
 */
export const ProgressNotesDisclosure = memo(function ProgressNotesDisclosure({ notes }: { notes: readonly ProgressNote[] }) {
  const t = useTheme();
  const { t: tr } = useFmt();
  const [open, setOpen] = useState(false);
  if (!notes.length) return null;
  const toggle = () => {
    if (NATIVE) LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen((o) => !o);
  };
  return (
    <View style={styles.notes}>
      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        {...a11yState({ expanded: open })}
        accessibilityHint={tr('chat.toolTimeline.notesA11y', { count: notes.length })}
        hitSlop={6}
        style={({ pressed }) => [styles.notesHead, pressed && { opacity: 0.6 }]}
      >
        <Text style={[t.typography.caption, styles.notesTitle, { color: t.colors.muted }]}>
          {open ? tr('chat.toolTimeline.notesHide') : tr('chat.toolTimeline.notesAll', { count: notes.length })}
        </Text>
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={13} color={t.colors.muted} />
      </Pressable>
      {open ? (
        <View style={[styles.notesBody, { borderLeftColor: t.colors.borderStrong }]}>
          {notes.map((n) => (
            <Text key={n.toolId} style={[t.typography.callout, { color: t.colors.muted }]} selectable>
              {n.text}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
});

// ------------------------------------------------------------------ footer

export function TurnFooter({ message, onOpen, tokens = true }: { message: ChatMessage; onOpen?(key: string): void; /** token counts + cache share (verbose only) */ tokens?: boolean }) {
  const t = useTheme();
  const fmt = useFmt();
  const parts = footerParts(message, fmt, { tokens });
  if (!parts.length) return null;
  const line = parts.join(' · ');
  if (!onOpen) {
    return (
      <Text style={[t.typography.caption, styles.footer, styles.footerText, { color: t.colors.subtle }]} numberOfLines={2}>
        {line}
      </Text>
    );
  }
  return (
    <Pressable
      onPress={() => onOpen('turn')}
      accessibilityRole="button"
      accessibilityLabel={fmt.t('chat.toolTimeline.footer.a11y', { text: line })}
      hitSlop={6}
      style={({ pressed }) => [styles.footer, pressed && { opacity: 0.6 }]}
    >
      <Text style={[t.typography.caption, styles.footerText, { color: t.colors.subtle }]} numberOfLines={2}>
        {line}
      </Text>
    </Pressable>
  );
}

// ------------------------------------------------------------------ detail sheet

const PREVIEW_CHARS = 3000;
const MAX_CHARS = 200_000;

export function ToolDetailSheet({ message, rowKey, onClose }: { message: ChatMessage; rowKey: string | null; onClose(): void }) {
  const t = useTheme();
  const fmt = useFmt();
  const detail = useMemo(() => (rowKey ? rowDetail(message, rowKey, fmt) : null), [message, rowKey, fmt]);
  return (
    <SheetModal
      visible={!!rowKey && !!detail}
      onClose={onClose}
      closeLabel={fmt.t('actions.close')}
      label={detail?.title}
      empty={!detail}
      maxWidth={720}
      maxHeight="88%"
      bottomPadding={0}
      style={styles.sheet}
    >
      {detail ? (
        <>
          <SheetGrabber style={styles.grabber} />
          <View style={styles.sheetHead}>
            {detail.iconName ? <Icon name={detail.iconName} size={20} color={t.colors.muted} /> : <Text style={t.typography.headline}>{detail.icon}</Text>}
            <Text style={[t.typography.headline, styles.sheetTitle, { color: t.colors.text }]} numberOfLines={2}>
              {detail.title}
            </Text>
            <Pressable
              onPress={onClose}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={fmt.t('actions.close')}
              style={({ pressed }) => [styles.closeBtn, pressed && { backgroundColor: t.colors.surfacePressed }]}
            >
              <Icon name="close" size={18} color={t.colors.muted} />
            </Pressable>
          </View>
          <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetContent}>
            {detail.meta.length ? (
              <View style={[styles.metaBox, { backgroundColor: t.colors.surfaceAlt, borderRadius: t.radii.control }]}>
                {detail.meta.map((m, i) => (
                  <View key={`${m.label}-${i}`} style={styles.metaRow}>
                    <Text style={[t.typography.caption, styles.metaLabel, { color: t.colors.muted }]}>{m.label}</Text>
                    <Text style={[t.typography.caption, styles.metaValue, { color: t.colors.text, fontFamily: t.fonts.mono }]} selectable numberOfLines={3}>
                      {m.value}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
            {detail.note ? <Text style={[t.typography.caption, styles.note, { color: t.colors.muted }]}>{detail.note}</Text> : null}
            {detail.links?.length ? <Links links={detail.links} /> : null}
            {detail.sections.map((s, i) => (
              <Section key={`${s.title}-${i}`} section={s} />
            ))}
          </ScrollView>
        </>
      ) : null}
    </SheetModal>
  );
}

function Links({ links }: { links: NonNullable<ReturnType<typeof rowDetail>>['links'] }) {
  const t = useTheme();
  const { t: tr } = useFmt();
  if (!links) return null;
  return (
    <View style={styles.section}>
      <Text style={[t.typography.caption, styles.sectionTitle, { color: t.colors.muted }]}>{tr('chat.detail.sources', { count: links.length })}</Text>
      <View style={[styles.linkList, { borderColor: t.colors.border, borderRadius: t.radii.control }]}>
        {links.map((l, i) => {
          const href = safeHref(l.url);
          return (
            <Pressable
              key={`${l.url}-${i}`}
              disabled={!href}
              onPress={() => href && Linking.openURL(href).catch(() => {})}
              accessibilityRole="link"
              accessibilityLabel={`${l.title}, ${linkDomain(l.url)}`}
              style={({ pressed }) => [
                styles.link,
                i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.colors.border },
                pressed && { backgroundColor: t.colors.surfacePressed },
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[t.typography.callout, styles.linkTitle, { color: t.colors.accentText }]} numberOfLines={2}>
                  {l.title}
                </Text>
                <Text style={[t.typography.caption, styles.linkDomain, { color: t.colors.muted }]} numberOfLines={1}>
                  {linkDomain(l.url)}
                  {l.age ? ` · ${l.age}` : ''}
                </Text>
              </View>
              <Icon name="chevronRight" size={15} color={t.colors.subtle} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function Section({ section }: { section: DetailSection }) {
  const t = useTheme();
  const { t: tr, locale } = useFmt();
  const copy = useCopy();
  const [full, setFull] = useState(false);
  const [copied, flashCopied] = useCopiedFlash();
  const shown = truncateText(section.body, full ? MAX_CHARS : PREVIEW_CHARS);
  const textStyle = section.mono
    ? [t.typography.mono, { color: t.colors.text, fontFamily: t.fonts.mono }]
    : [t.typography.callout, { color: t.colors.text }];
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={[t.typography.caption, styles.sectionTitle, { color: t.colors.muted, flex: 1 }]}>{section.title}</Text>
        <Button
          label={copied ? tr('actions.copied') : tr('actions.copy')}
          icon={copied ? 'check' : 'copy'}
          variant="tertiary"
          size="small"
          accessibilityLabel={tr('chat.detail.sectionCopy', { title: section.title })}
          onPress={() => {
            copy(section.body, tr('chat.detail.sectionCopied', { title: section.title }));
            flashCopied();
          }}
        />
      </View>
      <View style={[styles.codeBox, { backgroundColor: t.colors.codeBg, borderColor: t.colors.border, borderRadius: t.radii.control }]}>
        {section.mono ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={Platform.OS === 'web'} contentContainerStyle={styles.codeScroll}>
            <Text style={textStyle} selectable>
              {shown.text}
            </Text>
          </ScrollView>
        ) : (
          <Text style={[textStyle, styles.codeScroll]} selectable>
            {shown.text}
          </Text>
        )}
      </View>
      {shown.truncated ? (
        <Button
          label={full
            ? tr('chat.detail.truncatedTo', { max: formatNumber(locale, MAX_CHARS) })
            : tr('chat.detail.showMore', { total: formatNumber(locale, shown.total) })}
          variant="tertiary"
          size="small"
          numberOfLines={2}
          onPress={() => setFull(true)}
          style={styles.more}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { borderWidth: StyleSheet.hairlineWidth, marginBottom: 10, overflow: 'hidden' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 10, paddingVertical: 8, minHeight: 38 },
  headText: { flex: 1, minWidth: 0 },
  headTitle: { fontWeight: '600' },
  headMeta: { marginTop: 1 },
  rows: { paddingBottom: 4 },
  row: { flexDirection: 'row', paddingHorizontal: 8, paddingTop: 4, gap: 8 },
  rail: { width: 26, alignItems: 'center' },
  iconDot: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  line: { width: StyleSheet.hairlineWidth * 2, flex: 1, marginTop: 2, minHeight: 6 },
  body: { flex: 1, minWidth: 0, paddingBottom: 8, paddingTop: 3 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontWeight: '600', flexShrink: 1 },
  dur: { fontVariant: ['tabular-nums'] },
  summary: { marginTop: 1 },
  sub: { marginTop: 1 },
  offset: { marginTop: 2, fontVariant: ['tabular-nums'] },
  pulse: { width: 7, height: 7, borderRadius: 4 },
  notesInPanel: { paddingHorizontal: 12, paddingBottom: 6 },
  notes: { marginBottom: 8 },
  notesHead: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', minHeight: 28 },
  notesTitle: { fontWeight: '500' },
  notesBody: { borderLeftWidth: 2, paddingLeft: 10, marginTop: 4, gap: 6 },
  footer: { alignSelf: 'flex-start', marginTop: 8, paddingVertical: 2 },
  footerText: { fontVariant: ['tabular-nums'] },
  sheet: { paddingHorizontal: 0 },
  grabber: { marginBottom: 8 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  sheetTitle: { flex: 1, fontWeight: '600' },
  closeBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  sheetScroll: { flexGrow: 0 },
  sheetContent: { paddingHorizontal: 16, paddingBottom: 12, gap: 12 },
  metaBox: { paddingHorizontal: 12, paddingVertical: 8, gap: 5 },
  metaRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  metaLabel: { width: 112 },
  metaValue: { flex: 1 },
  note: { fontStyle: 'italic' },
  section: { gap: 6 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: { fontWeight: '600' },
  codeBox: { borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  codeScroll: { padding: 10 },
  more: { alignSelf: 'flex-start', paddingVertical: 2 },
  linkList: { borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  link: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 9 },
  linkTitle: { fontWeight: '500' },
  linkDomain: { marginTop: 1 },
});
