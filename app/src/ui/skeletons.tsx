import { View } from 'react-native';
import { useT } from '../i18n';
import { useTheme } from './theme';
import { Skeleton, SkeletonLines } from './primitives/Skeleton';
import { HText, Surface } from './primitives/basics';
import { Icon, type IconName } from './primitives/Icon';
import type { RouteFormat } from './types';

// Placeholder shapes that mimic each component's final layout so content
// "fills in" without layout jumps.

export function ChartSkeleton({ kind = 'bar', bare }: { kind?: string; bare?: boolean }) {
  const t = useTheme();
  const heights = [0.45, 0.7, 0.55, 0.85, 0.62, 0.38, 0.75];
  const round = kind === 'pie' || kind === 'donut' || kind === 'radar' || kind === 'gauge';
  const body = (
    <View style={{ gap: t.spacing.m }}>
      <Skeleton width="45%" height={14} />
      {round ? (
        <View style={{ alignItems: 'center', paddingVertical: t.spacing.s }}>
          <Skeleton width={150} height={150} radius={75} />
        </View>
      ) : (
        <View style={{ height: 170, flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingLeft: 28 }}>
          {heights.map((h, i) => (
            <Skeleton key={i} height={160 * h} width={null} radius={4} style={{ flex: 1 }} />
          ))}
        </View>
      )}
      <View style={{ flexDirection: 'row', gap: t.spacing.m }}>
        <Skeleton width={64} height={10} />
        <Skeleton width={52} height={10} />
      </View>
    </View>
  );
  return bare ? body : <Surface>{body}</Surface>;
}

export function TableSkeleton({ rows = 4, cols = 3, bare }: { rows?: number; cols?: number; bare?: boolean }) {
  const t = useTheme();
  const body = (
    <View>
      <View style={{ flexDirection: 'row', gap: t.spacing.l, padding: t.spacing.m, backgroundColor: t.colors.surfaceAlt }}>
        {Array.from({ length: cols }, (_, i) => (
          <Skeleton key={i} height={10} style={{ flex: 1 }} width={null} />
        ))}
      </View>
      {Array.from({ length: rows }, (_, r) => (
        <View key={r} style={{ flexDirection: 'row', gap: t.spacing.l, padding: t.spacing.m, borderTopWidth: 1, borderColor: t.colors.border }}>
          {Array.from({ length: cols }, (_, i) => (
            <Skeleton key={i} height={10} width={null} style={{ flex: 1, opacity: i === 0 ? 1 : 0.7 }} />
          ))}
        </View>
      ))}
    </View>
  );
  return bare ? body : <Surface padded={false}>{body}</Surface>;
}

export function StatsSkeleton({ count = 4 }: { count?: number }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.s }}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={{ flexGrow: 1, flexBasis: '45%', minWidth: 140 }}>
          <Surface style={{ gap: t.spacing.s }}>
            <Skeleton width="55%" height={10} />
            <Skeleton width="70%" height={22} />
            <Skeleton width="35%" height={10} />
          </Surface>
        </View>
      ))}
    </View>
  );
}

export function ListSkeleton({ rows = 3, marker = 'dot' }: { rows?: number; marker?: 'dot' | 'circle' }) {
  const t = useTheme();
  return (
    <View style={{ gap: t.spacing.m }}>
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: t.spacing.m, alignItems: 'flex-start' }}>
          <Skeleton width={marker === 'circle' ? 24 : 8} height={marker === 'circle' ? 24 : 8} radius={12} style={{ marginTop: marker === 'circle' ? 0 : 6 }} />
          <View style={{ flex: 1, gap: 6 }}>
            <Skeleton width={`${70 - i * 12}%`} height={12} />
            <Skeleton width={`${45 + i * 9}%`} height={10} />
          </View>
        </View>
      ))}
    </View>
  );
}

