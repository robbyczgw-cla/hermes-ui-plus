/**
 * Before/after comparison above an edited image: both images in the same box (contain fit), the
 * "before" layer clipped at the divider. Drag anywhere to move the divider; screen readers adjust
 * it in 10 % steps. A chip toggles the comparison.
 */
import { Image } from 'expo-image';
import { useMemo, useRef, useState } from 'react';
import { PanResponder, Platform, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { useT } from '../i18n';
import { useTheme } from '../ui';

const MAX_W = 420;

export function clampFraction(v: number): number {
  return Math.min(1, Math.max(0, v));
}

export function BeforeAfter({ before, after }: { before: string; after: string }) {
  const t = useTheme();
  const tr = useT();
  const [open, setOpen] = useState(true);
  const [aspect, setAspect] = useState(1);
  return (
    <View style={{ gap: 8, maxWidth: MAX_W, marginBottom: 10 }}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={open ? tr('imageEdit.compare.hideA11y') : tr('imageEdit.compare.showA11y')}
        style={({ pressed }) => [
          styles.chip,
          { borderColor: open ? t.colors.accent : t.colors.border, backgroundColor: open ? t.colors.accentSoft : pressed ? t.colors.surfacePressed : t.colors.surfaceAlt },
        ]}
      >
        <Text style={[styles.chipText, { color: open ? t.colors.accent : t.colors.text }]}>{tr('imageEdit.compare.show')}</Text>
      </Pressable>
      {open ? (
        <Slider before={before} after={after} aspect={aspect} onAspect={setAspect} />
      ) : null}
    </View>
  );
}

function Slider({ before, after, aspect, onAspect }: { before: string; after: string; aspect: number; onAspect(a: number): void }) {
  const t = useTheme();
  const tr = useT();
  const [pos, setPos] = useState(0.5);
  const [w, setW] = useState(0);
  const live = useRef({ w: 0, startX: 0 });
  live.current.w = w;
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > Math.abs(g.dy),
        // the chat list may take over vertical drags (scrolling past the slider)
        onPanResponderTerminationRequest: () => true,
        onPanResponderGrant: (e) => {
          live.current.startX = e.nativeEvent.locationX;
          if (live.current.w > 0) setPos(clampFraction(e.nativeEvent.locationX / live.current.w));
        },
        onPanResponderMove: (_e, g) => {
          if (live.current.w > 0) setPos(clampFraction((live.current.startX + g.dx) / live.current.w));
        },
      }),
    [],
  );
  const pct = Math.round(pos * 100);
  const cut = w * pos;
  const height = w > 0 ? w / Math.min(2.4, Math.max(0.6, aspect)) : 0;
  return (
    <View
      onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}
      {...pan.panHandlers}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={tr('imageEdit.compare.sliderA11y')}
      accessibilityValue={{ min: 0, max: 100, now: pct, text: tr('imageEdit.compare.sliderValue', { value: pct }) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => setPos((p) => clampFraction(p + (e.nativeEvent.actionName === 'increment' ? 0.1 : -0.1)))}
      style={[
        styles.box,
        { height: height || 240, borderRadius: t.radii.l, borderColor: t.colors.border, backgroundColor: t.colors.surfaceAlt },
        Platform.OS === 'web' ? ({ cursor: 'ew-resize', touchAction: 'pan-y', userSelect: 'none' } as object) : null,
      ]}
    >
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Image
          source={{ uri: after }}
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          transition={150}
          onLoad={(e) => {
            if (e.source?.width > 0 && e.source?.height > 0) onAspect(e.source.width / e.source.height);
          }}
        />
      </View>
      <View pointerEvents="none" style={[styles.clip, { width: cut }]}>
        <Image source={{ uri: before }} style={{ width: w, height: height || 240 }} contentFit="contain" transition={150} />
      </View>
      <View pointerEvents="none" style={[styles.divider, { left: cut - 1 }]} />
      <View pointerEvents="none" style={[styles.knob, { left: cut - 16, top: (height || 240) / 2 - 16 }]}>
        <Text style={styles.knobText}>{'‹ ›'}</Text>
      </View>
      <Text pointerEvents="none" style={[styles.tag, { left: 8 }]}>
        {tr('imageEdit.compare.before')}
      </Text>
      <Text pointerEvents="none" style={[styles.tag, { right: 8 }]}>
        {tr('imageEdit.compare.after')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { alignSelf: 'flex-start', paddingHorizontal: 12, minHeight: 34, justifyContent: 'center', borderRadius: 999, borderWidth: StyleSheet.hairlineWidth },
  chipText: { fontSize: 13.5, fontWeight: '600' },
  box: { width: '100%', overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
  clip: { position: 'absolute', left: 0, top: 0, bottom: 0, overflow: 'hidden' },
  divider: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: '#fff' },
  knob: {
    position: 'absolute',
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.2)',
  },
  knobText: { color: '#222', fontSize: 13, fontWeight: '700', marginTop: -1 },
  tag: {
    position: 'absolute',
    bottom: 8,
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    overflow: 'hidden',
  },
});
