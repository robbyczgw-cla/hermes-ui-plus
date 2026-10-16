// v3 chart kinds (docs/SPEC-modules-v3.md "Chart extensions"): hbar, stacked, scatter, radar, gauge,
// heatmap, waterfall – plus their table views and empty-state skeletons. Mounted by Chart.tsx, which owns
// the card chrome (title, table toggle, provenance chip). Entrance animations change geometry/opacity
// only (no clipPath: react-native-svg on Android does not re-apply clipPath size changes).

import { useMemo, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import type { Theme } from '../theme';
import { HText, Surface } from '../primitives/basics';
import { Skeleton } from '../primitives/Skeleton';
import { haptic } from '../primitives/haptics';
import { useLocale, useT } from '../../i18n';
import type { Lang } from '../../i18n';
import { clamp, formatCompact, formatNumber, niceTicks, withUnit } from '../lib/format';
import { barPath, labelStride, labelWithUnit, polar } from '../lib/chartMath';
import {
  arcStroke,
  calendarLayout,
  cats3,
  dayToIso,
  gaugeAngle,
  gaugeFraction,
  gaugeRange,
  GAUGE_END,
  GAUGE_START,
  hbarPath,
  heatDomain,
  heatLevel,
  heatRamp,
  isoDay,
  linearScale,
  looseTicks,
  luminance,
  nearestPoint,
  polygonPath,
  radarAnchor,
  radarAngle,
  radarMax,
  radarPolygon,
  stackSeries,
  waterfallBars,
  waterfallExtent,
  wrapLabel,
  type Series3,
} from '../lib/chartMath3';
import { FONT, Legend, PLOT_H, TapLayer, Tooltip, truncate, type TooltipRow } from './ChartParts';
import { Table } from './Table';

export const V3_KINDS = ['hbar', 'stacked', 'scatter', 'radar', 'gauge', 'heatmap', 'waterfall'] as const;
export type V3Kind = (typeof V3_KINDS)[number];

export type V3Props = { t: Theme; series: Series3[]; width: number; progress: number; unit?: string; xLabel?: string; yLabel?: string };

type GaugeNode = { min?: unknown; max?: unknown; target?: unknown; value?: unknown };

function n(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

/** Gauge value: `series[0].data[0].y` (canonical) or a top-level `value` (accepted, normalized away by protocol). */
export function gaugeValue(series: Series3[], node: GaugeNode): number | undefined {
  return series[0]?.points[0]?.y ?? n(node.value);
}

export function gaugeConfig(node: GaugeNode) {
  const { min, max } = gaugeRange(n(node.min), n(node.max));
  return { min, max, target: n(node.target) };
}

function signed(v: number, lang: Lang, unit?: string) {
  return (v > 0 ? '+' : '') + withUnit(formatNumber(v, 2, lang), unit, lang);
}

/** Heatmap variant: `matrix` if points carry `y2` (or x is not a date), `calendar` for ISO dates. */
export function heatVariant(series: Series3[]): 'calendar' | 'matrix' {
  const pts = series.flatMap((s) => s.points);
  if (pts.some((p) => p.y2 !== undefined)) return 'matrix';
  const dated = pts.filter((p) => isoDay(p.x) !== undefined).length;
  return pts.length > 0 && dated >= pts.length / 2 ? 'calendar' : 'matrix';
}

/** Whether a v3 chart has enough data to render (else Chart shows a skeleton / "no data"). */
export function v3HasData(kind: V3Kind, series: Series3[], node: GaugeNode, streaming: boolean): boolean {
  switch (kind) {
    case 'gauge':
      return gaugeValue(series, node) !== undefined;
    case 'scatter':
      return series.some((s) => s.points.some((p) => p.xn !== undefined));
    case 'radar':
      // < 3 axes: wait while streaming; afterwards it renders as a ranking (hbar) fallback
      return streaming ? cats3(series).length >= 3 : series.some((s) => s.points.length > 0);
    default:
      return series.some((s) => s.points.length > 0);
  }
}

/* ═════════════ hbar (ranking) ═════════════ */

export function HBarChart({ t, series, width, progress, unit }: V3Props) {
  const { lang } = useLocale();
  const tr = useT();
  const [sel, setSel] = useState<number | null>(null);
  const cats = useMemo(() => cats3(series).slice(0, 40), [series]);
  const look = useMemo(() => series.map((s) => new Map(s.points.map((p) => [p.x, p.y]))), [series]);
  const nS = series.length;
  const all = series.flatMap((s) => s.points.map((p) => p.y));
  const lo = Math.min(0, ...all);
  const hi = Math.max(0, ...all);
  const barH = nS > 1 ? 10 : 18;
  const rowH = nS * barH + (nS - 1) * 2 + (nS > 1 ? 14 : 12);
  const labelW = Math.round(clamp(width * 0.3, 64, 150));
  const fmt = (v: number) => (nS > 1 ? formatCompact(v, lang) : withUnit(formatNumber(v, 2, lang), unit, lang));
  const valueW = clamp(Math.max(...all.map((v) => fmt(v).length)) * (nS > 1 ? 6.4 : 7.8) + 12, 36, 120);
  const plotX = labelW + 8;
  const plotW = Math.max(30, width - plotX - valueW);
  const sx = linearScale(lo, hi, plotX, plotX + plotW);
  const base = sx(0);
  const H = cats.length * rowH;
  const selIdx = sel !== null && sel < cats.length ? sel : null;
  const maxChars = Math.max(4, Math.floor(labelW / 6.4));

  let tooltip: React.ReactNode = null;
  if (selIdx !== null && nS > 1) {
    const rows: TooltipRow[] = series
      .map((s, si) => ({ si, v: look[si].get(cats[selIdx]) }))
      .filter((r) => r.v !== undefined)
      .map((r) => ({ color: t.colors.chart[r.si], name: series[r.si].name, value: withUnit(formatNumber(r.v!, 2, lang), unit, lang) }));
    tooltip = <Tooltip t={t} x={plotX + plotW / 2} top={selIdx * rowH + 4} label={cats[selIdx]} rows={rows} containerW={width} />;
  }

  return (
    <View style={{ gap: t.spacing.s }}>
      <View style={{ height: H }}>
        <Svg width={width} height={H}>
          {lo < 0 ? <Line x1={base} x2={base} y1={0} y2={H} stroke={t.colors.borderStrong} strokeWidth={1} /> : null}
          {cats.map((c, i) => {
            const y0 = i * rowH + (rowH - (nS * barH + (nS - 1) * 2)) / 2;
            const active = selIdx === i;
            const dim = selIdx !== null && !active;
            return (
              <G key={i} opacity={dim ? 0.45 : 1}>
                {active ? <Rect x={0} y={i * rowH + 1} width={width} height={rowH - 2} rx={t.radii.control} fill={t.colors.surfaceAlt} /> : null}
                <SvgText x={4} y={i * rowH + rowH / 2 + 4} fontSize={FONT + 1} fill={t.colors.text} fontWeight={active ? '600' : '400'} fontFamily={t.fonts.sans}>
                  {truncate(c, maxChars)}
                </SvgText>
                {series.map((s, si) => {
                  const v = look[si].get(c);
                  if (v === undefined) return null;
                  const by = y0 + si * (barH + 2);
                  const xv = base + (sx(v) - base) * progress;
                  return (
                    <G key={si}>
                      <Path d={hbarPath(base, xv, by, barH, nS > 1 ? 3 : 4)} fill={t.colors.chart[si]} />
                      <SvgText
                        x={Math.max(xv, base) + 6}
                        y={by + barH / 2 + 4}
                        fontSize={nS > 1 ? FONT - 1 : FONT + 1}
                        fill={nS > 1 ? t.colors.muted : t.colors.text}
                        fontWeight={nS > 1 ? '400' : '600'}
                        fontFamily={t.fonts.sans}
                        opacity={progress}
                      >
                        {fmt(v)}
                      </SvgText>
                    </G>
                  );
                })}
              </G>
            );
          })}
        </Svg>
        <TapLayer
          width={width}
          height={H}
          label={tr('ui.chart.a11y')}
          onTap={(_, y) => {
            const i = clamp(Math.floor(y / rowH), 0, cats.length - 1);
            haptic('selection');
            setSel((cur) => (cur === i ? null : i));
          }}
        />
        {tooltip}
      </View>
      <Legend t={t} items={series.map((s, i) => ({ name: s.name, color: t.colors.chart[i] }))} shape="square" />
    </View>
  );
}

/* ═════════════ stacked bars ═════════════ */

export function StackedChart({ t, series, width, progress, unit, xLabel }: V3Props) {
  const { lang } = useLocale();
  const tr = useT();
  const [sel, setSel] = useState<number | null>(null);
  const [hidden, setHidden] = useState<Set<number>>(() => new Set());
  const cats = useMemo(() => cats3(series), [series]);
  const hid = useMemo(() => new Set([...hidden].filter((i) => i < series.length)), [hidden, series.length]);
  const { stacks, min, max, totals } = useMemo(() => stackSeries(series, cats, hid), [series, cats, hid]);
  const ticks = niceTicks(min, max, 4);
  const y0 = ticks[0];
  const y1 = ticks[ticks.length - 1];
  const tickLabels = ticks.map((v) => formatCompact(v, lang));
  const padLeft = Math.max(30, Math.max(...tickLabels.map((l) => l.length)) * 7 + 12);
  const padTop = 6;
  const xAxisH = 22;
  const plotW = Math.max(40, width - padLeft - 6);
  const nC = cats.length;
  const slot = plotW / Math.max(1, nC);
  const barW = Math.min(slot * 0.62, 40);
  const xAt = (i: number) => padLeft + slot * (i + 0.5);
  const yAt = (v: number) => padTop + PLOT_H * (1 - (v - y0) / (y1 - y0 || 1));
  const H = padTop + PLOT_H + xAxisH + (xLabel ? 16 : 0);
  const stride = labelStride(cats.map((c) => truncate(c, 12)), slot);
  const selIdx = sel !== null && sel < nC ? sel : null;

  const toggle = (i: number) =>
    setHidden((cur) => {
      const next = new Set(cur);
      if (next.has(i)) next.delete(i);
      else if (series.length - [...next].filter((k) => k < series.length).length > 1) next.add(i); // keep one visible
      return next;
    });

  let tooltip: React.ReactNode = null;
  if (selIdx !== null) {
    const segs = stacks[selIdx];
    const rows: TooltipRow[] = [...segs]
      .reverse()
      .map((sg) => ({ color: t.colors.chart[sg.si], name: series[sg.si].name, value: withUnit(formatNumber(sg.v, 2, lang), unit, lang) }));
    if (segs.length > 1) rows.push({ color: 'transparent', name: tr('ui.chart.total'), value: withUnit(formatNumber(totals[selIdx], 2, lang), unit, lang) });
    const top = Math.min(...segs.map((sg) => Math.min(yAt(sg.y0), yAt(sg.y1))), yAt(0));
    tooltip = <Tooltip t={t} x={xAt(selIdx)} top={top} label={cats[selIdx]} rows={rows} containerW={width} showNames />;
  }

  return (
    <View style={{ gap: t.spacing.s }}>
      <View style={{ height: H }}>
        <Svg width={width} height={H}>
          {ticks.map((v, i) => (
            <G key={i}>
              <Line x1={padLeft} x2={padLeft + plotW} y1={yAt(v)} y2={yAt(v)} stroke={v === 0 ? t.colors.borderStrong : t.colors.border} strokeWidth={1} strokeDasharray={v === 0 ? undefined : '3,4'} />
              <SvgText x={padLeft - 8} y={yAt(v) + 4} fontSize={FONT} fill={t.colors.subtle} textAnchor="end" fontFamily={t.fonts.sans}>
                {tickLabels[i]}
              </SvgText>
            </G>
          ))}
          {cats.map((c, i) =>
            i % stride === 0 ? (
              <SvgText key={i} x={xAt(i)} y={padTop + PLOT_H + 16} fontSize={FONT} fill={selIdx === i ? t.colors.text : t.colors.subtle} fontWeight={selIdx === i ? '600' : '400'} textAnchor="middle" fontFamily={t.fonts.sans}>
                {truncate(c, 12)}
              </SvgText>
            ) : null,
          )}
          {xLabel ? (
            <SvgText x={padLeft + plotW / 2} y={H - 2} fontSize={FONT} fill={t.colors.muted} textAnchor="middle" fontFamily={t.fonts.sans}>
              {xLabel}
            </SvgText>
          ) : null}
          {stacks.map((segs, i) => {
            const bx = xAt(i) - barW / 2;
            const dim = selIdx !== null && selIdx !== i;
            const lastPos = [...segs].reverse().find((sg) => sg.v > 0);
            const lastNeg = [...segs].reverse().find((sg) => sg.v < 0);
            return (
              <G key={i} opacity={dim ? 0.35 : 1}>
                {segs.map((sg) => {
                  const base = yAt(0);
                  const ya = base + (yAt(sg.y0) - base) * progress;
                  let yb = base + (yAt(sg.y1) - base) * progress;
                  const outer = sg === lastPos || sg === lastNeg;
                  // 2px surface gap between stacked segments
                  if (!outer) yb += sg.v > 0 ? 2 : -2;
                  if (outer) return <Path key={sg.si} d={barPath(bx, barW, ya, yb, 4)} fill={t.colors.chart[sg.si]} />;
                  const h = Math.abs(yb - ya);
                  return h > 0.5 ? <Rect key={sg.si} x={bx} y={Math.min(ya, yb)} width={barW} height={h} fill={t.colors.chart[sg.si]} /> : null;
                })}
              </G>
            );
          })}
        </Svg>
        <TapLayer
          width={width}
          height={padTop + PLOT_H + xAxisH}
          label={tr('ui.chart.a11y')}
          onTap={(x) => {
            const i = clamp(Math.floor((x - padLeft) / slot), 0, nC - 1);
            haptic('selection');
            setSel((cur) => (cur === i ? null : i));
          }}
        />
        {tooltip}
      </View>
      <Legend
        t={t}
        items={series.map((s, i) => ({ name: s.name, color: t.colors.chart[i] }))}
        shape="square"
        hidden={hid}
        onToggle={series.length > 1 ? toggle : undefined}
        toggleLabel={(name) => tr('ui.chart.toggleSeries', { name })}
      />
    </View>
  );
}

/* ═════════════ scatter ═════════════ */

export function ScatterChart({ t, series, width, progress, unit, xLabel, yLabel }: V3Props) {
  const { lang } = useLocale();
  const tr = useT();
  const [sel, setSel] = useState<{ si: number; pi: number } | null>(null);
  const pts = useMemo(
    () => series.map((s, si) => s.points.filter((p) => p.xn !== undefined).map((p) => ({ si, x: p.xn!, y: p.y, label: p.label }))),
    [series],
  );
  const flat = pts.flat();
  const xt = looseTicks(Math.min(...flat.map((p) => p.x)), Math.max(...flat.map((p) => p.x)), width < 400 ? 3 : 5);
  const yt = looseTicks(Math.min(...flat.map((p) => p.y)), Math.max(...flat.map((p) => p.y)), 4);
  const yLabels = yt.map((v) => formatCompact(v, lang));
  const padLeft = Math.max(30, Math.max(...yLabels.map((l) => l.length)) * 7 + 12);
  const padRight = 12;
  const padTop = 8;
  const xAxisH = 22;
  const plotW = Math.max(40, width - padLeft - padRight);
  const sx = linearScale(xt[0], xt[xt.length - 1], padLeft, padLeft + plotW);
  const sy = linearScale(yt[0], yt[yt.length - 1], padTop + PLOT_H, padTop);
  const H = padTop + PLOT_H + xAxisH + (xLabel ? 16 : 0);
  const screen = flat.map((p) => ({ x: sx(p.x), y: sy(p.y) }));
  const selP = sel ? pts[sel.si]?.[sel.pi] : undefined;
  const r = (width < 400 ? 4 : 4.5) * Math.min(1, progress * 1.4);

  let tooltip: React.ReactNode = null;
  if (selP) {
    const rows: TooltipRow[] = [
      { color: t.colors.chart[selP.si], name: xLabel ?? 'x', value: formatNumber(selP.x, 2, lang) },
      { color: t.colors.chart[selP.si], name: yLabel ?? 'y', value: withUnit(formatNumber(selP.y, 2, lang), unit, lang) },
    ];
    const label = [selP.label, series.length > 1 ? series[selP.si].name : undefined].filter(Boolean).join(' · ') || series[selP.si].name;
    tooltip = <Tooltip t={t} x={sx(selP.x)} top={sy(selP.y) - 6} label={label} rows={rows} containerW={width} showNames />;
  }

  return (
    <View style={{ gap: t.spacing.s }}>
      <View style={{ height: H }}>
        <Svg width={width} height={H}>
          {yt.map((v, i) => (
            <G key={`y${i}`}>
              <Line x1={padLeft} x2={padLeft + plotW} y1={sy(v)} y2={sy(v)} stroke={v === 0 ? t.colors.borderStrong : t.colors.border} strokeWidth={1} strokeDasharray={v === 0 ? undefined : '3,4'} />
              <SvgText x={padLeft - 8} y={sy(v) + 4} fontSize={FONT} fill={t.colors.subtle} textAnchor="end" fontFamily={t.fonts.sans}>
                {yLabels[i]}
              </SvgText>
            </G>
          ))}
          {xt.map((v, i) => (
            <G key={`x${i}`}>
              <Line x1={sx(v)} x2={sx(v)} y1={padTop} y2={padTop + PLOT_H} stroke={t.colors.border} strokeWidth={1} strokeDasharray="3,4" />
              <SvgText
                x={sx(v)}
                y={padTop + PLOT_H + 16}
                fontSize={FONT}
                fill={t.colors.subtle}
                textAnchor={i === 0 ? 'start' : i === xt.length - 1 ? 'end' : 'middle'}
                fontFamily={t.fonts.sans}
              >
                {formatCompact(v, lang)}
              </SvgText>
            </G>
          ))}
          {xLabel ? (
            <SvgText x={padLeft + plotW / 2} y={H - 2} fontSize={FONT} fill={t.colors.muted} textAnchor="middle" fontFamily={t.fonts.sans}>
              {xLabel}
            </SvgText>
          ) : null}
          {pts.map((list, si) => (
            <G key={si} opacity={sel && sel.si !== si ? 0.4 : 1}>
              {list.map((p, pi) => (
                <Circle key={pi} cx={sx(p.x)} cy={sy(p.y)} r={r} fill={t.colors.chart[si]} fillOpacity={0.78} stroke={t.colors.surface} strokeWidth={1} />
              ))}
            </G>
          ))}
          {selP ? (
            <G>
              <Circle cx={sx(selP.x)} cy={sy(selP.y)} r={7} fill={t.colors.chart[selP.si]} stroke={t.colors.surface} strokeWidth={2} />
            </G>
          ) : null}
        </Svg>
        <TapLayer
          width={width}
          height={padTop + PLOT_H + xAxisH}
          label={tr('ui.chart.scatterA11y')}
          onTap={(x, y) => {
            const k = nearestPoint(screen, x, y, 28);
            if (k === null) return setSel(null);
            const p = flat[k];
            const pi = pts[p.si].indexOf(p);
            haptic('selection');
            setSel((cur) => (cur && cur.si === p.si && cur.pi === pi ? null : { si: p.si, pi }));
          }}
        />
        {tooltip}
      </View>
      <Legend t={t} items={series.map((s, i) => ({ name: s.name, color: t.colors.chart[i] }))} shape="dot" />
    </View>
  );
}

/* ═════════════ radar ═════════════ */

export function RadarChart({ t, series, width, progress, unit, max }: V3Props & { max?: number }) {
  const { lang } = useLocale();
  const tr = useT();
  const [sel, setSel] = useState<number | null>(null);
  const axes = useMemo(() => cats3(series).slice(0, 8), [series]);
  const look = useMemo(() => series.map((s) => new Map(s.points.map((p) => [p.x, p.y]))), [series]);
  const nA = axes.length;
  const outer = radarMax(series.flatMap((s) => s.points.map((p) => p.y)), max);
  const labelW = clamp(width * 0.22, 56, 100);
  const R = Math.max(40, Math.min((width - 2 * labelW - 16) / 2, 120));
  const cx = width / 2;
  const topPad = 34;
  const cy = topPad + R;
  const H = cy + R + 34;
  const maxChars = Math.max(5, Math.floor(labelW / 6.2));
  const rings = [0.25, 0.5, 0.75, 1];
  const selIdx = sel !== null && sel < nA ? sel : null;

  let tooltip: React.ReactNode = null;
  if (selIdx !== null) {
    const rows: TooltipRow[] = series
      .map((s, si) => ({ si, v: look[si].get(axes[selIdx]) }))
      .filter((r) => r.v !== undefined)
      .map((r) => ({ color: t.colors.chart[r.si], name: series[r.si].name, value: withUnit(formatNumber(r.v!, 2, lang), unit, lang) }));
    const p = polar(cx, cy, R, radarAngle(selIdx, nA));
    tooltip = <Tooltip t={t} x={p.x} top={Math.max(30, p.y)} label={axes[selIdx]} rows={rows} containerW={width} />;
  }

  return (
    <View style={{ gap: t.spacing.s }}>
      <View style={{ height: H }}>
        <Svg width={width} height={H}>
          {rings.map((k, i) => (
            <Path key={i} d={polygonPath(axes.map((_, ai) => polar(cx, cy, R * k, radarAngle(ai, nA))))} fill="none" stroke={k === 1 ? t.colors.borderStrong : t.colors.border} strokeWidth={1} strokeDasharray={k === 1 ? undefined : '3,4'} />
          ))}
          {axes.map((_, ai) => {
            const p = polar(cx, cy, R, radarAngle(ai, nA));
            return <Line key={ai} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke={selIdx === ai ? t.colors.text : t.colors.border} strokeWidth={selIdx === ai ? 1.5 : 1} />;
          })}
          {[0.5, 1].map((k) => (
            <SvgText key={k} x={cx + 4} y={cy - R * k + 11} fontSize={FONT - 1} fill={t.colors.subtle} fontFamily={t.fonts.sans}>
              {formatCompact(outer * k, lang)}
            </SvgText>
          ))}
          <G opacity={Math.min(1, progress * 1.3)}>
            {series.map((s, si) => {
              const pts = radarPolygon(axes.map((a) => look[si].get(a)), outer, cx, cy, R, progress);
              const dim = false;
              return (
                <G key={si} opacity={dim ? 0.4 : 1}>
                  <Path d={polygonPath(pts)} fill={t.colors.chart[si]} fillOpacity={series.length > 1 ? 0.14 : 0.22} stroke={t.colors.chart[si]} strokeWidth={2} strokeLinejoin="round" />
                  {pts.map((p, pi) =>
                    look[si].has(axes[pi]) ? <Circle key={pi} cx={p.x} cy={p.y} r={selIdx === pi ? 4.5 : 3} fill={t.colors.chart[si]} stroke={t.colors.surface} strokeWidth={selIdx === pi ? 2 : 1} /> : null,
                  )}
                </G>
              );
            })}
          </G>
          {axes.map((a, ai) => {
            const ang = radarAngle(ai, nA);
            const anchor = radarAnchor(ang);
            const p = polar(cx, cy, R + 10, ang);
            const lines = wrapLabel(a, maxChars, 3);
            const c = Math.cos(ang);
            // labels above the center grow upward, below grow downward, sides are vertically centered
            const lh = 13;
            const y0 = c > 0.3 ? p.y - (lines.length - 1) * lh - 2 : c < -0.3 ? p.y + 10 : p.y + 4 - ((lines.length - 1) * lh) / 2;
            return (
              <G key={ai}>
                {lines.map((l, li) => (
                  <SvgText
                    key={li}
                    x={p.x}
                    y={y0 + li * lh}
                    fontSize={FONT}
                    fill={selIdx === ai ? t.colors.text : t.colors.muted}
                    fontWeight={selIdx === ai ? '600' : '400'}
                    textAnchor={anchor}
                    fontFamily={t.fonts.sans}
                  >
                    {l}
                  </SvgText>
                ))}
              </G>
            );
          })}
        </Svg>
        <TapLayer
          width={width}
          height={H}
          label={tr('ui.chart.radarA11y')}
          onTap={(x, y) => {
            const dx = x - cx;
            const dy = y - cy;
            if (Math.hypot(dx, dy) > R + 40) return setSel(null);
            let a = Math.atan2(dx, -dy);
            if (a < 0) a += Math.PI * 2;
            const i = Math.round(a / ((Math.PI * 2) / nA)) % nA;
            haptic('selection');
            setSel((cur) => (cur === i ? null : i));
          }}
        />
        {tooltip}
      </View>
      <Legend t={t} items={series.map((s, i) => ({ name: s.name, color: t.colors.chart[i] }))} shape="square" />
    </View>
  );
}

/* ═════════════ gauge ═════════════ */

export function GaugeChart({ t, width, progress, unit, value, min, max, target, label }: Omit<V3Props, 'series'> & { value: number; min: number; max: number; target?: number; label?: string }) {
  const { lang } = useLocale();
  const tr = useT();
  const [open, setOpen] = useState(false);
  const ro = Math.max(60, Math.min(width / 2 - 28, 130));
  const thick = clamp(ro * 0.16, 12, 20);
  const rm = ro - thick / 2;
  const cx = width / 2;
  const cy = ro + 22;
  const H = cy + 30;
  const frac = gaugeFraction(value, min, max);
  const aVal = GAUGE_START + frac * (GAUGE_END - GAUGE_START) * progress;
  const shown = min + (Math.min(Math.max(value, min), max) - min) * progress;
  const display = progress >= 1 ? value : shown;
  const fmt = (v: number) => withUnit(formatNumber(v, 2, lang), unit, lang);
  const tA = target !== undefined ? gaugeAngle(target, min, max) : undefined;
  const reached = target !== undefined && value >= target;
  const pctOfTarget = target ? withUnit(formatNumber((value / target) * 100, 0, lang), '%', lang) : undefined;

  return (
    <View style={{ height: H + 4 }}>
      <Svg width={width} height={H}>
        <Path d={arcStroke(cx, cy, rm, GAUGE_START, GAUGE_END)} stroke={t.colors.surfaceAlt} strokeWidth={thick} strokeLinecap="round" fill="none" />
        {frac > 0 ? <Path d={arcStroke(cx, cy, rm, GAUGE_START, Math.max(aVal, GAUGE_START + 0.001))} stroke={t.colors.accent} strokeWidth={thick} strokeLinecap="round" fill="none" /> : null}
        {tA !== undefined ? (
          <G opacity={progress}>
            {(() => {
              const p0 = polar(cx, cy, ro - thick - 4, tA);
              const p1 = polar(cx, cy, ro + 5, tA);
              // label inside the arc, next to the tick (outside would clip at 360 px)
              const pl = polar(cx, cy, ro - thick - 10, tA);
              const s = Math.sin(tA);
              const side = Math.abs(s) < 0.25 ? 'middle' : s > 0 ? 'end' : 'start';
              return (
                <>
                  <Line x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y} stroke={t.colors.surface} strokeWidth={5} strokeLinecap="round" />
                  <Line x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y} stroke={t.colors.text} strokeWidth={2.5} strokeLinecap="round" />
                  <SvgText x={pl.x} y={pl.y + (side === 'middle' ? 10 : 4)} fontSize={FONT} fill={t.colors.muted} textAnchor={side} fontFamily={t.fonts.sans}>
                    {tr('ui.chart.targetValue', { value: formatCompact(target!, lang) })}
                  </SvgText>
                </>
              );
            })()}
          </G>
        ) : null}
        <SvgText x={cx - rm} y={cy + 22} fontSize={FONT} fill={t.colors.subtle} textAnchor="middle" fontFamily={t.fonts.sans}>
          {formatCompact(min, lang)}
        </SvgText>
        <SvgText x={cx + rm} y={cy + 22} fontSize={FONT} fill={t.colors.subtle} textAnchor="middle" fontFamily={t.fonts.sans}>
          {formatCompact(max, lang)}
        </SvgText>
      </Svg>
      <View pointerEvents="none" style={{ position: 'absolute', left: cx - (rm - thick), width: (rm - thick) * 2, top: cy - Math.min(64, ro * 0.62), height: Math.min(64, ro * 0.62) + 26, alignItems: 'center', justifyContent: 'flex-end' }}>
        <HText variant="title" tabular numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>
          {fmt(display)}
        </HText>
        <HText variant="caption" color={reached ? 'text' : 'muted'} numberOfLines={1} tabular>
          {label ?? (pctOfTarget ? tr('ui.chart.ofTarget', { pct: pctOfTarget }) : tr('ui.chart.ofRange', { min: formatCompact(min, lang), max: formatCompact(max, lang) }))}
        </HText>
      </View>
      <TapLayer
        width={width}
        height={H}
        label={tr('ui.chart.gaugeA11y', { value: fmt(value) })}
        onTap={() => {
          haptic('selection');
          setOpen((v) => !v);
        }}
      />
      {open ? (
        <Tooltip
          t={t}
          x={cx}
          top={cy - ro + 8}
          label={tr('ui.chart.ofRange', { min: fmt(min), max: fmt(max) })}
          rows={[
            { color: t.colors.accent, name: tr('ui.chart.value'), value: fmt(value) },
            ...(target !== undefined ? [{ color: t.colors.text, name: tr('ui.chart.target'), value: fmt(target) }] : []),
          ]}
          containerW={width}
          showNames
        />
      ) : null}
    </View>
  );
}