export function CompareSkeleton() {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: t.spacing.s }}>
      {[0, 1].map((i) => (
        <Surface key={i} style={{ flex: 1, gap: t.spacing.s }}>
          <Skeleton width="60%" height={14} />
          <SkeletonLines lines={4} lineHeight={10} />
        </Surface>
      ))}
    </View>
  );
}

export function FormSkeleton({ fields = 3 }: { fields?: number }) {
  const t = useTheme();
  return (
    <Surface style={{ gap: t.spacing.l }}>
      <Skeleton width="50%" height={16} />
      {Array.from({ length: fields }, (_, i) => (
        <View key={i} style={{ gap: 8 }}>
          <Skeleton width="30%" height={10} />
          <Skeleton height={42} radius={t.radii.m} />
        </View>
      ))}
      <Skeleton width={120} height={40} radius={t.radii.pill} />
    </Surface>
  );
}

export function ImageSkeleton({ aspect = 16 / 9 }: { aspect?: number }) {
  const t = useTheme();
  return (
    <View style={{ width: '100%', aspectRatio: aspect, borderRadius: t.radii.l, overflow: 'hidden' }}>
      <Skeleton height={null} width="100%" radius={t.radii.l} style={{ flex: 1 }} />
    </View>
  );
}

export function CodeSkeleton() {
  const t = useTheme();
  return (
    <View style={{ backgroundColor: t.colors.codeBg, borderRadius: t.radii.m, padding: t.spacing.l, gap: 8, borderWidth: 1, borderColor: t.colors.border }}>
      <Skeleton width="40%" height={10} />
      <Skeleton width="75%" height={10} />
      <Skeleton width="58%" height={10} />
    </View>
  );
}

/** Generic block for "something interactive is being built" (hui-html formats). */
function InteractiveSkeleton({ icon, label }: { icon: IconName; label: string }) {
  const t = useTheme();
  return (
    <Surface style={{ gap: t.spacing.m }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.s }}>
        <Icon name={icon} size={16} color={t.colors.muted} />
        <HText variant="caption" color="muted">
          {label}
        </HText>
      </View>
      <Skeleton height={180} radius={t.radii.m} />
    </Surface>
  );
}

// ───────────── v2 module skeletons (shared with the modules' own "nothing arrived yet" state) ─────────────

export function ChecklistSkeleton() {
  return (
    <Surface style={{ gap: 12 }}>
      <Skeleton width="45%" height={16} />
      {[0, 1, 2].map((i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
          <Skeleton width={22} height={22} radius={11} />
          <Skeleton width={`${60 - i * 12}%`} height={12} />
        </View>
      ))}
    </Surface>
  );
}

export function ChoiceSkeleton() {
  const t = useTheme();
  return (
    <Surface style={{ gap: 10 }}>
      <Skeleton width="55%" height={14} />
      <Skeleton height={44} radius={t.radii.m} />
      <Skeleton height={44} radius={t.radii.m} />
      <Skeleton height={44} radius={t.radii.m} />
    </Surface>
  );
}

export function RecipeSkeleton() {
  const t = useTheme();
  return (
    <Surface style={{ gap: t.spacing.m }}>
      <Skeleton width="100%" height={160} radius={t.radii.m} />
      <SkeletonLines lines={4} />
    </Surface>
  );
}

export function QuizSkeleton() {
  const t = useTheme();
  return (
    <Surface style={{ gap: 12 }}>
      <Skeleton width="30%" height={10} />
      <Skeleton width="80%" height={16} />
      {[0, 1, 2].map((k) => (
        <Skeleton key={k} height={46} radius={t.radii.m} />
      ))}
    </Surface>
  );
}

export function FlashcardsSkeleton() {
  const t = useTheme();
  return (
    <Surface style={{ gap: 12 }}>
      <Skeleton width="40%" height={12} />
      <Skeleton height={180} radius={t.radii.l} />
    </Surface>
  );
}

export function SourcesSkeleton() {
  const t = useTheme();
  return (
    <View style={{ gap: 8 }}>
      <Skeleton width={80} height={10} />
      <Skeleton height={56} radius={t.radii.m} />
    </View>
  );
}

