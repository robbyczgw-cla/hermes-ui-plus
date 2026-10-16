import { useId, useMemo, useRef, useState } from 'react';
import { View, type GestureResponderEvent } from 'react-native';
import Svg, { Defs, G, Line, LinearGradient as SvgGradient, Path, Stop, Text as SvgText, Circle } from 'react-native-svg';
import { useTheme, type Theme } from '../theme';
import { useHui } from '../primitives/context';
import { HText, InlineText, PressableScale, Surface } from '../primitives/basics';
import { ProvenanceChip } from './modules/ProvenanceChip';
import { Icon } from '../primitives/Icon';
import { haptic } from '../primitives/haptics';
import { ChartSkeleton } from '../skeletons';
import { useLocale, useT } from '../../i18n';
import { asOptString, clamp, formatCompact, formatNumber, niceTicks, withUnit } from '../lib/format';
import { arcPath, barPath, categories, cleanSeries, foldSlices, labelStride, labelWithUnit, monotonePath } from '../lib/chartMath';
import { cleanSeries3 } from '../lib/chartMath3';
import { Entrance, FONT, Legend as LegendBase, PLOT_H, Tooltip, truncate, useEntranceOnMount } from './ChartParts';
import { V3_KINDS, V3Body, V3Skeleton, V3Table, v3HasData, type V3Kind } from './ChartV3';
import type { HuiChart, HuiChartKind } from '../types';
import type { NodeProps } from './content';
import { Table } from './Table';
import { useCaptureMode } from '../lib/capture';

// Native SVG charts. Design rules (dataviz skill): fixed categorical order (never cycled,
// max 8 series), thin marks, 4px rounded data-ends on the baseline, 2px lines, 2px surface
// gaps, recessive grid, legend for ≥2 series, tap-to-inspect tooltip, table view.

const KINDS: HuiChartKind[] = ['bar', 'line', 'area', 'pie', 'donut', ...V3_KINDS];
const isV3 = (k: HuiChartKind): k is V3Kind => (V3_KINDS as readonly string[]).includes(k);

type CleanSeries = { name: string; points: { x: string; y: number }[] };

export function Chart({ node }: NodeProps<HuiChart>) {
  const tr = useT();
  const t = useTheme();
  const { streaming } = useHui();
  const kind: HuiChartKind = KINDS.includes(node.kind as HuiChartKind) ? (node.kind as HuiChartKind) : 'bar';
  const v3 = isV3(kind) ? kind : null;
  const series = useMemo(() => cleanSeries(node.series).slice(0, 8), [node.series]);
  const series3 = useMemo(() => (v3 ? cleanSeries3(node.series, 8) : []), [node.series, v3]);
  const hasData = v3 ? v3HasData(v3, series3, node as Record<string, unknown>, streaming) : series.some((s) => s.points.length > 0);
  const [width, setWidth] = useState(0);
  const [showTable, setShowTable] = useState(false);
  // share-as-image: no chart/table switch (an app-only control)
  const capture = useCaptureMode();
  // entrance = container fade/grow on the UI thread (ChartParts.Entrance); geometry is always final
  const playEntrance = useEntranceOnMount();
  const progress = 1;

  const title = asOptString(node.title);
  const unit = asOptString(node.unit);
  const yLabel = asOptString(node.yLabel);
  const xLabel = asOptString(node.xLabel);
  const round = kind === 'pie' || kind === 'donut' || kind === 'gauge' || kind === 'radar' || kind === 'heatmap';

  if (!hasData) {
    return streaming ? v3 ? <V3Skeleton kind={v3} t={t} /> : <ChartSkeleton kind={kind} /> : (
      <Surface>
        {title ? <InlineText variant="headline" text={title} /> : null}
        <HText variant="callout" color="muted">
          {tr('ui.chart.noData')}
        </HText>
      </Surface>
    );
  }

  const subtitle = kind === 'gauge' ? undefined : !round ? (yLabel ? labelWithUnit(yLabel, unit) : unit ? tr('ui.chart.inUnit', { unit }) : undefined) : unit ? tr('ui.chart.inUnit', { unit }) : undefined;

  return (
    <Surface style={{ gap: t.spacing.m }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: t.spacing.s }}>
        <View style={{ flex: 1, gap: 2 }}>
          {title ? <InlineText variant="headline" text={title} /> : null}
          {subtitle ? <HText variant="caption" color="muted">{subtitle}</HText> : null}
        </View>
        {capture ? null : <PressableScale
          haptic="selection"
          onPress={() => setShowTable((v) => !v)}
          accessibilityLabel={showTable ? tr('ui.chart.showChart') : tr('ui.chart.showTable')}
          style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: showTable ? t.colors.accentSoft : 'transparent' }}
        >
          <Icon name={showTable ? 'chart' : 'table'} size={17} color={showTable ? t.colors.accent : t.colors.muted} />
        </PressableScale>}
      </View>
      {showTable ? (
        v3 ? (
          <V3Table kind={v3} series={series3} node={node as Record<string, unknown>} unit={unit} xLabel={xLabel} yLabel={yLabel} />
        ) : (
          <ChartAsTable series={series} round={round} xLabel={xLabel} unit={unit} />
        )
      ) : (
        <View onLayout={(e) => setWidth(Math.floor(e.nativeEvent.layout.width))}>
          {width > 0 ? (
            <Entrance play={playEntrance} active>
              {v3 ? (
                <V3Body kind={v3} t={t} series={series3} node={node as Record<string, unknown>} width={width} progress={progress} unit={unit} xLabel={xLabel} yLabel={yLabel} />
              ) : round ? (
                <PieChart t={t} series={series[0]} donut={kind === 'donut'} width={width} progress={progress} unit={unit} />
              ) : (
                <CartesianChart t={t} kind={kind} series={series} width={width} progress={progress} unit={unit} xLabel={xLabel} streaming={streaming} />
              )}
            </Entrance>
          ) : (
            <View style={{ height: PLOT_H + 30 }} />
          )}
        </View>
      )}
      <ProvenanceChip node={node} />
    </Surface>
  );
}

