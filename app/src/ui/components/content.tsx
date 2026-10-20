import { Fragment, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { useMotionReduced, useTheme } from '../theme';
import { scaleFont } from '../themes';
import { useAnswerUiPrefs } from '../lib/answerPrefs';
import { StatValue } from './CountUpValue';
import { useHui } from '../primitives/context';
import { Badge, FadeIn, HText, InlineText, PressableScale, Surface } from '../primitives/basics';
import { Icon, type IconName } from '../primitives/Icon';
import { Skeleton, SkeletonLines } from '../primitives/Skeleton';
import { CompareSkeleton, ListSkeleton, StatsSkeleton } from '../skeletons';
import { Thumb } from './imageParts';
import { productImageFit } from '../../images/slot';
import { ImageSlotGroup, useImageGroupHasImages } from './imageSlot';
import { ProvenanceChip } from './modules/ProvenanceChip';
import { Sparkline } from './Sparkline';
import { asNumber, asObjects, asOptString, asString, asArray, clamp, formatNumber } from '../lib/format';
import type { HuiCallout, HuiCompare, HuiList, HuiProgress, HuiStats, HuiSteps, HuiText, HuiTimeline } from '../types';
import { useLocale, useT } from '../../i18n';
import { useSettledAfter } from '../lib/useSettledAfter';
import { NARROW_TEXT_PROPS } from '../lib/textWrap';
import { statCardMinWidth } from '../lib/fontScaleLayout';
import { compareRows } from './comparePoints.ts';
import { compareLooksLikeProducts, compareProductQuery } from './compareProducts.ts';
import { CardImage } from './modules/d1/parts';
import { D1Icon } from './modules/d1/icons';
import { productKind } from './modules/d1/d1Model.ts';
import { useCaptureMode } from '../lib/capture';
import { LiveNode, useLivePatchHandOver } from '../../live/ui/LiveNode';

export type NodeProps<T> = { node: Partial<T> };

/* ───────────── text ───────────── */

export function TextBlock({ node }: NodeProps<HuiText>) {
  const t = useTheme();
  const { streaming } = useHui();
  const text = asString(node.text);
  if (!text) return streaming ? <SkeletonLines lines={2} /> : null;
  switch (node.variant) {
    case 'title':
      return <InlineText variant="title" text={text} accessibilityRole="header" />;
    case 'caption':
      return <InlineText variant="caption" color="muted" text={text} />;
    case 'mono':
      return (
        <HText variant="mono" selectable style={{ backgroundColor: t.colors.codeBg, padding: t.spacing.m, borderRadius: t.radii.control }}>
          {text}
        </HText>
      );
    default:
      return <InlineText variant="body" text={text} />;
  }
}

/* ───────────── callout ───────────── */

const TONE_ICON: Record<string, IconName> = { info: 'info', success: 'checkCircle', warning: 'alert', danger: 'alertOctagon' };

export function Callout({ node }: NodeProps<HuiCallout>) {
  // a Hermes patch of a live card of this chat (`livePatch`): its receipt; elsewhere the plain callout below
  const live = useLivePatchHandOver(node.livePatch);
  if (live && node.livePatch) return <LiveNode node={{ id: node.livePatch.card }} {...live} />;
  return <PlainCallout node={node} />;
}

function PlainCallout({ node }: NodeProps<HuiCallout>) {
  const t = useTheme();
  const { streaming } = useHui();
  const tone = (['info', 'success', 'warning', 'danger'] as const).includes(node.tone as never) ? node.tone! : 'info';
  const fg = t.colors[tone];
  const bg = t.colors[`${tone}Soft` as const];
  const title = asOptString(node.title);
  const text = asString(node.text);
  return (
    <View style={{ flexDirection: 'row', gap: t.spacing.m, backgroundColor: bg, borderRadius: t.radii.control, padding: t.spacing.m + 2 }}>
      <View style={{ paddingTop: 2 }}>
        <Icon name={TONE_ICON[tone]} size={18} color={fg} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        {title ? <InlineText variant="bodyStrong" text={title} /> : null}
        {text ? <InlineText variant="callout" color={title ? 'muted' : 'text'} text={text} /> : streaming ? <SkeletonLines lines={2} lineHeight={10} /> : null}
      </View>
    </View>
  );
}

/* ───────────── stats ───────────── */

function inferTrend(trend: unknown, delta: string): 'up' | 'down' | 'flat' | undefined {
  if (trend === 'up' || trend === 'down' || trend === 'flat') return trend;
  const d = delta.trim();
  if (/^[+▲↑]/.test(d)) return 'up';
  if (/^[-−▼↓]/.test(d)) return 'down';
  return undefined;
}

export function Stats({ node }: NodeProps<HuiStats>) {
  const t = useTheme();
  const { streaming, depth } = useHui();
  // A5: count up only in a newly streamed answer (mounted while streaming), never in history
  const [fresh] = useState(streaming);
  const reduced = useMotionReduced();
  const { motion } = useAnswerUiPrefs();
  const countUp = fresh && !reduced && motion;
  // large text: wider cards → one per row instead of a value cut to "1,2…" (fontScaleLayout.ts)
  const minW = statCardMinWidth(t.fontScale * (useWindowDimensions().fontScale || 1));
  const items = asObjects(node.items);
  if (!items.length) return streaming ? <StatsSkeleton /> : null;
  const n = items.length;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.s }}>
      {items.map((it, i) => {
        const label = asString(it.label);
        const value = asString(it.value);
        const delta = asString(it.delta);
        const trend = inferTrend(it.trend, delta);
        const tc = trend === 'up' ? t.colors.success : trend === 'down' ? t.colors.danger : t.colors.muted;
        return (
          <FadeIn key={i} delay={i * 40} style={{ flexGrow: 1, flexBasis: n === 1 ? '100%' : n === 3 && i === 2 ? '100%' : '45%', minWidth: minW }}>
            <Surface depth={depth} style={{ gap: 4, flexGrow: 1 }}>
              <HText variant="caption" color="muted" numberOfLines={1}>
                {label || ' '}
              </HText>
              {value ? (
                <StatValue value={value} animate={countUp} />
              ) : (
                <Skeleton width="60%" height={24} style={{ marginVertical: 3 }} />
              )}
              {delta ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  {trend ? <Icon name={trend === 'up' ? 'trendUp' : trend === 'down' ? 'trendDown' : 'minus'} size={14} color={tc} strokeWidth={2} /> : null}
                  <HText variant="caption" style={{ color: tc }} weight="500" numberOfLines={1} tabular>
                    {delta}
                  </HText>
                </View>
              ) : null}
              <Sparkline values={it.sparkline} color={trend === 'up' || trend === 'down' ? tc : undefined} />
            </Surface>
          </FadeIn>
        );
      })}
      {streaming ? (
        <View style={{ flexGrow: 1, flexBasis: '45%', minWidth: minW, opacity: 0.6 }}>
          <Surface style={{ gap: 8 }}>
            <Skeleton width="50%" height={10} />
            <Skeleton width="65%" height={22} />
          </Surface>
        </View>
      ) : null}
      <ProvenanceChip node={node} style={{ flexBasis: '100%' }} />
    </View>
  );
}