export function SlotsSkeleton() {
  const t = useTheme();
  return (
    <Surface style={{ gap: 10 }}>
      <Skeleton width="55%" height={14} />
      <Skeleton height={52} radius={t.radii.m} />
      <Skeleton height={52} radius={t.radii.m} />
    </Surface>
  );
}

export function ConfirmSkeleton() {
  const t = useTheme();
  return (
    <Surface style={{ gap: 10 }}>
      <Skeleton width="60%" height={16} />
      <Skeleton width="90%" height={12} />
      <Skeleton height={44} radius={t.radii.pill} />
    </Surface>
  );
}

export const TIMER_RING = 112;

export function TimerSkeleton() {
  const t = useTheme();
  return (
    <Surface style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.l }}>
      <Skeleton width={TIMER_RING} height={TIMER_RING} radius={TIMER_RING / 2} />
      <View style={{ flex: 1, gap: 10 }}>
        <Skeleton width="60%" height={14} />
        <Skeleton width={120} height={40} radius={t.radii.pill} />
      </View>
    </Surface>
  );
}

export const MAP_SKELETON_HEIGHT = 260;

/** `title` = already streamed map title (shown above the placeholder). */
export function MapSkeleton({ title }: { title?: string }) {
  const t = useTheme();
  return (
    <Surface style={{ gap: t.spacing.m }}>
      {title ? <HText variant="headline">{title}</HText> : <Skeleton width="45%" height={16} />}
      <Skeleton width="100%" height={MAP_SKELETON_HEIGHT} radius={t.radii.m} />
    </Surface>
  );
}

export function TabsSkeleton() {
  const t = useTheme();
  return (
    <View style={{ gap: t.spacing.m }}>
      <View style={{ flexDirection: 'row', gap: t.spacing.s }}>
        <Skeleton width={90} height={34} radius={t.radii.pill} />
        <Skeleton width={90} height={34} radius={t.radii.pill} />
      </View>
      <SkeletonLines lines={3} />
    </View>
  );
}

export function AccordionSkeleton({ depth = 0 }: { depth?: number }) {
  return (
    <Surface depth={depth} style={{ gap: 14 }}>
      <Skeleton width="60%" height={14} />
      <Skeleton width="45%" height={14} />
    </Surface>
  );
}

function PillsSkeleton({ count = 3 }: { count?: number }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.s }}>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} width={[150, 120, 96][i % 3]} height={40} radius={t.radii.pill} />
      ))}
    </View>
  );
}

function CardSkeleton() {
  const t = useTheme();
  return (
    <Surface style={{ gap: t.spacing.m }}>
      <Skeleton width="50%" height={16} />
      <SkeletonLines lines={3} />
    </Surface>
  );
}

function ProgressSkeleton() {
  const t = useTheme();
  return (
    <View style={{ gap: 8 }}>
      <Skeleton width="40%" height={10} />
      <Skeleton height={8} radius={t.radii.pill} />
    </View>
  );
}

// ───────────── v3 module skeletons ─────────────

export function TranslationSkeleton() {
  const t = useTheme();
  return (
    <Surface style={{ gap: t.spacing.m }}>
      <Skeleton width={56} height={10} />
      <SkeletonLines lines={2} />
      <Skeleton width={56} height={10} />
      <SkeletonLines lines={2} />
    </Surface>
  );
}

export function PollSkeleton() {
  const t = useTheme();
  return (
    <Surface style={{ gap: 10 }}>
      <Skeleton width="65%" height={14} />
      {[0.9, 0.6, 0.35].map((w, i) => (
        <Skeleton key={i} width={`${w * 100}%`} height={36} radius={t.radii.m} />
      ))}
    </Surface>
  );
}

export function AgendaSkeleton() {
  const t = useTheme();
  return (
    <Surface style={{ gap: 10 }}>
      <Skeleton width="40%" height={14} />
      {[0, 1, 2].map((i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
          <Skeleton width={36} height={10} />
          <Skeleton height={i === 1 ? 64 : 44} radius={t.radii.m} style={{ flex: 1 }} />
        </View>
      ))}
    </Surface>
  );
}

