/**
 * `products` (docs/SPEC-modules-v4.md §B): product cards (image tile, brand, name, rating, price, badge,
 * 3 key specs, "Zum Shop"). Tap → detail sheet (all specs, pros/cons, offers with "Zum Shop" through the
 * confirmed action runner, "Das nehme ich" → `[products:<id>] Favorit: <name>`). "Vergleichen":
 * multi-select 2–3 → side-by-side table (best price / rating marked, "Nur Unterschiede"). Compare
 * selection and the pick persist via useNodeState. Phones: snapping rail with peek; wide screens or
 * `layout: 'grid'`: grid. Streaming: finished products render, the arriving one is a skeleton card.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { StyleSheet, View } from 'react-native';
import { useMotionReduced, useTheme, type Theme } from '../../../theme';
import { useHui } from '../../../primitives/context';
import { FadeIn, HText, InlineText, PressableScale } from '../../../primitives/basics';
import { useNodeState } from '../../../../nodestate';
import { useLocale, useT } from '../../../../i18n';
import type { HuiProducts } from '../../../types';
import { useModuleId, useSend } from '../a/shared';
import { useSettledAfter } from '../../../lib/useSettledAfter';
import { ProvenanceChip } from '../ProvenanceChip';
import { productImageQuery } from '../../../../images';
import { D1Icon } from './icons';
import {
  buildCompareTable,
  cheapestOffer,
  displayPrice,
  formatPrice,
  normalizeProducts,
  numLang,
  productA11y,
  productKind,
  productReply,
  formatScore,
  scoresLine,
  ratingA11y,
  shopTarget,
  toggleCompare,
  urlHost,
  type NumLang,
  type ProductItem,
} from './d1Model.ts';
import { ImageSlotGroup } from '../../imageSlot';
import { productImageFit, type SlotMode } from '../../../../images/slot';
import { CardImage, DetailSheet, HeaderPill, InfoRow, PillButton, Rail, RatingRow, SNAP_START, SectionLabel, SkeletonCard, railLayout, type RailLayout } from './parts';

type ProductsState = { compare: string[]; comparing?: boolean; onlyDiff?: boolean; pick?: string };
const INITIAL: ProductsState = { compare: [] };
const IMG = 150;

export function Products({ node }: { node: Partial<HuiProducts> }) {
  const t = useTheme();
  const tr = useT();
  const { lang } = useLocale();
  const L = numLang(lang);
  const { streaming, onAction } = useHui();
  const id = useModuleId('products', node as Record<string, unknown>);
  const model = useMemo(() => normalizeProducts(node, streaming), [node, streaming]);
  const [st, setSt] = useNodeState<ProductsState>(id, INITIAL);
  const [w, setW] = useState(0);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [full, setFull] = useState(false);
  const animateIn = useRef(streaming).current;
  const send = useSend(id);

  if (!model.items.length && !model.pending) {
    if (streaming) {
      return (
        <View style={{ flexDirection: 'row', gap: 10, overflow: 'hidden' }} accessibilityLabel={tr('ui.products.loading')}>
          <SkeletonCard width={200} imageH={IMG} />
          <SkeletonCard width={200} imageH={IMG} />
        </View>
      );
    }
    return (
      <HText variant="callout" color="muted">
        {tr('ui.products.empty')}
      </HText>
    );
  }

  const keys = new Set(model.items.map((p) => p.key));
  const sel = (st.compare ?? []).filter((k) => keys.has(k));
  const comparing = !!st.comparing && model.compare && model.items.length > 1;
  const picked = st.pick && keys.has(st.pick) ? st.pick : undefined;
  const layout = railLayout(w, { peek: 0.6, maxCard: 230, minGridCard: 200, grid: model.layout === 'grid' });
  const count = model.items.length + (model.pending ? 1 : 0);
  const opened = openKey ? model.items.find((p) => p.key === openKey) : undefined;

  const toggle = (p: ProductItem) => {
    const r = toggleCompare(sel, p.key);
    setFull(r.full);
    if (!r.full) setSt((s) => ({ ...s, compare: r.sel }));
  };
  const shop = (p: ProductItem, url?: string) => {
    const target = url ?? shopTarget(p)?.url;
    if (target) onAction({ type: 'open_url', url: target }, undefined, { nodeId: id });
  };
  const take = (p: ProductItem) => {
    if (streaming) return;
    if (!send(productReply(id, p, tr))) return;
    setSt((s) => ({ ...s, pick: p.key }));
  };
  const toggleMode = () => {
    setFull(false);
    setSt((s) => ({ ...s, comparing: !s.comparing }));
  };

  const compared = model.items.filter((p) => sel.includes(p.key));

  return (
    <ImageSlotGroup>
    <View style={{ gap: t.spacing.m }} onLayout={(e) => setW(Math.round(e.nativeEvent.layout.width))}>
      {/* header */}
      <View style={{ gap: 6 }}>
        {model.title ? <InlineText variant="headline" text={model.title} accessibilityRole="header" /> : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {model.items.length ? (
              <HText variant="caption" color="muted">
                {tr('ui.products.count', { n: model.items.length })}
              </HText>
            ) : null}
            <ProvenanceChip basis={model.basis} source={model.source} />
          </View>
          {model.compare && model.items.length > 1 ? (
            <HeaderPill icon={comparing ? 'check' : 'compare'} label={comparing ? tr('ui.products.compareDone') : tr('ui.products.compare')} onPress={toggleMode} active={comparing} disabled={streaming} />
          ) : null}
        </View>
      </View>

      {comparing ? (
        <FadeIn rise={4}>
          <View accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: t.radii.m, backgroundColor: full ? t.colors.warningSoft : t.colors.accentSoft }}>
            <D1Icon name={full ? 'x' : 'compare'} size={15} color={full ? t.colors.warning : t.colors.accent} strokeWidth={2} />
            <HText variant="caption" weight="500" style={{ flex: 1, color: full ? t.colors.warning : t.colors.accent }}>
              {full ? tr('ui.products.compareMax') : sel.length ? tr('ui.products.selected', { n: sel.length }) : tr('ui.products.compareHint')}
            </HText>
          </View>
        </FadeIn>
      ) : null}

      {/* cards */}
      {model.ranked ? (
        <View style={{ gap: t.spacing.s }} accessibilityLabel={tr('ui.products.carouselA11y', { n: count })}>
          {model.items.map((p, i) => (
            <Appear key={p.key} on={animateIn}>
              <RankedRow t={t} p={p} rank={i + 1} lang={L} selecting={comparing} selected={sel.includes(p.key)} picked={picked === p.key} onPress={() => (comparing ? toggle(p) : setOpenKey(p.key))} />
            </Appear>
          ))}
          {model.pending ? <SkeletonCard width="100%" imageH={0} lines={3} /> : null}
        </View>
      ) : w > 0 ? (
        <Rail layout={layout} count={count} label={tr('ui.products.carouselA11y', { n: count })} arrowTop={IMG / 2}>
          {model.items.map((p) => (
            <Appear key={p.key} on={animateIn} style={[{ width: layout.cardW }, SNAP_START]}>
              <ProductCard
                t={t}
                p={p}
                lang={L}
                layout={layout}
                selecting={comparing}
                selected={sel.includes(p.key)}
                picked={picked === p.key}
                onPress={() => (comparing ? toggle(p) : setOpenKey(p.key))}
                onShop={() => shop(p)}
              />
            </Appear>
          ))}
          {model.pending ? <SkeletonCard width={layout.cardW} imageH={IMG} lines={4} /> : null}
        </Rail>
      ) : (
        <View style={{ height: IMG + 210 }} />
      )}

      {comparing && compared.length >= 2 ? (
        <FadeIn>
          <CompareTable t={t} items={compared} lang={L} onlyDiff={!!st.onlyDiff} setOnlyDiff={(v) => setSt((s) => ({ ...s, onlyDiff: v }))} picked={picked} onTake={take} onOpen={(p) => setOpenKey(p.key)} streaming={streaming} />
        </FadeIn>
      ) : null}

      <DetailSheet
        open={!!opened}
        onClose={() => setOpenKey(null)}
        label={opened?.name ?? ''}
        hero={opened ? <ProductHero p={opened} /> : null}
        footer={
          opened ? (
            <View style={{ flexDirection: 'row', gap: t.spacing.s }}>
              {shopTarget(opened) ? <PillButton label={tr('ui.products.toShop')} icon="cart" onPress={() => shop(opened)} a11yLabel={shopA11y(opened, tr)} style={{ flex: 1 }} /> : null}
              {picked === opened.key ? (
                <PillButton label={tr('ui.products.taken')} icon="check" kind="success" onPress={() => {}} disabled style={{ flex: 1 }} />
              ) : (
                <PillButton label={tr('ui.products.take')} icon="check" kind="primary" onPress={() => take(opened)} disabled={streaming} a11yLabel={tr('ui.products.takeA11y', { name: opened.name })} style={{ flex: 1 }} />
              )}
            </View>
          ) : null
        }
      >
        {opened ? <ProductDetails t={t} p={opened} lang={L} onShop={(url) => shop(opened, url)} source={model.source} basis={model.basis} /> : null}
      </DetailSheet>
    </View>
    </ImageSlotGroup>
  );
}

