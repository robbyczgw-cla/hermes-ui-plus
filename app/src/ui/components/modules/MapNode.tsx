/**
 * `map` node (docs/SPEC-modules-v2.md + OIUI trip-animator spec): TRUSTED built-in Leaflet
 * document (b/mapTemplate.ts – never model HTML) rendered through the sandbox frame
 * (app/src/sandbox/HtmlFrame: locked-down WebView on native, sandboxed srcdoc iframe on web).
 * Markers arrive as a JSON message and are rendered with textContent only.
 *
 *  - numbered pins + popups, optional dashed route (labelled "zur Orientierung")
 *  - animate: pins drop one by one (~6 s), camera fixed, pauses in background, reduced motion →
 *    final state, never loops; Pause/Abspielen + Wiederholen
 *  - map is locked by default (no scroll hijacking); "Karte erkunden" enables pan/zoom
 *  - native stop list (thumbnail via imageQuery); tap row ↔ highlight pin (postMessage)
 *  - "In Karten öffnen" → maps action (confirmed in the action sheet)
 *  - real tile load / failure states; failure keeps the stop list usable
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { useTheme, type Theme } from '../../theme';
import { useHui } from '../../primitives/context';
import { BlockTitle, HText, InlineText, PressableScale, Surface } from '../../primitives/basics';
import { Icon } from '../../primitives/Icon';
import { Skeleton } from '../../primitives/Skeleton';
import { haptic } from '../../primitives/haptics';
import { useNodeState } from '../../../nodestate';
import { HtmlFrame } from '../../../sandbox/HtmlFrame';
import type { HtmlFrameHandle } from '../../../sandbox/frameTypes';
import type { HostMessage } from '../../../sandbox/messages';
import { Thumb } from '../imageParts';
import type { NodeProps } from '../content';
import type { HuiMap } from '../../types';
import { animDuration, normalizeMap, parseMapMessage, stopsSummary, type MapMarker, type MapModel } from './b/mapModel';
import { buildMapDocument, type MapColors, type MapHostMessage } from './b/mapTemplate';
import { BIcon, Btn, RoundBtn } from './b/controls';
import { ProvenanceChip } from './ProvenanceChip';
import { useS } from './useS';
import { useLocale } from '../../../i18n';
import { MapSkeleton } from '../../skeletons';

const MAP_HEIGHT = 260;
/** Static trusted document, built once (stable reference = the frame never reloads). */

type MapState = { played?: boolean };
type Tiles = 'idle' | 'loading' | 'loaded' | 'failed';
type Anim = 'idle' | 'playing' | 'paused' | 'complete';

function colorsOf(t: Theme): MapColors {
  const c = t.colors;
  return { accent: c.accent, onAccent: c.onAccent, text: c.text, muted: c.muted, surface: c.surface, border: c.border, bg: c.bg };
}

export function MapNode({ node }: NodeProps<HuiMap>) {
  const MAP = useS().map;
  const t = useTheme();
  const { streaming } = useHui();
  const model = useMemo(() => normalizeMap(node), [node]);
  const basis = (node as { basis?: unknown }).basis;
  const source = (node as { source?: unknown }).source;

  if (!model.markers.length) {
    if (streaming) {
      return <MapSkeleton title={model.title} />;
    }
    return (
      <Surface style={{ gap: t.spacing.s }}>
        <BlockTitle title={model.title} />
        <HText variant="callout" color="muted">
          {MAP.noMarkers}
        </HText>
      </Surface>
    );
  }
  return <MapBody model={model} streaming={streaming} basis={basis} source={source} />;
}