/* ───────────── progress ───────────── */

export function Progress({ node }: NodeProps<HuiProgress>) {
  const { lang } = useLocale();
  const t = useTheme();
  const value = asNumber(node.value);
  const max = asNumber(node.max) ?? 100;
  const ratio = value === undefined || max <= 0 ? 0 : clamp(value / max, 0, 1);
  const [w, setW] = useState(0);
  const p = useSharedValue(0);
  const reduced = useReducedMotion();
  useEffect(() => {
    p.value = reduced ? ratio : withTiming(ratio, { duration: 600, easing: Easing.out(Easing.cubic) });
  }, [ratio, reduced, p]);
  const anim = useAnimatedStyle(() => ({ width: p.value * w }), [w]);
  // settled: React owns the final width, so a dropped animated value cannot reset a finished bar to 0
  const settled = useSettledAfter(reduced ? 0 : 680, [ratio, reduced]);
  const label = asString(node.label);
  const readout = value === undefined ? '' : node.max === undefined || max === 100 ? `${formatNumber(ratio * 100, 0, lang)}${lang === 'en' ? '' : ' '}%` : `${formatNumber(value, 2, lang)} / ${formatNumber(max, 2, lang)}`;
  return (
    <View style={{ gap: 6 }} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(ratio * 100) }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: t.spacing.s }}>
        {label ? <InlineText variant="callout" text={label} style={{ flex: 1 }} numberOfLines={2} /> : <Skeleton width="40%" height={12} />}
        <HText variant="callout" color="muted" tabular>
          {readout}
        </HText>
      </View>
      <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ height: 8, borderRadius: 4, backgroundColor: t.colors.surfaceAlt, overflow: 'hidden' }}>
        <Animated.View style={[{ height: 8, borderRadius: 4, backgroundColor: ratio >= 1 ? t.colors.success : t.colors.accent }, anim, settled ? { width: ratio * w } : null]} />
      </View>
    </View>
  );
}

