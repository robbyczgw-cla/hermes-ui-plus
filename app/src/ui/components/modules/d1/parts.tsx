/**
 * Shared UI for the places / products modules: image with category fallback + trust-policy gate,
 * star rating, open-state line, carousel (snap + peek on phones, grid on wide screens), detail
 * sheet (bottom sheet on phones, centred dialog on wide screens), action tiles, skeleton card.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { shouldResetRail } from './railReset';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMotionReduced, useTheme, type Theme } from '../../../theme';
import { withAlpha } from '../../../color';
import { HText, PressableScale } from '../../../primitives/basics';
import { Skeleton } from '../../../primitives/Skeleton';
import { useHui } from '../../../primitives/context';
import { imageSourceFor, useImageGate, useImageProxyKey, useItemImage } from '../../../../images';
import { askPlaceholderLayout, fallbackHeight, photoInset, slotNeedsVisibility, slotShimmer, slotStatus, type SlotMode } from '../../../../images/slot';
import { ImageSlotGroup, useImageGroupHasImages, useImageSlot, useSlotCap } from '../../imageSlot';
import { useNearViewportWatch } from './useNearViewport';
import { useT } from '../../../../i18n';
import { D1Icon, StarGlyph, type D1IconName } from './icons';
import { useSettledAfter } from '../../../lib/useSettledAfter';
import { formatCount, formatRating, starFills, type NumLang, type OpenKind } from './d1Model.ts';
import { useEscapeToClose } from '../../../lib/useEscapeToClose';

/* ───────────── colours ───────────── */

const KIND_COLOR: Record<string, number> = { food: 3, cafe: 6, bar: 5, hotel: 0, sight: 7, park: 2, shop: 4, health: 1, pin: 0, headphones: 0, gamepad: 5, phone: 4, laptop: 7, watch: 5, camera: 3, screen: 2, box: 6 };

/** Category tint (from the categorical chart palette) for image fallbacks. */
export function kindColor(t: Theme, kind: string): string {
  const pal = t.colors.chart;
  return pal[(KIND_COLOR[kind] ?? 0) % pal.length] ?? t.colors.accent;
}

export function starColor(t: Theme): string {
  return t.dark ? '#F5B83D' : '#E8A10C';
}

/* ───────────── image ───────────── */

/** Subtle surface behind contained product photos (multiply blend drops their white backgrounds). */
export function productTileBg(t: Theme): string {
  return t.dark ? '#E4E4E8' : '#F3F3F5';
}

/**
 * Card / hero image for products / places items (strategy: images/itemImage.ts). Order: trusted `url` (or
 * any `url` with "Immer laden") → `query` → `autoQuery` (brand + name / name + city + category) through our
 * image search, started lazily once the card is near the viewport → untrusted `url` as a labelled
 * "Bild von <host> laden" placeholder (`allowAsk`: cards and detail sheet – the slot keeps its full size, the button sits
 * centred, clear of the corner badges) → tinted tile with the category glyph.
 * Never a broken image: a failing direct URL falls through to the search, a failing search photo to the glyph.
 * An answer-provided `url` goes through the user's bridge image proxy first when the bridge offers it (images/proxy.ts):
 * it shows at once and counts as a photo for the slot logic; if the proxy cannot deliver it, the chain continues
 * with the searches exactly like a failing direct URL.
 *
 * No photo (nothing found, no search available, or still nothing after IMAGE_SLOT_CAP_MS): the image area is not
 * reserved. Alone (or when no sibling in the surrounding ImageSlotGroup has a photo) the component renders nothing
 * (`onMode('collapse')` lets the parent move overlays/badges into the flow); next to cards that do have photos
 * it shrinks to a small tinted category tile so the cards stay aligned (images/slot.ts).
 * The search starts when the viewport watcher reports the card (nearly) visible; a card it has not reported within
 * IMAGE_SLOT_CAP_MS shows its category glyph instead of the shimmer (slotShimmer), and a view that cannot be measured
 * counts as visible (nearRegistry.ts) – every slot ends as photo, glyph or collapse.
 */
