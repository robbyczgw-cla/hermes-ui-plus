import * as Clipboard from 'expo-clipboard';
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useImagesAllowed } from '../images';
import { ImageLightbox, Photo, useNaturalAspect, type LightboxItem } from '../ui/components/imageParts';
import { resolveImageUrl } from './imageUrl';
import { useMarkdownImageBase } from './MarkdownImageContext';
import { Linking, Platform, Pressable, StyleSheet, View, useWindowDimensions, type TextStyle } from 'react-native';
import { Text } from '../ui/primitives/Text';
import { bindAfterCode, nowrapCode } from '../ui/lib/inlineCode';
import { keepTogether, markdownColumnWidth } from '../ui/lib/tableMath';
import { NARROW_TEXT_PROPS } from '../ui/lib/textWrap';
import { useT } from '../i18n';
import { FadeIn, haptic, useCopiedFlash, useMotionReduced, useTheme, type Theme } from '../ui';
import { usePreferences } from '../settings/PreferencesProvider';
import { EdgeScroll } from '../ui/components/EdgeScroll';
import { Icon } from './icons';
import { PERF, perfNow, perfSpan } from '../perf/probe';
import { perfWrap } from '../perf/react';
import { dropFinalNewline, inlineToPlain, parseInline, parseMarkdownIncremental, safeHref, type Align, type Inline, type MdBlock, type MdListItem, type MdParseState } from './markdown';
import { enterBlockPropsEqual, enterDelay } from './enterBlock';
import { useToast } from './Toast';
import type { AppendRun } from '../protocol/appendRun';
import { Highlighted, useFindHighlight } from './findContext';
import { AnswerIcon } from './answers/answerIcons';
import { useAnswerScope } from './answers/AnswerScope';
import { blockLinesCached, collapsePlan, sectionPlan } from './answers/collapse';
import { detectEntitiesCached, finishedInline, finishedMarkdown } from './parseCache';
import { parseHuiHref } from './answers/entities';
import { EntityChip, FootnotePill, MdFeaturesContext, useMdFeatures, type MdFeatures } from './answers/inline';

type Props = {
  text: string;
  /** last block is still streaming: lenient inline parsing + caret */
  streaming?: boolean;
  /**
   * A2 "Weiterlesen" (Settings → Antworten): `true` after a `summary` node – long text collapses to ~12 lines;
   * `'section'` for long researched answers with sources (B3) – after the first section
   */
  collapse?: boolean | 'section';
  /** append run of `text` (protocol/appendRun.ts: stream parser segments), lets the incremental parse skip a compare */
  run?: AppendRun;
};

/**
 * Renders assistant Markdown. Parsing is incremental (stable prefix blocks are reused, only the tail
 * is re-parsed) and blocks are memoized by their source → only the tail re-renders while streaming.
 */
