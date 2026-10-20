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
import { D1Icon, StarGlyph } from './icons';
import { Button } from '../../../primitives/Button';
import { Skeleton } from '../../../primitives/Skeleton';
import {
  buildCompareTable,
  cheapestOffer,
  displayPrice,
  targetText,
  formatCount,
  formatPrice,
  formatRating,
  normalizeProducts,
  numLang,
  productA11y,
  productKind,
  productReply,
  formatScore,
  ratingA11y,
  shopTarget,
  toggleCompare,
  urlHost,
  type NumLang,
  type ProductItem,
} from './d1Model.ts';
import { ImageSlotGroup } from '../../imageSlot';
import { productImageFit, type SlotMode } from '../../../../images/slot';
import { CardImage, DetailSheet, HeaderPill, InfoRow, Rail, RatingRow, SNAP_START, SectionLabel, SkeletonCard, railLayout, starColor, type RailLayout } from './parts';
import { useCaptureMode } from '../../../lib/capture';
import { LiveNode, useLiveHandOver } from '../../../../live/ui/LiveNode';

type ProductsState = { compare: string[]; comparing?: boolean; onlyDiff?: boolean; pick?: string };
const INITIAL: ProductsState = { compare: [] };
const IMG = 150;

export function Products({ node }: { node: Partial<HuiProducts> }) {
  // a live watchlist (`"live":true`) in a chat that folds live cards: receipt / inline card / snapshot
  const live = useLiveHandOver(node);
  if (live) return <LiveNode node={node} {...live} type="products" />;
  return <PlainProducts node={node} />;
}