/* ═════════════ heatmap ═════════════ */

const LEVELS = 5;

function HeatLegend({ t, ramp, lo, hi, lang }: { t: Theme; ramp: { fill: string; opacity: number }[]; lo: number; hi: number; lang: Lang }) {
  const tr = useT();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-end', flexWrap: 'wrap' }}>
      <HText variant="micro" color="muted">
        {tr('ui.chart.less')} · {formatCompact(lo, lang)}
      </HText>
      <View style={{ flexDirection: 'row', gap: 2 }}>
        {ramp.map((r, i) => (
          <View key={i} style={{ width: 11, height: 11, borderRadius: 2, backgroundColor: r.fill, opacity: r.opacity, borderWidth: i === 0 ? 1 : 0, borderColor: t.colors.border }} />
        ))}
      </View>
      <HText variant="micro" color="muted">
        {formatCompact(hi, lang)} · {tr('ui.chart.more')}
      </HText>
    </View>
  );
}

export function HeatmapChart({ t, series, width, progress, unit }: V3Props) {
  const variant = heatVariant(series);
  return variant === 'calendar' ? <CalendarHeat t={t} series={series} width={width} progress={progress} unit={unit} /> : <MatrixHeat t={t} series={series} width={width} progress={progress} unit={unit} />;
}

