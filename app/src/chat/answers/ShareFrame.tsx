/**
 * A6 share-as-image frame: the answer content without chrome (no action row, tools, timestamps) on the
 * theme background with a small app wordmark. Rendered once for the capture, never while streaming.
 */
import { forwardRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Segment } from '../../protocol/types';
import { shareWordmark } from '../../brand';
import { HuiView, useTheme } from '../../ui';
import { Markdown } from '../Markdown';

export const SHARE_FRAME_WIDTH = 390;

export const ShareFrame = forwardRef<View, { segments: readonly Segment[] }>(function ShareFrame({ segments }, ref) {
  const t = useTheme();
  return (
    <View ref={ref} collapsable={false} style={[styles.frame, { backgroundColor: t.colors.bg, width: SHARE_FRAME_WIDTH }]}>
      <View style={styles.wordmark}>
        <View style={[styles.dot, { backgroundColor: t.colors.accent }]} />
        <Text style={[styles.brand, { color: t.colors.text }]}>{shareWordmark()}</Text>
      </View>
      <View style={{ gap: 14 }}>
        {segments.map((seg) =>
          seg.kind === 'markdown' ? (
            seg.text.trim() ? <Markdown key={seg.key} text={seg.text} /> : null
          ) : seg.kind === 'hui' && seg.node ? (
            <HuiView key={seg.key} node={seg.node} animateIn={false} onAction={() => {}} />
          ) : null,
        )}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  frame: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 24 },
  wordmark: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 14 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  brand: { fontSize: 13, fontWeight: '700', letterSpacing: 0.2 },
});