export function CardImage({
  query,
  autoQuery,
  url,
  kind,
  height,
  fit = 'cover',
  tile,
  enabled = true,
  allowAsk,
  webOnly,
  radius = 0,
  label,
  iconSize = 34,
  style,
  onPress,
  inline,
  onMode,
}: {
  query?: string;
  /** automatic search query derived from the item (productImageQuery / placeImageQuery) */
  autoQuery?: string;
  url?: string;
  kind: D1IconName;
  height: number;
  fit?: 'cover' | 'contain';
  /** product tile: subtle surface, inset photo */
  tile?: boolean;
  enabled?: boolean;
  /** show the tap-to-load placeholder for an answer URL that waits for a tap (cards and detail sheet) */
  allowAsk?: boolean;
  /** products: image searches use web search only, never Wikipedia/Wikimedia (wrong photos); none → category icon */
  webOnly?: boolean;
  radius?: number;
  label?: string;
  iconSize?: number;
  style?: StyleProp<ViewStyle>;
  /** tap on the image (e.g. open the details); rendered under the load button so buttons never nest. Hidden from screen readers – the card's own button carries the label. */
  onPress?: () => void;
  /** square thumbnail inside a row: the fallback tile keeps its size (text stays aligned) */
  inline?: boolean;
  /** reports what the slot renders, so the parent can drop wrappers / move overlays when it collapses */
  onMode?: (mode: SlotMode) => void;
}) {
  const t = useTheme();
  const tr = useT();
  const box = useRef<View>(null);
  // one-way latch: set by the viewport watcher below (registered only while this slot needs it)
  const [visible, setVisible] = useState(false);
  const markVisible = useCallback(() => setVisible(true), []);
  const [failed, setFailed] = useState<string | null>(null);
  // the answer URL whose direct / proxied load failed (the rendered uri may be the bridge proxy URL, not `url`)
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null);
  // a direct URL that failed to load is dropped → the chain continues with the searches
  const st = useItemImage({ image: url && (url === failed || url === failedUrl) ? undefined : url, imageQuery: query, autoQuery }, { visible, enabled, allowAsk, webOnly });
  const r = st.result;
  const uri = r.kind === 'image' ? r.image.url : r.kind === 'ask' ? r.url : null;
  const proxyKey = useImageProxyKey();
  // memoized: expo-image (web) refetches a header source whenever the object changes
  const source = useMemo(() => (uri ? imageSourceFor(uri) : null), [uri, proxyKey]);
  const gate = useImageGate(uri);
  const loading = st.status === 'loading';
  const showImg = r.kind === 'image' && !!uri && gate.allowed && failed !== uri;
  // a tap-to-load button counts as content; a photo that failed to load or a plain category icon does not
  const hasContent = (r.kind === 'image' && !!uri && failed !== uri) || r.kind === 'ask';
  const capKey = `${url ?? ''}|${query ?? ''}|${autoQuery ?? ''}`;
  // the lookup is capped from the moment it may run (seen) …
  const expired = useSlotCap(loading && visible, capKey);
  // … and so is waiting for that moment: past the cap an unseen slot shows its glyph instead of shimmering forever
  const waitExpired = useSlotCap(loading && !visible, capKey);
  const shimmer = slotShimmer({ loading, seen: visible, lookupCapPassed: expired, waitCapPassed: waitExpired });
  const mode = useImageSlot(slotStatus({ hasImage: hasContent, pending: st.status !== 'done', expired }));
  useEffect(() => {
    onMode?.(mode);
  }, [mode, onMode]);
  useNearViewportWatch(box, slotNeedsVisibility({ enabled, seen: visible, status: st.status, mode }), markVisible);
  const tint = kindColor(t, kind);
  const askShown = r.kind === 'ask' && !gate.allowed;
  const ask = askPlaceholderLayout(height, iconSize);
  const bg = tile && showImg ? productTileBg(t) : withAlpha(tint, t.dark ? 0.2 : 0.12);
  const inset = photoInset({ tile, fit, height });
  if (mode === 'collapse') return null;
  if (mode === 'fallback') {
    const fh = inline ? height : fallbackHeight(height);
    return (
      <View
        style={[{ height: fh, borderRadius: radius, overflow: 'hidden', backgroundColor: withAlpha(tint, t.dark ? 0.2 : 0.12), alignItems: 'center', justifyContent: 'center' }, style]}
        accessible={!!label}
        accessibilityRole={label ? 'image' : undefined}
        accessibilityLabel={label}
      >
        <D1Icon name={kind} size={Math.min(iconSize, Math.max(18, Math.round(fh * 0.45)))} color={tint} strokeWidth={1.5} />
      </View>
    );
  }
  return (
    <View
      ref={box}
      style={[{ height, borderRadius: radius, overflow: 'hidden', backgroundColor: bg }, tile && !t.dark ? { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: t.colors.border } : null, style]}
      accessible={!!label}
      accessibilityRole={label ? 'image' : undefined}
      accessibilityLabel={label}
    >
      {/* fallback glyph sits underneath; a loaded photo covers it (the tap-to-load placeholder brings its own) */}
      {!askShown && (!showImg || loaded !== uri) ? (
        <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
          {shimmer ? null : <D1Icon name={kind} size={iconSize} color={tint} strokeWidth={1.5} />}
        </View>
      ) : null}
      {shimmer ? <Skeleton width="100%" height={null} radius={0} style={StyleSheet.absoluteFill} /> : null}
      {showImg ? (
        <View style={[StyleSheet.absoluteFill, { margin: inset }, tile && fit === 'contain' ? { mixBlendMode: 'multiply' } : null]}>
          <Image
            source={source ?? { uri }}
            recyclingKey={uri}
            style={StyleSheet.absoluteFill}
            contentFit={fit}
            transition={220}
            onLoad={() => setLoaded(uri)}
            onError={() => {
              setFailed(uri);
              if (r.kind === 'image' && r.step === 'direct' && url) setFailedUrl(url);
            }}
          />
        </View>
      ) : null}
      {onPress ? <Pressable onPress={onPress} accessible={false} aria-hidden tabIndex={-1} style={StyleSheet.absoluteFill} /> : null}
      {askShown ? (
        // centred column (glyph + button), padded on all sides: never clipped, never under a corner badge
        <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', gap: 8, padding: 8 }]}>
          {ask.glyph ? (
            <View pointerEvents="none">
              <D1Icon name={kind} size={iconSize} color={tint} strokeWidth={1.5} />
            </View>
          ) : null}
          <Pressable
            onPress={gate.unlock}
            accessibilityRole="button"
            accessibilityLabel={tr('ui.places.loadImageFrom', { host: gate.host || '?' })}
            hitSlop={8}
            style={({ pressed }) => ({
              maxWidth: '100%',
              minHeight: ask.buttonH,
              minWidth: ask.buttonH,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              paddingHorizontal: ask.compact ? 0 : 14,
              borderRadius: 18,
              backgroundColor: pressed ? 'rgba(0,0,0,0.72)' : 'rgba(0,0,0,0.58)',
            })}
          >
            <D1Icon name="external" size={ask.compact ? 14 : 13} color="#fff" strokeWidth={2} />
            {ask.compact ? null : (
              <HText variant="caption" weight="600" style={{ color: '#fff', flexShrink: 1 }} numberOfLines={1}>
                {tr('ui.places.loadImageFrom', { host: gate.host || '?' })}
              </HText>
            )}
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

/* ───────────── rating / open state ───────────── */

export function Stars({ rating, size = 12 }: { rating: number; size?: number }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 1 }}>
      {starFills(rating).map((f, i) => (
        <StarGlyph key={i} fill={f} size={size} color={starColor(t)} track={t.dark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.12)'} />
      ))}
    </View>
  );
}