export const Markdown = memo(function Markdown({ text, streaming = false, collapse = false, run }: Props) {
  const t = useTheme();
  const tr = useT();
  const prefs = usePreferences().prefs;
  const s = useMdStyles(t, prefs.chatWidth === 'normal');
  const reduced = useMotionReduced();
  const parsed = useRef<MdParseState | null>(null);
  const blocks = useMemo(() => {
    // finished text: shared with every other mount of it (parse cache); streaming: only the tail is re-parsed
    const t0 = PERF ? perfNow() : 0;
    const st = streaming ? parseMarkdownIncremental(text, parsed.current, run) : finishedMarkdown(text, parsed.current);
    if (PERF) perfSpan(streaming ? 'md.parse' : 'md.final', t0);
    parsed.current = st;
    return st.blocks;
  }, [text, streaming, run]);
  // Settings → Antworten: footnote pills / entity chips (one context value per switch combination)
  const footnotes = prefs['answers.footnotes'];
  const entities = prefs['answers.entities'];
  // B3: numeric `[n]` citations only when the answer has a matching closing sources list (AnswerScope)
  const cites = useAnswerScope()?.cites ?? 0;
  const features = useMemo<MdFeatures>(() => ({ footnotes, entities, cites }), [footnotes, entities, cites]);

  // A2 "Weiterlesen": blocks already shown while streaming stay visible, later ones fold away
  const [expanded, setExpanded] = useState(false);
  // N2: an answer the user just watched stream in is never folded under them; once it ended, a one-time
  // "Einklappen" chip offers the fold instead (after a reload / reopen it starts folded as usual)
  const [foldedByUser, setFoldedByUser] = useState(false);
  const shownLive = useRef(0);
  // "Im Chat suchen" with a match in this answer: nothing stays folded away
  const findHit = !!useFindHighlight();
  let visible = blocks.length;
  let hiddenLines = 0;
  let offerFold = 0;
  if (collapse && !expanded && !findHit && prefs['answers.collapseLong']) {
    const plan =
      collapse === 'section'
        ? sectionPlan(blocks, undefined, undefined, blockLinesCached)
        : collapsePlan(blocks, undefined, undefined, undefined, blockLinesCached);
    if (plan) {
      visible = Math.min(blocks.length, foldedByUser ? plan.visible : Math.max(plan.visible, shownLive.current));
      for (let i = visible; i < blocks.length; i++) hiddenLines += blockLinesCached(blocks[i]);
      if (!streaming && !foldedByUser && visible >= blocks.length) offerFold = plan.hiddenLines;
    }
  }
  const folded = visible < blocks.length && hiddenLines > 0;
  if (!folded) visible = blocks.length;

  // A5 entrance: only blocks that appear while this answer streams (never history), UI-thread fade/rise
  const motion = prefs['answers.motion'] && !reduced;
  const mountedWith = useRef<number | null>(null);
  if (mountedWith.current === null) mountedWith.current = streaming ? 0 : blocks.length;
  const rendered = useRef(0);
  useEffect(() => {
    rendered.current = visible;
    if (streaming) shownLive.current = visible;
  });
  const prevRendered = rendered.current;

  return (
    <MdFeaturesContext.Provider value={features}>
      <View>
        {blocks.slice(0, visible).map((b, i) => {
          const live = streaming && i === blocks.length - 1;
          // memoized per block: a streaming tick re-renders only the changed tail block, not every wrapper
          const enter = motion && i >= (mountedWith.current ?? 0);
          return <EnterBlock key={enter ? `e${i}` : i} block={b} s={s} first={i === 0} live={live} enter={enter} delay={enter ? enterDelay(i, prevRendered) : 0} />;
        })}
        {folded ? (
          <Pressable
            onPress={() => {
              haptic('selection');
              setExpanded(true);
            }}
            accessibilityRole="button"
            accessibilityLabel={tr('chat.answers.readMoreA11y', { n: hiddenLines })}
            style={({ pressed }) => [s.readMore, pressed && { opacity: 0.6 }]}
          >
            <Text style={s.readMoreText}>{tr('chat.answers.readMore')}</Text>
            <AnswerIcon name="chevronDown" size={16} color={t.colors.accent} strokeWidth={2} />
          </Pressable>
        ) : offerFold ? (
          <Pressable
            onPress={() => {
              haptic('selection');
              setFoldedByUser(true);
            }}
            accessibilityRole="button"
            accessibilityLabel={tr('chat.answers.collapseLiveA11y', { n: offerFold })}
            style={({ pressed }) => [s.readMore, pressed && { opacity: 0.6 }]}
          >
            <Text style={[s.readMoreText, { color: t.colors.subtle, fontWeight: '500' }]}>{tr('chat.answers.collapseLive')}</Text>
            <AnswerIcon name="chevronUp" size={16} color={t.colors.subtle} strokeWidth={2} />
          </Pressable>
        ) : null}
      </View>
    </MdFeaturesContext.Provider>
  );
});

type MdStyles = ReturnType<typeof makeStyles>;

function useMdStyles(t: Theme, measure: boolean): MdStyles {
  return useMemo(() => makeStyles(t, measure), [t, measure]);
}

