/**
 * Shared pieces for resolved images (image node, gallery, thumbnails): shimmer → fade-in photo,
 * tiny attribution line (tap → source page), thumbnails and a fullscreen lightbox.
 * Never shows a broken image: failures render a subtle placeholder glyph or nothing.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { useTheme } from '../theme';
import { useHui } from '../primitives/context';
import { HText, PressableScale } from '../primitives/basics';
import { Icon } from '../primitives/Icon';
import { Skeleton } from '../primitives/Skeleton';
import { attributionText, attributionUrl, useImageGate, useResolvedImage, type ResolvedImage } from '../../images';
import { useT } from '../../i18n';
import { shareImageUrl } from '../../images/share';
import { useImageEdit } from '../../imageedit/context';
import { useEscapeToClose } from '../lib/useEscapeToClose';
import { knownAspect, rememberAspect } from '../lib/aspectCache';
import { fallbackHeight, slotStatus } from '../../images/slot';
import { FallbackTile, useImageSlot, useSlotCap } from './imageSlot';

/** Simple "photo" glyph for placeholders (not in the shared icon set). */
export function ImageGlyph({ size = 20, color }: { size?: number; color: string }) {
  const p = { stroke: color, strokeWidth: 1.6, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x={3} y={4} width={18} height={16} rx={2.5} {...p} />
      <Circle cx={9} cy={9.5} r={1.6} {...p} />
      <Path d="M3.5 17.5 9 12.5l3.5 3 3-2.5 5 4.5" {...p} />
    </Svg>
  );
}

/**
 * Aspect ratio of an image without a known size, for `<Photo aspect onNaturalSize>`: the ratio it had when it was
 * last shown (ui/lib/aspectCache.ts, so a reopened chat does not reflow), `fallback` before its first load.
 */
export function useNaturalAspect(uri: string | null, fallback = 4 / 3): [number, (width: number, height: number) => void] {
  const [measured, setMeasured] = useState<{ uri: string | null; aspect: number } | null>(null);
  const aspect = measured && measured.uri === uri ? measured.aspect : (knownAspect(uri) ?? fallback);
  const onNaturalSize = useCallback(
    (width: number, height: number) => {
      const a = rememberAspect(uri, width, height);
      if (a !== undefined) setMeasured({ uri, aspect: a });
    },
    [uri],
  );
  return [aspect, onNaturalSize];
}

/** Rounded photo box: shimmer until loaded, then fade-in; load error → placeholder glyph. */
export function Photo({
  uri,
  aspect,
  height,
  fit = 'cover',
  radius,
  onPress,
  label,
  style,
  onNaturalSize,
  onError,
}: {
  uri: string | null;
  aspect?: number;
  height?: number;
  fit?: 'cover' | 'contain';
  radius?: number;
  onPress?: () => void;
  label?: string;
  style?: StyleProp<ViewStyle>;
  /** reports the decoded pixel size once loaded (for aspect handling of images without known size) */
  onNaturalSize?: (width: number, height: number) => void;
  /** the image could not be loaded (callers like Thumb drop the whole slot instead of showing the glyph) */
  onError?: () => void;
}) {
  const tr = useT();
  const t = useTheme();
  const editor = useImageEdit();
  // load state is keyed by uri (derived, no reset effect needed when the uri changes)
  const [load, setLoad] = useState<{ uri: string | null; s: 'ok' | 'error' } | null>(null);
  const state = load && load.uri === uri ? load.s : 'loading';
  const setState = (s: 'ok' | 'error') => setLoad({ uri, s });
  const r = radius ?? t.radii.l;
  // security review H1: unknown hosts (model-written URLs) load only after a tap (images/trust.ts)
  const gate = useImageGate(uri);
  if (uri && !gate.allowed) {
    return <ImageConsent host={gate.host} onLoad={gate.unlock} radius={r} aspect={aspect} height={height} style={style} />;
  }
  const box = (
    <View
      style={[
        { width: '100%', borderRadius: r, overflow: 'hidden', backgroundColor: t.colors.surfaceAlt, borderWidth: StyleSheet.hairlineWidth, borderColor: t.colors.border },
        height !== undefined ? { height } : { aspectRatio: aspect ?? 4 / 3 },
        style,
      ]}
    >
      {uri && state !== 'error' ? (
        <Image
          source={{ uri }}
          recyclingKey={uri}
          style={StyleSheet.absoluteFill}
          contentFit={fit}
          transition={260}
          accessibilityLabel={label}
          onLoad={(e) => {
            setState('ok');
            if (onNaturalSize && e.source?.width > 0 && e.source?.height > 0) onNaturalSize(e.source.width, e.source.height);
          }}
          onError={() => {
            setState('error');
            onError?.();
          }}
        />
      ) : null}
      {uri && state === 'loading' ? <Skeleton width="100%" height={null} radius={0} style={StyleSheet.absoluteFill} /> : null}
      {!uri || state === 'error' ? (
        <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
          <ImageGlyph color={t.colors.subtle} size={22} />
        </View>
      ) : null}
    </View>
  );
  if (!onPress || !uri || state === 'error') return box;
  return (
    <PressableScale
      haptic="selection"
      scaleTo={0.985}
      onPress={onPress}
      // chat images: long-press → "✨ Bearbeiten" sheet
      onLongPress={editor ? () => editor.open({ uri, label }) : undefined}
      delayLongPress={380}
      accessibilityRole="imagebutton"
      accessibilityLabel={label ? tr('ui.image.fullscreen', { label }) : tr('ui.image.fullscreenNoLabel')}
      accessibilityHint={editor ? tr('imageEdit.longPressHint') : undefined}
      accessibilityActions={editor ? [{ name: 'activate' }, { name: 'longpress', label: tr('imageEdit.actionA11y') }] : undefined}
      onAccessibilityAction={editor ? (e) => (e.nativeEvent.actionName === 'longpress' ? editor.open({ uri, label }) : onPress()) : undefined}
    >
      {box}
    </PressableScale>
  );
}