/** "4,6 ★★★★½ (2.345)" – hidden from screen readers (the card label says it in words). */
export function RatingRow({ rating, reviews, lang, size = 12, long }: { rating: number; reviews?: number; lang: NumLang; size?: number; long?: boolean }) {
  const tr = useT();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }} aria-hidden>
      <HText variant="caption" weight="600" tabular>
        {formatRating(rating, lang)}
      </HText>
      <Stars rating={rating} size={size} />
      {reviews !== undefined ? (
        <HText variant="caption" color="muted" tabular numberOfLines={1} style={{ flexShrink: 1 }}>
          {long ? tr('ui.places.reviews', { n: reviews, count: formatCount(reviews, lang) }) : `(${formatCount(reviews, lang)})`}
        </HText>
      ) : null}
    </View>
  );
}

/** Coloured dot + "Geöffnet" (coloured) + " · bis 23:00" (muted). */
export function OpenLine({ kind, text, variant = 'caption' }: { kind: OpenKind; text: string; variant?: 'caption' | 'callout' }) {
  const t = useTheme();
  const color = kind === 'open' ? t.colors.success : kind === 'closed' ? t.colors.danger : t.colors.muted;
  const i = text.indexOf(' · ');
  const head = i > 0 ? text.slice(0, i) : text;
  const tail = i > 0 ? text.slice(i) : '';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }} aria-hidden>
      {kind === 'unknown' ? <D1Icon name="clock" size={13} color={color} /> : <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color }} />}
      <HText variant={variant} numberOfLines={1} style={{ flexShrink: 1 }}>
        <HText variant={variant} weight="600" style={{ color }}>
          {head}
        </HText>
        {tail ? (
          <HText variant={variant} color="muted">
            {tail}
          </HText>
        ) : null}
      </HText>
    </View>
  );
}