const WEB = Platform.OS === 'web';
const BODY_SIZE = 16;
/**
 * Reading measure of prose (paragraphs, headings, lists, quotes) on wide screens, scaled with the font size: keeps
 * lines well under ~90 characters while code, tables, images and cards use the whole column. Only for the "Normal"
 * chat width – "Wide"/"Full" are an explicit choice for longer lines, "Narrow" is below it anyway.
 */
export const READING_MAX_WIDTH = 680;

function makeStyles(t: Theme, measure = false) {
  const c = t.colors;
  // reading tokens of the type scale (ui/theme.ts), already scaled by Settings → Darstellung → Schriftgröße
  // (t.fontScale); RN applies the OS font scale on top
  const ty = t.typography;
  const size = (k: keyof typeof ty) => ({ fontSize: ty[k].fontSize, lineHeight: ty[k].lineHeight });
  const body = size('reading');
  return StyleSheet.create({
    p: { color: c.text, ...body, fontFamily: t.fonts.sans },
    measure: { maxWidth: measure ? Math.round(READING_MAX_WIDTH * t.fontScale) : undefined },
    block: { marginTop: 12 },
    first: { marginTop: 0 },
    // H1 24 / H2 20 / H3 17 over body 16: levels differ by size first, then weight; space above grows with the level
    h1: { ...size('readingH1'), fontWeight: ty.readingH1.fontWeight, letterSpacing: ty.readingH1.letterSpacing, marginTop: 22 },
    h2: { ...size('readingH2'), fontWeight: ty.readingH2.fontWeight, letterSpacing: ty.readingH2.letterSpacing, marginTop: 20 },
    h3: { ...size('readingH3'), fontWeight: ty.readingH3.fontWeight, marginTop: 14 },
    h4: { ...body, fontWeight: '600', color: c.muted, marginTop: 12 },
    strong: { fontWeight: '700' },
    em: { fontStyle: 'italic' },
    del: { textDecorationLine: 'line-through', color: c.muted },
    link: { color: c.accentText, textDecorationLine: 'underline' },
    icode: {
      fontFamily: t.fonts.mono,
      fontSize: ty.readingSmall.fontSize,
      backgroundColor: c.surfaceAlt,
      color: c.text,
    },
    // react-native-web passes these CSS properties through (not in the RN style types)
    icodeWeb: { paddingHorizontal: 4, borderRadius: 4, boxDecorationBreak: 'clone', WebkitBoxDecorationBreak: 'clone' } as TextStyle,
    icodeNowrap: { whiteSpace: 'nowrap' } as TextStyle,
    codeWrap: { borderRadius: t.radii.m, backgroundColor: c.codeBg, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, overflow: 'hidden' },
    codeHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 12,
      paddingVertical: 6,
      backgroundColor: c.surfaceAlt,
    },
    codeLang: { color: c.muted, fontSize: ty.caption.fontSize, fontWeight: '500' },
    codeCopy: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 2, paddingHorizontal: 4 },
    codeCopyText: { color: c.muted, fontSize: ty.caption.fontSize },
    codeText: { fontFamily: t.fonts.mono, ...size('code'), color: c.codeText, padding: 12 },
    codeChunks: { padding: 12 },
    codeChunk: { padding: 0 },
    listRow: { flexDirection: 'row', marginTop: 4 },
    bullet: { width: 22, color: c.text, ...body },
    num: { minWidth: 22, paddingRight: 6, color: c.muted, ...body, fontVariant: ['tabular-nums'] },
    listBody: { flex: 1, minWidth: 0 },
    quote: { borderLeftWidth: 3, borderLeftColor: c.borderStrong, paddingLeft: 12 },
    hr: { height: StyleSheet.hairlineWidth, backgroundColor: c.borderStrong, marginVertical: 8 },
    table: { borderWidth: StyleSheet.hairlineWidth, borderColor: c.borderControl, borderRadius: t.radii.s, overflow: 'hidden' },
    tr: { flexDirection: 'row' },
    th: { backgroundColor: c.surfaceAlt },
    td: { paddingHorizontal: 10, paddingVertical: 7, borderColor: c.border, borderRightWidth: StyleSheet.hairlineWidth, borderTopWidth: StyleSheet.hairlineWidth },
    tdText: { color: c.text, ...size('readingSmall') },
    thText: { color: c.text, ...size('readingSmall'), fontWeight: '600' },
    caret: { color: c.text, fontSize: ty.caption.fontSize },
    fnRaw: { color: c.muted, fontSize: ty.caption.fontSize },
    readMore: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', minHeight: 44, marginTop: 4, paddingRight: 8 },
    readMoreText: { color: c.accentText, ...size('bodyStrong'), fontWeight: '600' },
  });
}