/* ───────────── list ───────────── */

function isEmojiish(s: string) {
  return s.length <= 4 && !/^[a-z0-9-_]+$/i.test(s);
}

/** Empty thumbnail column of a row without image query – only while the list shows photos at all. */
function ThumbSpacer({ width, fallback }: { width: number; fallback: React.ReactNode }) {
  return useImageGroupHasImages() ? <View style={{ width }} /> : <>{fallback}</>;
}

export function List({ node }: NodeProps<HuiList>) {
  const t = useTheme();
  const { streaming } = useHui();
  const items = asObjects(node.items);
  if (!items.length) return streaming ? <ListSkeleton /> : null;
  const style = node.style ?? 'bullet';
  const withThumbs = items.some((it) => asOptString(it.imageQuery));
  const Wrap = withThumbs ? ImageSlotGroup : Fragment;
  return (
    <Wrap>
    <View>
      {items.map((it, i) => {
        const title = asString(it.title);
        const subtitle = asOptString(it.subtitle);
        const trailing = asOptString(it.trailing);
        const icon = asOptString(it.icon);
        const imageQuery = asOptString(it.imageQuery);
        let marker: React.ReactNode;
        if (icon && isEmojiish(icon)) {
          marker = (
            <View style={{ width: 28, height: 28, borderRadius: t.radii.inline, backgroundColor: t.colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
              <HText style={scaleFont(15, 20, t.fontScale)}>{icon}</HText>
            </View>
          );
        } else if (style === 'number') {
          marker = (
            <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: t.colors.surfaceAlt, alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
              <HText variant="micro" color="muted" tabular>
                {i + 1}
              </HText>
            </View>
          );
        } else if (style === 'check') {
          marker = (
            <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: t.colors.accentSoft, alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
              <Icon name="check" size={13} color={t.colors.accent} strokeWidth={2.5} />
            </View>
          );
        } else {
          marker = (
            <View style={{ width: 22, alignItems: 'center', paddingTop: 9 }}>
              <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: t.colors.muted }} />
            </View>
          );
        }
        if (withThumbs) {
          // photo thumbnails replace the marker; rows without a query get an empty slot (aligned text). Without any
          // photo in the list (none found / no image search) the normal markers stay – no empty column.
          marker = imageQuery ? (
            <Thumb query={imageQuery} size={56} label={title} enabled={!streaming || i < items.length - 1} whenCollapsed={marker} />
          ) : (
            <ThumbSpacer width={56} fallback={marker} />
          );
        }
        return (
          <FadeIn key={i} delay={Math.min(i, 6) * 30}>
            <View
              style={{
                flexDirection: 'row',
                gap: t.spacing.m,
                paddingVertical: subtitle || withThumbs ? t.spacing.s + 2 : t.spacing.xs + 2,
                borderTopWidth: i > 0 && (subtitle || withThumbs) ? 1 : 0,
                borderColor: t.colors.border,
                alignItems: withThumbs || (subtitle && icon) ? 'center' : 'flex-start',
              }}
            >
              {marker}
              <View style={{ flex: 1, gap: 2 }}>
                <InlineText variant={subtitle ? 'bodyStrong' : 'body'} text={title} />
                {subtitle ? <InlineText variant="caption" color="muted" text={subtitle} /> : null}
              </View>
              {trailing ? (
                <HText variant="callout" color="muted" tabular style={{ paddingTop: 1 }}>
                  {trailing}
                </HText>
              ) : null}
            </View>
          </FadeIn>
        );
      })}
      {streaming ? (
        <View style={{ flexDirection: 'row', gap: t.spacing.m, paddingVertical: t.spacing.s }}>
          <Skeleton width={22} height={10} />
          <Skeleton width="55%" height={10} />
        </View>
      ) : null}
    </View>
    </Wrap>
  );
}

