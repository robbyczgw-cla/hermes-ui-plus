/**
 * `places` (docs/SPEC-modules-v4.md §B): ChatGPT-class place cards. Photo (imageQuery → our image
 * search), name, category · price · distance, stars + count, open state with coloured dot, short note,
 * actions Route · Anrufen · Website · Merken (all through the confirmed action runner). Tap → detail
 * sheet (hours table with today highlighted, address, contact, mini map via the `map` renderer, tags).
 * "Alle auf Karte" expands the existing map renderer with every place. Phones: snapping rail with the
 * next card peeking; wide screens: grid; `layout: 'list'` → compact rows. Streaming: finished places
 * render, the one still arriving is a skeleton card. "Merken" state persists via useNodeState.
 */
import { useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme, type Theme } from '../../../theme';
import { useHui } from '../../../primitives/context';
import { FadeIn, HText, InlineText, PressableScale } from '../../../primitives/basics';
import { useNodeState } from '../../../../nodestate';
import { useLocale, useT } from '../../../../i18n';
import type { HuiMap, HuiPlaces } from '../../../types';
import { useModuleId } from '../a/shared';
import { ProvenanceChip } from '../ProvenanceChip';
import { MapNode } from '../MapNode';
import { placeImageQuery, placeModelQuery, sharedPlaceCity } from '../../../../images';
import { D1Icon } from './icons';
import {
  cleanPhone,
  cleanUrl,
  formatCount,
  normalizePlaces,
  numLang,
  openState,
  parseHoursLines,
  placeA11y,
  placeKind,
  placeListItem,
  placesMapNode,
  ratingA11y,
  urlHost,
  type NumLang,
  type PlaceItem,
} from './d1Model.ts';
import { ImageSlotGroup } from '../../imageSlot';
import type { SlotMode } from '../../../../images/slot';
import { ActionTile, CardImage, DetailSheet, HeaderPill, InfoRow, OpenLine, Rail, RatingRow, SNAP_START, SectionLabel, SkeletonCard, railLayout, type RailLayout } from './parts';
import { useCaptureMode } from '../../../lib/capture';

type PlacesState = { saved: string[] };
const INITIAL: PlacesState = { saved: [] };
const CARD_IMG = 150;
const LIST_IMG = 84;