type BlockProps = { block: MdBlock; s: MdStyles; first: boolean; live: boolean };

/**
 * One top-level block, with the A5 entrance fade when `enter`. Memoized (chat/enterBlock.ts): unchanged blocks skip
 * the wrapper's re-render on a streaming tick; the stagger `delay` is taken on mount only.
 */
const EnterBlock = memo(function EnterBlock({ block, s, first, live, enter, delay }: BlockProps & { enter: boolean; delay: number }) {
  const [mountDelay] = useState(delay);
  const view = perfWrap(`md.${block.type}${live ? '' : '.done'}`, <BlockView block={block} s={s} first={first} live={live} />);
  return enter ? <FadeIn delay={mountDelay}>{view}</FadeIn> : view;
}, enterBlockPropsEqual);

const BlockView = memo(
  function BlockView({ block, s, first, live }: BlockProps) {
    const spacing = first ? s.first : s.block;
    switch (block.type) {
      case 'paragraph':
        return (
          <Text style={[s.p, s.measure, spacing]} selectable>
            <InlineText text={block.text} partial={live} s={s} d={!live} />
            {live ? <Caret s={s} /> : null}
          </Text>
        );
      case 'heading': {
        const hs = block.level === 1 ? s.h1 : block.level === 2 ? s.h2 : block.level === 3 ? s.h3 : s.h4;
        return (
          <Text style={[s.p, s.measure, hs, first && s.first]} accessibilityRole="header" selectable>
            <InlineText text={block.text} partial={live} s={s} d={!live} />
            {live ? <Caret s={s} /> : null}
          </Text>
        );
      }
      case 'code':
        return (
          <View style={spacing}>
            <CodeBlock lang={block.lang} code={dropFinalNewline(block.code)} s={s} />
          </View>
        );
      case 'list':
        return (
          <View style={[s.measure, spacing]}>
            <ListView block={block} s={s} live={live} depth={0} />
          </View>
        );
      case 'quote':
        return (
          <View style={[s.quote, s.measure, spacing]}>
            {block.blocks.map((b, i) => (
              <BlockView key={i} block={b} s={s} first={i === 0} live={live && i === block.blocks.length - 1} />
            ))}
          </View>
        );
      case 'table':
        return (
          <View style={spacing}>
            <TableView block={block} s={s} />
          </View>
        );
      case 'hr':
        return <View style={[s.hr, spacing]} />;
      case 'images':
        return (
          <View style={spacing}>
            <ImagesView items={block.items} />
          </View>
        );
    }
  },
  (a, b) => a.block.src === b.block.src && a.live === b.live && a.s === b.s && a.first === b.first,
);

/**
 * Parses + renders one inline run. Reads the citation switch from context, so memoized blocks re-parse
 * when an answer turns out to be cited (its sources list arrives at the end).
 */
function InlineText({ text, partial = false, s, d = false }: { text: string; partial?: boolean; s: MdStyles; d?: boolean }) {
  const { cites } = useMdFeatures();
  // finished runs: parse cache (a reopened chat does not parse its answers again)
  const nodes = useMemo(() => (partial ? parseInline(text, { partial, cites }) : finishedInline(text, cites)), [text, partial, cites]);
  return <InlineView nodes={nodes} s={s} d={d} />;
}