/* ───────────── steps ───────────── */

export function Steps({ node }: NodeProps<HuiSteps>) {
  const t = useTheme();
  const { streaming } = useHui();
  const items = asObjects(node.items);
  if (!items.length) return streaming ? <ListSkeleton rows={3} marker="circle" /> : null;
  const current = asNumber(node.current);
  return (
    <View>
      {items.map((it, i) => {
        const done = current !== undefined && i < current;
        const active = current !== undefined && i === current;
        const last = i === items.length - 1 && !streaming;
        const detail = asOptString(it.detail);
        const imageQuery = asOptString(it.imageQuery);
        const circleBg = done ? t.colors.accent : active ? t.colors.accentSoft : t.colors.surfaceAlt;
        return (
          <FadeIn key={i} delay={Math.min(i, 6) * 40} style={{ flexDirection: 'row', gap: t.spacing.m }}>
            <View style={{ alignItems: 'center', width: 26 }}>
              <View
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 13,
                  backgroundColor: circleBg,
                  borderWidth: active ? 1.5 : 0,
                  borderColor: t.colors.accent,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {done ? (
                  <Icon name="check" size={14} color={t.colors.onAccent} strokeWidth={2.5} />
                ) : (
                  <HText variant="micro" tabular style={{ color: active ? t.colors.accentText : t.colors.muted, fontWeight: '600' }}>
                    {i + 1}
                  </HText>
                )}
              </View>
              {!last ? <View style={{ flex: 1, width: 1.5, minHeight: 12, backgroundColor: done ? t.colors.accent : t.colors.border, marginVertical: 4 }} /> : null}
            </View>
            <View style={{ flex: 1, paddingBottom: last ? 0 : t.spacing.l, paddingTop: 3, gap: 2 }}>
              <InlineText variant="bodyStrong" text={asString(it.title)} color={current !== undefined && i > current ? 'muted' : 'text'} />
              {detail ? <InlineText variant="callout" color="muted" text={detail} /> : null}
            </View>
            {imageQuery ? (
              <View style={{ paddingTop: 2, paddingBottom: last ? 0 : t.spacing.l }}>
                <Thumb query={imageQuery} size={60} label={asString(it.title)} enabled={!streaming || i < items.length - 1} />
              </View>
            ) : null}
          </FadeIn>
        );
      })}
      {streaming ? (
        <View style={{ flexDirection: 'row', gap: t.spacing.m }}>
          <Skeleton width={26} height={26} radius={13} />
          <Skeleton width="50%" height={12} style={{ marginTop: 7 }} />
        </View>
      ) : null}
    </View>
  );
}

/* ───────────── timeline ───────────── */