function CalendarHeat({ t, series, width, progress, unit }: V3Props) {
  const { lang, locale } = useLocale();
  const tr = useT();
  const [sel, setSel] = useState<number | null>(null);
  const scroll = useRef<ScrollView>(null);
  const lay = useMemo(() => calendarLayout(series.flatMap((s) => s.points)), [series]);
  const fmts = useMemo(
    () => ({
      month: new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }),
      weekday: new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }),
      date: new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }),
    }),
    [locale],
  );
  if (!lay) return null;
  const vals = lay.cells.filter((c) => c.value !== undefined).map((c) => c.value!);
  const { lo, hi } = heatDomain(vals);
  const ramp = heatRamp(t.colors.surfaceAlt, t.colors.accent, LEVELS);
  const dayW = 26;
  const avail = width - dayW;
  const gap = avail / lay.weeks < 14 ? 2 : 3;
  const cell = clamp(Math.floor(avail / lay.weeks) - gap, 7, 18);
  const step = cell + gap;
  const gridW = dayW + lay.weeks * step;
  const monthH = 16;
  const H = monthH + 7 * step;
  const overflow = gridW > width;
  const selCell = sel !== null ? lay.cells[sel] : undefined;
  const dayName = (mon0: number) => fmts.weekday.format(new Date((4 + mon0) * 86400000)); // 1970-01-05 = Monday

  const body = (
    <View style={{ width: gridW - dayW, height: H }}>
      <Svg width={gridW - dayW} height={H}>
        {lay.months.map((m, i) => (
          <SvgText key={i} x={m.col * step} y={11} fontSize={FONT} fill={t.colors.muted} fontFamily={t.fonts.sans}>
            {fmts.month.format(new Date(Date.UTC(m.year, m.month, 1)))}
          </SvgText>
        ))}
        {lay.cells.map((c, i) => {
          const lvl = c.value === undefined ? 0 : heatLevel(c.value, lo, hi, LEVELS);
          const r = ramp[lvl];
          const wave = clamp(progress * 1.6 - (c.col / Math.max(1, lay.weeks)) * 0.6, 0, 1);
          return (
            <Rect
              key={c.day}
              x={c.col * step}
              y={monthH + c.row * step}
              width={cell}
              height={cell}
              rx={cell > 12 ? 3 : 2}
              fill={r.fill}
              opacity={(c.value === undefined ? 0.55 : r.opacity) * wave}
              stroke={sel === i ? t.colors.text : undefined}
              strokeWidth={sel === i ? 1.5 : 0}
            />
          );
        })}
      </Svg>
      <TapLayer
        width={gridW - dayW}
        height={7 * step}
        top={monthH}
        label={tr('ui.chart.heatA11y')}
        onTap={(x, y) => {
          const col = Math.floor(x / step);
          const row = Math.floor(y / step);
          const i = lay.cells.findIndex((c) => c.col === col && c.row === row);
          if (i < 0) return setSel(null);
          haptic('selection');
          setSel((cur) => (cur === i ? null : i));
        }}
      />
      {selCell ? (
        <Tooltip
          t={t}
          x={selCell.col * step + cell / 2}
          top={monthH + selCell.row * step}
          label={fmts.date.format(new Date(selCell.day * 86400000))}
          rows={[{ color: t.colors.accent, name: '', value: selCell.value === undefined ? '–' : withUnit(formatNumber(selCell.value, 2, lang), unit, lang) }]}
          containerW={gridW - dayW}
        />
      ) : null}
    </View>
  );

  return (
    <View style={{ gap: t.spacing.s }}>
      <View style={{ flexDirection: 'row' }}>
        {/* weekday column stays put while the weeks scroll */}
        <Svg width={dayW} height={H}>
          {[0, 2, 4].map((r) => (
            <SvgText key={r} x={0} y={monthH + r * step + cell - 1} fontSize={FONT - 1} fill={t.colors.subtle} fontFamily={t.fonts.sans}>
              {truncate(dayName(r), 3)}
            </SvgText>
          ))}
        </Svg>
        {overflow ? (
          <ScrollView ref={scroll} horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }} onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}>
            {body}
          </ScrollView>
        ) : (
          body
        )}
      </View>
      <HeatLegend t={t} ramp={ramp} lo={lo} hi={hi} lang={lang} />
    </View>
  );
}

