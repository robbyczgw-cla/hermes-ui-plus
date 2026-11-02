import { useRef, type ReactNode } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useTheme } from '../ui';
import { lightHaptic } from './actions';
import { Icon } from './icons';

/** drag distance (px, after damping) that triggers "Antworten" */
export const SWIPE_REPLY_PX = 56;
const MAX_PX = 76;

/**
 * Swipe a message to the right to reply (phones; web and screen readers use the menu / the accessibility action).
 * The pan only starts after a clear horizontal move (24 px) and fails on a vertical one, so the list scrolls as before;
 * cards with their own swipe (flashcards, guide steps, rank) start earlier (≤ 14 px) and keep their gesture.
 */
export function SwipeReply({ onReply, children }: { onReply?: () => void; children: ReactNode }) {
  if (Platform.OS === 'web' || !onReply) return <>{children}</>;
  return <SwipeRow onReply={onReply}>{children}</SwipeRow>;
}

function SwipeRow({ onReply, children }: { onReply: () => void; children: ReactNode }) {
  const t = useTheme();
  const dx = useSharedValue(0);
  // past the threshold in the running pan: a ref, written only in the gesture callbacks (the pan runs on the JS thread;
  // a shared value set there reads back stale, the swipe then never fired)
  const armed = useRef(false);
  const pan = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetX(24)
    .failOffsetX(-16)
    .failOffsetY([-14, 14])
    .onUpdate((e) => {
      const x = Math.max(0, Math.min(MAX_PX, e.translationX * 0.55));
      dx.set(x);
      if (!armed.current && x >= SWIPE_REPLY_PX) {
        armed.current = true;
        lightHaptic();
      } else if (armed.current && x < SWIPE_REPLY_PX) armed.current = false;
    })
    .onEnd(() => {
      if (armed.current) onReply();
    })
    .onFinalize(() => {
      armed.current = false;
      dx.set(withTiming(0, { duration: 160 }));
    });
  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: dx.value }] }));
  const iconStyle = useAnimatedStyle(() => ({ opacity: Math.min(1, dx.value / SWIPE_REPLY_PX), transform: [{ scale: 0.6 + 0.4 * Math.min(1, dx.value / SWIPE_REPLY_PX) }] }));
  return (
    <GestureDetector gesture={pan}>
      <View>
        <Animated.View style={[styles.icon, { backgroundColor: t.colors.surfaceAlt }, iconStyle]} pointerEvents="none" importantForAccessibility="no-hide-descendants">
          <Icon name="reply" size={18} color={t.colors.muted} strokeWidth={2} />
        </Animated.View>
        <Animated.View style={rowStyle}>{children}</Animated.View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  icon: { position: 'absolute', left: 0, top: '50%', marginTop: -16, width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
});