function Caret({ s }: { s: MdStyles }) {
  return <Text style={s.caret}> ●</Text>;
}

/**
 * `d` = entity auto-detection allowed here (finished paragraphs/headings/list items; never in code,
 * table cells, link labels or the live streaming block).
 */
function InlineView({ nodes, s, d = false }: { nodes: Inline[]; s: MdStyles; d?: boolean }): ReactNode {
  const f = useMdFeatures();
  const hl = useFindHighlight();
  const detect = d && f.entities;
  return nodes.map((n, i) => {
    switch (n.t) {
      case 'text': {
        // "." / "," / ")" right after inline code stays on the code's line
        const text = i > 0 && nodes[i - 1].t === 'code' ? bindAfterCode(n.s) : n.s;
        // "Im Chat suchen": matches marked (entity chips are skipped in a run with a match)
        if (hl && text) return <Highlighted key={i} text={text} hl={hl} />;
        return detect ? <DetectedText key={i} text={text} s={s} /> : text;
      }
      case 'fn':
        return f.footnotes ? (
          <FootnotePill key={i} n={n.n} raw={n.raw} />
        ) : (
          <Text key={i} style={s.fnRaw}>
            {`[${n.n}]`}
          </Text>
        );
      case 'br':
        return '\n';
      case 'code':
        // web: CSS padding (no padding spaces to break at or to copy) and short commands never split;
        // native has no per-span nowrap/padding, so the chip keeps its padding spaces
        return WEB ? (
          <Text key={i} style={[s.icode, s.icodeWeb, nowrapCode(n.s) && s.icodeNowrap]}>
            {n.s}
          </Text>
        ) : (
          <Text key={i} style={s.icode}>
            {` ${n.s} `}
          </Text>
        );
      case 'strong':
        return (
          <Text key={i} style={s.strong}>
            <InlineView nodes={n.c} s={s} d={d} />
          </Text>
        );
      case 'em':
        return (
          <Text key={i} style={s.em}>
            <InlineView nodes={n.c} s={s} d={d} />
          </Text>
        );
      case 'del':
        return (
          <Text key={i} style={s.del}>
            <InlineView nodes={n.c} s={s} d={d} />
          </Text>
        );
      case 'image':
        return <InlineImage key={i} href={n.href} alt={n.alt} s={s} />;
      case 'link': {
        if (/^\s*hui:/i.test(n.href)) {
          // A4: model-tagged entity → chip; unknown kinds (or entities off) → plain text, never a link
          const entity = f.entities ? parseHuiHref(n.href, inlineToPlain(n.c)) : null;
          return entity ? (
            <EntityChip key={i} entity={entity} fontSize={StyleSheet.flatten(s.p).fontSize ?? BODY_SIZE} />
          ) : (
            <Text key={i}>
              <InlineView nodes={n.c} s={s} />
            </Text>
          );
        }
        const href = safeHref(n.href);
        return (
          <Text
            key={i}
            style={href ? s.link : undefined}
            accessibilityRole={href ? 'link' : undefined}
            onPress={href ? () => Linking.openURL(href).catch(() => {}) : undefined}
          >
            <InlineView nodes={n.c} s={s} />
          </Text>
        );
      }
    }
  });
}

/** A4 auto-detection on a finished text run (memoized: re-renders of the block don't re-scan). */
const DetectedText = memo(function DetectedText({ text, s }: { text: string; s: MdStyles }) {
  const parts = useMemo(() => detectEntitiesCached(text), [text]);
  if (parts.length === 1 && typeof parts[0] === 'string') return <>{parts[0]}</>;
  const size = StyleSheet.flatten(s.p).fontSize ?? BODY_SIZE;
  return (
    <>
      {parts.map((p, k) => (typeof p === 'string' ? p : <EntityChip key={k} entity={p} fontSize={size} />))}
    </>
  );
});