function MatrixHeat({ t, series, width, progress, unit }: V3Props) {
  const { lang } = useLocale();
  const tr = useT();
  const [sel, setSel] = useState<{ r: number; c: number } | null>(null);
  // rows: y2 categories, or one row per series when points have no y2
  const { rows, cols, look } = useMemo(() => {
    const hasY2 = series.some((s) => s.points.some((p) => p.y2 !== undefined));
    const rowsL: string[] = [];
    const colsL: string[] = [];
    const m = new Map<string, number>();
    const add = (r: string, c: string, v: number) => {
      if (!rowsL.includes(r)) rowsL.push(r);
      if (!colsL.includes(c)) colsL.push(c);
      m.set(`${r}\u0000${c}`, (m.get(`${r}\u0000${c}`) ?? 0) + v);
    };
    for (const s of series) for (const p of s.points) add(hasY2 ? (p.y2 ?? s.name) : s.name, p.x, p.y);
    return { rows: rowsL.slice(0, 24), cols: colsL.slice(0, 31), look: m };
  }, [series]);
  const get = (r: string, c: string) => look.get(`${r}\u0000${c}`);
  const vals = [...look.values()];
  const { lo, hi } = heatDomain(vals);
  const ramp = heatRamp(t.colors.surfaceAlt, t.colors.accent, LEVELS);
  const rowW = clamp(Math.max(...rows.map((r) => r.length)) * 6.6 + 10, 36, Math.max(60, width * 0.3));
  const gap = 2;
  const minCell = 26;
  const cellW = Math.max(minCell, Math.floor((width - rowW) / Math.max(1, cols.length)));
  const cellH = clamp(cellW * 0.8, 24, 34);
  const headH = 18;
  const gridW = rowW + cols.length * cellW;
  const H = headH + rows.length * cellH;
  const overflow = gridW > width;
  const showVals = cellW >= 34;
  const colChars = Math.max(2, Math.floor((cellW - 4) / 6.2));
  const colStride = labelStride(cols.map((c) => truncate(c, Math.max(colChars, 3))), cellW);
  const rowChars = Math.max(3, Math.floor((rowW - 8) / 6.4));
  const selV = sel ? get(rows[sel.r], cols[sel.c]) : undefined;

  const body = (
    <View style={{ width: Math.max(gridW, width), height: H }}>
      <Svg width={gridW} height={H}>
        {cols.map((c, ci) =>
          ci % colStride === 0 ? (
            <SvgText key={ci} x={rowW + ci * cellW + cellW / 2} y={12} fontSize={FONT} fill={sel?.c === ci ? t.colors.text : t.colors.muted} fontWeight={sel?.c === ci ? '600' : '400'} textAnchor="middle" fontFamily={t.fonts.sans}>
              {truncate(c, Math.max(colChars, 3))}
            </SvgText>
          ) : null,
        )}
        {rows.map((r, ri) => (
          <G key={ri}>
            <SvgText x={0} y={headH + ri * cellH + cellH / 2 + 4} fontSize={FONT} fill={sel?.r === ri ? t.colors.text : t.colors.muted} fontWeight={sel?.r === ri ? '600' : '400'} fontFamily={t.fonts.sans}>
              {truncate(r, rowChars)}
            </SvgText>
            {cols.map((c, ci) => {
              const v = get(r, c);
              const lvl = v === undefined ? 0 : heatLevel(v, lo, hi, LEVELS);
              const rp = ramp[lvl];
              const isSel = sel?.r === ri && sel?.c === ci;
              const x = rowW + ci * cellW;
              const y = headH + ri * cellH;
              const wave = clamp(progress * 1.6 - ((ri + ci) / Math.max(1, rows.length + cols.length)) * 0.6, 0, 1);
              // pick the text color with the higher contrast (WCAG crossover at L ≈ 0.179)
              const dark = rp.opacity === 1 ? luminance(rp.fill) < 0.179 : lvl >= 3;
              return (
                <G key={ci} opacity={wave}>
                  <Rect x={x + gap / 2} y={y + gap / 2} width={cellW - gap} height={cellH - gap} rx={4} fill={rp.fill} opacity={v === undefined ? 0.45 : rp.opacity} stroke={isSel ? t.colors.text : undefined} strokeWidth={isSel ? 1.5 : 0} />
                  {showVals && v !== undefined ? (
                    <SvgText x={x + cellW / 2} y={y + cellH / 2 + 4} fontSize={FONT - 1} fill={dark ? '#FFFFFF' : '#16161A'} textAnchor="middle" fontFamily={t.fonts.sans}>
                      {formatCompact(v, lang)}
                    </SvgText>
                  ) : null}
                </G>
              );
            })}
          </G>
        ))}
      </Svg>
      <TapLayer
        width={cols.length * cellW}
        height={rows.length * cellH}
        left={rowW}
        top={headH}
        label={tr('ui.chart.heatA11y')}
        onTap={(x, y) => {
          const c = clamp(Math.floor(x / cellW), 0, cols.length - 1);
          const r = clamp(Math.floor(y / cellH), 0, rows.length - 1);
          haptic('selection');
          setSel((cur) => (cur && cur.r === r && cur.c === c ? null : { r, c }));
        }}
      />
      {sel ? (
        <Tooltip
          t={t}
          x={rowW + sel.c * cellW + cellW / 2}
          top={headH + sel.r * cellH}
          label={`${rows[sel.r]} · ${cols[sel.c]}`}
          rows={[{ color: t.colors.accent, name: '', value: selV === undefined ? '–' : withUnit(formatNumber(selV, 2, lang), unit, lang) }]}
          containerW={Math.max(gridW, width)}
        />
      ) : null}
    </View>
  );

  return (
    <View style={{ gap: t.spacing.s }}>
      {overflow ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {body}
        </ScrollView>
      ) : (
        body
      )}
      <HeatLegend t={t} ramp={ramp} lo={lo} hi={hi} lang={lang} />
    </View>
  );
}