function shopA11y(p: ProductItem, tr: ReturnType<typeof useT>): string {
  const target = shopTarget(p);
  const merchant = target?.merchant ?? (target ? urlHost(target.url) : undefined);
  return merchant ? tr('ui.products.toShopA11y', { name: p.name, merchant }) : tr('ui.products.toShopA11yNoMerchant', { name: p.name });
}

function Appear({ on, style, children }: { on: boolean; style?: object; children: React.ReactNode }) {
  if (!on) return <View style={style}>{children}</View>;
  return (
    <FadeIn style={style} rise={10}>
      {children}
    </FadeIn>
  );
}

/* ───────────── card ───────────── */

function PriceLine({ p, lang, big }: { p: ProductItem; lang: NumLang; big?: boolean }) {
  const tr = useT();
  const dp = displayPrice(p);
  if (!dp) {
    // display-only price text ("ca. 229–244 USD") without a numeric price
    return p.priceNote ? (
      <HText variant={big ? 'headline' : 'callout'} weight="600" numberOfLines={2}>
        {p.priceNote}
      </HText>
    ) : null;
  }
  const text = formatPrice(dp.price, p.currency, lang);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
      <HText variant={big ? 'stat' : 'headline'} weight="700" tabular>
        {dp.from ? tr('ui.products.from', { price: text }) : text}
      </HText>
      {p.priceNote ? (
        <HText variant="micro" color="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
          {p.priceNote}
        </HText>
      ) : null}
    </View>
  );
}