function MapBody({ model, streaming, basis, source }: { model: MapModel; streaming: boolean; basis: unknown; source: unknown }) {
  const MAP = useS().map;
  const { lang } = useLocale();
  const mapDoc = useMemo(() => buildMapDocument({ lang, ariaLabel: MAP.mapLabel }), [lang, MAP.mapLabel]);
  const t = useTheme();
  const { onAction } = useHui();
  const reduced = useReducedMotion();
  const frame = useRef<HtmlFrameHandle>(null);
  const [state, setState] = useNodeState<MapState>(model.id, {});
  const [active, setActive] = useState<number | null>(null);
  const [tiles, setTiles] = useState<Tiles>('idle');
  const [anim, setAnim] = useState<Anim>('idle');
  const [libError, setLibError] = useState(false);
  const [exploring, setExploring] = useState(false);
  const [frameKey, setFrameKey] = useState(0);
  const inited = useRef(false);

  const animate = model.animate && !state.played;
  const post = useCallback((m: MapHostMessage) => frame.current?.post(m as unknown as HostMessage), []);

  const initMsg = useMemo<MapHostMessage>(
    () => ({
      t: 'init',
      markers: model.markers.map((m) => ({ lat: m.lat, lng: m.lng, n: m.n, title: m.title, ...(m.description ? { description: m.description } : {}) })),
      route: model.route,
      animate: model.animate,
      reduced,
      final: !animate,
      center: model.center,
      zoom: model.zoom,
      colors: colorsOf(t),
      dark: t.dark,
      durationMs: animDuration(model.markers.length),
    }),
    // theme changes are pushed separately; `animate` only matters for the first init
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [model, reduced],
  );

  const sendInit = useCallback(() => {
    inited.current = true;
    post(initMsg);
  }, [initMsg, post]);

  // node changed after the first init (rare) → rebuild markers
  useEffect(() => {
    if (inited.current) sendInit();
  }, [sendInit]);

  // theme switch without reloading the frame
  useEffect(() => {
    if (inited.current) post({ t: 'theme', colors: colorsOf(t), dark: t.dark });
  }, [t, post]);

  // pause when the app goes to the background (OIUI: never keep animating unseen)
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') post({ t: 'pause' });
    });
    return () => sub.remove();
  }, [post]);

  const onMessage = useCallback(
    (raw: unknown) => {
      const m = parseMapMessage(raw, model.markers.length);
      if (!m) return;
      switch (m.t) {
        case 'ready':
          setLibError(false);
          sendInit();
          break;
        case 'error':
          setLibError(true);
          break;
        case 'tiles':
          setTiles(m.s);
          break;
        case 'select':
          haptic('selection');
          setActive(m.i);
          break;
        case 'active':
          setActive(m.i);
          break;
        case 'anim':
          setAnim(m.s);
          if (m.s === 'complete' && !state.played) setState((s) => ({ ...s, played: true }));
          break;
      }
    },
    [model.markers.length, sendInit, setState, state.played],
  );

  const select = (i: number) => {
    setActive(i);
    post({ t: 'select', i });
  };
  const openInMaps = (m: MapMarker) => {
    // confirmed in the action sheet by the chat shell (actions/INTEGRATION.md: onAction → run)
    onAction({ type: 'maps', lat: m.lat, lng: m.lng, query: m.title }, undefined, { nodeId: model.id });
  };
  const retry = () => {
    inited.current = false;
    setLibError(false);
    setTiles('idle');
    setFrameKey((k) => k + 1);
  };
  const toggleExplore = () => {
    const on = !exploring;
    setExploring(on);
    post({ t: 'explore', on });
  };

  const focus = model.markers[active ?? 0];
  const showOverlay = libError || tiles === 'failed' || tiles === 'idle' || tiles === 'loading';

  return (
    <Surface style={{ gap: t.spacing.m }}>
      {model.title || basis || source ? (
        <View style={{ gap: t.spacing.xs }}>
          <BlockTitle title={model.title} />
          <View style={{ marginTop: model.title ? -t.spacing.s : 0 }}>
            <ProvenanceChip basis={basis} source={source} />
          </View>
        </View>
      ) : null}

      {/* map */}
      <View style={{ height: MAP_HEIGHT, borderRadius: t.radii.m, overflow: 'hidden', backgroundColor: t.colors.surfaceAlt, borderWidth: 1, borderColor: t.colors.border }}>
        {streaming ? (
          <Skeleton width="100%" height={MAP_HEIGHT} radius={0} />
        ) : (
          <HtmlFrame
            key={frameKey}
            ref={frame}
            shellHtml={mapDoc}
            scrollEnabled={exploring}
            onMessage={onMessage}
            onLoaded={() => {
              if (!inited.current) sendInit();
            }}
            onCrash={() => setLibError(true)}
            scheme={t.dark ? 'dark' : 'light'}
            accessibilityLabel={MAP.mapA11y(stopsSummary(model.markers))}
          />
        )}
        {!streaming && showOverlay ? <MapOverlay t={t} state={libError ? 'lib' : tiles === 'failed' ? 'failed' : 'loading'} onRetry={retry} /> : null}
      </View>

      {/* controls */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.s, flexWrap: 'wrap' }}>
        {model.animate && !libError ? (
          <>
            <RoundBtn
              bicon={anim === 'playing' ? 'pause' : 'play'}
              label={anim === 'playing' ? MAP.pause : MAP.play}
              onPress={() => post(anim === 'playing' ? { t: 'pause' } : { t: 'play' })}
              disabled={streaming || reduced}
            />
            <RoundBtn bicon="reset" label={MAP.replay} onPress={() => post({ t: 'replay' })} disabled={streaming || reduced} />
          </>
        ) : null}
        <Btn label={exploring ? MAP.exploreDone : MAP.explore} bicon="expand" compact onPress={toggleExplore} disabled={streaming || libError} kind={exploring ? 'success' : 'secondary'} />
        <View style={{ flex: 1 }} />
        {focus ? <Btn label={MAP.openInMaps} icon="external" compact kind="ghost" onPress={() => openInMaps(focus)} disabled={streaming} /> : null}
      </View>

      {model.route ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon name="info" size={14} color={t.colors.muted} />
          <HText variant="caption" color="muted" style={{ flex: 1 }}>
            {MAP.routeDisclaimer}
          </HText>
        </View>
      ) : null}

      {/* stops */}
      <View style={{ gap: 2 }}>
        {model.markers.map((m, i) => (
          <StopRow key={`${i}:${m.title}`} t={t} m={m} active={active === i} onPress={() => select(i)} onOpen={() => openInMaps(m)} thumbs={!streaming} />
        ))}
      </View>
      {model.dropped ? (
        <HText variant="caption" color="subtle">
          {MAP.dropped(model.dropped)}
        </HText>
      ) : null}
    </Surface>
  );
}

