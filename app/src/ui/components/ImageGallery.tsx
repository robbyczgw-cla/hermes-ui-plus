/**
 * `gallery` node: horizontal snapping photo carousel (next slide peeks in), page dots, captions,
 * attribution, fullscreen on tap. Items resolve by `query` (Wikipedia/Commons, or web image search for
 * `source:"web"`) or use `url` (from Hermes' tools; through the bridge image proxy when it has one).
 * Items without a photo (no image search, images off, lookup failed, nothing found, photo did not load) never
 * vanish: they keep a calm placeholder tile with their caption (tap → image search in the browser), and one quiet
 * line under the block names the reason (imageMiss.tsx, images/miss.ts). No photo at all → a compact tile grid.
 *
 * Paging: native = ScrollView snapping (snapToInterval); web = CSS scroll snap (`pagingEnabled`) plus
 * mouse drag-to-scroll and ‹ › buttons. A press only opens fullscreen when the pointer didn't drag.
 * Page dots are tappable and form one adjustable control for screen readers.
 */
import { useCallback, useEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import { useTheme } from '../theme';
import { useHui } from '../primitives/context';
import { BlockTitle, HText } from '../primitives/basics';
import { Skeleton } from '../primitives/Skeleton';
import { ImageSkeleton } from '../skeletons';
import { asNumber, asObjects, asOptString, clamp } from '../lib/format';
import { useImagesAllowed, useResolvedImages, useWebImagesEnabled, type ImageSource, type ResolvedImage, type ResolvedImageState } from '../../images';
import { getImageSearchMode } from '../../images/web';
import { IMAGE_LOOKUP_CAP_MS, blockMissReason, imageMissReason, type ImageMissReason } from '../../images/miss';
import { AttributionLine, ImageLightbox, Photo, type LightboxItem } from './imageParts';
import { MissNote, MissTile } from './imageMiss';
import { useSlotCap } from './imageSlot';
import { Icon } from '../primitives/Icon';
import { isDrag, offsetForPage, pageAfterDrag, pageAtOffset, type GalleryGeometry } from './galleryPaging';
import type { HuiGallery } from '../types';
import type { NodeProps } from './content';
import { useT } from '../../i18n';

const MAX_ITEMS = 6;
/** height of a placeholder tile when no item has a photo (compact grid, not a row of big empty boxes) */
const MISS_TILE_H = 88;

type Item = { query?: string; url?: string; caption?: string; web: boolean };
type Slide = Item & { photo: ResolvedImage | null; pending: boolean; miss: ImageMissReason | null };

/** Per item: photo, still resolving (shimmer) or missing with its reason. */
function useSlides(items: Item[], states: ResolvedImageState[], expired: boolean, broken: Record<string, true>): Slide[] {
  const allowed = useImagesAllowed();
  const webOn = useWebImagesEnabled();
  const mode = getImageSearchMode();
  return items.map((it, i) => {
    const st = states[i];
    const img = st?.status === 'ok' ? st.image : null;
    if (img && !broken[img.url]) return { ...it, photo: img, pending: false, miss: null };
    const loading = !st || st.status === 'idle' || st.status === 'loading';
    if (loading && !expired) return { ...it, photo: null, pending: true, miss: null };
    const status = img ? 'broken' : st?.status === 'error' ? 'error' : st?.status === 'none' ? 'none' : 'expired';
    return { ...it, photo: null, pending: false, miss: imageMissReason({ allowed, webOnly: it.web, webEnabled: webOn, mode, status, urlOnly: !it.query && !!it.url }) };
  });
}

export function ImageGallery({ node }: NodeProps<HuiGallery>) {
  const tr = useT();
  const t = useTheme();
  const { streaming } = useHui();
  const lang = asOptString(node.lang);
  const aspect = clamp(asNumber(node.aspect) ?? 4 / 3, 0.6, 2.4);
  const nodeWeb = node.source === 'web';
  const items: Item[] = asObjects(node.items)
    .map((it) => ({ query: asOptString(it.query), url: asOptString(it.url), caption: asOptString(it.caption), web: nodeWeb || it.source === 'web' }))
    .filter((it) => it.query || it.url)
    .slice(0, MAX_ITEMS);
  // while streaming, only items followed by another item are complete strings
  const enabled = items.map((_, i) => !streaming || i < items.length - 1);
  const states = useResolvedImages(
    items.map((it): ImageSource => ({ query: it.query, url: it.url, lang, source: it.web ? 'web' : undefined })),
    enabled,
  );
  // resolving shimmers at most IMAGE_LOOKUP_CAP_MS, then the still-pending slides turn into placeholders
  const expired = useSlotCap(states.some((s) => s.status === 'loading'), items.map((it) => `${it.query ?? ''}|${it.url ?? ''}`).join('\n'), IMAGE_LOOKUP_CAP_MS);
  // photos that failed to load (bad URL, proxy refused it): placeholders too
  const [broken, setBroken] = useState<Record<string, true>>({});
  const [w, setW] = useState(0);
  const [page, setPage] = useState(0);
  const [viewer, setViewer] = useState<number | null>(null);
  const ref = useRef<ScrollView>(null);
  // set while a drag/scroll gesture is (or just was) in progress → the release is not a tap
  const drag = useRef({ moved: false });
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const slides = useSlides(items, states, expired, broken);
  const n = slides.length;
  // no photo at all and nothing resolving any more: compact tiles instead of a carousel of empty boxes
  const grid = n > 0 && !streaming && slides.every((s) => s.miss);
  const carousel = n > 0 && !grid;
  const gap = t.spacing.s;
  const slideW = n === 1 ? w : Math.round(w * 0.84);
  const geo: GalleryGeometry = { n: carousel ? n : 0, slideW, gap, viewW: w };
  const geoRef = useRef(geo);
  geoRef.current = geo;
  const web = Platform.OS === 'web';

  const goTo = useCallback((p: number) => {
    const g = geoRef.current;
    const next = Math.max(0, Math.min(g.n - 1, p));
    ref.current?.scrollTo({ x: offsetForPage(g, next), animated: true });
    setPage(next);
  }, []);
  useWebDragScroll(ref, geoRef, drag, setPage, web && carousel && n > 1 && w > 0);
  useEffect(() => () => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
  }, []);

  if (!n) return streaming ? <ImageSkeleton aspect={aspect} /> : null;

  const reason = streaming ? null : blockMissReason(slides.map((s) => s.miss));
  const markBroken = (url: string) => setBroken((b) => (b[url] ? b : { ...b, [url]: true }));
  // the model's heading ("Fotos"); BlockTitle draws nothing without one
  const heading = <BlockTitle title={asOptString(node.title)} />;

  if (grid) {
    const cols = n === 1 ? 1 : 2;
    const tileW = w > 0 ? Math.floor((w - gap * (cols - 1)) / cols) : 0;
    return (
      <View onLayout={(e) => setW(Math.round(e.nativeEvent.layout.width))} style={{ gap: t.spacing.s }}>
        {heading}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap }} accessibilityLabel={tr('ui.image.galleryA11y', { n })}>
          {slides.map((s, k) => (
            <View key={`${k}-${s.query ?? s.url}`} style={{ width: tileW || (cols === 1 ? '100%' : '48%'), gap: 4 }}>
              <MissTile query={s.query} label={s.caption} height={MISS_TILE_H} />
              {s.caption ? (
                <HText variant="callout" weight="500" numberOfLines={2}>
                  {s.caption}
                </HText>
              ) : null}
            </View>
          ))}
        </View>
        {reason ? <MissNote reason={reason} /> : null}
      </View>
    );
  }

  const ready = slides.filter((s) => s.photo);
  const viewerItems: LightboxItem[] = ready.map((s) => ({ image: s.photo!, caption: s.caption }));
  const photoH = slideW > 0 ? slideW / aspect : 0;
  // native: a drag ends with momentum; allow taps again shortly after it settles
  const endDrag = () => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => (drag.current.moved = false), 120);
  };

  return (
    <View onLayout={(e) => setW(Math.round(e.nativeEvent.layout.width))} style={{ gap: t.spacing.s }}>
      {heading}
      {w > 0 ? (
        <View>
          <ScrollView
            ref={ref}
            horizontal
            showsHorizontalScrollIndicator={false}
            pagingEnabled={web && n > 1}
            snapToInterval={!web && n > 1 ? slideW + gap : undefined}
            snapToAlignment="start"
            decelerationRate="fast"
            disableIntervalMomentum
            scrollEventThrottle={32}
            // native only: react-native-web fires these for any scroll start/stop (incl. our own mouse drag)
            onScrollBeginDrag={
              web
                ? undefined
                : () => {
                    if (resetTimer.current) clearTimeout(resetTimer.current);
                    drag.current.moved = true;
                  }
            }
            onScrollEndDrag={web ? undefined : endDrag}
            onMomentumScrollEnd={web ? undefined : endDrag}
            onScroll={(e) => setPage(pageAtOffset(geoRef.current, e.nativeEvent.contentOffset.x))}
            contentContainerStyle={{ gap }}
            accessibilityLabel={tr('ui.image.galleryA11y', { n })}
          >
            {slides.map((s, k) => {
              const img = s.photo;
              const caption = s.caption ?? (img?.attribution.provider === 'wikipedia' ? img.title : undefined);
              return (
                <View key={`${k}-${s.query ?? s.url}`} style={{ width: slideW, gap: 4 }}>
                  {img ? (
                    <Photo
                      uri={img.url}
                      aspect={aspect}
                      label={caption ?? img.title}
                      onError={() => markBroken(img.url)}
                      onPress={() => {
                        if (drag.current.moved) return; // the release of a swipe/drag is not a tap
                        setViewer(Math.max(0, ready.findIndex((r) => r.photo === img)));
                      }}
                    />
                  ) : s.miss ? (
                    <MissTile query={s.query} label={caption} aspect={aspect} />
                  ) : (
                    <ImageSkeleton aspect={aspect} />
                  )}
                  {caption ? (
                    <HText variant="callout" weight="500" numberOfLines={1} style={{ marginTop: 2 }}>
                      {caption}
                    </HText>
                  ) : img || s.miss ? null : (
                    <Skeleton width="45%" height={12} style={{ marginTop: 4 }} />
                  )}
                  {img ? <AttributionLine image={img} /> : null}
                </View>
              );
            })}
          </ScrollView>
          {web && n > 1 && photoH > 0 ? (
            <>
              {page > 0 ? <Arrow dir="prev" top={photoH / 2 - 22} onPress={() => goTo(page - 1)} /> : null}
              {page < n - 1 ? <Arrow dir="next" top={photoH / 2 - 22} onPress={() => goTo(page + 1)} /> : null}
            </>
          ) : null}
        </View>
      ) : (
        <ImageSkeleton aspect={aspect} />
      )}
      {n > 1 ? <Dots count={n} active={page} onSelect={goTo} /> : null}
      {reason ? <MissNote reason={reason} /> : null}
      <ImageLightbox items={viewerItems} index={viewer} onClose={() => setViewer(null)} />
    </View>
  );
}