function ProductCard({ t, p, lang, layout, selecting, selected, picked, onPress, onShop }: { t: Theme; p: ProductItem; lang: NumLang; layout: RailLayout; selecting: boolean; selected: boolean; picked: boolean; onPress: () => void; onShop: () => void }) {
  const tr = useT();
  const target = shopTarget(p);
  const border = selected ? t.colors.accent : picked ? t.colors.success : t.colors.border;
  const [imgMode, setImgMode] = useState<SlotMode>('skeleton');
  // no photo: the card starts with its text; badge / checkbox overlays keep a slim strip to sit in
  const noImg = imgMode === 'collapse';
  return (
    <View style={{ flex: 1, width: layout.cardW, borderRadius: t.radii.l, backgroundColor: t.colors.surface, borderWidth: selected || picked ? 2 : StyleSheet.hairlineWidth, borderColor: border, overflow: 'hidden', ...t.shadows.sm }}>
      <View style={noImg && (p.badge || picked || selecting) ? { minHeight: selecting ? 44 : 36 } : undefined}>
        <CardImage query={p.imageQuery} autoQuery={productImageQuery(p)} url={p.image} webOnly kind={productKind(p.name, p.brand)} height={IMG} fit={productImageFit('card')} tile allowAsk onPress={onPress} onMode={setImgMode} />
        {p.badge || picked ? (
          <View pointerEvents="none" style={{ position: 'absolute', top: 8, left: 8, right: selecting ? 44 : 8, flexDirection: 'row' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: t.radii.pill, backgroundColor: picked ? t.colors.success : t.colors.accent, maxWidth: '100%' }}>
              {picked ? <D1Icon name="check" size={11} color={t.dark ? '#111' : '#fff'} strokeWidth={2.6} /> : null}
              <HText variant="micro" weight="700" numberOfLines={1} style={{ color: picked ? (t.dark ? '#111' : '#fff') : t.colors.onAccent, flexShrink: 1 }}>
                {picked ? tr('ui.products.taken') : p.badge}
              </HText>
            </View>
          </View>
        ) : null}
        {selecting ? (
          <View pointerEvents="none" style={{ position: 'absolute', top: 8, right: 8, width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: selected ? t.colors.accent : 'rgba(255,255,255,0.92)', borderWidth: selected ? 0 : 1.5, borderColor: 'rgba(0,0,0,0.25)' }}>
            {selected ? <D1Icon name="check" size={15} color={t.colors.onAccent} strokeWidth={2.6} /> : null}
          </View>
        ) : null}
      </View>
      <PressableScale
        haptic="selection"
        scaleTo={0.985}
        onPress={onPress}
        accessibilityRole={selecting ? 'checkbox' : 'button'}
        accessibilityState={selecting ? { checked: selected } : undefined}
        accessibilityLabel={productA11y(p, tr, lang) + (picked ? ` ${tr('ui.products.taken')}.` : '')}
        accessibilityHint={selecting ? (selected ? tr('ui.products.deselectA11y', { name: p.name }) : tr('ui.products.selectA11y', { name: p.name })) : tr('ui.places.detailsHint')}
        style={{ flex: 1 }}
        pressedStyle={{ opacity: 0.92 }}
      >
        <View style={{ padding: t.spacing.m, paddingBottom: t.spacing.s, gap: 4 }}>
          {p.brand ? (
            <HText variant="micro" color="muted" numberOfLines={1} style={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
              {p.brand}
            </HText>
          ) : null}
          <HText variant="callout" weight="600" numberOfLines={2}>
            {p.name}
          </HText>
          {p.rating !== undefined ? <RatingRow rating={p.rating} reviews={p.reviews} lang={lang} size={11} /> : null}
          <View style={{ marginTop: 2 }}>
            <PriceLine p={p} lang={lang} />
          </View>
          {p.specs.length ? (
            <View style={{ gap: 2, marginTop: 4 }}>
              {p.specs.slice(0, 3).map((s, i) => (
                <HText key={i} variant="caption" numberOfLines={1}>
                  {s.label ? <HText variant="caption" color="muted">{`${s.label} `}</HText> : null}
                  <HText variant="caption" weight="500">
                    {s.value}
                  </HText>
                </HText>
              ))}
            </View>
          ) : null}
        </View>
      </PressableScale>
      {target ? (
        <View style={{ paddingHorizontal: t.spacing.m, paddingBottom: t.spacing.m, paddingTop: 4 }}>
          <PillButton label={tr('ui.products.toShop')} icon="cart" onPress={onShop} a11yLabel={shopA11y(p, tr)} small style={{ minHeight: 40 }} />
        </View>
      ) : null}
    </View>
  );
}

/* ───────────── ranked row ───────────── */

const RANK_IMG = 76;

function Chip({ t, text, tone }: { t: Theme; text: string; tone: 'pro' | 'con' | 'badge' }) {
  const fg = tone === 'pro' ? t.colors.success : tone === 'con' ? t.colors.danger : t.colors.accent;
  const bg = tone === 'pro' ? t.colors.successSoft : tone === 'con' ? t.colors.dangerSoft : t.colors.accentSoft;
  return (
    // B5: pro/con text wraps inside the pill instead of ending in "…" (a long point takes its own row)
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 3, paddingLeft: tone === 'badge' ? 8 : 5, paddingRight: 8, paddingVertical: 3, borderRadius: t.radii.pill, backgroundColor: bg, maxWidth: '100%' }}>
      {tone !== 'badge' ? (
        <View style={{ paddingTop: 1 }}>
          <D1Icon name={tone === 'pro' ? 'plus' : 'minus'} size={11} color={fg} strokeWidth={2.6} />
        </View>
      ) : null}
      <HText variant="micro" weight="600" style={{ color: fg, flexShrink: 1 }}>
        {text}
      </HText>
    </View>
  );
}