export function Timeline({ node }: NodeProps<HuiTimeline>) {
  const t = useTheme();
  const { streaming } = useHui();
  const items = asObjects(node.items);
  if (!items.length) return streaming ? <ListSkeleton rows={3} /> : null;
  return (
    <View>
      {items.map((it, i) => {
        const last = i === items.length - 1 && !streaming;
        const detail = asOptString(it.detail);
        const imageQuery = asOptString(it.imageQuery);
        return (
          <FadeIn key={i} delay={Math.min(i, 6) * 40} style={{ flexDirection: 'row', gap: t.spacing.m }}>
            <View style={{ alignItems: 'center', width: 12, paddingTop: 5 }}>
              <View style={{ width: 11, height: 11, borderRadius: 6, borderWidth: 2, borderColor: i === 0 ? t.colors.accent : t.colors.borderStrong, backgroundColor: t.colors.surface }} />
              {!last ? <View style={{ flex: 1, width: 1.5, backgroundColor: t.colors.border, marginTop: 4 }} /> : null}
            </View>
            <View style={{ flex: 1, paddingBottom: last ? 0 : t.spacing.l, gap: 2 }}>
              <HText variant="caption" weight="600" color="muted">
                {asString(it.time)}
              </HText>
              <InlineText variant="bodyStrong" text={asString(it.title)} />
              {detail ? <InlineText variant="callout" color="muted" text={detail} /> : null}
            </View>
            {imageQuery ? (
              <View style={{ paddingBottom: last ? 0 : t.spacing.l }}>
                <Thumb query={imageQuery} size={60} label={asString(it.title)} enabled={!streaming || i < items.length - 1} />
              </View>
            ) : null}
          </FadeIn>
        );
      })}
      {streaming ? (
        <View style={{ flexDirection: 'row', gap: t.spacing.m, paddingTop: 2 }}>
          <Skeleton width={11} height={11} radius={6} />
          <View style={{ flex: 1, gap: 6 }}>
            <Skeleton width={60} height={9} />
            <Skeleton width="55%" height={12} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

/* ───────────── compare ───────────── */

const COMPARE_THUMB = 44;

/**
 * Small product photo in a compare column header when the columns are products without an `imageQuery`
 * (compareProducts.ts). Same chain as product cards (CardImage: autoQuery → web image search only, the privacy
 * settings and the search queue); a fixed square, so nothing moves when the photo arrives or never does: the
 * neutral glyph underneath stays when the slot collapses (no photo / no image search).
 */
function CompareProductThumb({ title, enabled }: { title: string; enabled: boolean }) {
  const t = useTheme();
  const kind = productKind(title);
  const query = compareProductQuery(title);
  return (
    <View style={{ width: COMPARE_THUMB, height: COMPARE_THUMB, borderRadius: t.radii.m, overflow: 'hidden', backgroundColor: t.colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
      <D1Icon name={kind} size={20} color={t.colors.muted} strokeWidth={1.5} />
      {query ? (
        // own group: the thumbnail never turns the other columns' slots into fallback tiles
        <ImageSlotGroup>
          <CardImage autoQuery={query} webOnly kind={kind} height={COMPARE_THUMB} fit={productImageFit('compare')} tile inline radius={t.radii.m} iconSize={20} enabled={enabled} label={title} style={StyleSheet.absoluteFill} />
        </ImageSlotGroup>
      ) : null}
    </View>
  );
}

export function Compare({ node }: NodeProps<HuiCompare>) {
  const t = useTheme();
  const { streaming } = useHui();
  const cols = asObjects(node.columns);
  // product columns get header thumbnails; latched, so a later streamed column never takes them away again
  const detected = compareLooksLikeProducts(cols);
  const [productLatch, setProductLatch] = useState(false);
  useEffect(() => {
    if (detected) setProductLatch(true);
  }, [detected]);
  const products = detected || productLatch;
  // share-as-image: more than two columns stack (a horizontal scroller would cut them off at the frame edge)
  const capture = useCaptureMode();
  if (!cols.length) return streaming ? <CompareSkeleton /> : null;
  const stack = capture && cols.length > 2;
  const scroll = cols.length > 2 && !stack;
  const renderCol = (c: Record<string, unknown>, i: number) => {
    const hl = c.highlight === true;
    const badge = asOptString(c.badge);
    const rows = compareRows({
      items: asArray(c.items).map((x) => asString(x)),
      pros: asArray(c.pros).map((x) => asString(x)),
      cons: asArray(c.cons).map((x) => asString(x)),
    });
    const imageQuery = asOptString(c.imageQuery);
    const thumb = products && !imageQuery && !!asString(c.title);
    return (
      <View
        key={i}
        style={[
          {
            backgroundColor: hl ? t.colors.accentSoft : t.colors.surface,
            borderWidth: hl ? 1.5 : 1,
            borderColor: hl ? t.colors.accent : t.colors.border,
            borderRadius: t.radii.card,
            padding: t.spacing.l,
            gap: t.spacing.m,
          },
          scroll ? { width: 228 } : stack ? null : { flex: 1, minWidth: 0 },
        ]}
      >
        {imageQuery ? <Thumb query={imageQuery} size="100%" height={120} fit={productImageFit('compare')} label={asString(c.title)} webOnly enabled={!streaming || i < cols.length - 1} /> : null}
        {/* wide (scrolling) cards: thumbnail beside the title; two narrow columns: above it */}
        <View style={thumb ? (scroll || stack ? { flexDirection: 'row', alignItems: 'center', gap: t.spacing.s } : { gap: t.spacing.s }) : null}>
          {thumb ? <CompareProductThumb title={asString(c.title)} enabled={!streaming || i < cols.length - 1} /> : null}
          <View style={[{ gap: 6 }, thumb && (scroll || stack) ? { flex: 1, minWidth: 0 } : null]}>
            {badge ? <Badge label={badge} tone={hl ? 'accent' : 'neutral'} /> : null}
            <InlineText {...NARROW_TEXT_PROPS} variant="headline" text={asString(c.title)} />
          </View>
        </View>
        <View style={{ gap: t.spacing.s }}>
          {rows.map((r, j) => (
            <View key={j} style={{ flexDirection: 'row', gap: t.spacing.s }}>
              <View style={{ paddingTop: 3, width: 14, alignItems: 'center' }}>
                {r.kind === 'pro' ? (
                  <Icon name="check" size={14} color={t.colors.success} strokeWidth={2.25} />
                ) : r.kind === 'con' ? (
                  <Icon name="minus" size={14} color={t.colors.danger} strokeWidth={2.25} />
                ) : (
                  <View style={{ width: 5, height: 5, borderRadius: 3, marginTop: 5, backgroundColor: hl ? t.colors.accent : t.colors.muted }} />
                )}
              </View>
              <InlineText {...NARROW_TEXT_PROPS} variant="callout" text={r.text} style={{ flex: 1, minWidth: 0 }} />
            </View>
          ))}
          {streaming && rows.length === 0 ? <SkeletonLines lines={3} lineHeight={10} /> : null}
        </View>
      </View>
    );
  };
  // columns decide together: no photo in any column → no image row; some → the others get a small calm tile
  return (
    <ImageSlotGroup>
      <View style={{ gap: t.spacing.s }}>
        {scroll ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.spacing.s, paddingRight: t.spacing.s }}>
            {cols.map(renderCol)}
          </ScrollView>
        ) : (
          <View style={{ flexDirection: stack ? 'column' : 'row', gap: t.spacing.s }}>{cols.map(renderCol)}</View>
        )}
        <ProvenanceChip node={node} />
      </View>
    </ImageSlotGroup>
  );
}

/* ───────────── fallback ───────────── */

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2) ?? String(v);
  } catch {
    return String(v);
  }
}