/* ───────────── layout: rail / grid ───────────── */

export type RailLayout = { mode: 'rail' | 'grid'; cardW: number; cols: number; gap: number };

/** Phones: horizontal rail with the next card peeking; ≥ 640 px (or `grid`): wrapping grid. */
export function railLayout(w: number, opts: { peek: number; maxCard: number; minGridCard: number; grid?: boolean; gap?: number }): RailLayout {
  const gap = opts.gap ?? 10;
  if (w <= 0) return { mode: 'rail', cardW: 0, cols: 1, gap };
  if (opts.grid || w >= 640) {
    const cols = Math.max(2, Math.floor((w + gap) / (opts.minGridCard + gap)));
    return { mode: 'grid', cardW: Math.floor((w - gap * (cols - 1)) / cols), cols, gap };
  }
  return { mode: 'rail', cardW: Math.min(opts.maxCard, Math.round(w * opts.peek)), cols: 1, gap };
}

/**
 * Cards in a snapping rail (native: snapToInterval; web: CSS scroll-snap + ‹ › buttons for mouse
 * users) or a grid. `arrowTop` = vertical centre for the web arrows (middle of the image).
 */
export function Rail({ layout, count, label, arrowTop, children }: { layout: RailLayout; count: number; label: string; arrowTop: number; children: ReactNode }) {
  const t = useTheme();
  const tr = useT();
  const ref = useRef<ScrollView>(null);
  const [x, setX] = useState(0);
  const [viewW, setViewW] = useState(0);
  const { streaming } = useHui();
  // Start at the first card: streaming growth (and web scroll-snap) must not leave the rail
  // parked on a later card, unless the user scrolled it themselves.
  const xRef = useRef(0);
  const userScrolled = useRef(false);
  const prevStreaming = useRef(streaming);
  const resetIfNeeded = () => {
    if (shouldResetRail({ streaming, prevStreaming: prevStreaming.current, userScrolled: userScrolled.current, x: xRef.current })) {
      ref.current?.scrollTo({ x: 0, animated: false });
      xRef.current = 0;
      setX(0);
    }
  };
  useEffect(() => {
    resetIfNeeded();
    if (!streaming) {
      // layout can still settle right after completion: keep resetting for a moment
      const id = setTimeout(() => {
        prevStreaming.current = false;
      }, 800);
      return () => clearTimeout(id);
    }
    prevStreaming.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming, count]);
  const markManual = () => {
    userScrolled.current = true;
  };
  if (layout.mode === 'grid') {
    return (
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: layout.gap }} accessibilityLabel={label}>
        {children}
      </View>
    );
  }
  const step = layout.cardW + layout.gap;
  const web = Platform.OS === 'web';
  const contentW = count * step - layout.gap;
  const canPrev = x > 4;
  const canNext = x + viewW < contentW - 4;
  const go = (dir: 1 | -1) => {
    markManual();
    const page = Math.round(x / step) + dir;
    ref.current?.scrollTo({ x: Math.max(0, Math.min(contentW - viewW, page * step)), animated: true });
  };
  return (
    <View onLayout={(e) => setViewW(e.nativeEvent.layout.width)}>
      <ScrollView
        ref={ref}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={web ? undefined : step}
        snapToAlignment="start"
        decelerationRate="fast"
        disableIntervalMomentum
        scrollEventThrottle={48}
        onScroll={(e) => {
          xRef.current = e.nativeEvent.contentOffset.x;
          if (web) setX(xRef.current);
        }}
        onScrollBeginDrag={markManual}
        onTouchStart={markManual}
        {...(web ? ({ onWheel: markManual } as object) : null)}
        onContentSizeChange={resetIfNeeded}
        contentContainerStyle={{ gap: layout.gap, paddingRight: 2 }}
        style={web ? ({ scrollSnapType: 'x mandatory', overscrollBehaviorX: 'contain' } as object) : undefined}
        accessibilityLabel={label}
      >
        {children}
      </ScrollView>
      {web && count > 1 ? (
        <>
          {canPrev ? <RailArrow dir="prev" top={arrowTop} label={tr('ui.places.prev')} onPress={() => go(-1)} t={t} /> : null}
          {canNext ? <RailArrow dir="next" top={arrowTop} label={tr('ui.places.next')} onPress={() => go(1)} t={t} /> : null}
        </>
      ) : null}
    </View>
  );
}

