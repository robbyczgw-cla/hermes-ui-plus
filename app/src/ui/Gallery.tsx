import { useT } from '../i18n';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { HuiThemeProvider, useTheme, type ColorScheme } from './theme';
import { HuiView } from './HuiView';
import { RouteSkeleton } from './skeletons';
import { HText, PressableScale } from './primitives/basics';
import { Icon } from './primitives/Icon';
import { defaultActionHandler, type HuiActionHandler } from './primitives/context';
import { GALLERY_SAMPLES, PARTIAL_SAMPLES, type GallerySample } from './galleryData';
import { INTERACTIVE_PARTIAL_SAMPLES, INTERACTIVE_SAMPLES } from './components/modules/a/galleryInteractive';
import { createStreamParser } from '../protocol/streamParser';
import { ROUTE_FORMATS } from '../protocol/types';
// ── modules-b (calc, recipe, map) ──
import { GallerySectionB } from './components/modules/b/GallerySectionB';
// ── modules-c1 (translation, poll) ──
import { GallerySectionC1 } from './components/modules/c1/GallerySectionC1';
// ── charts-v3 (hbar, stacked, scatter, radar, gauge, heatmap, waterfall, sparkline) ──
import { GallerySectionCharts } from './components/GallerySectionCharts';
// ── modules-c3 (decision, rank, scale) ──
import { GallerySectionC3 } from './components/modules/c3/GallerySectionC3';
// ── modules-c2 (agenda, weather) ──
import { GallerySectionC2 } from './components/modules/c2/GallerySectionC2';
// ── modules-d3 (studyplan, vocab, mindmap) ──
import { GallerySectionD3 } from './components/modules/d3/GallerySectionD3';
// ── modules-d2 (guide, workout, timer v2) ──
import { GallerySectionD2 } from './components/modules/d2/GallerySectionD2';
// ── modules-d1 (places, products) ──
import { GallerySectionD1 } from './components/modules/d1/GallerySectionD1';
// ── modules-e1 (paths, blocks) ──
import { GallerySectionE1 } from './components/modules/e1/GallerySectionE1';
import { LoaderGallery } from './loaders/LoaderGallery';

type Mode = 'static' | 'streaming' | 'skeletons' | 'loaders';

/**
 * Component gallery / storybook screen. Not a route – mount it from a route file:
 *   export default function GalleryRoute() { return <Gallery />; }
 * Modes: static, simulated streaming (fed through the real protocol stream parser), route skeletons.
 */
export function Gallery() {
  const [scheme, setScheme] = useState<ColorScheme | null>(null);
  return (
    <HuiThemeProvider scheme={scheme}>
      <GalleryBody scheme={scheme} setScheme={setScheme} />
    </HuiThemeProvider>
  );
}

function Segmented<T extends string | null>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', backgroundColor: t.colors.surfaceAlt, borderRadius: t.radii.m, padding: 3, gap: 3 }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <PressableScale
            key={String(o.value)}
            haptic="selection"
            scaleTo={0.98}
            onPress={() => onChange(o.value)}
            style={{ flex: 1, height: 32, borderRadius: t.radii.s, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? t.colors.surface : 'transparent', ...(active ? t.shadows.sm : {}) }}
          >
            <HText variant="caption" weight={active ? '600' : '400'} color={active ? 'text' : 'muted'}>
              {o.label}
            </HText>
          </PressableScale>
        );
      })}
    </View>
  );
}

