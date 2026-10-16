import { useRef, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { withAlpha } from '../color';
import { useTheme } from '../theme';
import { PressableScale } from '../primitives/basics';
import { Icon } from '../primitives/Icon';
import { scrollEdges, type ScrollEdges } from '../lib/tableMath';
import { useCaptureMode } from '../lib/capture';

/**
 * Horizontal scroller that shows when content is cut: while there is more to the right, a 24 px fade into
 * `fadeColor` (the background behind the content) plus a small "→" that scrolls on; once scrolled, a soft shadow on
 * the left edge. Same edge logic as the card table (Table.tsx B5); used by Markdown tables and unwrapped code blocks.
 */
export function EdgeScroll({
  children,
  fadeColor,
  hintLabel,
  hintTop = 8,
  contentContainerStyle,
}: {
  children: ReactNode;
  fadeColor: string;
  hintLabel: string;
  hintTop?: number;
  /** e.g. `{ flexGrow: 1 }` so full-width rows (diff lines) span at least the viewport */
  contentContainerStyle?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  // share-as-image: the fade stays (the line goes on), the "→" button does not
  const capture = useCaptureMode();
  const [viewport, setViewport] = useState(0);
  const [contentW, setContentW] = useState(0);
  // only the edge booleans live in state: a scroll event re-renders when an edge appears/disappears
  const [edges, setEdges] = useState<ScrollEdges>({ scrolled: false, atEnd: false });
  const scrollX = useRef(0);
  const ref = useRef<ScrollView>(null);
  const overflowRight = viewport > 0 && contentW > viewport + 2 && !edges.atEnd;
  return (
    <View onLayout={(e) => setViewport(Math.round(e.nativeEvent.layout.width))}>
      <ScrollView
        ref={ref}
        horizontal
        showsHorizontalScrollIndicator={false}
        bounces={false}
        scrollEventThrottle={32}
        onScroll={(e) => {
          scrollX.current = e.nativeEvent.contentOffset.x;
          const next = scrollEdges(scrollX.current, viewport, contentW);
          setEdges((p) => (p.scrolled === next.scrolled && p.atEnd === next.atEnd ? p : next));
        }}
        onContentSizeChange={(w) => setContentW(w)}
        contentContainerStyle={contentContainerStyle}
        nestedScrollEnabled
      >
        {children}
      </ScrollView>
      {overflowRight ? (
        // the fade lets touches through; the "→" scrolls right (until the user scrolled once)
        <View pointerEvents="box-none" style={styles.edgeRight}>
          <LinearGradient pointerEvents="none" colors={[withAlpha(fadeColor, 0), fadeColor]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
          {!edges.scrolled && !capture ? (
            <PressableScale
              haptic="light"
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={hintLabel}
              onPress={() => ref.current?.scrollTo({ x: Math.min(contentW - viewport, scrollX.current + viewport * 0.8), animated: true })}
              style={[styles.hint, { marginTop: hintTop, backgroundColor: t.colors.surfaceAlt, borderColor: t.colors.border }]}
            >
              <Icon name="arrowRight" size={12} color={t.colors.muted} strokeWidth={2.25} />
            </PressableScale>
          ) : null}
        </View>
      ) : null}
      {edges.scrolled ? (
        <LinearGradient
          pointerEvents="none"
          colors={[t.dark ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.10)', 'rgba(0,0,0,0)']}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={styles.edgeLeft}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  edgeRight: { position: 'absolute', right: 0, top: 0, bottom: 0, width: 24, alignItems: 'flex-end', justifyContent: 'flex-start' },
  hint: { marginRight: 2, width: 20, height: 20, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  edgeLeft: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 10 },
});