/** Web-only snap alignment for a rail card. */
export const SNAP_START = (Platform.OS === 'web' ? { scrollSnapAlign: 'start' } : {}) as ViewStyle;

function RailArrow({ dir, top, label, onPress, t }: { dir: 'prev' | 'next'; top: number; label: string; onPress: () => void; t: Theme }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => ({
        position: 'absolute',
        top: top - 18,
        [dir === 'prev' ? 'left' : 'right']: 6,
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: t.colors.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: t.colors.borderStrong,
        opacity: pressed ? 0.85 : hovered ? 1 : 0.94,
        ...t.shadows.md,
      })}
    >
      <HText variant="headline" style={{ marginTop: -2 }}>
        {dir === 'prev' ? '‹' : '›'}
      </HText>
    </Pressable>
  );
}

/* ───────────── header / labels ───────────── */

export function SectionLabel({ text, right }: { text: string; right?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.s, minHeight: 20 }}>
      <HText variant="micro" color="muted" style={{ flex: 1, textTransform: 'uppercase', letterSpacing: 0.7 }} accessibilityRole="header">
        {text}
      </HText>
      {right}
    </View>
  );
}

/** Quiet pill button for the module header ("Alle auf Karte", "Vergleichen"). */
export function HeaderPill({ icon, label, onPress, active, disabled, a11yLabel }: { icon: D1IconName; label: string; onPress: () => void; active?: boolean; disabled?: boolean; a11yLabel?: string }) {
  const t = useTheme();
  const fg = active ? t.colors.onAccent : t.colors.text;
  return (
    <PressableScale
      haptic="selection"
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={a11yLabel ?? label}
      accessibilityState={{ selected: !!active }}
      hitSlop={4}
      style={{ minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, borderRadius: t.radii.pill, backgroundColor: active ? t.colors.accent : t.colors.surfaceAlt, borderWidth: active ? 0 : StyleSheet.hairlineWidth, borderColor: t.colors.border }}
      pressedStyle={{ opacity: 0.85 }}
    >
      <D1Icon name={icon} size={15} color={fg} strokeWidth={2} />
      <HText variant="caption" weight="600" style={{ color: fg }} numberOfLines={1}>
        {label}
      </HText>
    </PressableScale>
  );
}