/** Tap-to-load box for an image on an unknown host: nothing is fetched until the user taps. */
export function ImageConsent({ host, onLoad, radius, aspect, height, style, dark }: { host: string; onLoad: () => void; radius?: number; aspect?: number; height?: number; style?: StyleProp<ViewStyle>; dark?: boolean }) {
  const tr = useT();
  const t = useTheme();
  const label = tr('ui.image.loadFrom', { host: host || '?' });
  const fg = dark ? '#fff' : t.colors.accent;
  return (
    <Pressable
      onPress={onLoad}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={tr('ui.image.loadFromHint')}
      style={({ pressed }) => [
        { width: '100%', borderRadius: radius ?? t.radii.l, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 12 },
        dark ? { backgroundColor: pressed ? 'rgba(255,255,255,0.12)' : 'transparent' } : { backgroundColor: pressed ? t.colors.surfacePressed : t.colors.surfaceAlt, borderWidth: StyleSheet.hairlineWidth, borderColor: t.colors.border },
        height !== undefined ? { height } : { aspectRatio: aspect ?? 4 / 3, minHeight: 72 },
        style,
      ]}
    >
      <ImageGlyph color={dark ? '#fff' : t.colors.subtle} size={22} />
      <Text style={{ color: fg, fontSize: 14, fontWeight: '600', textAlign: 'center' }} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

/** One fullscreen page; unknown hosts show the tap-to-load box instead of fetching (H1). */
function LightboxImage({ item, width, height, onClose }: { item: LightboxItem; width: number; height: number; onClose: () => void }) {
  const tr = useT();
  const gate = useImageGate(item.image.url);
  if (!gate.allowed) {
    return (
      <View style={{ width, height, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
        <ImageConsent host={gate.host} onLoad={gate.unlock} dark height={160} />
      </View>
    );
  }
  return (
    <Pressable onPress={onClose} style={{ width, height }} accessibilityLabel={tr('ui.image.close')}>
      <Image source={{ uri: item.image.url }} placeholder={{ uri: item.image.thumbUrl }} style={{ width, height }} contentFit="contain" transition={200} accessibilityLabel={item.caption ?? item.image.title} />
    </Pressable>
  );
}

/** "Foto: Autor · Lizenz · Wikimedia" – tap opens the file page (license + full credits). */
export function AttributionLine({ image, align = 'left' }: { image: ResolvedImage; align?: 'left' | 'center' }) {
  const tr = useT();
  const { onAction } = useHui();
  const text = attributionText(image.attribution, undefined, tr);
  if (!text) return null;
  // never link to the user's own bridge / LAN (proxied images link to their original)
  const url = attributionUrl(image.attribution);
  if (!url) {
    return (
      <HText variant="micro" color="subtle" numberOfLines={1} style={{ fontWeight: '400', alignSelf: align === 'center' ? 'center' : 'flex-start', maxWidth: '100%' }}>
        {text}
      </HText>
    );
  }
  return (
    <Pressable
      onPress={() => onAction({ type: 'open_url', url })}
      hitSlop={6}
      accessibilityRole="link"
      accessibilityLabel={tr('ui.image.openSource', { text })}
      style={{ alignSelf: align === 'center' ? 'center' : 'flex-start', maxWidth: '100%' }}
    >
      <HText variant="micro" color="subtle" numberOfLines={1} style={{ fontWeight: '400' }}>
        {text}
      </HText>
    </Pressable>
  );
}

export type LightboxItem = { image: ResolvedImage; caption?: string };

/** Fullscreen viewer, swipe between items. Tap the credit line to open the source. */
export function ImageLightbox({ items, index, onClose }: { items: LightboxItem[]; index: number | null; onClose: () => void }) {
  return (
    <Modal visible={index !== null && items.length > 0} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent supportedOrientations={['portrait', 'landscape']}>
      {index !== null && items.length > 0 ? <LightboxBody items={items} start={Math.min(index, items.length - 1)} onClose={onClose} /> : null}
    </Modal>
  );
}

function LightboxBody({ items, start, onClose }: { items: LightboxItem[]; start: number; onClose: () => void }) {
  useEscapeToClose(true, onClose);
  const tr = useT();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { onAction } = useHui();
  const editor = useImageEdit();
  const [page, setPage] = useState(start);
  const ref = useRef<ScrollView>(null);
  useEffect(() => {
    // contentOffset isn't honored everywhere (web) → scroll after layout
    const id = setTimeout(() => ref.current?.scrollTo({ x: start * width, animated: false }), 0);
    return () => clearTimeout(id);
  }, [start, width]);
  const cur = items[page] ?? items[0];
  // share / edit download the image: only once it may load (H1)
  const curGate = useImageGate(cur.image.url);
  const credit = attributionText(cur.image.attribution, undefined, tr);
  const creditUrl = attributionUrl(cur.image.attribution);
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }]}>
      <ScrollView
        ref={ref}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={32}
        onScroll={(e) => setPage(Math.max(0, Math.min(items.length - 1, Math.round(e.nativeEvent.contentOffset.x / width))))}
        style={StyleSheet.absoluteFill}
      >
        {items.map((it, i) => (
          <LightboxImage key={i} item={it} width={width} height={height} onClose={onClose} />
        ))}
      </ScrollView>
      <View style={[lb.top, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel={tr('ui.image.close')} style={lb.btn}>
          <Icon name="x" size={22} color="#fff" strokeWidth={2.2} />
        </Pressable>
        {items.length > 1 ? <Text style={lb.counter}>{`${page + 1} / ${items.length}`}</Text> : null}
        {curGate.allowed ? (
        <View style={lb.actions}>
        {editor ? (
          <Pressable
            onPress={() => {
              editor.open({ uri: cur.image.url, label: cur.caption || cur.image.title || undefined });
              onClose();
            }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={tr('imageEdit.actionA11y')}
            style={lb.pill}
          >
            <Text style={lb.pillText}>{tr('imageEdit.action')}</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={() => void shareImageUrl(cur.image.url, tr)} hitSlop={10} accessibilityRole="button" accessibilityLabel={tr('ui.image.share')} style={lb.btn}>
          <Svg width={20} height={20} viewBox="0 0 24 24">
            <Path d="M12 14.5V4M8 7.5 12 3.5l4 4M8.5 10.5H7A2.5 2.5 0 0 0 4.5 13v5A2.5 2.5 0 0 0 7 20.5h10a2.5 2.5 0 0 0 2.5-2.5v-5a2.5 2.5 0 0 0-2.5-2.5h-1.5" stroke="#fff" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        </Pressable>
        </View>
        ) : null}
      </View>
      <View style={[lb.bottom, { paddingBottom: insets.bottom + 16 }]} pointerEvents="box-none">
        {cur.caption || cur.image.title ? (
          <Text style={lb.caption} numberOfLines={3}>
            {cur.caption || cur.image.title}
          </Text>
        ) : null}
        {credit && creditUrl ? (
          <Pressable onPress={() => onAction({ type: 'open_url', url: creditUrl })} hitSlop={8} accessibilityRole="link">
            <Text style={lb.credit} numberOfLines={1}>
              {credit + '  ›'}
            </Text>
          </Pressable>
        ) : credit ? (
          <Text style={lb.credit} numberOfLines={1}>
            {credit}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const lb = StyleSheet.create({
  top: { position: 'absolute', left: 0, right: 0, top: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12 },
  btn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.14)' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pill: { height: 40, borderRadius: 20, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.18)' },
  pillText: { color: '#fff', fontSize: 14.5, fontWeight: '600' },
  counter: { color: 'rgba(255,255,255,0.85)', fontSize: 14, fontWeight: '500', paddingHorizontal: 12, fontVariant: ['tabular-nums'] },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 20, gap: 6, backgroundColor: 'rgba(0,0,0,0.35)', paddingTop: 12 },
  caption: { color: '#fff', fontSize: 15, lineHeight: 21, fontWeight: '500' },
  credit: { color: 'rgba(255,255,255,0.7)', fontSize: 12 },
});

/**
 * 56–64 px rounded thumbnail for list/timeline/steps/card/compare. `enabled=false` while the query may still be
 * streaming. Shimmers while resolving (capped at IMAGE_SLOT_CAP_MS). No photo → never a "picture" box: the slot
 * collapses (`whenCollapsed` is rendered instead, default nothing) unless a sibling inside the same
 * ImageSlotGroup has a photo – then a calm monogram tile keeps the cards aligned (images/slot.ts).
 */
export function Thumb({ query, lang, enabled = true, size = 60, height, fit = 'cover', label, selectOnTap, whenCollapsed, webOnly }: { query: string; lang?: string; /** web image search only (products / current things): never a Wikipedia guess */ webOnly?: boolean; enabled?: boolean; size?: number | '100%'; height?: number; fit?: 'cover' | 'contain'; label?: string; /** parent handles taps (e.g. a Choice card): image tap falls through, fullscreen only via the small expand badge */ selectOnTap?: boolean; /** rendered instead of the thumbnail when the slot collapses (e.g. the list's normal marker) */ whenCollapsed?: ReactNode }) {
  const tr = useT();
  const t = useTheme();
  const st = useResolvedImage({ query, lang, ...(webOnly ? { source: 'web' as const } : {}) }, { enabled });
  const [open, setOpen] = useState(false);
  const [broken, setBroken] = useState<string | null>(null);
  const img = st.status === 'ok' ? st.image : null;
  const loading = st.status === 'loading';
  const expired = useSlotCap(loading, `${lang ?? ''}|${query}`);
  const mode = useImageSlot(slotStatus({ hasImage: !!img && broken !== img.url, pending: st.status === 'idle' || loading, expired }));
  const w = size;
  const h = height ?? (typeof size === 'number' ? size : 120);
  const r = typeof size === 'number' && size < 80 ? t.radii.m : t.radii.l;
  if (mode === 'collapse') return <>{whenCollapsed ?? null}</>;
  if (mode === 'skeleton') return <Skeleton width={w} height={h} radius={r} />;
  if (mode === 'fallback' || !img) return <FallbackTile width={w} height={fallbackHeight(h)} radius={r} label={label ?? query} />;
  return (
    <View style={{ width: w }}>
      <Photo uri={typeof size === 'number' && size < 120 ? img.thumbUrl : img.url} height={h} radius={r} fit={fit} label={label ?? img.title} onPress={selectOnTap ? undefined : () => setOpen(true)} onError={() => setBroken(img.url)} />
      {selectOnTap && h >= 80 ? (
        <Pressable
          onPress={() => setOpen(true)}
          hitSlop={8}
          accessibilityRole="imagebutton"
          accessibilityLabel={label ? tr('ui.image.fullscreen', { label }) : tr('ui.image.fullscreenNoLabel')}
          style={{ position: 'absolute', right: 6, bottom: 6, width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)' }}
        >
          <Svg width={14} height={14} viewBox="0 0 24 24">
            <Path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" stroke="#fff" strokeWidth={2.2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        </Pressable>
      ) : null}
      <ImageLightbox items={[{ image: img, caption: label }]} index={open ? 0 : null} onClose={() => setOpen(false)} />
    </View>
  );
}