function nowMinutes(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

export function Places({ node }: { node: Partial<HuiPlaces> }) {
  const t = useTheme();
  const tr = useT();
  const { lang } = useLocale();
  const L = numLang(lang);
  const { streaming, onAction } = useHui();
  const capture = useCaptureMode();
  const id = useModuleId('places', node as Record<string, unknown>);
  const model = useMemo(() => normalizePlaces(node, streaming), [node, streaming]);
  const [st, setSt] = useNodeState<PlacesState>(id, INITIAL);
  const [w, setW] = useState(0);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [showMap, setShowMap] = useState(false);
  // only places that stream in animate; history renders still
  const animateIn = useRef(streaming).current;
  const now = nowMinutes();

  // the city the places share (from their addresses): lets "Altstadt" search as "Altstadt <city>"
  const city = useMemo(() => sharedPlaceCity(model.items), [model.items]);
  const mapNode = useMemo(() => placesMapNode(`${id}-all-map`, model.items, model.title), [id, model.items, model.title]);
  const saved = new Set(st.saved ?? []);

  const act = useMemo(
    () => ({
      route: (p: PlaceItem) => onAction({ type: 'maps', query: [p.name, p.address].filter(Boolean).join(', '), ...(p.lat !== undefined && p.lng !== undefined ? { lat: p.lat, lng: p.lng } : {}) }, undefined, { nodeId: id }),
      call: (p: PlaceItem) => {
        const phone = cleanPhone(p.phone);
        if (phone) onAction({ type: 'call', phone }, undefined, { nodeId: id });
      },
      website: (p: PlaceItem) => {
        const url = cleanUrl(p.website);
        if (url) onAction({ type: 'open_url', url }, undefined, { nodeId: id });
      },
      save: (p: PlaceItem, on: boolean) => {
        setSt((s) => ({ ...s, saved: on ? [...(s.saved ?? []).filter((k) => k !== p.key), p.key] : (s.saved ?? []).filter((k) => k !== p.key) }));
        if (on) onAction({ type: 'add_to_list', items: [placeListItem(p)], listTitle: tr('ui.places.listTitle') }, undefined, { nodeId: id });
      },
      copy: (text: string) => onAction({ type: 'copy', text }, undefined, { nodeId: id }),
    }),
    [onAction, id, setSt, tr],
  );

  if (!model.items.length && !model.pending) {
    if (streaming) return <PlacesLoading t={t} label={tr('ui.places.loading')} />;
    return (
      <HText variant="callout" color="muted">
        {tr('ui.places.empty')}
      </HText>
    );
  }

  const list = model.layout === 'list';
  // share-as-image: one card per row (a rail would cut the cards off at the frame edge)
  const layout = railLayout(w, { peek: 0.8, maxCard: 320, minGridCard: 260, grid: capture, minCols: capture ? 1 : 2 });
  const opened = openKey ? model.items.find((p) => p.key === openKey) : undefined;
  const count = model.items.length + (model.pending ? 1 : 0);

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
                {tr('ui.places.count', { n: model.items.length })}
              </HText>
            ) : null}
            <ProvenanceChip basis={model.basis} source={model.source} />
          </View>
          {mapNode && !capture ? <HeaderPill icon="map" label={showMap ? tr('ui.places.hideMap') : tr('ui.places.showMap')} onPress={() => setShowMap((v) => !v)} active={showMap} /> : null}
        </View>
      </View>

      {/* cards */}
      {w > 0 ? (
        list ? (
          <View style={{ gap: t.spacing.s }}>
            {model.items.map((p) => (
              <Appear key={p.key} on={animateIn}>
                <PlaceRow t={t} p={p} city={city} lang={L} now={now} saved={saved.has(p.key)} onOpen={() => setOpenKey(p.key)} act={act} />
              </Appear>
            ))}
            {model.pending ? <SkeletonCard width="100%" imageH={0} lines={2} /> : null}
          </View>
        ) : (
          <Rail layout={layout} count={count} label={tr('ui.places.carouselA11y', { n: count })} arrowTop={CARD_IMG / 2}>
            {model.items.map((p) => (
              <Appear key={p.key} on={animateIn} style={[{ width: layout.cardW }, SNAP_START]}>
                <PlaceCard t={t} p={p} city={city} lang={L} now={now} layout={layout} saved={saved.has(p.key)} onOpen={() => setOpenKey(p.key)} act={act} />
              </Appear>
            ))}
            {model.pending ? <SkeletonCard width={layout.cardW} imageH={CARD_IMG} /> : null}
          </Rail>
        )
      ) : (
        <View style={{ height: CARD_IMG + 190 }} />
      )}

      {showMap && mapNode ? (
        <FadeIn>
          <MapNode node={mapNode as unknown as HuiMap} />
        </FadeIn>
      ) : null}

      <DetailSheet
        open={!!opened}
        onClose={() => setOpenKey(null)}
        label={opened?.name ?? ''}
        hero={opened ? <CardImage query={placeModelQuery(opened.imageQuery, { city })} autoQuery={placeImageQuery(opened, { city })} url={opened.image} kind={placeKind(opened.category, opened.name)} height={220} iconSize={48} allowAsk /> : null}
      >
        {opened ? <PlaceDetails t={t} p={opened} id={id} lang={L} now={now} saved={saved.has(opened.key)} act={act} source={model.source} basis={model.basis} /> : null}
      </DetailSheet>
    </View>
    </ImageSlotGroup>
  );
}

type Acts = {
  route: (p: PlaceItem) => void;
  call: (p: PlaceItem) => void;
  website: (p: PlaceItem) => void;
  save: (p: PlaceItem, on: boolean) => void;
  copy: (text: string) => void;
};

/** Fade/rise in for places that arrive while streaming (reduce-motion aware via FadeIn). */
function Appear({ on, style, children }: { on: boolean; style?: object; children: React.ReactNode }) {
  if (!on) return <View style={style}>{children}</View>;
  return (
    <FadeIn style={style} rise={10}>
      {children}
    </FadeIn>
  );
}