/** Icon-over-label action ("Route", "Anrufen" …). `tone='accent'` for the primary one. */
export function ActionTile({ icon, label, a11yLabel, onPress, tone = 'neutral', active, disabled, big }: { icon: D1IconName; label: string; a11yLabel: string; onPress: () => void; tone?: 'neutral' | 'accent'; active?: boolean; disabled?: boolean; big?: boolean }) {
  const t = useTheme();
  const accent = tone === 'accent' || active;
  const fg = accent ? t.colors.accent : t.colors.text;
  if (big) {
    return (
      <PressableScale haptic="selection" onPress={onPress} disabled={disabled} accessibilityLabel={a11yLabel} accessibilityState={{ selected: !!active }} style={{ flex: 1, alignItems: 'center', gap: 6, minHeight: 64, paddingVertical: 2 }}>
        <View style={{ width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: tone === 'accent' ? t.colors.accent : active ? t.colors.accentSoft : t.colors.surfaceAlt }}>
          <D1Icon name={icon} size={19} color={tone === 'accent' ? t.colors.onAccent : fg} strokeWidth={2} />
        </View>
        <HText variant="caption" weight="500" numberOfLines={1} style={{ color: tone === 'accent' ? t.colors.accent : fg }}>
          {label}
        </HText>
      </PressableScale>
    );
  }
  return (
    <PressableScale
      haptic="selection"
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={a11yLabel}
      accessibilityState={{ selected: !!active }}
      style={{ flex: 1, minHeight: 50, alignItems: 'center', justifyContent: 'center', gap: 3, borderRadius: t.radii.m, backgroundColor: accent ? t.colors.accentSoft : t.colors.surfaceAlt, paddingHorizontal: 2 }}
      pressedStyle={{ backgroundColor: t.colors.surfacePressed }}
    >
      <D1Icon name={icon} size={17} color={fg} strokeWidth={2} />
      <HText variant="micro" weight="600" numberOfLines={1} style={{ color: fg, fontSize: 11.5 }}>
        {label}
      </HText>
    </PressableScale>
  );
}

/** Generic pill button (primary / secondary / success state). */
export function PillButton({ label, icon, onPress, kind = 'secondary', disabled, a11yLabel, style, small }: { label: string; icon?: D1IconName; onPress: () => void; kind?: 'primary' | 'secondary' | 'success'; disabled?: boolean; a11yLabel?: string; style?: StyleProp<ViewStyle>; small?: boolean }) {
  const t = useTheme();
  const bg = kind === 'primary' ? t.colors.accent : kind === 'success' ? t.colors.successSoft : t.colors.surfaceAlt;
  const fg = kind === 'primary' ? t.colors.onAccent : kind === 'success' ? t.colors.success : t.colors.text;
  return (
    <PressableScale
      haptic={kind === 'primary' ? 'light' : 'selection'}
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={a11yLabel ?? label}
      style={[{ minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: small ? 10 : 16, borderRadius: t.radii.pill, backgroundColor: bg, borderWidth: kind === 'secondary' ? StyleSheet.hairlineWidth : 0, borderColor: t.colors.borderStrong }, style]}
      pressedStyle={{ opacity: 0.86 }}
    >
      {icon ? <D1Icon name={icon} size={small ? 14 : 16} color={fg} strokeWidth={2.1} /> : null}
      <HText variant={small ? 'caption' : 'callout'} weight="600" style={{ color: fg, flexShrink: 1 }} numberOfLines={small ? 2 : 1} align="center">
        {label}
      </HText>
    </PressableScale>
  );
}

