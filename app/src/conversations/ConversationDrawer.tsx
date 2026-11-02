/* eslint-disable react-hooks/immutability -- reanimated shared values are mutated by design */
/**
 * ConversationDrawer – left slide-in panel over the chat (no extra navigation dependency).
 * Mount it as the LAST child of the chat screen's root View so it overlays everything:
 *
 *   <ConversationDrawer open={open} onClose={() => setOpen(false)} activeId={id} onSelect={…} onNewChat={…} />
 *
 * Tap on the scrim, swipe left or Esc (web) closes it. Width = min(320, 86 % of the screen) -> fine at 360 px.
 */
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useTitlebarInset } from '../desktop/chrome';
import { useT } from '../i18n';
import { useTheme } from '../ui';
import { useEscapeToClose } from '../ui/lib/useEscapeToClose';
import { useSettledAfter } from '../ui/lib/useSettledAfter';
import { webOverlayPanel } from '../ui/lib/webStyle';
import { ConversationList, type ConversationListProps } from './ConversationList';

export type ConversationDrawerProps = ConversationListProps & {
  open: boolean;
  onClose: () => void;
};

export function ConversationDrawer({ open, onClose, onSelect, onNewChat, ...rest }: ConversationDrawerProps) {
  const t = useTheme();
  const titlebarInset = useTitlebarInset();
  const tr = useT();
  const { width: screenW } = useWindowDimensions();
  const width = Math.min(320, Math.round(screenW * 0.86));
  const progress = useSharedValue(0); // 0 closed .. 1 open
  const [mounted, setMounted] = useState(open);

  // mount on open during render (allowed pattern); unmount after the close animation
  if (open && !mounted) setMounted(true);

  useEffect(() => {
    if (open) {
      progress.value = withTiming(1, { duration: 240, easing: Easing.out(Easing.cubic) });
    } else {
      progress.value = withTiming(0, { duration: 200, easing: Easing.in(Easing.cubic) }, (done) => {
        if (done) runOnJS(setMounted)(false);
      });
    }
  }, [open, progress]);
  // the close animation's callback may not run (web tab in the background, interrupted animation):
  // unmount anyway, so the invisible scrim can never sit over the chat
  useEffect(() => {
    if (open || !mounted) return;
    const id = setTimeout(() => setMounted(false), 400);
    return () => clearTimeout(id);
  }, [open, mounted]);
  useEscapeToClose(open, onClose); // web: Esc closes the drawer
  // iOS Safari (home-screen app): the tap that picked a chat closes the drawer on touchend, and the browser's
  // synthesized click for the same tap follows ~300 ms later. A layer that stopped catching taps lets that click land on
  // whatever is under the finger now: the chat behind (its header's "new chat", a starter card) or another row of the
  // sliding panel → the wrong chat. A transparent shield over the closing drawer swallows it.
  const [shield, setShield] = useState(false);
  const wasOpen = useRef(open);
  useEffect(() => {
    const closing = wasOpen.current && !open;
    wasOpen.current = open;
    if (!closing) return;
    setShield(true);
    const id = setTimeout(() => setShield(false), GHOST_CLICK_MS);
    return () => clearTimeout(id);
  }, [open]);

  // fully open: React owns the end state (ui/lib/fadeIn.ts), so a dropped animated value cannot slide
  // the open panel back off-screen on the next list render; a swipe clears it before it takes over
  const [panning, setPanning] = useState(false);
  const settledOpen = useSettledAfter(300, [open]) && open && !panning;

  const panelStyle = useAnimatedStyle(() => ({ transform: [{ translateX: (progress.value - 1) * width }] }));
  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.value }));

  // `panning` only for a real swipe (onStart = after activeOffsetX), never on touch-down: a plain tap on a row must not
  // drop the settled-open override – with a dropped animated value the panel jumped off-screen for the tap (the flash
  // when switching chats on iOS) and the release landed on the chat behind it
  const pan = Gesture.Pan()
    .onStart(() => {
      runOnJS(setPanning)(true);
    })
    .onFinalize(() => {
      runOnJS(setPanning)(false);
    })
    .activeOffsetX(-12)
    .failOffsetY([-14, 14])
    .onUpdate((e) => {
      progress.value = Math.max(0, Math.min(1, 1 + e.translationX / width));
    })
    .onEnd((e) => {
      if (progress.value < 0.65 || e.velocityX < -600) runOnJS(onClose)();
      else progress.value = withTiming(1, { duration: 160 });
    });

  // unmounted after the close animation, the shield alone still catches the late click
  if (!mounted) return shield ? <View style={[StyleSheet.absoluteFill, styles.layer]} testID="drawer-ghost-shield" /> : null;

  return (
    // closing: never catch clicks/taps any more (the scrim fades out over the chat)
    // above the chat header and its banners (DEMO, offline): on Android a raised sibling would otherwise draw over
    // the drawer and cover its top buttons ("Neuer Chat", "Auswählen")
    <Animated.View style={[StyleSheet.absoluteFill, styles.layer]} pointerEvents={open ? 'box-none' : shield ? 'auto' : 'none'}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: t.colors.overlay }, scrimStyle, settledOpen ? { opacity: 1 } : null]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel={tr('conversations.drawer.close')} />
      </Animated.View>
      <GestureDetector gesture={pan}>
        <Animated.View
          style={[styles.panel, { width, backgroundColor: t.colors.bg, borderRightColor: t.colors.border }, t.shadows.lg, panelStyle, settledOpen ? { transform: [{ translateX: 0 }] } : null]}
          accessibilityViewIsModal
          accessibilityLabel={tr('conversations.sidebar.title')}
          {...webOverlayPanel}
        >
          {/* macOS app: room for the traffic lights above the search field */}
          {titlebarInset > 0 ? <View style={styles.titlebar} /> : null}
          <ConversationList {...rest} onSelect={onSelect} onNewChat={onNewChat} />
        </Animated.View>
      </GestureDetector>
      {/* last child: above scrim and panel while the drawer closes (ghost click, see `shield`) */}
      {shield && !open ? <View style={StyleSheet.absoluteFill} testID="drawer-ghost-shield" /> : null}
    </Animated.View>
  );
}

/** iOS delivers the synthesized click up to ~300 ms after touchend (plus a little slack) */
const GHOST_CLICK_MS = 450;

const styles = StyleSheet.create({
  layer: { zIndex: 20, elevation: 20 },
  panel: { position: 'absolute', top: 0, bottom: 0, left: 0, borderRightWidth: StyleSheet.hairlineWidth },
  titlebar: { height: 40 },
});