function PlacesLoading({ t, label }: { t: Theme; label: string }) {
  return (
    <View style={{ gap: t.spacing.m }} accessibilityLabel={label} accessibilityLiveRegion="polite">
      <View style={{ flexDirection: 'row', gap: 10, overflow: 'hidden' }}>
        <SkeletonCard width={280} imageH={CARD_IMG} />
        <SkeletonCard width={280} imageH={CARD_IMG} />
      </View>
    </View>
  );
}

/* ───────────── card ───────────── */

function MetaLine({ p, t }: { p: PlaceItem; t: Theme }) {
  const parts: React.ReactNode[] = [];
  if (p.category) parts.push(p.category);
  if (p.price)
    parts.push(
      <HText key="price" variant="caption">
        <HText variant="caption" color="text" weight="500">
          {p.price.symbol.repeat(p.price.level)}
        </HText>
        <HText variant="caption" style={{ color: t.colors.border }}>
          {p.price.symbol.repeat(4 - p.price.level)}
        </HText>
      </HText>,
    );
  if (p.distance) parts.push(p.distance);
  if (!parts.length) return null;
  return (
    <HText variant="caption" color="muted" numberOfLines={1}>
      {parts.map((x, i) => (
        <HText key={i} variant="caption" color="muted">
          {i > 0 ? ' · ' : ''}
          {x}
        </HText>
      ))}
    </HText>
  );
}

function PlaceActions({ p, saved, act }: { p: PlaceItem; saved: boolean; act: Acts }) {
  const tr = useT();
  const phone = cleanPhone(p.phone);
  const site = cleanUrl(p.website);
  return (
    <View style={{ flexDirection: 'row', gap: 6 }}>
      <ActionTile icon="route" label={tr('ui.places.route')} a11yLabel={tr('ui.places.routeA11y', { name: p.name })} onPress={() => act.route(p)} tone="accent" />
      {phone ? <ActionTile icon="phone" label={tr('ui.places.call')} a11yLabel={tr('ui.places.callA11y', { name: p.name })} onPress={() => act.call(p)} /> : null}
      {site ? <ActionTile icon="globe" label={tr('ui.places.website')} a11yLabel={tr('ui.places.websiteA11y', { name: p.name })} onPress={() => act.website(p)} /> : null}
      <ActionTile
        icon={saved ? 'bookmarkFilled' : 'bookmark'}
        label={saved ? tr('ui.places.saved') : tr('ui.places.save')}
        a11yLabel={saved ? tr('ui.places.savedA11y', { name: p.name }) : tr('ui.places.saveA11y', { name: p.name })}
        onPress={() => act.save(p, !saved)}
        active={saved}
      />
    </View>
  );
}