/** Numbered row for `ranked` lists: rank, thumbnail, name, rating · price, verdict, scores line, badge + pros/cons chips. */
function RankedRow({ t, p, rank, lang, selecting, selected, picked, onPress }: { t: Theme; p: ProductItem; rank: number; lang: NumLang; selecting: boolean; selected: boolean; picked: boolean; onPress: () => void }) {
  const tr = useT();
  const dp = displayPrice(p);
  const top = rank === 1;
  const border = selected ? t.colors.accent : picked ? t.colors.success : t.colors.border;
  const [imgMode, setImgMode] = useState<SlotMode>('skeleton');
  const noImg = imgMode === 'collapse';
  return (
    <View style={{ flexDirection: 'row', gap: t.spacing.m, padding: t.spacing.m, borderRadius: t.radii.l, backgroundColor: t.colors.surface, borderWidth: selected || picked ? 2 : StyleSheet.hairlineWidth, borderColor: border }}>
      <View style={noImg ? undefined : { width: RANK_IMG, gap: 8 }}>
        <CardImage query={p.imageQuery} autoQuery={productImageQuery(p)} url={p.image} webOnly kind={productKind(p.name, p.brand)} height={RANK_IMG} fit={productImageFit('rank')} tile radius={t.radii.m} iconSize={26} inline allowAsk onPress={onPress} onMode={setImgMode} style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.colors.border }} />
        <View pointerEvents="none" style={[{ minWidth: 26, height: 26, paddingHorizontal: 6, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: top ? t.colors.accent : t.colors.text }, noImg ? null : { position: 'absolute', top: -6, left: -6, borderWidth: 2, borderColor: t.colors.surface }]}>
          <HText variant="micro" weight="700" tabular style={{ color: top ? t.colors.onAccent : t.colors.bg, fontSize: 12 }}>
            {String(rank)}
          </HText>
        </View>
      </View>
      <PressableScale
        haptic="selection"
        scaleTo={0.99}
        onPress={onPress}
        accessibilityRole={selecting ? 'checkbox' : 'button'}
        accessibilityState={selecting ? { checked: selected } : undefined}
        accessibilityLabel={productA11y(p, tr, lang, rank) + (picked ? ` ${tr('ui.products.taken')}.` : '')}
        accessibilityHint={selecting ? (selected ? tr('ui.products.deselectA11y', { name: p.name }) : tr('ui.products.selectA11y', { name: p.name })) : tr('ui.places.detailsHint')}
        style={{ flex: 1, gap: 4, minWidth: 0 }}
        pressedStyle={{ opacity: 0.85 }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            {p.brand ? (
              <HText variant="micro" color="muted" numberOfLines={1} style={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
                {p.brand}
              </HText>
            ) : null}
            <HText variant="bodyStrong" numberOfLines={2}>
              {p.name}
            </HText>
          </View>
          {selecting ? (
            <View style={{ width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: selected ? t.colors.accent : 'transparent', borderWidth: selected ? 0 : 1.5, borderColor: t.colors.borderStrong }}>
              {selected ? <D1Icon name="check" size={14} color={t.colors.onAccent} strokeWidth={2.6} /> : null}
            </View>
          ) : picked ? (
            <D1Icon name="check" size={18} color={t.colors.success} strokeWidth={2.6} />
          ) : null}
        </View>
        {p.rating !== undefined || dp || p.priceNote ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {p.rating !== undefined ? <RatingRow rating={p.rating} reviews={p.reviews} lang={lang} size={11} /> : null}
            {dp ? (
              <HText variant="caption" weight="700" tabular aria-hidden>
                {dp.from ? tr('ui.products.from', { price: formatPrice(dp.price, p.currency, lang) }) : formatPrice(dp.price, p.currency, lang)}
              </HText>
            ) : p.priceNote ? (
              <HText variant="caption" weight="600" numberOfLines={1} aria-hidden>
                {p.priceNote}
              </HText>
            ) : null}
          </View>
        ) : null}
        {p.verdict ? (
          <HText variant="caption" numberOfLines={3} style={{ color: t.colors.text }}>
            {p.verdict}
          </HText>
        ) : null}
        {p.scores.length ? (
          <HText variant="caption" color="muted" numberOfLines={2} tabular>
            {scoresLine(p.scores, lang)}
          </HText>
        ) : null}
        {p.badge || p.pros.length || p.cons.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 2 }}>
            {p.badge ? <Chip t={t} text={p.badge} tone="badge" /> : null}
            {p.pros.slice(0, 2).map((x, i) => (
              <Chip key={`p${i}`} t={t} text={x} tone="pro" />
            ))}
            {p.cons.slice(0, 1).map((x, i) => (
              <Chip key={`c${i}`} t={t} text={x} tone="con" />
            ))}
          </View>
        ) : null}
      </PressableScale>
    </View>
  );
}