/** `![alt](url)` inside running text: the alt text as a link to the picture. */
function InlineImage({ href, alt, s }: { href: string; alt: string; s: MdStyles }) {
  const base = useMarkdownImageBase();
  const tr = useT();
  const url = resolveImageUrl(href, base);
  return (
    <Text
      style={url ? s.link : undefined}
      accessibilityRole={url ? 'link' : undefined}
      onPress={url ? () => Linking.openURL(url).catch(() => {}) : undefined}
    >
      {alt || tr('ui.image.fullscreenNoLabel')}
    </Text>
  );
}

const SINGLE_MAX_WIDTH = 420;

/**
 * Standalone images of an answer: one → full width in its natural aspect (clamped), several → 2-column grid.
 * Tap → fullscreen viewer (swipe, share/save). Respects Settings → Medien → Bilder laden: when not allowed,
 * a "load image" button appears instead of fetching.
 */
function ImagesView({ items }: { items: { alt: string; href: string }[] }) {
  const t = useTheme();
  const tr = useT();
  const base = useMarkdownImageBase();
  const allowed = useImagesAllowed();
  const [forced, setForced] = useState(false);
  const [viewer, setViewer] = useState<number | null>(null);
  const imgs = useMemo(
    () => items.map((it) => ({ alt: it.alt, url: resolveImageUrl(it.href, base) })).filter((x): x is { alt: string; url: string } => !!x.url),
    [items, base],
  );
  // a single image keeps the ratio it had when it was last shown (no 4:3 → real-size jump on reopen)
  const [aspect, onNaturalSize] = useNaturalAspect(imgs.length === 1 ? imgs[0].url : null);
  if (!imgs.length) {
    // unresolvable (no base / unsafe scheme): keep the alt text instead of a broken box
    const text = items.map((i) => i.alt).filter(Boolean).join(' · ');
    return text ? <Text style={{ color: t.colors.muted, fontSize: 14 }}>{text}</Text> : null;
  }
  if (!allowed && !forced) {
    return (
      <Pressable
        onPress={() => setForced(true)}
        accessibilityRole="button"
        accessibilityLabel={imgs.length > 1 ? tr('ui.image.tapToLoadN', { count: imgs.length }) : tr('ui.image.tapToLoad')}
        style={({ pressed }) => [{ borderRadius: t.radii.m, borderWidth: StyleSheet.hairlineWidth, borderColor: t.colors.border, backgroundColor: pressed ? t.colors.surfacePressed : t.colors.surfaceAlt, padding: 14 }]}
      >
        <Text style={{ color: t.colors.accentText, fontSize: 15, fontWeight: '600' }}>{imgs.length > 1 ? tr('ui.image.tapToLoadN', { count: imgs.length }) : tr('ui.image.tapToLoad')}</Text>
        {imgs[0].alt && imgs.length === 1 ? <Text style={{ color: t.colors.muted, fontSize: 13, marginTop: 2 }}>{imgs[0].alt}</Text> : null}
      </Pressable>
    );
  }
  const lightbox: LightboxItem[] = imgs.map((i) => ({
    caption: i.alt || undefined,
    image: { url: i.url, thumbUrl: i.url, width: 0, height: 0, title: i.alt, attribution: { sourceUrl: i.url, provider: 'source' } },
  }));
  const box = (
    <ImageLightbox items={lightbox} index={viewer} onClose={() => setViewer(null)} />
  );
  if (imgs.length === 1) {
    const one = imgs[0];
    return (
      <View style={{ maxWidth: SINGLE_MAX_WIDTH }}>
        <Photo uri={one.url} aspect={Math.min(2.4, Math.max(0.6, aspect))} fit="contain" label={one.alt || undefined} onPress={() => setViewer(0)} onNaturalSize={onNaturalSize} />
        {box}
      </View>
    );
  }
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, maxWidth: SINGLE_MAX_WIDTH }}>
      {imgs.map((im, k) => (
        <View key={k} style={{ width: '48.5%' }}>
          <Photo uri={im.url} aspect={1} label={im.alt || undefined} onPress={() => setViewer(k)} />
        </View>
      ))}
      {box}
    </View>
  );
}