function PlaceCard({ t, p, city, lang, now, layout, saved, onOpen, act }: { t: Theme; p: PlaceItem; city: string; lang: NumLang; now: number; layout: RailLayout; saved: boolean; onOpen: () => void; act: Acts }) {
  const tr = useT();
  const open = openState(p, tr, now);
  const kind = placeKind(p.category, p.name);
  const [imgMode, setImgMode] = useState<SlotMode>('skeleton');
  const noImg = imgMode === 'collapse';
  return (
    <View style={{ flex: 1, width: layout.cardW, borderRadius: t.radii.card, backgroundColor: t.colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: t.colors.border, overflow: 'hidden', ...t.shadows.sm }}>
      <View style={noImg && saved ? { minHeight: 44 } : undefined}>
        <CardImage query={placeModelQuery(p.imageQuery, { city })} autoQuery={placeImageQuery(p, { city })} url={p.image} kind={kind} height={CARD_IMG} allowAsk onPress={onOpen} onMode={setImgMode} />
        {saved ? (
          <View pointerEvents="none" style={{ position: 'absolute', top: 8, right: 8, width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)' }}>
            <D1Icon name="bookmarkFilled" size={14} color="#fff" />
          </View>
        ) : null}
      </View>
      <PressableScale haptic="selection" scaleTo={0.985} onPress={onOpen} accessibilityLabel={placeA11y(p, tr, lang, now)} accessibilityHint={tr('ui.places.detailsHint')} style={{ flex: 1 }} pressedStyle={{ opacity: 0.85 }}>
        <View style={{ padding: t.spacing.m, paddingBottom: t.spacing.s, gap: 4 }}>
          <HText variant="headline" numberOfLines={1}>
            {p.name}
          </HText>
          <MetaLine p={p} t={t} />
          {p.rating !== undefined ? <RatingRow rating={p.rating} reviews={p.reviews} lang={lang} /> : null}
          {open ? <OpenLine kind={open.kind} text={open.text} /> : null}
          {p.note ? (
            <HText variant="caption" color="muted" numberOfLines={2} style={{ marginTop: 2 }}>
              {p.note}
            </HText>
          ) : null}
        </View>
      </PressableScale>
      <View style={{ paddingHorizontal: t.spacing.m, paddingBottom: t.spacing.m, paddingTop: 4 }}>
        <PlaceActions p={p} saved={saved} act={act} />
      </View>
    </View>
  );
}

function PlaceRow({ t, p, city, lang, now, saved, onOpen, act }: { t: Theme; p: PlaceItem; city: string; lang: NumLang; now: number; saved: boolean; onOpen: () => void; act: Acts }) {
  const tr = useT();
  const open = openState(p, tr, now);
  const [imgMode, setImgMode] = useState<SlotMode>('skeleton');
  return (
    <View style={{ borderRadius: t.radii.card, backgroundColor: t.colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: t.colors.border, padding: t.spacing.s, gap: t.spacing.s }}>
      <View style={{ flexDirection: 'row', gap: t.spacing.m, alignItems: 'center' }}>
        <View style={imgMode === 'collapse' ? { display: 'none' } : { width: LIST_IMG }}>
          <CardImage query={placeModelQuery(p.imageQuery, { city })} autoQuery={placeImageQuery(p, { city })} url={p.image} kind={placeKind(p.category, p.name)} height={LIST_IMG} radius={t.radii.control} iconSize={26} inline allowAsk onPress={onOpen} onMode={setImgMode} />
        </View>
        <PressableScale haptic="selection" scaleTo={0.99} onPress={onOpen} accessibilityLabel={placeA11y(p, tr, lang, now)} accessibilityHint={tr('ui.places.detailsHint')} style={{ flex: 1, gap: 3, minWidth: 0 }} pressedStyle={{ opacity: 0.85 }}>
          <HText variant="bodyStrong" numberOfLines={1}>
            {p.name}
          </HText>
          <MetaLine p={p} t={t} />
          {p.rating !== undefined ? <RatingRow rating={p.rating} reviews={p.reviews} lang={lang} /> : null}
          {open ? <OpenLine kind={open.kind} text={open.text} /> : null}
        </PressableScale>
      </View>
      <PlaceActions p={p} saved={saved} act={act} />
    </View>
  );
}

/* ───────────── detail sheet ───────────── */

function PlaceDetails({ t, p, id, lang, now, saved, act, source, basis }: { t: Theme; p: PlaceItem; id: string; lang: NumLang; now: number; saved: boolean; act: Acts; source: unknown; basis: unknown }) {
  const tr = useT();
  const open = openState(p, tr, now);
  const phone = cleanPhone(p.phone);
  const site = cleanUrl(p.website);
  const dow = new Date().getDay();
  const hours = parseHoursLines(p.hours);
  const miniMap = useMemo(() => placesMapNode(`${id}-${p.key}-map`, [p]), [id, p]);
  const rA11y = ratingA11y(p.rating, p.reviews, tr, lang);
  return (
    <View style={{ padding: t.spacing.l, gap: t.spacing.l }}>
      {/* title block */}
      <View style={{ gap: 6 }}>
        <HText variant="title" accessibilityRole="header">
          {p.name}
        </HText>
        <MetaLine p={p} t={t} />
        {p.rating !== undefined ? (
          <View accessible accessibilityLabel={rA11y}>
            <RatingRow rating={p.rating} reviews={p.reviews} lang={lang} size={14} long />
          </View>
        ) : null}
        {open ? (
          <View accessible accessibilityLabel={open.text}>
            <OpenLine kind={open.kind} text={open.text} variant="callout" />
          </View>
        ) : null}
      </View>

      {/* actions */}
      <View style={{ flexDirection: 'row', gap: 4 }}>
        <ActionTile big icon="route" label={tr('ui.places.route')} a11yLabel={tr('ui.places.routeA11y', { name: p.name })} onPress={() => act.route(p)} tone="accent" />
        {phone ? <ActionTile big icon="phone" label={tr('ui.places.call')} a11yLabel={tr('ui.places.callA11y', { name: p.name })} onPress={() => act.call(p)} /> : null}
        {site ? <ActionTile big icon="globe" label={tr('ui.places.website')} a11yLabel={tr('ui.places.websiteA11y', { name: p.name })} onPress={() => act.website(p)} /> : null}
        <ActionTile
          big
          icon={saved ? 'bookmarkFilled' : 'bookmark'}
          label={saved ? tr('ui.places.saved') : tr('ui.places.save')}
          a11yLabel={saved ? tr('ui.places.savedA11y', { name: p.name }) : tr('ui.places.saveA11y', { name: p.name })}
          onPress={() => act.save(p, !saved)}
          active={saved}
        />
      </View>

      {p.note ? <InlineText variant="body" text={p.note} /> : null}

      {/* hours */}
      {hours.length || p.hoursToday ? (
        <View style={{ gap: 4 }}>
          <SectionLabel text={tr('ui.places.hours')} />
          <View>
            {hours.length
              ? hours.map((h, i) => {
                  const today = h.days.includes(dow);
                  return (
                    <InfoRow
                      key={i}
                      label={h.day || undefined}
                      value={h.hours}
                      strong={today}
                      last={i === hours.length - 1}
                      a11y={`${h.day ? `${h.day}: ` : ''}${h.hours}${today ? `, ${tr('ui.places.today')}` : ''}`}
                      right={today ? <TodayDot t={t} label={tr('ui.places.today')} /> : undefined}
                    />
                  );
                })
              : [<InfoRow key="today" label={tr('ui.places.today')} value={(p.hoursToday ?? '').replace(/^\s*(heute|today|hoy)\s*:?\s*/i, '')} strong last />]}
          </View>
        </View>
      ) : null}

      {/* contact */}
      {p.address || phone || site ? (
        <View style={{ gap: 4 }}>
          <SectionLabel text={tr('ui.places.address')} />
          <View>
            {p.address ? (
              <InfoRow
                value={p.address}
                last={!phone && !site}
                right={
                  <PressableScale haptic="selection" onPress={() => act.copy(p.address as string)} accessibilityLabel={tr('ui.places.copyA11y', { label: tr('ui.places.address') })} hitSlop={6} style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }} pressedStyle={{ backgroundColor: t.colors.surfacePressed }}>
                    <D1Icon name="copy" size={17} color={t.colors.muted} />
                  </PressableScale>
                }
              />
            ) : null}
            {phone ? <InfoRow label={tr('ui.places.phone')} value={p.phone as string} onPress={() => act.call(p)} a11y={tr('ui.places.callA11y', { name: p.name })} last={!site} /> : null}
            {site ? <InfoRow label={tr('ui.places.website')} value={urlHost(site)} onPress={() => act.website(p)} a11y={tr('ui.places.websiteA11y', { name: p.name })} last /> : null}
          </View>
        </View>
      ) : null}

      {/* mini map */}
      {miniMap ? (
        <View style={{ gap: 8 }}>
          <SectionLabel text={tr('ui.places.location')} />
          <MapNode node={miniMap as unknown as HuiMap} />
        </View>
      ) : null}

      {/* tags */}
      {p.tags.length ? (
        <View style={{ gap: 8 }}>
          <SectionLabel text={tr('ui.places.tags')} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {p.tags.map((tag, i) => (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: t.radii.pill, backgroundColor: t.colors.surfaceAlt }}>
                <D1Icon name="tag" size={12} color={t.colors.muted} />
                <HText variant="caption">{tag}</HText>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {p.reviews !== undefined && p.rating === undefined ? (
        <HText variant="caption" color="muted">
          {tr('ui.places.reviews', { n: p.reviews, count: formatCount(p.reviews, lang) })}
        </HText>
      ) : null}
      <ProvenanceChip basis={basis} source={source} />
    </View>
  );
}

function TodayDot({ t, label }: { t: Theme; label: string }) {
  return (
    <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: t.radii.pill, backgroundColor: t.colors.accentSoft }}>
      <HText variant="micro" weight="600" color="accent">
        {label}
      </HText>
    </View>
  );
}