/* ───────────── skeleton card ───────────── */

export function SkeletonCard({ width, imageH, lines = 3, style }: { width: number | `${number}%`; imageH: number; lines?: number; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return (
    <View style={[{ width, borderRadius: t.radii.l, overflow: 'hidden', backgroundColor: t.colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: t.colors.border }, SNAP_START, style]} aria-hidden>
      <Skeleton height={imageH} radius={0} />
      <View style={{ padding: t.spacing.m, gap: 9 }}>
        <Skeleton width="72%" height={14} />
        {Array.from({ length: lines }, (_, i) => (
          <Skeleton key={i} width={i % 2 ? '45%' : '58%'} height={10} />
        ))}
        <Skeleton height={44} radius={t.radii.m} style={{ marginTop: 4 }} />
      </View>
    </View>
  );
}

/* ───────────── detail sheet ───────────── */

/**
 * Detail sheet: bottom sheet on phones (slides up), centred dialog on wide screens (fades/scales in).
 * Reduce-motion → no movement. Scrim tap, the close button, Android back and Esc (web) close it.
 */
export function DetailSheet({ open, onClose, label, hero, children, footer }: { open: boolean; onClose: () => void; label: string; hero?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <Modal visible={open} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent supportedOrientations={['portrait', 'landscape']}>
      {open ? (
        <SheetBody onClose={onClose} label={label} hero={hero} footer={footer}>
          {children}
        </SheetBody>
      ) : null}
    </Modal>
  );
}

/** Room for the close button when the hero photo is missing (the sheet then starts with its text). */
function HeroTopSpace() {
  return useImageGroupHasImages() ? null : <View style={{ height: 44 }} />;
}

/** Grab handle: white on a photo, neutral on the sheet surface when there is no photo. */
function SheetHandle({ hero }: { hero: boolean }) {
  const t = useTheme();
  const photo = useImageGroupHasImages() && hero;
  return <View pointerEvents="none" style={{ position: 'absolute', top: 7, alignSelf: 'center', width: 38, height: 4, borderRadius: 2, backgroundColor: photo ? 'rgba(255,255,255,0.75)' : t.colors.borderStrong }} />;
}

function SheetBody({ onClose, label, hero, children, footer }: { onClose: () => void; label: string; hero?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  useEscapeToClose(true, onClose); // web: Esc closes the detail sheet (place sheet, …)
  const t = useTheme();
  const tr = useT();
  const reduced = useMotionReduced();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const wide = width >= 720;
  const p = useSharedValue(reduced ? 1 : 0);
  const closing = useRef(false);
  const [closingNow, setClosingNow] = useState(false);
  useEffect(() => {
    if (!reduced) p.value = withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) });
  }, [p, reduced]);
  // once open, React owns the end state (ui/lib/fadeIn.ts): a dropped animated value must not leave the
  // sheet 420 px below the screen / the scrim transparent while the Modal blocks the chat
  const settled = useSettledAfter(reduced ? 0 : 340) && !closingNow;
  const close = () => {
    if (closing.current) return;
    closing.current = true;
    setClosingNow(true);
    if (reduced) return onClose();
    p.value = withTiming(0, { duration: 180, easing: Easing.in(Easing.quad) }, (fin) => {
      if (fin) runOnJS(onClose)();
    });
    // the animation callback may never run (interrupted / backgrounded): close anyway
    setTimeout(onClose, 300);
  };
  const scrim = useAnimatedStyle(() => ({ opacity: p.value }));
  const sheet = useAnimatedStyle(() => (wide ? { opacity: p.value, transform: [{ scale: 0.96 + 0.04 * p.value }] } : { transform: [{ translateY: (1 - p.value) * 420 }] }), [wide]);
  const r = 22;
  return (
    <View style={StyleSheet.absoluteFill}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: t.colors.overlay }, scrim, settled ? { opacity: 1 } : null]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel={tr('ui.places.close')} accessibilityRole="button" />
      </Animated.View>
      <View style={[StyleSheet.absoluteFill, { justifyContent: wide ? 'center' : 'flex-end', alignItems: 'center', padding: wide ? 24 : 0 }]} pointerEvents="box-none">
        <ImageSlotGroup>
        <Animated.View
          accessibilityViewIsModal
          aria-modal
          accessibilityLabel={label}
          style={[
            {
              width: '100%',
              maxWidth: wide ? 560 : 640,
              maxHeight: wide ? height * 0.88 : height * 0.92 - insets.top,
              backgroundColor: t.dark ? t.colors.surface : t.colors.bg,
              borderTopLeftRadius: r,
              borderTopRightRadius: r,
              borderBottomLeftRadius: wide ? r : 0,
              borderBottomRightRadius: wide ? r : 0,
              overflow: 'hidden',
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: t.colors.border,
              ...t.shadows.lg,
            },
            sheet,
            settled ? (wide ? { opacity: 1, transform: [{ scale: 1 }] } : { transform: [{ translateY: 0 }] }) : null,
          ]}
        >
          <ScrollView bounces={false} contentContainerStyle={{ paddingBottom: footer ? t.spacing.l : Math.max(insets.bottom, 12) + t.spacing.l }}>
            {hero ? <HeroTopSpace /> : null}
            {hero}
            {children}
          </ScrollView>
          {!wide ? <SheetHandle hero={!!hero} /> : null}
          <Pressable
            onPress={close}
            accessibilityRole="button"
            accessibilityLabel={tr('ui.places.close')}
            hitSlop={8}
            style={({ pressed }) => ({ position: 'absolute', top: 12, right: 12, width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? 'rgba(0,0,0,0.65)' : 'rgba(0,0,0,0.45)' })}
          >
            <D1Icon name="x" size={18} color="#fff" strokeWidth={2.3} />
          </Pressable>
          {footer ? (
            <View style={{ paddingHorizontal: t.spacing.l, paddingTop: t.spacing.m, paddingBottom: Math.max(insets.bottom, 12) + 4, borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.colors.border, backgroundColor: t.dark ? t.colors.surface : t.colors.bg }}>{footer}</View>
          ) : null}
        </Animated.View>
        </ImageSlotGroup>
      </View>
    </View>
  );
}

/** Label/value row for sheets (hours, specs, contact). */
export function InfoRow({ label, value, strong, last, right, onPress, a11y }: { label?: string; value: string; strong?: boolean; last?: boolean; right?: ReactNode; onPress?: () => void; a11y?: string }) {
  const t = useTheme();
  const body = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.m, minHeight: 44, paddingVertical: 8, borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth, borderColor: t.colors.border }}>
      {label !== undefined ? (
        <HText variant="callout" color={strong ? 'text' : 'muted'} weight={strong ? '600' : '400'} style={{ width: '38%' }} numberOfLines={2}>
          {label}
        </HText>
      ) : null}
      <HText variant="callout" weight={strong ? '600' : '400'} color={onPress ? 'accent' : 'text'} style={{ flex: 1 }} selectable={!onPress}>
        {value}
      </HText>
      {right}
    </View>
  );
  if (!onPress) return <View accessible accessibilityLabel={a11y ?? (label ? `${label}: ${value}` : value)}>{body}</View>;
  return (
    <PressableScale haptic="selection" scaleTo={0.99} onPress={onPress} accessibilityLabel={a11y ?? value} accessibilityRole="link">
      {body}
    </PressableScale>
  );
}