function MapOverlay({ t, state, onRetry }: { t: Theme; state: 'loading' | 'failed' | 'lib'; onRetry: () => void }) {
  const MAP = useS().map;
  if (state === 'loading') {
    return (
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, top: 0, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.colors.surface, borderRadius: t.radii.pill, paddingHorizontal: 12, paddingVertical: 6, ...t.shadows.sm }}>
          <BIcon name="map" size={15} color={t.colors.muted} />
          <HText variant="caption" color="muted">
            {MAP.loading}
          </HText>
        </View>
      </View>
    );
  }
  return (
    <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, top: 0, alignItems: 'center', justifyContent: 'center', padding: t.spacing.l, gap: t.spacing.m, backgroundColor: t.colors.surfaceAlt }} accessibilityLiveRegion="polite">
      <BIcon name="map" size={28} color={t.colors.subtle} />
      <HText variant="callout" color="muted" align="center">
        {state === 'lib' ? MAP.libFailed : MAP.failed}
      </HText>
      <Btn label={MAP.retry} bicon="reset" compact onPress={onRetry} />
    </View>
  );
}

function StopRow({ t, m, active, onPress, onOpen, thumbs }: { t: Theme; m: MapMarker; active: boolean; onPress: () => void; onOpen: () => void; thumbs: boolean }) {
  const MAP = useS().map;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.s, borderRadius: t.radii.m, backgroundColor: active ? t.colors.accentSoft : 'transparent', paddingRight: 4 }}>
      <PressableScale
        haptic="selection"
        scaleTo={0.99}
        onPress={onPress}
        accessibilityLabel={MAP.stopA11y(m.n, m.title)}
        accessibilityState={{ selected: active }}
        style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: t.spacing.m, padding: t.spacing.s, minHeight: 56 }}
      >
        <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: t.colors.accent, alignItems: 'center', justifyContent: 'center' }}>
          <HText variant="caption" weight="600" tabular style={{ color: t.colors.onAccent }}>
            {m.n}
          </HText>
        </View>
        {m.imageQuery ? <Thumb query={m.imageQuery} size={48} label={m.title} enabled={thumbs} /> : null}
        <View style={{ flex: 1, gap: 1 }}>
          <HText variant="bodyStrong" numberOfLines={2}>
            {m.title}
          </HText>
          {m.description ? <InlineText variant="caption" color="muted" text={m.description} numberOfLines={2} /> : null}
        </View>
      </PressableScale>
      <RoundBtn icon="external" label={`${MAP.openInMaps}: ${m.title}`} onPress={onOpen} size={36} />
    </View>
  );
}