function PlainProducts({ node }: { node: Partial<HuiProducts> }) {
  const t = useTheme();
  const tr = useT();
  const { lang } = useLocale();
  const L = numLang(lang);
  const { streaming, onAction } = useHui();
  const capture = useCaptureMode();
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
        <View style={{ flexDirection: 'row', gap: t.spacing.s, overflow: 'hidden' }} accessibilityLabel={tr('ui.products.loading')}>
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
  // share-as-image: a grid (a rail would cut the cards off at the frame edge)
  const layout = railLayout(w, { peek: 0.6, maxCard: 230, minGridCard: 200, grid: model.layout === 'grid' || capture });
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
      <View style={{ gap: t.spacing.xs }}>
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
          <View accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: t.radii.control, backgroundColor: full ? t.colors.warningSoft : t.colors.accentSoft }}>
            <D1Icon name={full ? 'x' : 'compare'} size={15} color={full ? t.colors.warning : t.colors.accent} strokeWidth={2} />
            <HText variant="caption" weight="500" style={{ flex: 1, color: full ? t.colors.warning : t.colors.accentText }}>
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
              <RankedRow t={t} p={p} rank={i + 1} lang={L} wide={w >= WIDE_RANKED} selecting={comparing} selected={sel.includes(p.key)} picked={picked === p.key} onPress={() => (comparing ? toggle(p) : setOpenKey(p.key))} />
            </Appear>
          ))}
          {model.pending ? <RankedSkeleton t={t} /> : null}
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
              {shopTarget(opened) ? <Button label={tr('ui.products.toShop')} icon="external" variant="secondary" grow numberOfLines={2} onPress={() => shop(opened)} accessibilityLabel={shopA11y(opened, tr)} /> : null}
              {picked === opened.key ? (
                <PickedNote t={t} grow />
              ) : (
                <Button label={tr('ui.products.take')} icon="check" variant="primary" grow numberOfLines={2} onPress={() => take(opened)} disabled={streaming} accessibilityLabel={tr('ui.products.takeA11y', { name: opened.name })} />
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

/* ───────────── shared pieces (product-specific; the places card keeps its own in parts.tsx) ───────────── */

/**
 * The one highlight a product may carry: its badge ("Testsieger") or, once chosen, "Your pick". One quiet
 * style (soft tint + coloured text); the surface underneath keeps the translucent dark-mode tint legible
 * over a photo.
 */
function Highlight({ t, text, picked }: { t: Theme; text: string; picked?: boolean }) {
  const fg = picked ? t.colors.success : t.colors.accentText;
  return (
    <View style={[s.hlWrap, { borderRadius: t.radii.inline, backgroundColor: t.colors.surface }]}>
      <View style={[s.hl, { borderRadius: t.radii.inline, backgroundColor: picked ? t.colors.successSoft : t.colors.accentSoft }]}>
        {picked ? <D1Icon name="check" size={12} color={fg} strokeWidth={2.6} /> : null}
        <HText variant="caption" weight="600" style={[s.shrink, { color: fg }]}>
          {text}
        </HText>
      </View>
    </View>
  );
}

/** "★ 4,6 (2.345)": one star, the score, the count. Hidden from screen readers (the row label says it in words). */
function RatingCompact({ t, rating, reviews, lang }: { t: Theme; rating: number; reviews?: number; lang: NumLang }) {
  return (
    <View style={s.rating} aria-hidden>
      <StarGlyph fill={1} size={Math.round(13 * t.fontScale)} color={starColor(t)} track={t.colors.border} />
      <HText variant="caption" weight="600" tabular>
        {formatRating(rating, lang)}
      </HText>
      {reviews !== undefined ? (
        <HText variant="caption" color="muted" tabular style={s.shrink}>
          {`(${formatCount(reviews, lang)})`}
        </HText>
      ) : null}
    </View>
  );
}

/** Headline price ("ab 199 €"), or the model's display text when there is no number. Never truncated. */
function PriceText({ p, lang, align }: { p: ProductItem; lang: NumLang; align?: 'right' }) {
  const tr = useT();
  const dp = displayPrice(p);
  if (dp) {
    const text = formatPrice(dp.price, p.currency, lang);
    return (
      <HText variant="headline" weight="700" tabular align={align} aria-hidden>
        {dp.from ? tr('ui.products.from', { price: text }) : text}
      </HText>
    );
  }
  const note = p.priceNote ?? targetText(p, tr, lang);
  return note ? (
    <HText variant="callout" weight="600" align={align} aria-hidden>
      {note}
    </HText>
  ) : null;
}

type Fact = { label: string; value: string };

/** Label (muted) / value (tabular, right-aligned) pairs, `cols` pairs per row: the spec table of a card. */
function FactsTable({ t, facts, cols }: { t: Theme; facts: Fact[]; cols: 1 | 2 }) {
  const rows: Fact[][] = [];
  for (let i = 0; i < facts.length; i += cols) rows.push(facts.slice(i, i + cols));
  return (
    <View style={s.facts} aria-hidden>
      {rows.map((r, ri) => (
        <View key={ri} style={[s.factsRow, { columnGap: t.spacing.l }]}>
          {Array.from({ length: cols }, (_, ci) => {
            const f = r[ci];
            if (!f) return <View key={ci} style={s.fact} />;
            return (
              <View key={ci} style={s.fact}>
                {f.label ? (
                  <HText variant="caption" color="muted" style={s.flex}>
                    {f.label}
                  </HText>
                ) : null}
                <HText variant="caption" weight="600" tabular align={f.label ? 'right' : undefined} style={f.label ? s.factValue : s.flex}>
                  {f.value}
                </HText>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

/**
 * Up to two pros and one con as quiet lines. Only the sign carries colour: "+" success, "−" muted (seal red is
 * reserved for approval / destructive moments and danger red would read as an error).
 */
function ProConLines({ t, pros, cons }: { t: Theme; pros: string[]; cons: string[] }) {
  return (
    <View style={s.lines} aria-hidden>
      {pros.slice(0, 2).map((x, i) => (
        <ProConLine key={`p${i}`} t={t} kind="pro" text={x} />
      ))}
      {cons.slice(0, 1).map((x, i) => (
        <ProConLine key={`c${i}`} t={t} kind="con" text={x} />
      ))}
    </View>
  );
}

function ProConLine({ t, kind, text }: { t: Theme; kind: 'pro' | 'con'; text: string }) {
  return (
    <View style={s.line}>
      <HText variant="caption" weight="700" style={[s.sign, { color: kind === 'pro' ? t.colors.success : t.colors.muted }]}>
        {kind === 'pro' ? '+' : '−'}
      </HText>
      <HText variant="caption" color="muted" style={s.flex}>
        {text}
      </HText>
    </View>
  );
}

/** Round compare checkbox (selecting mode). */
function SelectMark({ t, selected }: { t: Theme; selected: boolean }) {
  return (
    <View style={[s.selectMark, { backgroundColor: selected ? t.colors.accent : t.colors.surface, borderWidth: selected ? 0 : 1.5, borderColor: t.colors.borderControl }]}>
      {selected ? <D1Icon name="check" size={14} color={t.colors.onAccent} strokeWidth={2.6} /> : null}
    </View>
  );
}

/** "Your pick" as a settled state (not a button) where the pick button was. */
function PickedNote({ t, grow }: { t: Theme; grow?: boolean }) {
  const tr = useT();
  return (
    <View style={[s.picked, grow ? s.grow : null, { borderRadius: t.radii.control, backgroundColor: t.colors.successSoft }]}>
      <D1Icon name="check" size={15} color={t.colors.success} strokeWidth={2.4} />
      <HText variant="callout" weight="600" color="success" numberOfLines={2} style={s.shrink}>
        {tr('ui.products.taken')}
      </HText>
    </View>
  );
}

/* ───────────── card ───────────── */

function PriceLine({ p, lang, big }: { p: ProductItem; lang: NumLang; big?: boolean }) {
  const tr = useT();
  const dp = displayPrice(p);
  const target = targetText(p, tr, lang);
  if (!dp) {
    // display-only price text ("ca. 229–244 USD") without a numeric price; a watchlist product without a price yet
    // shows the user's target price
    const note = [p.priceNote, target].filter(Boolean).join(' · ');
    return note ? (
      <HText variant={big ? 'headline' : 'callout'} weight="600">
        {note}
      </HText>
    ) : null;
  }
  const text = formatPrice(dp.price, p.currency, lang);
  return (
    <View style={s.priceLine}>
      <HText variant={big ? 'stat' : 'headline'} weight="700" tabular>
        {dp.from ? tr('ui.products.from', { price: text }) : text}
      </HText>
      {p.priceNote || target ? (
        <HText variant="caption" color="muted" style={s.shrink}>
          {[p.priceNote, target].filter(Boolean).join(' · ')}
        </HText>
      ) : null}
    </View>
  );
}

/** Rail / grid card: photo, highlight, brand, name, price, rating, a small spec table, "Go to shop". */
function ProductCard({ t, p, lang, layout, selecting, selected, picked, onPress, onShop }: { t: Theme; p: ProductItem; lang: NumLang; layout: RailLayout; selecting: boolean; selected: boolean; picked: boolean; onPress: () => void; onShop: () => void }) {
  const tr = useT();
  const target = shopTarget(p);
  const border = selected ? t.colors.accent : picked ? t.colors.success : t.colors.border;
  const [imgMode, setImgMode] = useState<SlotMode>('skeleton');
  // no photo: the card starts with its text; the compare checkbox keeps a slim strip to sit in
  const noImg = imgMode === 'collapse';
  const specs = p.specs.slice(0, 3).map((x) => ({ label: x.label, value: x.value }));
  return (
    <View style={{ flex: 1, width: layout.cardW, borderRadius: t.radii.card, backgroundColor: t.colors.surface, borderWidth: selected || picked ? 2 : StyleSheet.hairlineWidth, borderColor: border, overflow: 'hidden', ...t.shadows.sm }}>
      <View style={noImg && selecting ? s.checkStrip : undefined}>
        <CardImage query={p.imageQuery} autoQuery={productImageQuery(p)} url={p.image} webOnly kind={productKind(p.name, p.brand)} height={IMG} fit={productImageFit('card')} tile allowAsk onPress={onPress} onMode={setImgMode} />
        {selecting ? (
          <View pointerEvents="none" style={s.checkOverlay}>
            <SelectMark t={t} selected={selected} />
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
        style={s.flex}
        pressedStyle={s.pressed}
      >
        <View style={{ padding: t.spacing.m, paddingBottom: t.spacing.s, gap: t.spacing.xs }}>
          {p.badge || picked ? (
            <View style={{ marginBottom: t.spacing.xs }}>
              <Highlight t={t} text={picked ? tr('ui.products.taken') : (p.badge as string)} picked={picked} />
            </View>
          ) : null}
          <View>
            {p.brand ? (
              <HText variant="caption" color="muted" numberOfLines={1}>
                {p.brand}
              </HText>
            ) : null}
            <HText variant="headline" numberOfLines={3}>
              {p.name}
            </HText>
          </View>
          <PriceLine p={p} lang={lang} />
          {p.rating !== undefined ? <RatingCompact t={t} rating={p.rating} reviews={p.reviews} lang={lang} /> : null}
          {specs.length ? (
            <View style={{ marginTop: t.spacing.xs }}>
              <FactsTable t={t} facts={specs} cols={1} />
            </View>
          ) : null}
        </View>
      </PressableScale>
      {target ? (
        <View style={{ paddingHorizontal: t.spacing.m, paddingBottom: t.spacing.m, paddingTop: t.spacing.xs }}>
          <Button label={tr('ui.products.toShop')} icon="external" variant="secondary" size="small" numberOfLines={2} onPress={onShop} accessibilityLabel={shopA11y(p, tr)} />
        </View>
      ) : null}
    </View>
  );
}

/* ───────────── ranked row ───────────── */

const RANK_IMG = 72;
/** wide ranked rows: price + spec table in their own right-hand column */
const FACTS_W = 248;
const WIDE_RANKED = 680;

/**
 * Numbered row for `ranked` lists, set like a buying guide: rank + brand caption, the name as headline with
 * the price, one compact rating, the one highlight; then the verdict, the scores as a label / value table
 * and up to two pros + one con as quiet lines. Wide (≥ WIDE_RANKED): price + table move to a right column.
 * The header carries the row's one accessible label; the rest is a second, screen-reader-hidden tap area.
 */
function RankedRow({ t, p, rank, lang, wide, selecting, selected, picked, onPress }: { t: Theme; p: ProductItem; rank: number; lang: NumLang; wide: boolean; selecting: boolean; selected: boolean; picked: boolean; onPress: () => void }) {
  const tr = useT();
  const border = selected ? t.colors.accent : picked ? t.colors.success : t.colors.border;
  const [imgMode, setImgMode] = useState<SlotMode>('skeleton');
  const noImg = imgMode === 'collapse';
  const scores = p.scores.map((sc) => ({ label: sc.label, value: formatScore(sc.value, lang) }));
  const facts = scores.length ? <FactsTable t={t} facts={scores} cols={wide ? 1 : 2} /> : null;
  const hasPrice = !!displayPrice(p) || !!p.priceNote || p.target !== undefined;
  const hasBody = !!p.verdict || (!wide && !!facts) || p.pros.length > 0 || p.cons.length > 0;
  const quiet = { onPress, haptic: 'selection' as const, scaleTo: 1, pressedStyle: s.pressed, accessible: false, focusable: false, importantForAccessibility: 'no-hide-descendants' as const, accessibilityElementsHidden: true, 'aria-hidden': true };

  const head = (
    <>
      <View style={s.topLine}>
        <View style={[s.rank, { borderRadius: t.radii.inline, backgroundColor: t.colors.surfaceAlt }]}>
          <HText variant="caption" weight="600" tabular>
            {String(rank)}
          </HText>
        </View>
        {p.brand ? (
          <HText variant="caption" color="muted" style={s.shrink}>
            {p.brand}
          </HText>
        ) : null}
        {p.badge || selecting || picked ? (
          <View style={s.topEnd}>
            {p.badge ? <Highlight t={t} text={p.badge} /> : null}
            {selecting ? <SelectMark t={t} selected={selected} /> : picked ? <D1Icon name="check" size={18} color={t.colors.success} strokeWidth={2.6} /> : null}
          </View>
        ) : null}
      </View>
      <View style={[s.nameLine, { columnGap: t.spacing.m }]}>
        <HText variant="headline" style={s.shrink}>
          {p.name}
        </HText>
        {!wide && hasPrice ? <PriceText p={p} lang={lang} /> : null}
      </View>
      {p.rating !== undefined ? <RatingCompact t={t} rating={p.rating} reviews={p.reviews} lang={lang} /> : null}
    </>
  );
  const body = (
    <>
      {p.verdict ? <HText variant="callout">{p.verdict}</HText> : null}
      {wide ? null : facts}
      {p.pros.length || p.cons.length ? <ProConLines t={t} pros={p.pros} cons={p.cons} /> : null}
    </>
  );
  const main = (extra: object, children: React.ReactNode) => (
    <PressableScale
      haptic="selection"
      scaleTo={1}
      onPress={onPress}
      accessibilityRole={selecting ? 'checkbox' : 'button'}
      accessibilityState={selecting ? { checked: selected } : undefined}
      accessibilityLabel={productA11y(p, tr, lang, rank) + (picked ? ` ${tr('ui.products.taken')}.` : '')}
      accessibilityHint={selecting ? (selected ? tr('ui.products.deselectA11y', { name: p.name }) : tr('ui.products.selectA11y', { name: p.name })) : tr('ui.places.detailsHint')}
      style={[s.flex, s.gap4, extra]}
      pressedStyle={s.pressed}
    >
      {children}
    </PressableScale>
  );
  const thumb = (
    <View style={noImg ? undefined : [s.thumb, { marginRight: t.spacing.m }]}>
      <CardImage query={p.imageQuery} autoQuery={productImageQuery(p)} url={p.image} webOnly kind={productKind(p.name, p.brand)} height={RANK_IMG} fit={productImageFit('rank')} tile radius={t.radii.control} iconSize={26} inline allowAsk onPress={onPress} onMode={setImgMode} style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.colors.border }} />
    </View>
  );
  const card = { padding: t.spacing.l, borderRadius: t.radii.card, backgroundColor: t.colors.surface, borderWidth: selected || picked ? 2 : StyleSheet.hairlineWidth, borderColor: border };

  if (wide) {
    return (
      <View style={[card, s.row]}>
        {thumb}
        {main({}, (
          <>
            {head}
            {hasBody ? <View style={[s.body, { marginTop: t.spacing.xs }]}>{body}</View> : null}
          </>
        ))}
        {hasPrice || facts ? (
          <PressableScale {...quiet} style={[s.factsCol, { width: FACTS_W, marginLeft: t.spacing.xl }]}>
            {hasPrice ? <PriceText p={p} lang={lang} align="right" /> : null}
            {facts}
          </PressableScale>
        ) : null}
      </View>
    );
  }
  return (
    <View style={card}>
      <View style={s.row}>
        {thumb}
        {main({}, head)}
      </View>
      {hasBody ? (
        <PressableScale {...quiet} style={[s.body, { marginTop: t.spacing.m }]}>
          {body}
        </PressableScale>
      ) : null}
    </View>
  );
}

/** Placeholder for the arriving ranked row: same thumbnail + header shape, so the real row lands in place. */
function RankedSkeleton({ t }: { t: Theme }) {
  return (
    <View aria-hidden style={[s.row, { padding: t.spacing.l, borderRadius: t.radii.card, backgroundColor: t.colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: t.colors.border }]}>
      <Skeleton width={RANK_IMG} height={RANK_IMG} radius={t.radii.control} style={{ marginRight: t.spacing.m }} />
      <View style={[s.flex, { gap: t.spacing.s, paddingTop: t.spacing.xxs }]}>
        <Skeleton width="30%" height={10} />
        <Skeleton width="65%" height={14} />
        <Skeleton width="40%" height={10} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  shrink: { flexShrink: 1 },
  grow: { flexGrow: 1, flexBasis: 0 },
  gap4: { gap: 4 },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  pressed: { opacity: 0.85 },
  hlWrap: { alignSelf: 'flex-start', maxWidth: '100%' },
  hl: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 2 },
  rating: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  priceLine: { flexDirection: 'row', alignItems: 'baseline', columnGap: 8, flexWrap: 'wrap' },
  facts: { gap: 4 },
  factsRow: { flexDirection: 'row' },
  fact: { flex: 1, flexBasis: 0, minWidth: 0, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  factValue: { flexShrink: 1, maxWidth: '65%' },
  lines: { gap: 2 },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: 4 },
  sign: { minWidth: 12, textAlign: 'center' },
  selectMark: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  picked: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 12 },
  checkStrip: { minHeight: 44 },
  checkOverlay: { position: 'absolute', top: 8, right: 8 },
  thumb: { width: RANK_IMG },
  topLine: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  topEnd: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 8 },
  rank: { minWidth: 22, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  nameLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', rowGap: 2 },
  body: { gap: 8 },
  factsCol: { gap: 8 },
});

/* ───────────── compare table ───────────── */

function CompareTable({ t, items, lang, onlyDiff, setOnlyDiff, picked, onTake, onOpen, streaming }: { t: Theme; items: ProductItem[]; lang: NumLang; onlyDiff: boolean; setOnlyDiff: (v: boolean) => void; picked?: string; onTake: (p: ProductItem) => void; onOpen: (p: ProductItem) => void; streaming: boolean }) {
  const tr = useT();
  const table = useMemo(() => buildCompareTable(items, { price: tr('ui.products.price'), rating: tr('ui.products.rating') }, lang), [items, tr, lang]);
  const rows = onlyDiff ? table.rows.filter((r) => r.differs) : table.rows;
  return (
    <View style={{ borderRadius: t.radii.card, backgroundColor: t.colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: t.colors.border, padding: t.spacing.m, gap: t.spacing.m }}>
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
          <View key={p.key} style={{ flex: 1, gap: 4 }}>
            <CardImage query={p.imageQuery} autoQuery={productImageQuery(p)} url={p.image} webOnly kind={productKind(p.name, p.brand)} height={72} fit={productImageFit('compare')} tile radius={t.radii.control} iconSize={24} inline allowAsk onPress={() => onOpen(p)} />
            <PressableScale haptic="selection" onPress={() => onOpen(p)} accessibilityLabel={productA11y(p, tr, lang)} accessibilityHint={tr('ui.places.detailsHint')}>
              {p.brand ? (
                <HText variant="caption" color="muted" numberOfLines={1}>
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
              <HText variant="caption" weight="600" color="muted">
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
            <PickedNote key={p.key} t={t} grow />
          ) : (
            <Button key={p.key} label={tr('ui.products.take')} variant="secondary" size="small" grow numberOfLines={2} onPress={() => onTake(p)} disabled={streaming} accessibilityLabel={tr('ui.products.takeA11y', { name: p.name })} />
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
        <View style={noImg ? undefined : { position: 'absolute', left: 16, bottom: 12, right: 16 }}>
          <Highlight t={t} text={p.badge} />
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
      <View style={{ gap: 8 }}>
        {p.brand ? (
          <HText variant="caption" color="muted">
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
        <View style={{ gap: 8 }}>
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
                  <Button label={tr('ui.products.toShop')} icon="external" variant="secondary" size="small" onPress={() => onShop(o.url)} accessibilityLabel={tr('ui.products.toShopA11y', { name: p.name, merchant: o.merchant })} />
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
  return (
    <View style={{ gap: 8 }}>
      <SectionLabel text={title} />
      {items.map((x, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }} accessible accessibilityLabel={`${title}: ${x}`}>
          <HText variant="body" weight="700" style={{ minWidth: 16, textAlign: 'center', color: kind === 'pro' ? t.colors.success : t.colors.muted }} aria-hidden>
            {kind === 'pro' ? '+' : '−'}
          </HText>
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
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }} accessible accessibilityLabel={a11y}>
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