/* ═════════════ waterfall ═════════════ */

export function WaterfallChart({ t, series, width, progress, unit, xLabel }: V3Props) {
  const { lang } = useLocale();
  const tr = useT();
  const [sel, setSel] = useState<number | null>(null);
  const bars = useMemo(() => waterfallBars(series[0]?.points ?? []), [series]);
  const { min, max } = waterfallExtent(bars);
  const ticks = niceTicks(min, max, 4);
  const y0 = ticks[0];
  const y1 = ticks[ticks.length - 1];
  const tickLabels = ticks.map((v) => formatCompact(v, lang));
  const padLeft = Math.max(30, Math.max(...tickLabels.map((l) => l.length)) * 7 + 12);
  const padTop = 18;
  const xAxisH = 22;
  const plotW = Math.max(40, width - padLeft - 6);
  const nB = bars.length;
  const slot = plotW / Math.max(1, nB);
  const barW = Math.min(slot * 0.66, 44);
  const xAt = (i: number) => padLeft + slot * (i + 0.5);
  const yAt = (v: number) => padTop + PLOT_H * (1 - (v - y0) / (y1 - y0 || 1));
  const H = padTop + PLOT_H + xAxisH + (xLabel ? 16 : 0);
  const stride = labelStride(bars.map((b) => truncate(b.x, 12)), slot);
  const showVals = slot >= 34;
  const selIdx = sel !== null && sel < nB ? sel : null;
  const color = (b: (typeof bars)[number]) => (b.total ? t.colors.chart[0] : b.delta >= 0 ? t.colors.success : t.colors.danger);

  let tooltip: React.ReactNode = null;
  if (selIdx !== null) {
    const b = bars[selIdx];
    const rows: TooltipRow[] = b.total
      ? [{ color: color(b), name: tr('ui.chart.total'), value: withUnit(formatNumber(b.end, 2, lang), unit, lang) }]
      : [
          { color: color(b), name: tr('ui.chart.change'), value: signed(b.delta, lang, unit) },
          { color: 'transparent', name: tr('ui.chart.runningTotal'), value: withUnit(formatNumber(b.end, 2, lang), unit, lang) },
        ];
    tooltip = <Tooltip t={t} x={xAt(selIdx)} top={Math.min(yAt(b.start), yAt(b.end))} label={b.x} rows={rows} containerW={width} showNames />;
  }

  return (
    <View style={{ gap: t.spacing.s }}>
      <View style={{ height: H }}>
        <Svg width={width} height={H}>
          {ticks.map((v, i) => (
            <G key={i}>
              <Line x1={padLeft} x2={padLeft + plotW} y1={yAt(v)} y2={yAt(v)} stroke={v === 0 ? t.colors.borderStrong : t.colors.border} strokeWidth={1} strokeDasharray={v === 0 ? undefined : '3,4'} />
              <SvgText x={padLeft - 8} y={yAt(v) + 4} fontSize={FONT} fill={t.colors.subtle} textAnchor="end" fontFamily={t.fonts.sans}>
                {tickLabels[i]}
              </SvgText>
            </G>
          ))}
          {bars.map((b, i) =>
            i % stride === 0 ? (
              <SvgText key={i} x={xAt(i)} y={padTop + PLOT_H + 16} fontSize={FONT} fill={selIdx === i ? t.colors.text : t.colors.subtle} fontWeight={selIdx === i || b.total ? '600' : '400'} textAnchor="middle" fontFamily={t.fonts.sans}>
                {truncate(b.x, 12)}
              </SvgText>
            ) : null,
          )}
          {xLabel ? (
            <SvgText x={padLeft + plotW / 2} y={H - 2} fontSize={FONT} fill={t.colors.muted} textAnchor="middle" fontFamily={t.fonts.sans}>
              {xLabel}
            </SvgText>
          ) : null}
          {/* connectors between consecutive bar levels */}
          <G opacity={progress}>
            {bars.slice(0, -1).map((b, i) => (
              <Line key={i} x1={xAt(i) + barW / 2} x2={xAt(i + 1) - barW / 2} y1={yAt(b.end)} y2={yAt(b.end)} stroke={t.colors.borderStrong} strokeWidth={1} strokeDasharray="2,3" />
            ))}
          </G>
          {bars.map((b, i) => {
            const ya = yAt(b.start);
            const yb = ya + (yAt(b.end) - ya) * progress;
            const top = Math.min(ya, yb);
            const h = Math.max(1.5, Math.abs(yb - ya));
            const dim = selIdx !== null && selIdx !== i;
            const up = b.end >= b.start;
            return (
              <G key={i} opacity={dim ? 0.35 : 1}>
                <Rect x={xAt(i) - barW / 2} y={top} width={barW} height={h} rx={Math.min(3, h / 2)} fill={color(b)} />
                {showVals ? (
                  <SvgText
                    x={xAt(i)}
                    y={up ? yAt(b.end) - 5 : yAt(b.end) + 13}
                    fontSize={FONT - 1}
                    fill={b.total ? t.colors.text : t.colors.muted}
                    fontWeight={b.total ? '600' : '400'}
                    textAnchor="middle"
                    fontFamily={t.fonts.sans}
                    opacity={progress}
                  >
                    {b.total ? formatCompact(b.end, lang) : (b.delta > 0 ? '+' : '') + formatCompact(b.delta, lang)}
                  </SvgText>
                ) : null}
              </G>
            );
          })}
        </Svg>
        <TapLayer
          width={width}
          height={padTop + PLOT_H + xAxisH}
          label={tr('ui.chart.a11y')}
          onTap={(x) => {
            const i = clamp(Math.floor((x - padLeft) / slot), 0, nB - 1);
            haptic('selection');
            setSel((cur) => (cur === i ? null : i));
          }}
        />
        {tooltip}
      </View>
      <Legend
        t={t}
        shape="square"
        items={[
          { name: tr('ui.chart.increase'), color: t.colors.success },
          { name: tr('ui.chart.decrease'), color: t.colors.danger },
          ...(bars.some((b) => b.total) ? [{ name: tr('ui.chart.total'), color: t.colors.chart[0] }] : []),
        ]}
      />
    </View>
  );
}

