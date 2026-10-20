import { Component, createContext, memo, useContext, useMemo, type ComponentType, type ReactNode } from 'react';
import { View } from 'react-native';
import { useTheme } from './theme';
import { HuiContext, defaultActionHandler, useHui, type HuiActionHandler } from './primitives/context';
import { BlockTitle, FadeIn, InlineText, Surface } from './primitives/basics';
import { SkeletonLines } from './primitives/Skeleton';
import { NodeSkeleton } from './skeletons';
import { guessNodeType } from '../protocol/streamPlaceholder.ts';
import { emptyNodeLabel, isEmptyNode } from '../protocol/emptyNode.ts';
import { asArray, asOptString, isObject } from './lib/format';
import { Callout, Compare, Fallback, List, Progress, Stats, Steps, TextBlock, Timeline } from './components/content';
import { Table } from './components/Table';
import { Chart } from './components/Chart';
import { Buttons, CodeBlock, ImageBlock, Suggestions } from './components/media';
import { Form } from './components/Form';
import { ImageGallery } from './components/ImageGallery';
import { Thumb } from './components/imageParts';
import { UnknownNode } from './components/UnknownNode';
import type { HuiCard, HuiStack } from './types';
import { useT } from '../i18n';
import { registryA } from './components/modules/registryA';
import { registryB } from './components/modules/registryB';
import { registryC1 } from './components/modules/registryC1';
import { registryC2 } from './components/modules/registryC2';
import { registryC3 } from './components/modules/registryC3';
import { registryD1 } from './components/modules/registryD1';
import { registryD2 } from './components/modules/registryD2';
import { registryD3 } from './components/modules/registryD3';
import { registryE1 } from './components/modules/registryE1';
import { registryE2 } from './components/modules/registryE2';
import { registryPolish } from './components/registryPolish';
import { ChildRendererContext, type ChildRenderer } from './components/modules/a/shared';
import { LiveUnappliedNote } from '../live/ui/LiveNotes';

/** Module renderers (registries have disjoint keys; merge order: polish, d3, d2, d1, c3 … a). Built-in types above take precedence. */
/** Module renderers (registries have disjoint keys; a duplicate key is won by the LAST spread, i.e. a < b < c < d < polish is NOT the case – the order below is polish, d3..d1, c3..a). Built-in types above take precedence. */
const MODULES: Record<string, ComponentType<{ node: never }>> = { ...registryPolish, ...registryE2, ...registryE1, ...registryD3, ...registryD2, ...registryD1, ...registryC3, ...registryC2, ...registryC1, ...registryB, ...registryA };
const hasModule = (type: string) => Object.prototype.hasOwnProperty.call(MODULES, type);
const renderChild: ChildRenderer = (node, { key, last }) => <Child key={key} node={node} last={last} />;

export type HuiViewProps = {
  /** A HuiNode – may be partial while streaming, `null`, or even garbage; never crashes. */
  node: unknown;
  /** Action callback, see `HuiActionHandler`. Defaults to `defaultActionHandler` (copy/open_url only). */
  onAction?: HuiActionHandler;
  /** True while the enclosing ```hui block is still streaming → partial data shows skeletons. */
  streaming?: boolean;
  /** Fade/rise in on mount (default true). */
  animateIn?: boolean;
  /**
   * Router hint (`message.route.format`): shapes the placeholder while the streamed node or its
   * `type` is not known yet (top level only).
   */
  routeFormat?: string | null;
};

/** Router format for the top-level placeholder (see HuiViewProps.routeFormat). */
const RouteHintContext = createContext<string | null>(null);

/**
 * Placeholder for a streamed node whose type is missing or still partial: shaped like the unique
 * known type with that prefix ("chec" → checklist), else like the router hint (top level), else lines.
 */
function StreamingPlaceholder({ type }: { type: unknown }) {
  const route = useContext(RouteHintContext);
  const { depth } = useHui();
  const shape = guessNodeType(type, Object.keys(MODULES)) ?? (depth === 0 && route && route !== 'text' ? route : undefined);
  return shape ? <NodeSkeleton shape={shape} /> : <SkeletonLines lines={2} />;
}

/** Renders one HuiNode tree natively. */
export function HuiView({ node, onAction, streaming = false, animateIn = true, routeFormat = null }: HuiViewProps) {
  const parent = useContext(HuiContext);
  const handler = onAction ?? parent.onAction ?? defaultActionHandler;
  const ctx = useMemo(() => ({ onAction: handler, streaming, depth: 0 }), [handler, streaming]);
  const body = (
    <NodeBoundary node={node}>
      <RenderNode node={node} />
      {streaming ? null : <LiveUnappliedNote node={node} />}
    </NodeBoundary>
  );
  return (
    <HuiContext.Provider value={ctx}>
      <RouteHintContext.Provider value={routeFormat}>
        <ChildRendererContext.Provider value={renderChild}>{animateIn ? <FadeIn>{body}</FadeIn> : body}</ChildRendererContext.Provider>
      </RouteHintContext.Provider>
    </HuiContext.Provider>
  );
}

/**
 * Render a child node one level deeper (used by card/stack). While the block streams, only the
 * LAST child can still be partial – earlier siblings are complete JSON, so they render as final
 * (e.g. their image queries may resolve right away).
 */
