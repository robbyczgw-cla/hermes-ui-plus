/**
 * Render sweep (`/gallery?fixtures=render[&only=gallery,image]`): every fixture of renderFixtures.ts rendered the way
 * the chat renders a complete ```hui block (stream parser → HuiSegment). scripts/ux-check/render-sweep.mjs opens it
 * in a browser and fails on any fixture that shows nothing visible. Each fixture's output sits in a box with
 * `testID="fx-<id>"`; its label is outside that box (it never counts as content).
 */
import { useMemo } from 'react';
import { ScrollView, View } from 'react-native';
import { useTheme } from './theme';
import { HText } from './primitives/basics';
import { createStreamParser } from '../protocol/streamParser';
import type { Segment } from '../protocol/types';
import { HuiSegment } from '../chat/MessageItem';
import { RENDER_FIXTURES } from './renderFixtures';

function parse(raw: string): Extract<Segment, { kind: 'hui' }> | null {
  const p = createStreamParser();
  p.push('```hui\n' + raw + '\n```\n');
  p.end();
  const s = p.segments().find((x) => x.kind === 'hui');
  return s && s.kind === 'hui' ? s : null;
}

const noop = () => true;

export function RenderSweep({ only }: { only?: string }) {
  const t = useTheme();
  const list = useMemo(() => {
    const keys = only?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
    const pick = keys.length ? RENDER_FIXTURES.filter((f) => keys.some((k) => f.id === k || f.type === k || f.id.startsWith(`${k}-`))) : RENDER_FIXTURES;
    return pick.map((f) => ({ f, seg: parse(f.raw) }));
  }, [only]);
  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.colors.bg }} contentContainerStyle={{ alignItems: 'center', paddingBottom: 64 }}>
      <View style={{ width: '100%', maxWidth: t.maxContentWidth, paddingHorizontal: t.spacing.l, paddingTop: t.spacing.l, gap: t.spacing.xl }}>
        {list.map(({ f, seg }) => (
          <View key={f.id} style={{ gap: t.spacing.xs }}>
            <HText variant="caption" color="subtle">
              {f.id}
            </HText>
            <View testID={`fx-${f.id}`}>{seg ? <HuiSegment seg={seg} onAction={noop} route={null} /> : null}</View>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