/* ───────────── bar / line / area ───────────── */

function CartesianChart({
  t,
  kind,
  series,
  width,
  progress,
  unit,
  xLabel,
  streaming,
}: {
  t: Theme;
  kind: HuiChartKind;
  series: CleanSeries[];
  width: number;
  progress: number;
  unit?: string;
  xLabel?: string;
  streaming: boolean;
}) {
  const { lang } = useLocale();
  const tr = useT();
  const [sel, setSel] = useState<number | null>(null);
  const uid = 'c' + useId().replace(/[^a-zA-Z0-9]/g, '');
  const gesture = useRef({ moved: false, wasSel: false });
  const cats = useMemo(() => categories(series), [series]);
  const lookup = useMemo(() => series.map((s) => new Map(s.points.map((p) => [p.x, p.y]))), [series]);
  const all = series.flatMap((s) => s.points.map((p) => p.y));
  const ticks = niceTicks(Math.min(...all), Math.max(...all), 4);
  const y0 = ticks[0];
  const y1 = ticks[ticks.length - 1];
  const tickLabels = ticks.map((v) => formatCompact(v, lang));
  const padLeft = Math.max(30, Math.max(...tickLabels.map((l) => l.length)) * 7 + 12);
  const padRight = 6;
  const padTop = 6;
  const xAxisH = 22;
  const plotW = Math.max(40, width - padLeft - padRight);
  const n = cats.length;
  const isBar = kind === 'bar';
  const slot = isBar ? plotW / Math.max(1, n) : n > 1 ? plotW / (n - 1) : plotW;
  const xAt = (i: number) => (isBar ? padLeft + slot * (i + 0.5) : n > 1 ? padLeft + slot * i : padLeft + plotW / 2);
  const yAt = (v: number) => padTop + PLOT_H * (1 - (v - y0) / (y1 - y0 || 1));
  const base = yAt(clamp(0, y0, y1));
  const H = padTop + PLOT_H + xAxisH + (xLabel ? 16 : 0);
  // line/area labels at the plot edges are anchored start/end → need ~1.5× the room of a centered label
  const stride = isBar ? labelStride(cats.map((c) => truncate(c, 12)), slot) : labelStride(cats.map((c) => truncate(c, 12)), slot / 1.5);
  const showLabel = (i: number) => (isBar ? i % stride === 0 : i === n - 1 || (i % stride === 0 && n - 1 - i >= stride));

  // keep selection valid while data streams in
  const selIdx = sel !== null && sel < n ? sel : null;

  const indexAt = (lx: number) => {
    const x = lx - padLeft;
    if (isBar) return clamp(Math.floor(x / slot), 0, n - 1);
    return n > 1 ? clamp(Math.round(x / slot), 0, n - 1) : 0;
  };
  const choose = (e: GestureResponderEvent, first: boolean) => {
    const idx = indexAt(e.nativeEvent.locationX);
    if (first) gesture.current = { moved: false, wasSel: idx === selIdx };
    else gesture.current.moved = true;
    if (idx !== selIdx) {
      haptic('selection');
      setSel(idx);
    }
  };

  const nS = series.length;
  const groupW = Math.min(slot * (nS > 1 ? 0.78 : 0.62), 34 * nS + 2 * (nS - 1));
  const barW = Math.max(2, (groupW - 2 * (nS - 1)) / nS);

  let tooltip: React.ReactNode = null;
  if (selIdx !== null) {
    const rows = series
      .map((s, si) => ({ si, v: lookup[si].get(cats[selIdx]) }))
      .filter((r) => r.v !== undefined)
      .map((r) => ({ color: t.colors.chart[r.si], name: series[r.si].name, value: withUnit(formatNumber(r.v!, 2, lang), unit, lang) }));
    const topVal = Math.max(...series.map((_, si) => lookup[si].get(cats[selIdx]) ?? y0));
    tooltip = <Tooltip t={t} x={xAt(selIdx)} top={Math.min(yAt(topVal), base)} label={cats[selIdx]} rows={rows} containerW={width} />;
  }

  return (
    <View style={{ gap: t.spacing.s }}>
      <View style={{ height: H }}>
        <Svg width={width} height={H}>
          <Defs>
            {series.map((_, si) => (
              <SvgGradient key={si} id={`${uid}a${si}`} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={t.colors.chart[si]} stopOpacity={nS > 1 ? 0.16 : 0.24} />
                <Stop offset="1" stopColor={t.colors.chart[si]} stopOpacity={0} />
              </SvgGradient>
            ))}
          </Defs>
          {/* grid + y labels */}
          {ticks.map((v, i) => (
            <G key={i}>
              <Line x1={padLeft} x2={padLeft + plotW} y1={yAt(v)} y2={yAt(v)} stroke={v === 0 ? t.colors.borderStrong : t.colors.border} strokeWidth={1} strokeDasharray={v === 0 ? undefined : '3,4'} />
              <SvgText x={padLeft - 8} y={yAt(v) + 4} fontSize={FONT} fill={t.colors.subtle} textAnchor="end" fontFamily={t.fonts.sans}>
                {tickLabels[i]}
              </SvgText>
            </G>
          ))}
          {/* x labels */}
          {cats.map((c, i) =>
            showLabel(i) ? (
              <SvgText
                key={i}
                x={xAt(i)}
                y={padTop + PLOT_H + 16}
                fontSize={FONT}
                fill={selIdx === i ? t.colors.text : t.colors.subtle}
                fontWeight={selIdx === i ? '600' : '400'}
                textAnchor={!isBar && n > 1 && i === 0 ? 'start' : !isBar && n > 1 && i === n - 1 ? 'end' : 'middle'}
                fontFamily={t.fonts.sans}
              >
                {truncate(c, 12)}
              </SvgText>
            ) : null,
          )}
          {xLabel ? (
            <SvgText x={padLeft + plotW / 2} y={H - 2} fontSize={FONT} fill={t.colors.muted} textAnchor="middle" fontFamily={t.fonts.sans}>
              {xLabel}
            </SvgText>
          ) : null}

          {isBar ? (
            <G>
              {cats.map((c, i) => {
                const dim = selIdx !== null && selIdx !== i;
                return series.map((s, si) => {
                  const v = lookup[si].get(c);
                  if (v === undefined) return null;
                  const bx = xAt(i) - groupW / 2 + si * (barW + 2);
                  const yv = base + (yAt(v) - base) * progress;
                  return <Path key={`${i}-${si}`} d={barPath(bx, barW, base, yv, 4)} fill={t.colors.chart[si]} opacity={dim ? 0.35 : 1} />;
                });
              })}
            </G>
          ) : (
            // Fade in instead of a growing clipPath reveal: react-native-svg on Android does not
            // re-apply a clipPath whose Rect changes size, so the line stayed clipped at frame 1.
            <G opacity={progress}>
              {series.map((s, si) => {
                const pts = cats
                  .map((c, i) => ({ i, v: lookup[si].get(c) }))
                  .filter((p) => p.v !== undefined)
                  .map((p) => ({ x: xAt(p.i), y: yAt(p.v!) }));
                if (!pts.length) return null;
                const d = monotonePath(pts);
                const area = kind === 'area' && pts.length > 1 ? `${d}L${pts[pts.length - 1].x},${base}L${pts[0].x},${base}Z` : null;
                return (
                  <G key={si}>
                    {area ? <Path d={area} fill={`url(#${uid}a${si})`} /> : null}
                    <Path d={d} stroke={t.colors.chart[si]} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
                    {pts.length === 1 ? <Circle cx={pts[0].x} cy={pts[0].y} r={4} fill={t.colors.chart[si]} /> : null}
                  </G>
                );
              })}
            </G>
          )}

          {/* crosshair + markers */}
          {!isBar && selIdx !== null ? (
            <G>
              <Line x1={xAt(selIdx)} x2={xAt(selIdx)} y1={padTop} y2={padTop + PLOT_H} stroke={t.colors.borderStrong} strokeWidth={1} strokeDasharray="3,3" />
              {series.map((s, si) => {
                const v = lookup[si].get(cats[selIdx]);
                if (v === undefined) return null;
                return <Circle key={si} cx={xAt(selIdx)} cy={yAt(v)} r={4.5} fill={t.colors.chart[si]} stroke={t.colors.surface} strokeWidth={2} />;
              })}
            </G>
          ) : null}
          {/* live edge while streaming */}
          {!isBar && streaming && selIdx === null
            ? series.map((s, si) => {
                const v = lookup[si].get(cats[n - 1]);
                return v === undefined ? null : <Circle key={si} cx={xAt(n - 1)} cy={yAt(v)} r={3.5} fill={t.colors.chart[si]} stroke={t.colors.surface} strokeWidth={2} />;
              })
            : null}
        </Svg>
        {/* hit layer */}
        <View
          style={{ position: 'absolute', left: 0, top: 0, width, height: padTop + PLOT_H + xAxisH }}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderTerminationRequest={() => true}
          onResponderGrant={(e) => choose(e, true)}
          onResponderMove={(e) => choose(e, false)}
          onResponderRelease={() => {
            if (!gesture.current.moved && gesture.current.wasSel) setSel(null);
          }}
          accessibilityRole="adjustable"
          accessibilityLabel={tr('ui.chart.a11y')}
        />
        {tooltip}
      </View>
      <LegendBase t={t} items={series.map((s, i) => ({ name: s.name, color: t.colors.chart[i] }))} shape={kind === 'bar' ? 'square' : 'line'} />
    </View>
  );
}