// memo by node identity: the stream parser shares unchanged subtrees across updates (structuralShare),
// so completed siblings skip re-rendering while the block streams
const Child = memo(function Child({ node, last = true }: { node: unknown; last?: boolean }) {
  const ctx = useHui();
  const streaming = ctx.streaming && last;
  const inner = useMemo(() => ({ ...ctx, streaming, depth: ctx.depth + 1 }), [ctx, streaming]);
  return (
    <HuiContext.Provider value={inner}>
      <NodeBoundary node={node}>
        <RenderNode node={node} />
      </NodeBoundary>
    </HuiContext.Provider>
  );
});

const RenderNode = memo(function RenderNode({ node }: { node: unknown }): ReactNode {
  const { streaming } = useHui();
  if (!isObject(node) || typeof node.type !== 'string' || !node.type) {
    return streaming ? <StreamingPlaceholder type={isObject(node) ? node.type : undefined} /> : <Fallback node={node} empty={node == null} />;
  }
  const n = node as never;
  // a complete node without any of its data (`{"type":"table"}`, a poll without options …) would render nothing or an
  // empty box: one quiet line instead, the raw JSON on tap (protocol/emptyNode.ts)
  if (!streaming && isEmptyNode(node)) return <EmptyNode node={node} />;
  switch (node.type) {
    case 'card':
      return <Card node={n} />;
    case 'stack':
      return <Stack node={n} />;
    case 'text':
      return <TextBlock node={n} />;
    case 'callout':
      return <Callout node={n} />;
    case 'stats':
      return <Stats node={n} />;
    case 'table':
      return <Table node={n} />;
    case 'chart':
      return <Chart node={n} />;
    case 'list':
      return <List node={n} />;
    case 'steps':
      return <Steps node={n} />;
    case 'timeline':
      return <Timeline node={n} />;
    case 'compare':
      return <Compare node={n} />;
    case 'image':
      return <ImageBlock node={n} />;
    case 'gallery':
      return <ImageGallery node={n} />;
    case 'progress':
      return <Progress node={n} />;
    case 'code':
      return <CodeBlock node={n} />;
    case 'buttons':
      return <Buttons node={n} />;
    case 'suggestions':
      return <Suggestions node={n} />;
    case 'form':
      return <Form node={n} />;
    default: {
      if (hasModule(node.type)) {
        const Mod = MODULES[node.type];
        return <Mod node={n} />;
      }
      // while streaming the `type` string itself may still be incomplete ("cha" → "chart"); complete but unknown:
      // its content readably, the JSON only on demand
      return streaming ? <StreamingPlaceholder type={node.type} /> : <UnknownNode node={node} />;
    }
  }
});

function EmptyNode({ node }: { node: Record<string, unknown> }) {
  const tr = useT();
  const label = emptyNodeLabel(node);
  return <Fallback node={node} collapsed reason={label ? `${label}: ${tr('ui.content.noData')}` : tr('ui.content.emptyNode')} />;
}

function Card({ node }: { node: Partial<HuiCard> }) {
  const t = useTheme();
  const { depth, streaming } = useHui();
  const children = asArray(node.children);
  const imageQuery = asOptString(node.imageQuery);
  const title = asOptString(node.title);
  return (
    <Surface depth={depth}>
      {imageQuery ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.m, marginBottom: t.spacing.m }}>
          <Thumb query={imageQuery} size={56} label={title} enabled={!streaming} />
          <View style={{ flex: 1, gap: 2 }}>
            {title ? <InlineText variant="headline" text={title} /> : null}
            {asOptString(node.subtitle) ? <InlineText variant="caption" color="muted" text={asOptString(node.subtitle)!} /> : null}
          </View>
        </View>
      ) : (
        <BlockTitle title={title} subtitle={asOptString(node.subtitle)} />
      )}
      <View style={{ gap: t.spacing.l }}>
        {children.map((c, i) => (
          <Child key={keyOf(c, i)} node={c} last={i === children.length - 1} />
        ))}
        {streaming && !children.length ? <SkeletonLines lines={3} /> : null}
      </View>
    </Surface>
  );
}

function Stack({ node }: { node: Partial<HuiStack> }) {
  const t = useTheme();
  const gap = node.gap === 's' ? t.spacing.s : node.gap === 'l' ? t.spacing.xl : t.spacing.m;
  const horizontal = node.direction === 'horizontal';
  const children = asArray(node.children);
  return (
    <View style={{ gap, flexDirection: horizontal ? 'row' : 'column', flexWrap: horizontal ? 'wrap' : 'nowrap' }}>
      {children.map((c, i) => (
        <View key={keyOf(c, i)} style={horizontal ? { flexGrow: 1, flexBasis: 0, minWidth: 140 } : undefined}>
          <Child node={c} last={i === children.length - 1} />
        </View>
      ))}
    </View>
  );
}

function keyOf(c: unknown, i: number): string {
  return isObject(c) && typeof c.id === 'string' && c.id ? `${c.id}` : `i${i}`;
}

/**
 * Per-node error boundary so one malformed component never takes down the chat.
 * (Deliberate exception to "no class components": React has no hook equivalent.)
 * Resets automatically when the node changes (streaming updates).
 */
class NodeBoundary extends Component<{ node: unknown; children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  componentDidUpdate(prev: { node: unknown }) {
    if (this.state.error && prev.node !== this.props.node) this.setState({ error: false });
  }
  componentDidCatch(err: unknown) {
    // also in release builds: shows up in logcat (ReactNativeJS) for device bug reports
    console.warn('[HuiView] render error', err instanceof Error ? err.message : err);
  }
  render() {
    return this.state.error ? <Fallback node={this.props.node} renderError /> : this.props.children;
  }
}