function GalleryBody({ scheme, setScheme }: { scheme: ColorScheme | null; setScheme: (s: ColorScheme | null) => void }) {
  const tr = useT();
  const t = useTheme();
  const [mode, setMode] = useState<Mode>('static');
  const [run, setRun] = useState(0);
  const [last, setLast] = useState<string | null>(null);

  const onAction = useCallback<HuiActionHandler>((action, values, meta) => {
    defaultActionHandler(action, values, meta);
    let s: string;
    if (action.type === 'submit') s = `[form:${meta?.formId ?? '?'}] ${JSON.stringify(values)}`;
    else if (action.type === 'send') s = `send → „${action.text}“`;
    else if (action.type === 'open_url') s = `open_url → ${action.url}`;
    else if (action.type === 'copy') s = `copy → ${action.text}`;
    else s = `${action.type} → ${JSON.stringify(action)}`;
    setLast(s);
  }, []);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.colors.bg }} contentContainerStyle={{ alignItems: 'center', paddingBottom: 64 }} keyboardShouldPersistTaps="handled">
      <View style={{ width: '100%', maxWidth: t.maxContentWidth, paddingHorizontal: t.spacing.l, paddingTop: t.spacing.xl, gap: t.spacing.xl }}>
        <View style={{ gap: t.spacing.m }}>
          <View>
            <HText variant="display">{tr('ui.gallery.title')}</HText>
            <HText variant="callout" color="muted">
              {tr('ui.gallery.subtitle')}
            </HText>
          </View>
          <Segmented<Mode>
            value={mode}
            onChange={(m) => {
              setMode(m);
              setRun((r) => r + 1);
            }}
            options={[
              { value: 'static', label: tr('ui.gallery.modeStatic') },
              { value: 'streaming', label: tr('ui.gallery.modeStreaming') },
              { value: 'skeletons', label: tr('ui.gallery.modeSkeletons') },
              { value: 'loaders', label: tr('waiting.gallery.mode') },
            ]}
          />
          <Segmented<ColorScheme | null>
            value={scheme}
            onChange={setScheme}
            options={[
              { value: null, label: tr('ui.gallery.schemeSystem') },
              { value: 'light', label: tr('ui.gallery.schemeLight') },
              { value: 'dark', label: tr('ui.gallery.schemeDark') },
            ]}
          />
          {mode === 'streaming' ? (
            <PressableScale
              onPress={() => setRun((r) => r + 1)}
              style={{ flexDirection: 'row', alignSelf: 'flex-start', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 14, borderRadius: t.radii.pill, borderWidth: 1, borderColor: t.colors.borderStrong }}
            >
              <Icon name="sparkle" size={14} color={t.colors.text} />
              <HText variant="callout" weight="500">
                {tr('ui.gallery.replay')}
              </HText>
            </PressableScale>
          ) : null}
          {last ? (
            <View style={{ backgroundColor: t.colors.surfaceAlt, borderRadius: t.radii.s, padding: t.spacing.s }}>
              <HText variant="micro" color="muted">
                {tr('ui.gallery.lastAction')}
              </HText>
              <HText variant="mono" style={{ fontSize: 12 }} numberOfLines={3}>
                {last}
              </HText>
            </View>
          ) : null}
        </View>

        {/* ── waiting-delight: loader library + waiting states ── */}
        {mode === 'loaders' ? <LoaderGallery key={run} /> : null}

        {mode === 'loaders'
          ? null
          : mode === 'skeletons'
          ? ROUTE_FORMATS.map((f) => (
              <Section key={f} title={`RouteSkeleton · ${f}`}>
                <RouteSkeleton format={f} />
              </Section>
            ))
          : GALLERY_SAMPLES.map((s, i) => (
              <Section key={`${run}-${i}`} title={s.title}>
                {mode === 'streaming' ? <StreamingSample sample={s} onAction={onAction} delay={150 + (i % 4) * 120} /> : <HuiView node={s.node} onAction={onAction} />}
              </Section>
            ))}

        {mode !== 'skeletons' && mode !== 'loaders' ? (
          <>
            <HText variant="title" style={{ marginTop: t.spacing.l }}>
              {tr('ui.gallery.interactive')}
            </HText>
            {INTERACTIVE_SAMPLES.map((s, i) => (
              <Section key={`ia-${run}-${i}`} title={s.title}>
                {mode === 'streaming' ? <StreamingSample sample={s} onAction={onAction} delay={150 + (i % 4) * 120} /> : <HuiView node={s.node} onAction={onAction} />}
              </Section>
            ))}
          </>
        ) : null}

        {mode === 'static' ? (
          <>
            <HText variant="title" style={{ marginTop: t.spacing.l }}>
              {tr('ui.gallery.partial')}
            </HText>
            {[...PARTIAL_SAMPLES, ...INTERACTIVE_PARTIAL_SAMPLES].map((s, i) => (
              <Section key={i} title={s.title}>
                <HuiView node={s.node} streaming onAction={onAction} />
              </Section>
            ))}
            <Section title={tr('ui.gallery.invalid')}>
              <HuiView node={'nur ein String'} onAction={onAction} />
            </Section>
          </>
        ) : null}

        {/* ── modules-b: Rechner, Rezept, Karte (owner: modules-b) ── */}
        {mode === 'static' ? <GallerySectionB onAction={onAction} /> : null}
        {/* ── /modules-b ── */}
        {/* ── modules-c1: Übersetzung & Abstimmung (owner: modules-c1) ── */}
        {mode === 'static' ? <GallerySectionC1 onAction={onAction} /> : null}
        {/* ── /modules-c1 ── */}
        {/* ── modules-c3: Entscheiden, Sortieren, Bewerten (owner: modules-c3) ── */}
        {mode === 'static' ? <GallerySectionC3 onAction={onAction} /> : null}
        {/* ── /modules-c3 ── */}
        {/* ── modules-c2: Tagesplan, Wetter (owner: modules-c2) ── */}
        {mode === 'static' ? <GallerySectionC2 onAction={onAction} /> : null}
        {/* ── /modules-c2 ── */}
        {/* ── modules-d3: Lernplan, Vokabeln, Mindmap (owner: modules-d3) ── */}
        {mode === 'static' ? <GallerySectionD3 onAction={onAction} /> : null}
        {/* ── /modules-d3 ── */}
        {/* ── modules-d2: Anleitung, Training, Timer (owner: modules-d2) ── */}
        {mode === 'static' ? <GallerySectionD2 onAction={onAction} /> : null}
        {/* ── /modules-d2 ── */}
        {/* ── modules-d1: Orte & Produkte (owner: modules-d1) ── */}
        {mode === 'static' ? <GallerySectionD1 onAction={onAction} /> : null}
        {/* ── /modules-d1 ── */}
        {/* ── modules-e1: Wege & Varianten (paths), Architektur & Bausteine (blocks) ── */}
        {mode === 'static' ? <GallerySectionE1 onAction={onAction} /> : null}
        {/* ── /modules-e1 ── */}

        {/* ── charts-v3: neue Diagrammarten + Sparklines (owner: charts-v3) ── */}
        {mode === 'static' ? <GallerySectionCharts onAction={onAction} /> : null}
        {/* ── /charts-v3 ── */}
      </View>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ gap: t.spacing.s }}>
      <HText variant="micro" color="subtle" style={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
        {title}
      </HText>
      {children}
    </View>
  );
}