/* ───────────── compare table ───────────── */

function CompareTable({ t, items, lang, onlyDiff, setOnlyDiff, picked, onTake, onOpen, streaming }: { t: Theme; items: ProductItem[]; lang: NumLang; onlyDiff: boolean; setOnlyDiff: (v: boolean) => void; picked?: string; onTake: (p: ProductItem) => void; onOpen: (p: ProductItem) => void; streaming: boolean }) {
  const tr = useT();
  const table = useMemo(() => buildCompareTable(items, { price: tr('ui.products.price'), rating: tr('ui.products.rating') }, lang), [items, tr, lang]);
  const rows = onlyDiff ? table.rows.filter((r) => r.differs) : table.rows;
  const n = items.length;
  return (
    <View style={{ borderRadius: t.radii.l, backgroundColor: t.colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: t.colors.border, padding: t.spacing.m, gap: t.spacing.m }}>
      <SectionLabel
        text={tr('ui.products.compareTitle')}
        right={
          <PressableScale
            haptic="selection"
            onPress={() => setOnlyDiff(!onlyDiff)}
            accessibilityRole="switch"
            accessibilityState={{ checked: onlyDiff }}
            accessibilityLabel={tr('ui.products.onlyDiff')}
            hitSlop={6}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32, paddingHorizontal: 10, borderRadius: t.radii.pill, backgroundColor: onlyDiff ? t.colors.accentSoft : t.colors.surfaceAlt }}
          >
            <View style={{ width: 14, height: 14, borderRadius: 4, borderWidth: 1.5, borderColor: onlyDiff ? t.colors.accent : t.colors.borderStrong, backgroundColor: onlyDiff ? t.colors.accent : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
              {onlyDiff ? <D1Icon name="check" size={10} color={t.colors.onAccent} strokeWidth={3} /> : null}
            </View>
            <HText variant="caption" weight="500" color={onlyDiff ? 'accent' : 'text'}>
              {tr('ui.products.onlyDiff')}
            </HText>
          </PressableScale>
        }
      />

      {/* column heads */}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {items.map((p) => (
          <View key={p.key} style={{ flex: 1, gap: 6 }}>
            <CardImage query={p.imageQuery} autoQuery={productImageQuery(p)} url={p.image} webOnly kind={productKind(p.name, p.brand)} height={72} fit={productImageFit('compare')} tile radius={t.radii.m} iconSize={24} inline allowAsk onPress={() => onOpen(p)} />
            <PressableScale haptic="selection" onPress={() => onOpen(p)} accessibilityLabel={productA11y(p, tr, lang)} accessibilityHint={tr('ui.places.detailsHint')}>
              {p.brand ? (
                <HText variant="micro" color="muted" numberOfLines={1} style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  {p.brand}
                </HText>
              ) : null}
              <HText variant="caption" weight="600" numberOfLines={2}>
                {p.name}
              </HText>
            </PressableScale>
          </View>
        ))}
      </View>

      {/* rows */}
      <View>
        {rows.length ? (
          rows.map((r, ri) => (
            <View key={r.key} style={{ paddingVertical: 8, gap: 4, borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.colors.border }} accessible accessibilityLabel={`${r.label}: ${r.cells.map((c, i) => `${table.columns[i].name} ${c ?? '–'}${r.best.includes(i) ? ` (${tr('ui.products.best')})` : ''}`).join(', ')}`}>
              <HText variant="micro" color="muted" style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {r.label}
              </HText>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {r.cells.map((c, i) => {
                  const best = r.best.includes(i);
                  return (
                    <View key={i} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      {best ? <D1Icon name="check" size={12} color={t.colors.success} strokeWidth={2.6} /> : null}
                      <HText variant="callout" weight={best || ri < 1 ? '600' : '400'} color={c === null ? 'subtle' : best ? 'success' : 'text'} style={{ flexShrink: 1 }} tabular>
                        {c ?? '–'}
                      </HText>
                    </View>
                  );
                })}
              </View>
            </View>
          ))
        ) : (
          <HText variant="caption" color="muted" style={{ paddingVertical: 8 }}>
            {tr('ui.products.noSpecs')}
          </HText>
        )}
      </View>

      {/* pick per column */}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {items.map((p) =>
          picked === p.key ? (
            <PillButton key={p.key} label={tr('ui.products.taken')} icon="check" kind="success" onPress={() => {}} disabled small style={{ flex: 1 }} />
          ) : (
            <PillButton key={p.key} label={tr('ui.products.take')} kind={n > 2 ? 'secondary' : 'primary'} onPress={() => onTake(p)} disabled={streaming} a11yLabel={tr('ui.products.takeA11y', { name: p.name })} small style={{ flex: 1 }} />
          ),
        )}
      </View>
    </View>
  );
}