export function WeatherSkeleton() {
  const t = useTheme();
  return (
    <Surface style={{ gap: t.spacing.m }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.m }}>
        <Skeleton width={56} height={56} radius={28} />
        <View style={{ gap: 8 }}>
          <Skeleton width={90} height={26} />
          <Skeleton width={120} height={12} />
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} width={40} height={64} radius={t.radii.m} />
        ))}
      </View>
    </Surface>
  );
}

export function DecisionSkeleton() {
  const t = useTheme();
  return (
    <Surface style={{ gap: 10 }}>
      <Skeleton width="50%" height={14} />
      {[0.9, 0.7, 0.45].map((w, i) => (
        <View key={i} style={{ gap: 6 }}>
          <Skeleton width={90} height={10} />
          <Skeleton width={`${w * 100}%`} height={18} radius={t.radii.s} />
        </View>
      ))}
    </Surface>
  );
}

export function RankSkeleton() {
  const t = useTheme();
  return (
    <Surface style={{ gap: 8 }}>
      <Skeleton width="55%" height={14} />
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
          <Skeleton width={24} height={24} radius={12} />
          <Skeleton height={40} radius={t.radii.m} style={{ flex: 1 }} />
        </View>
      ))}
    </Surface>
  );
}

export function ScaleSkeleton() {
  const t = useTheme();
  return (
    <Surface style={{ gap: 14 }}>
      <Skeleton width="70%" height={14} />
      <Skeleton height={12} radius={t.radii.pill} />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Skeleton width={48} height={10} />
        <Skeleton width={48} height={10} />
      </View>
    </Surface>
  );
}

// ───────────── v4 module skeletons ─────────────

export function SummarySkeleton() {
  const t = useTheme();
  return (
    <Surface style={{ gap: t.spacing.s, borderLeftWidth: 3, borderLeftColor: t.colors.border }}>
      <Skeleton width="90%" height={18} />
      <Skeleton width="65%" height={18} />
      <Skeleton width="50%" height={10} />
      <Skeleton width="40%" height={10} />
    </Surface>
  );
}

export function PlacesSkeleton() {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: t.spacing.m, overflow: 'hidden' }}>
      {[0, 1].map((i) => (
        <Surface key={i} padded={false} style={{ width: 240, overflow: 'hidden' }}>
          <Skeleton height={120} radius={0} />
          <View style={{ padding: t.spacing.m, gap: 8 }}>
            <Skeleton width="70%" height={14} />
            <Skeleton width="50%" height={10} />
            <Skeleton width="40%" height={10} />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Skeleton width={64} height={32} radius={t.radii.pill} />
              <Skeleton width={64} height={32} radius={t.radii.pill} />
            </View>
          </View>
        </Surface>
      ))}
    </View>
  );
}

export function ProductsSkeleton() {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: t.spacing.m, overflow: 'hidden' }}>
      {[0, 1].map((i) => (
        <Surface key={i} style={{ width: 176, gap: 8 }}>
          <Skeleton height={110} radius={t.radii.m} />
          <Skeleton width="45%" height={10} />
          <Skeleton width="85%" height={14} />
          <Skeleton width="40%" height={18} />
          <Skeleton width="55%" height={10} />
        </Surface>
      ))}
    </View>
  );
}

export function GuideSkeleton() {
  const t = useTheme();
  return (
    <Surface style={{ gap: t.spacing.m }}>
      <Skeleton width="55%" height={14} />
      <Skeleton height={6} radius={t.radii.pill} />
      <Skeleton width="70%" height={16} />
      <SkeletonLines lines={3} />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Skeleton width={88} height={44} radius={t.radii.pill} />
        <Skeleton width={110} height={44} radius={t.radii.pill} />
      </View>
    </Surface>
  );
}