/* ───────────── pie / donut ───────────── */

function PieChart({ t, series, donut, width, progress, unit }: { t: Theme; series: CleanSeries; donut: boolean; width: number; progress: number; unit?: string }) {
  const { lang } = useLocale();
  const tr = useT();
  const [sel, setSel] = useState<number | null>(null);
  const slices = useMemo(() => foldSlices(series.points, 8), [series.points]);
  const total = slices.reduce((s, p) => s + p.y, 0) || 1;
  const size = Math.min(width, 220);
  const cx = size / 2;
  const cy = size / 2;
  const ro = size / 2 - 4;
  const ri = donut ? ro * 0.64 : 0;
  const selIdx = sel !== null && sel < slices.length ? sel : null;

  let a = 0;
  const arcs = slices.map((s, i) => {
    const span = (s.y / total) * Math.PI * 2 * progress;
    const a0 = a;
    a += span;
    return { i, a0, a1: a0 + span };
  });

  const pick = (e: GestureResponderEvent) => {
    const dx = e.nativeEvent.locationX - cx;
    const dy = e.nativeEvent.locationY - cy;
    const r = Math.hypot(dx, dy);
    if (r > ro + 6 || r < ri - 6) {
      setSel(null);
      return;
    }
    let ang = Math.atan2(dx, -dy);
    if (ang < 0) ang += Math.PI * 2;
    const hit = arcs.find((x) => ang >= x.a0 && ang < x.a1);
    if (hit) {
      haptic('selection');
      setSel((cur) => (cur === hit.i ? null : hit.i));
    }
  };

  const pct = (v: number) => withUnit(formatNumber((v / total) * 100, 1, lang), '%', lang);
  const center = selIdx !== null ? slices[selIdx] : null;

  const legend = (
    <View style={{ gap: 2, flex: width >= 440 ? 1 : undefined, alignSelf: 'stretch' }}>
      {slices.map((s, i) => {
        const active = selIdx === i;
        return (
          <PressableScale
            key={i}
            haptic="selection"
            scaleTo={0.99}
            onPress={() => setSel((cur) => (cur === i ? null : i))}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, paddingHorizontal: 8, borderRadius: t.radii.control, backgroundColor: active ? t.colors.surfaceAlt : 'transparent', opacity: selIdx !== null && !active ? 0.6 : 1 }}
          >
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: t.colors.chart[i] }} />
            <HText variant="callout" numberOfLines={1} style={{ flex: 1 }} weight={active ? '600' : '400'}>
              {s.x}
            </HText>
            <HText variant="callout" tabular weight="500">
              {withUnit(formatNumber(s.y, 2, lang), unit, lang)}
            </HText>
            <HText variant="caption" color="muted" tabular style={{ minWidth: 48, textAlign: 'right' }}>
              {pct(s.y)}
            </HText>
          </PressableScale>
        );
      })}
    </View>
  );

  return (
    <View style={{ flexDirection: width >= 440 ? 'row' : 'column', alignItems: 'center', gap: t.spacing.l }}>
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size}>
          {arcs.map(({ i, a0, a1 }) => (
            <Path
              key={i}
              d={arcPath(cx, cy, selIdx === i ? ro + 3 : ro, ri, a0, a1)}
              fill={t.colors.chart[i]}
              stroke={t.colors.surface}
              strokeWidth={slices.length > 1 ? 2 : 0}
              strokeLinejoin="round"
              opacity={selIdx !== null && selIdx !== i ? 0.4 : 1}
            />
          ))}
        </Svg>
        {donut ? (
          <View pointerEvents="none" style={{ position: 'absolute', left: cx - ri + 8, top: cy - 30, width: (ri - 8) * 2, height: 60, alignItems: 'center', justifyContent: 'center' }}>
            <HText variant="title" tabular numberOfLines={1} adjustsFontSizeToFit>
              {center ? pct(center.y) : withUnit(formatCompact(total, lang), unit, lang)}
            </HText>
            <HText variant="caption" color="muted" numberOfLines={1}>
              {center ? center.x : tr('ui.chart.total')}
            </HText>
          </View>
        ) : null}
        <View
          style={{ position: 'absolute', left: 0, top: 0, width: size, height: size }}
          onStartShouldSetResponder={() => true}
          onResponderTerminationRequest={() => true}
          onResponderRelease={pick}
          accessibilityLabel={tr('ui.chart.pieA11y')}
        />
      </View>
      {legend}
    </View>
  );
}

/* ───────────── table view (a11y alternative) ───────────── */

function ChartAsTable({ series, round, xLabel, unit }: { series: CleanSeries[]; round: boolean; xLabel?: string; unit?: string }) {
  const { lang } = useLocale();
  const cats = categories(series);
  const used = round ? series.slice(0, 1) : series;
  const lookups = used.map((s) => new Map(s.points.map((p) => [p.x, p.y])));
  const columns = [xLabel ?? '', ...used.map((s) => labelWithUnit(s.name, unit))];
  const rows = cats.map((c) => [c, ...lookups.map((m) => (m.has(c) ? formatNumber(m.get(c)!, 2, lang) : null))]);
  return <Table node={{ type: 'table', columns, rows }} bare />;
}