/* ═════════════ table views ═════════════ */

export function V3Table({ kind, series, node, unit, xLabel, yLabel }: { kind: V3Kind; series: Series3[]; node: GaugeNode; unit?: string; xLabel?: string; yLabel?: string }) {
  const { lang, locale } = useLocale();
  const tr = useT();
  const f = (v: number | undefined) => (v === undefined ? null : formatNumber(v, 2, lang));
  const u = (s: string) => labelWithUnit(s, unit);
  let columns: string[];
  let rows: (string | number | null)[][];
  if (kind === 'gauge') {
    const { min, max, target } = gaugeConfig(node);
    columns = ['', unit ?? ''];
    rows = [
      [tr('ui.chart.value'), f(gaugeValue(series, node))],
      [tr('ui.chart.min'), f(min)],
      [tr('ui.chart.max'), f(max)],
      ...(target !== undefined ? [[tr('ui.chart.target'), f(target)]] : []),
    ];
  } else if (kind === 'scatter') {
    const withLabels = series.some((s) => s.points.some((p) => p.label));
    const multi = series.length > 1;
    columns = [...(withLabels ? [''] : []), ...(multi ? [''] : []), xLabel ?? 'x', u(yLabel ?? 'y')];
    rows = series.flatMap((s) =>
      s.points.filter((p) => p.xn !== undefined).map((p) => [...(withLabels ? [p.label ?? ''] : []), ...(multi ? [s.name] : []), f(p.xn), f(p.y)]),
    );
  } else if (kind === 'waterfall') {
    const bars = waterfallBars(series[0]?.points ?? []);
    columns = [xLabel ?? '', u(tr('ui.chart.change')), u(tr('ui.chart.runningTotal'))];
    rows = bars.map((b) => [b.x, b.total ? null : signed(b.delta, lang), f(b.end)]);
  } else if (kind === 'heatmap' && heatVariant(series) === 'calendar') {
    const df = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    const pts = series.flatMap((s) => s.points).filter((p) => isoDay(p.x) !== undefined);
    pts.sort((a, b) => isoDay(a.x)! - isoDay(b.x)!);
    columns = [tr('ui.chart.date'), u(tr('ui.chart.value'))];
    rows = pts.map((p) => [df.format(new Date(isoDay(p.x)! * 86400000)), f(p.y)]);
  } else if (kind === 'heatmap') {
    const hasY2 = series.some((s) => s.points.some((p) => p.y2 !== undefined));
    const cols = cats3(series);
    const rowNames: string[] = [];
    const m = new Map<string, number>();
    for (const s of series)
      for (const p of s.points) {
        const r = hasY2 ? (p.y2 ?? s.name) : s.name;
        if (!rowNames.includes(r)) rowNames.push(r);
        m.set(`${r}\u0000${p.x}`, (m.get(`${r}\u0000${p.x}`) ?? 0) + p.y);
      }
    columns = [unit ?? '', ...cols].slice(0, 12);
    rows = rowNames.map((r) => [r, ...cols.slice(0, 11).map((c) => f(m.get(`${r}\u0000${c}`)))]);
  } else {
    const cats = cats3(series);
    const look = series.map((s) => new Map(s.points.map((p) => [p.x, p.y])));
    const stacked = kind === 'stacked' && series.length > 1;
    columns = [xLabel ?? '', ...series.map((s) => u(s.name)), ...(stacked ? [u(tr('ui.chart.total'))] : [])].slice(0, 12);
    rows = cats.map((c) => {
      const vals = look.map((m) => m.get(c));
      const total = vals.reduce<number>((s, v) => s + (v ?? 0), 0);
      return [c, ...vals.map(f), ...(stacked ? [f(total)] : [])].slice(0, 12);
    });
  }
  return <Table node={{ type: 'table', columns, rows: rows.slice(0, 200) }} bare />;
}