/**
 * Simulates a model stream: shows the RouteSkeleton (as if `hermes.ui.route` arrived), then feeds
 * a ```hui fenced block in small random chunks through the protocol's createStreamParser().
 */
function StreamingSample({ sample, onAction, delay }: { sample: GallerySample; onAction: HuiActionHandler; delay: number }) {
  const [seg, setSeg] = useState<{ node: unknown; complete: boolean } | null>(null);
  useEffect(() => {
    const src = '```hui\n' + JSON.stringify(sample.node, null, 1) + '\n```\n';
    const parser = createStreamParser();
    const step = Math.max(6, Math.ceil(src.length / 60));
    let pos = 0;
    let iv: ReturnType<typeof setInterval> | undefined;
    const pick = (segs: ReturnType<typeof parser.push>) => {
      const h = segs.find((x) => x.kind === 'hui');
      if (h && h.kind === 'hui') setSeg({ node: h.node, complete: h.complete });
    };
    const to = setTimeout(() => {
      iv = setInterval(() => {
        const next = Math.min(src.length, pos + step + Math.floor(Math.random() * step));
        pick(parser.push(src.slice(pos, next)));
        pos = next;
        if (pos >= src.length) {
          pick(parser.end());
          clearInterval(iv);
        }
      }, 60);
    }, 700 + delay);
    return () => {
      clearTimeout(to);
      if (iv) clearInterval(iv);
    };
  }, [sample, delay]);
  if (!seg || seg.node == null) return <RouteSkeleton format={sample.route} />;
  return <HuiView node={seg.node} streaming={!seg.complete} onAction={onAction} />;
}