/* ───────────── detail sheet ───────────── */

function ProductHero({ p }: { p: ProductItem }) {
  const t = useTheme();
  const [imgMode, setImgMode] = useState<SlotMode>('skeleton');
  const noImg = imgMode === 'collapse';
  return (
    <View style={noImg ? { paddingHorizontal: 16, alignItems: 'flex-start' } : undefined}>
      <CardImage query={p.imageQuery} autoQuery={productImageQuery(p)} url={p.image} webOnly kind={productKind(p.name, p.brand)} height={240} fit={productImageFit('detail')} tile iconSize={56} allowAsk onMode={setImgMode} />
      {p.badge ? (
        <View style={{ ...(noImg ? null : { position: 'absolute' as const, left: 16, bottom: 12 }), paddingHorizontal: 10, paddingVertical: 4, borderRadius: t.radii.pill, backgroundColor: t.colors.accent }}>
          <HText variant="caption" weight="700" style={{ color: t.colors.onAccent }}>
            {p.badge}
          </HText>
        </View>
      ) : null}
    </View>
  );
}

function ProductDetails({ t, p, lang, onShop, source, basis }: { t: Theme; p: ProductItem; lang: NumLang; onShop: (url: string) => void; source: unknown; basis: unknown }) {
  const tr = useT();
  const cheapest = cheapestOffer(p);
  const pricedOffers = p.offers.filter((o) => o.price !== undefined).length;
  return (
    <View style={{ padding: t.spacing.l, gap: t.spacing.l }}>
      <View style={{ gap: 6 }}>
        {p.brand ? (
          <HText variant="caption" color="muted" style={{ textTransform: 'uppercase', letterSpacing: 0.7 }}>
            {p.brand}
          </HText>
        ) : null}
        <HText variant="title" accessibilityRole="header">
          {p.name}
        </HText>
        {p.rating !== undefined ? (
          <View accessible accessibilityLabel={ratingA11y(p.rating, p.reviews, tr, lang)}>
            <RatingRow rating={p.rating} reviews={p.reviews} lang={lang} size={14} long />
          </View>
        ) : null}
        <PriceLine p={p} lang={lang} big />
        {p.verdict ? <InlineText variant="body" text={p.verdict} /> : null}
      </View>

      {p.scores.length ? (
        <View style={{ gap: 10 }}>
          <SectionLabel text={tr('ui.products.scores')} />
          {p.scores.map((sc, i) => (
            <ScoreBar key={i} t={t} label={sc.label} value={sc.value} lang={lang} a11y={tr('ui.products.scoreA11y', { label: sc.label, value: formatScore(sc.value, lang) })} />
          ))}
        </View>
      ) : null}

      {p.offers.length ? (
        <View style={{ gap: 4 }}>
          <SectionLabel text={tr('ui.products.offers')} />
          <View>
            {p.offers.map((o, i) => {
              const best = pricedOffers > 1 && cheapest === o;
              const price = o.price !== undefined ? formatPrice(o.price, p.currency, lang) : o.priceText;
              return (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.s, minHeight: 56, paddingVertical: 6, borderBottomWidth: i === p.offers.length - 1 ? 0 : StyleSheet.hairlineWidth, borderColor: t.colors.border }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <HText variant="callout" weight="600" numberOfLines={1}>
                      {o.merchant}
                    </HText>
                    {best ? (
                      <HText variant="micro" weight="600" color="success">
                        {tr('ui.products.cheapest')}
                      </HText>
                    ) : (
                      <HText variant="micro" color="subtle" numberOfLines={1}>
                        {urlHost(o.url)}
                      </HText>
                    )}
                  </View>
                  {price ? (
                    <HText variant="bodyStrong" tabular color={best ? 'success' : 'text'}>
                      {price}
                    </HText>
                  ) : null}
                  <PillButton label={tr('ui.products.toShop')} icon="external" onPress={() => onShop(o.url)} a11yLabel={tr('ui.products.toShopA11y', { name: p.name, merchant: o.merchant })} small />
                </View>
              );
            })}
          </View>
        </View>
      ) : null}

      {p.pros.length || p.cons.length ? (
        <View style={{ gap: t.spacing.m }}>
          {p.pros.length ? <ProsCons t={t} kind="pro" title={tr('ui.products.pros')} items={p.pros} /> : null}
          {p.cons.length ? <ProsCons t={t} kind="con" title={tr('ui.products.cons')} items={p.cons} /> : null}
        </View>
      ) : null}

      {p.specs.length ? (
        <View style={{ gap: 4 }}>
          <SectionLabel text={tr('ui.products.specs')} />
          <View>
            {p.specs.map((s, i) => (
              <InfoRow key={i} label={s.label || undefined} value={s.value} last={i === p.specs.length - 1} />
            ))}
          </View>
        </View>
      ) : null}

      <ProvenanceChip basis={basis} source={source} />
    </View>
  );
}