export function WorkoutSkeleton() {
  const t = useTheme();
  return (
    <Surface style={{ gap: t.spacing.m }}>
      <Skeleton width="50%" height={14} />
      {[0, 1].map((i) => (
        <View key={i} style={{ gap: 8 }}>
          <Skeleton width="60%" height={14} />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {[0, 1, 2].map((j) => (
              <Skeleton key={j} width={44} height={44} radius={22} />
            ))}
          </View>
        </View>
      ))}
    </Surface>
  );
}

export function StudyPlanSkeleton() {
  const t = useTheme();
  return (
    <Surface style={{ gap: t.spacing.m }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.m }}>
        <Skeleton width={48} height={48} radius={24} />
        <View style={{ flex: 1, gap: 8 }}>
          <Skeleton width="60%" height={14} />
          <Skeleton width="35%" height={10} />
        </View>
      </View>
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} height={i === 0 ? 72 : 44} radius={t.radii.m} />
      ))}
    </Surface>
  );
}

export function VocabSkeleton() {
  const t = useTheme();
  return (
    <Surface style={{ gap: t.spacing.m, alignItems: 'center' }}>
      <View style={{ flexDirection: 'row', gap: 8, alignSelf: 'stretch' }}>
        <Skeleton width={72} height={32} radius={t.radii.pill} />
        <Skeleton width={72} height={32} radius={t.radii.pill} />
      </View>
      <Skeleton height={140} radius={t.radii.l} />
      <Skeleton width="30%" height={10} />
    </Surface>
  );
}

export function MindmapSkeleton() {
  const t = useTheme();
  const dot = (left: number, top: number, w: number) => (
    <View key={`${left}-${top}`} style={{ position: 'absolute', left, top }}>
      <Skeleton width={w} height={26} radius={t.radii.pill} />
    </View>
  );
  return (
    <Surface style={{ gap: t.spacing.s }}>
      <Skeleton width="40%" height={14} />
      <View style={{ height: 180 }}>
        {dot(110, 77, 96)}
        {dot(0, 20, 72)}
        {dot(0, 77, 72)}
        {dot(0, 134, 72)}
        {dot(240, 40, 72)}
        {dot(240, 114, 72)}
      </View>
    </Surface>
  );
}

/** One `paths` row: title + badge, a centred chain of node pills, a note line. */
export function PathRowSkeleton() {
  const t = useTheme();
  return (
    <View style={{ gap: t.spacing.s, paddingVertical: t.spacing.xs }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Skeleton width="45%" height={14} />
        <Skeleton width={72} height={18} radius={t.radii.pill} />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6 }}>
        <Skeleton width={64} height={24} radius={t.radii.pill} />
        <Skeleton width={12} height={2} />
        <Skeleton width={56} height={24} radius={t.radii.pill} />
        <Skeleton width={12} height={2} />
        <Skeleton width={60} height={24} radius={t.radii.pill} />
      </View>
      <View style={{ alignItems: 'center' }}>
        <Skeleton width="60%" height={10} />
      </View>
    </View>
  );
}

export function PathsSkeleton() {
  const t = useTheme();
  return (
    <Surface style={{ gap: t.spacing.l }}>
      <Skeleton width="50%" height={14} />
      <PathRowSkeleton />
      <PathRowSkeleton />
    </Surface>
  );
}

/** One `blocks` column: centred title, a 2×2 grid of boxes, a full-width base layer. */
export function BlocksColumnSkeleton() {
  const t = useTheme();
  const box = <Skeleton width="48%" height={56} radius={t.radii.m} />;
  return (
    <View style={{ gap: t.spacing.s }}>
      <View style={{ alignItems: 'center' }}>
        <Skeleton width="35%" height={12} />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        {box}
        {box}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        {box}
        {box}
      </View>
      <Skeleton width="100%" height={40} radius={t.radii.m} />
    </View>
  );
}