/** Neutral card for unknown node types (or garbage) – shows the JSON, never crashes. */
export function Fallback({ node, reason, renderError, empty, collapsed }: { node: unknown; reason?: string; renderError?: boolean; empty?: boolean; /** JSON only on tap (empty nodes: nothing to read there) */ collapsed?: boolean }) {
  const tr = useT();
  const t = useTheme();
  const [open, setOpen] = useState(!collapsed);
  const type = node && typeof node === 'object' && 'type' in node ? asString((node as { type: unknown }).type) : '';
  const json = safeJson(node);
  return (
    <Surface style={{ gap: t.spacing.s }}>
      <PressableScale haptic="selection" scaleTo={0.99} onPress={() => setOpen((o) => !o)} accessibilityLabel={tr('ui.content.showJson')} accessibilityState={{ expanded: open }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.s }}>
          <Icon name="sparkle" size={16} color={t.colors.muted} />
          <HText variant="callout" color="muted" style={{ flex: 1 }} numberOfLines={1}>
            {reason ?? (empty ? tr('ui.content.empty') : renderError ? tr('ui.content.renderError') : type ? tr('ui.content.unsupported', { type }) : tr('ui.content.unrenderable'))}
          </HText>
          <View style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}>
            <Icon name="chevronDown" size={16} color={t.colors.muted} />
          </View>
        </View>
      </PressableScale>
      {open ? (
        <ScrollView horizontal style={{ backgroundColor: t.colors.codeBg, borderRadius: t.radii.control }} contentContainerStyle={{ padding: t.spacing.m }}>
          <HText variant="mono" color="muted" selectable >
            {json}
          </HText>
        </ScrollView>
      ) : null}
    </Surface>
  );
}