function ProsCons({ t, kind, title, items }: { t: Theme; kind: 'pro' | 'con'; title: string; items: string[] }) {
  const fg = kind === 'pro' ? t.colors.success : t.colors.danger;
  const bg = kind === 'pro' ? t.colors.successSoft : t.colors.dangerSoft;
  return (
    <View style={{ gap: 8 }}>
      <SectionLabel text={title} />
      {items.map((x, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }} accessible accessibilityLabel={`${title}: ${x}`}>
          <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
            <D1Icon name={kind === 'pro' ? 'plus' : 'minus'} size={13} color={fg} strokeWidth={2.6} />
          </View>
          <InlineText variant="body" text={x} style={{ flex: 1 }} />
        </View>
      ))}
    </View>
  );
}

function ScoreBar({ t, label, value, lang, a11y }: { t: Theme; label: string; value: number; lang: NumLang; a11y: string }) {
  const reduced = useMotionReduced();
  const p = useSharedValue(reduced ? value / 10 : 0);
  useEffect(() => {
    p.value = reduced ? value / 10 : withTiming(value / 10, { duration: 420, easing: Easing.out(Easing.cubic) });
  }, [value, reduced, p]);
  const bar = useAnimatedStyle(() => ({ transform: [{ scaleX: Math.max(0.0001, p.value) }] }));
  // settled: React owns the final fill (a dropped animated value would reset the bar to scaleX 0)
  const settled = useSettledAfter(reduced ? 0 : 500, [value, reduced]);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }} accessible accessibilityLabel={a11y}>
      <HText variant="callout" style={{ width: '34%' }} numberOfLines={1}>
        {label}
      </HText>
      <View style={{ flex: 1, height: 8, borderRadius: 4, backgroundColor: t.colors.surfaceAlt, overflow: 'hidden' }}>
        <Animated.View style={[{ height: 8, width: '100%', borderRadius: 4, backgroundColor: value >= 8 ? t.colors.success : t.colors.accent, transformOrigin: 'left' } as object, bar, settled ? { transform: [{ scaleX: Math.max(0.0001, value / 10) }] } : null]} />
      </View>
      <HText variant="callout" weight="600" tabular style={{ minWidth: 30, textAlign: 'right' }}>
        {formatScore(value, lang)}
      </HText>
    </View>
  );
}