/* ═════════════ skeletons (no data yet, streaming) ═════════════ */

export function V3Skeleton({ kind, t }: { kind: V3Kind; t: Theme }) {
  let body: React.ReactNode;
  if (kind === 'gauge') {
    body = (
      <View style={{ alignItems: 'center', paddingVertical: t.spacing.s, overflow: 'hidden', height: 110 }}>
        <Skeleton width={200} height={200} radius={100} />
      </View>
    );
  } else if (kind === 'radar') {
    body = (
      <View style={{ alignItems: 'center', paddingVertical: t.spacing.s }}>
        <Skeleton width={170} height={170} radius={85} />
      </View>
    );
  } else if (kind === 'heatmap') {
    body = (
      <View style={{ gap: 3 }}>
        {Array.from({ length: 7 }, (_, r) => (
          <View key={r} style={{ flexDirection: 'row', gap: 3 }}>
            {Array.from({ length: 16 }, (_, c) => (
              <Skeleton key={c} width={null} height={12} radius={2} style={{ flex: 1, opacity: 0.5 + ((r * 7 + c * 3) % 5) / 10 }} />
            ))}
          </View>
        ))}
      </View>
    );
  } else if (kind === 'hbar') {
    body = (
      <View style={{ gap: 10 }}>
        {[0.9, 0.72, 0.55, 0.4].map((w, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Skeleton width={64} height={10} />
            <Skeleton width={`${w * 70}%`} height={16} radius={4} />
          </View>
        ))}
      </View>
    );
  } else {
    const heights = kind === 'scatter' ? [] : [0.45, 0.7, 0.55, 0.85, 0.62, 0.38, 0.75];
    body =
      kind === 'scatter' ? (
        <View style={{ height: 170, marginLeft: 28 }}>
          {[
            [0.1, 0.7],
            [0.25, 0.45],
            [0.4, 0.55],
            [0.55, 0.3],
            [0.7, 0.35],
            [0.85, 0.12],
          ].map(([x, y], i) => (
            <Skeleton key={i} width={12} height={12} radius={6} style={{ position: 'absolute', left: `${x * 100}%`, top: `${y * 100}%` }} />
          ))}
        </View>
      ) : (
        <View style={{ height: 170, flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingLeft: 28 }}>
          {heights.map((h, i) => (
            <Skeleton key={i} height={160 * h} width={null} radius={4} style={{ flex: 1 }} />
          ))}
        </View>
      );
  }
  return (
    <Surface>
      <View style={{ gap: t.spacing.m }}>
        <Skeleton width="45%" height={14} />
        {body}
      </View>
    </Surface>
  );
}

/** Renders a v3 kind (Chart.tsx dispatch). */
export function V3Body({ kind, series, node, ...p }: V3Props & { kind: V3Kind; node: GaugeNode & { max?: unknown } }) {
  switch (kind) {
    case 'hbar':
      return <HBarChart series={series} {...p} />;
    case 'stacked':
      return <StackedChart series={series} {...p} />;
    case 'scatter':
      return <ScatterChart series={series} {...p} />;
    case 'radar':
      // fewer than 3 axes cannot form a polygon → ranking fallback
      return cats3(series).length >= 3 ? <RadarChart series={series} {...p} max={n(node.max)} /> : <HBarChart series={series} {...p} />;
    case 'gauge': {
      const v = gaugeValue(series, node);
      if (v === undefined) return null;
      const { min, max, target } = gaugeConfig(node);
      return <GaugeChart {...p} value={v} min={min} max={max} target={target} />;
    }
    case 'heatmap':
      return <HeatmapChart series={series} {...p} />;
    case 'waterfall':
      return <WaterfallChart series={series} {...p} />;
  }
}