/**
 * Web: a mouse drag scrolls the strip (react-native-web leaves it to the browser, which only scrolls on
 * touch / wheel) and pages on release; any pointer movement beyond the tap slop marks the gesture as a drag.
 */
function useWebDragScroll(
  ref: RefObject<ScrollView | null>,
  geoRef: MutableRefObject<GalleryGeometry>,
  drag: MutableRefObject<{ moved: boolean }>,
  onPage: (p: number) => void,
  active: boolean,
) {
  useEffect(() => {
    if (Platform.OS !== 'web' || !active) return;
    const el = (ref.current as unknown as { getScrollableNode?: () => HTMLElement | null } | null)?.getScrollableNode?.();
    if (!el || typeof window === 'undefined') return;
    let start: { x: number; y: number; left: number; page: number; mouse: boolean; dragging: boolean } | null = null;
    let restore: ReturnType<typeof setTimeout> | null = null;
    const onDown = (e: PointerEvent) => {
      drag.current.moved = false;
      if (e.button !== 0) return;
      start = { x: e.clientX, y: e.clientY, left: el.scrollLeft, page: pageAtOffset(geoRef.current, el.scrollLeft), mouse: e.pointerType === 'mouse', dragging: false };
    };
    const onMove = (e: PointerEvent) => {
      if (!start) return;
      const dx = e.clientX - start.x;
      if (!start.dragging && isDrag(dx, e.clientY - start.y)) {
        start.dragging = true;
        drag.current.moved = true;
        if (start.mouse) {
          if (restore) clearTimeout(restore);
          el.style.scrollSnapType = 'none';
          el.style.userSelect = 'none';
        }
      }
      if (start.mouse && start.dragging) {
        el.scrollLeft = start.left - dx;
        e.preventDefault();
      }
    };
    const onUp = (e: PointerEvent) => {
      const s = start;
      start = null;
      if (!s || !s.mouse || !s.dragging) return;
      const g = geoRef.current;
      const p = pageAfterDrag(g, s.page, e.clientX - s.x, el.scrollLeft);
      onPage(p);
      // NOTE: react-native-web patches the RN signature onto the host node (`el.scrollTo({x, animated})`),
      // so page through the component ref, never `el.scrollTo({left})` (that lands on x = 0)
      ref.current?.scrollTo({ x: offsetForPage(g, p), animated: true });
      // re-enable snapping once the smooth scroll has landed on the page
      restore = setTimeout(() => {
        el.style.scrollSnapType = '';
        el.style.userSelect = '';
      }, 450);
    };
    const onCancel = () => {
      // the browser took over (touch scroll): never a tap
      if (start) drag.current.moved = true;
      start = null;
    };
    const onScroll = () => {
      if (start) drag.current.moved = true;
    };
    const noNativeDrag = (e: Event) => e.preventDefault();
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('dragstart', noNativeDrag);
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      if (restore) clearTimeout(restore);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('dragstart', noNativeDrag);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      el.style.scrollSnapType = '';
      el.style.userSelect = '';
    };
  }, [ref, geoRef, drag, onPage, active]);
}