function ListView({ block, s, live, depth }: { block: Extract<MdBlock, { type: 'list' }>; s: MdStyles; live: boolean; depth: number }) {
  return (
    <View>
      {block.items.map((item, i) => (
        <ListItemView
          key={i}
          item={item}
          marker={item.checked !== null ? (item.checked ? '☑' : '☐') : block.ordered ? `${block.start + i}.` : depth === 0 ? '•' : depth === 1 ? '◦' : '▪'}
          ordered={block.ordered && item.checked === null}
          s={s}
          live={live && i === block.items.length - 1}
          depth={depth}
        />
      ))}
    </View>
  );
}

type ListItemProps = { item: MdListItem; marker: string; ordered: boolean; s: MdStyles; live: boolean; depth: number };

/** items are re-created by every parse of a live list: compare by content so finished items skip re-rendering */
function sameItem(a: MdListItem, b: MdListItem): boolean {
  if (a === b) return true;
  if (a.text !== b.text || a.checked !== b.checked || a.children.length !== b.children.length) return false;
  return a.children.every((c, i) => c.src === b.children[i].src);
}

const ListItemView = memo(
  function ListItemView({ item, marker, ordered, s, live, depth }: ListItemProps) {
    return (
      <View style={s.listRow}>
        <Text style={ordered ? s.num : s.bullet}>{marker}</Text>
        <View style={s.listBody}>
          <Text style={[s.p, item.checked === true && s.del]} selectable>
            <InlineText text={item.text} partial={live && !item.children.length} s={s} d={!live} />
            {live && !item.children.length ? <Caret s={s} /> : null}
          </Text>
          {item.children.map((child, ci) =>
            child.type === 'list' ? (
              <ListView key={ci} block={child} s={s} live={live && ci === item.children.length - 1} depth={depth + 1} />
            ) : (
              <BlockView key={ci} block={child} s={s} first={false} live={live && ci === item.children.length - 1} />
            ),
          )}
        </View>
      </View>
    );
  },
  (a: ListItemProps, b: ListItemProps) =>
    a.marker === b.marker && a.ordered === b.ordered && a.s === b.s && a.live === b.live && a.depth === b.depth && sameItem(a.item, b.item),
);

export function CodeBlock({ lang, code, s }: { lang: string; code: string; s: MdStyles }) {
  const t = useTheme();
  const tr = useT();
  const toast = useToast();
  const [copied, flashCopied] = useCopiedFlash();
  // Settings → Medien → Code umbrechen
  const wrap = usePreferences().prefs.codeWrap;
  const copy = () => {
    Clipboard.setStringAsync(code).catch(() => {});
    haptic('light');
    flashCopied();
    toast(tr('chat.code.copied'));
  };
  return (
    <View style={s.codeWrap}>
      <View style={s.codeHead}>
        <Text style={s.codeLang}>{lang || 'Code'}</Text>
        <Pressable onPress={copy} hitSlop={8} style={s.codeCopy} accessibilityRole="button" accessibilityLabel={tr('chat.code.copy')}>
          <Icon name={copied ? 'check' : 'copy'} size={14} color={copied ? t.colors.success : t.colors.muted} />
          <Text style={[s.codeCopyText, copied && { color: t.colors.success }]}>{copied ? tr('actions.copied') : tr('actions.copy')}</Text>
        </Pressable>
      </View>
      {wrap ? (
        <CodeText code={code} s={s} />
      ) : (
        <EdgeScroll fadeColor={t.colors.codeBg} hintLabel={tr('chat.code.scrollRight')} hintTop={12}>
          <CodeText code={code} s={s} />
        </EdgeScroll>
      )}
    </View>
  );
}

const CODE_CHUNK_LINES = 40;