export function BlocksSkeleton() {
  const t = useTheme();
  return (
    <Surface style={{ gap: t.spacing.l }}>
      <Skeleton width="50%" height={14} />
      <BlocksColumnSkeleton />
    </Surface>
  );
}

/**
 * Placeholder shaped like a node type (`checklist`, `table` …) or a router format (`diagram`,
 * `calculator`, `interactive` …); anything else → a few text lines. Used while a ```hui block has
 * started but its component can't render yet (see protocol `huiStreamView`), and by RouteSkeleton.
 */
export function NodeSkeleton({ shape }: { shape: string }) {
  const tr = useT();
  switch (shape) {
    case 'chart':
      return <ChartSkeleton />;
    case 'table':
      return <TableSkeleton />;
    case 'stats':
      return <StatsSkeleton />;
    case 'compare':
      return <CompareSkeleton />;
    case 'steps':
      return <ListSkeleton rows={3} marker="circle" />;
    case 'timeline':
    case 'list':
      return <ListSkeleton rows={3} />;
    case 'form':
    case 'calc':
      return <FormSkeleton />;
    case 'image':
    case 'gallery':
      return <ImageSkeleton />;
    case 'code':
      return <CodeSkeleton />;
    case 'card':
    case 'stack':
      return <CardSkeleton />;
    case 'buttons':
    case 'suggestions':
      return <PillsSkeleton />;
    case 'progress':
      return <ProgressSkeleton />;
    case 'choice':
      return <ChoiceSkeleton />;
    case 'checklist':
      return <ChecklistSkeleton />;
    case 'quiz':
      return <QuizSkeleton />;
    case 'flashcards':
      return <FlashcardsSkeleton />;
    case 'recipe':
      return <RecipeSkeleton />;
    case 'timer':
      return <TimerSkeleton />;
    case 'map':
      return <MapSkeleton />;
    case 'tabs':
      return <TabsSkeleton />;
    case 'accordion':
      return <AccordionSkeleton />;
    case 'sources':
      return <SourcesSkeleton />;
    case 'slots':
      return <SlotsSkeleton />;
    case 'confirm':
      return <ConfirmSkeleton />;
    case 'translation':
      return <TranslationSkeleton />;
    case 'poll':
      return <PollSkeleton />;
    case 'agenda':
      return <AgendaSkeleton />;
    case 'weather':
      return <WeatherSkeleton />;
    case 'decision':
      return <DecisionSkeleton />;
    case 'rank':
      return <RankSkeleton />;
    case 'scale':
      return <ScaleSkeleton />;
    case 'summary':
      return <SummarySkeleton />;
    case 'places':
      return <PlacesSkeleton />;
    case 'products':
      return <ProductsSkeleton />;
    case 'guide':
      return <GuideSkeleton />;
    case 'workout':
      return <WorkoutSkeleton />;
    case 'studyplan':
      return <StudyPlanSkeleton />;
    case 'vocab':
      return <VocabSkeleton />;
    case 'mindmap':
      return <MindmapSkeleton />;
    case 'paths':
      return <PathsSkeleton />;
    case 'blocks':
      return <BlocksSkeleton />;
    case 'diagram':
      return <InteractiveSkeleton icon="sparkle" label={tr('ui.skeleton.chart')} />;
    case 'calculator':
      return <InteractiveSkeleton icon="sparkle" label={tr('ui.skeleton.calculator')} />;
    case 'interactive':
      return <InteractiveSkeleton icon="sparkle" label={tr('ui.skeleton.interactive')} />;
    default:
      return <SkeletonLines lines={3} />;
  }
}

export type RouteSkeletonProps = { format: RouteFormat | (string & {}) };

/**
 * Placeholder shaped like the component the router announced (`hermes.ui.route`),
 * shown before the first content of that block has streamed in. Same shapes as the in-block
 * placeholder (NodeSkeleton), so the hand-over to the streaming block causes no layout jump.
 */
export function RouteSkeleton({ format }: RouteSkeletonProps) {
  return <NodeSkeleton shape={format} />;
}