/** ‹ › page buttons (web): 44 pt target, translucent disc over the photo. */
function Arrow({ dir, top, onPress }: { dir: 'prev' | 'next'; top: number; onPress: () => void }) {
  const tr = useT();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={tr(dir === 'prev' ? 'ui.image.prev' : 'ui.image.next')}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => ({
        position: 'absolute',
        top,
        [dir === 'prev' ? 'left' : 'right']: 4,
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? 'rgba(0,0,0,0.62)' : hovered ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.42)',
      })}
    >
      <Icon name={dir === 'prev' ? 'chevronLeft' : 'chevronRight'} size={22} color="#fff" strokeWidth={2.2} />
    </Pressable>
  );
}

/** Page dots: tap a dot to jump; for screen readers one adjustable control (swipe up/down = next/previous). */
function Dots({ count, active, onSelect }: { count: number; active: number; onSelect: (i: number) => void }) {
  const tr = useT();
  const t = useTheme();
  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={tr('ui.image.galleryA11y', { n: count })}
      accessibilityValue={{ text: tr('ui.image.position', { i: active + 1, n: count }) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'increment') onSelect(active + 1);
        else if (e.nativeEvent.actionName === 'decrement') onSelect(active - 1);
      }}
      style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center' }}
    >
      {Array.from({ length: count }, (_, i) => (
        <Pressable
          key={i}
          accessible={false}
          onPress={() => onSelect(i)}
          hitSlop={{ top: 12, bottom: 12 }}
          style={{ paddingHorizontal: 4, paddingVertical: 6 }}
          aria-label={tr('ui.image.goTo', { i: i + 1, n: count })}
        >
          <View style={{ width: i === active ? 16 : 6, height: 6, borderRadius: 3, backgroundColor: i === active ? t.colors.text : t.colors.borderStrong }} />
        </Pressable>
      ))}
    </View>
  );
}