/**
 * Long code: one Text per 40 lines (memoized by content), so a streaming code block only re-lays out
 * its last chunk instead of one huge Text per update. Short code stays a single Text.
 */
function CodeText({ code, s }: { code: string; s: MdStyles }) {
  const chunks = useMemo(() => {
    const lines = code.split('\n');
    if (lines.length <= CODE_CHUNK_LINES * 1.5) return null;
    const out: string[] = [];
    for (let i = 0; i < lines.length; i += CODE_CHUNK_LINES) out.push(lines.slice(i, i + CODE_CHUNK_LINES).join('\n'));
    return out;
  }, [code]);
  if (!chunks) {
    return (
      <Text style={s.codeText} selectable>
        {code}
      </Text>
    );
  }
  return (
    <View style={s.codeChunks}>
      {chunks.map((c, i) => (
        <CodeChunk key={i} text={c} s={s} />
      ))}
    </View>
  );
}

const CodeChunk = memo(function CodeChunk({ text, s }: { text: string; s: MdStyles }) {
  return (
    <Text style={[s.codeText, s.codeChunk]} selectable>
      {text}
    </Text>
  );
});

type TableRowProps = { row: string[]; widths: number[]; align: Align[]; s: MdStyles };

/** rows are re-created by every parse of a live table: compare by content (and column widths) */
const TableRow = memo(
  function TableRow({ row, widths, align, s }: TableRowProps) {
    return (
      <View style={s.tr}>
        {row.map((cell, ci) => (
          <View key={ci} style={[s.td, { width: widths[ci] }, ci === widths.length - 1 && { borderRightWidth: 0 }]}>
            <Text {...NARROW_TEXT_PROPS} style={[s.tdText, { textAlign: align[ci] ?? 'left' }]} selectable>
              <InlineText text={keepTogether(cell)} s={s} />
            </Text>
          </View>
        ))}
      </View>
    );
  },
  (a: TableRowProps, b: TableRowProps) =>
    a.s === b.s && sameStrings(a.row, b.row) && sameNumbers(a.widths, b.widths) && a.align.length === b.align.length && a.align.every((x, i) => x === b.align[i]),
);

function sameStrings(a: string[], b: string[]): boolean {
  return a === b || (a.length === b.length && a.every((x, i) => x === b[i]));
}

function sameNumbers(a: number[], b: number[]): boolean {
  return a === b || (a.length === b.length && a.every((x, i) => x === b[i]));
}

function TableView({ block, s }: { block: Extract<MdBlock, { type: 'table' }>; s: MdStyles }) {
  // the text grows with the app setting AND the OS font scale (RN applies it on top): so must the columns,
  // or numbers and ranges break mid-digit at 1.3 ("c. 1011–1 / 021")
  const t = useTheme();
  const tr = useT();
  const fontScale = t.fontScale * (useWindowDimensions().fontScale || 1);
  const widths = useMemo(
    () => block.header.map((h, ci) => markdownColumnWidth([h, ...block.rows.map((r) => r[ci] ?? '')], fontScale)),
    [block, fontScale],
  );
  const alignStyle = (ci: number): TextStyle => ({ textAlign: block.align[ci] ?? 'left' });
  return (
    <EdgeScroll fadeColor={t.colors.bg} hintLabel={tr('ui.table.scrollRight')}>
      <View style={s.table}>
        <View style={[s.tr, s.th]}>
          {block.header.map((h, ci) => (
            <View key={ci} style={[s.td, { width: widths[ci], borderTopWidth: 0 }, ci === widths.length - 1 && { borderRightWidth: 0 }]}>
              <Text {...NARROW_TEXT_PROPS} style={[s.thText, alignStyle(ci)]}>
                <InlineText text={h} s={s} />
              </Text>
            </View>
          ))}
        </View>
        {block.rows.map((row, ri) => (
          <TableRow key={ri} row={row} widths={widths} align={block.align} s={s} />
        ))}
      </View>
    </EdgeScroll>
  );
}
