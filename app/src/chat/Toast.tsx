import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../ui/primitives/Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../ui';
import { toastDuration } from './toastTiming';

type ToastFn = (message: string) => void;
const ToastCtx = createContext<ToastFn>(() => {});

export function useToast(): ToastFn {
  return useContext(ToastCtx);
}

/**
 * Lightweight bottom toast ("Kopiert"). One at a time; a new toast replaces the old one.
 * Stays 4–8 s depending on the text length, pauses while hovered / touched, and is announced to
 * screen readers (iOS: announceForAccessibility; Android/web: polite live region).
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<{ text: string; n: number } | null>(null);
  const show = useCallback<ToastFn>((text) => setMsg((m) => ({ text, n: (m?.n ?? 0) + 1 })), []);
  const value = useMemo(() => show, [show]);
  return (
    <ToastCtx.Provider value={value}>
      {children}
      {msg ? <ToastView key={msg.n} text={msg.text} onDone={() => setMsg(null)} /> : null}
    </ToastCtx.Provider>
  );
}

function ToastView({ text, onDone }: { text: string; onDone: () => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const anim = useRef(new Animated.Value(0)).current;
  const native = Platform.OS !== 'web';
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const timer = useRef<{ id: ReturnType<typeof setTimeout> | null; left: number; since: number; hiding: boolean }>({ id: null, left: toastDuration(text), since: 0, hiding: false });

  const hide = useCallback(() => {
    timer.current.hiding = true;
    Animated.timing(anim, { toValue: 0, duration: 220, useNativeDriver: native }).start(({ finished }) => finished && doneRef.current());
    // an interrupted fade-out must not leave an invisible (but tappable) toast mounted
    setTimeout(() => doneRef.current(), 400);
  }, [anim, native]);
  const resume = useCallback(() => {
    const tm = timer.current;
    if (tm.hiding || tm.id) return;
    tm.since = Date.now();
    tm.id = setTimeout(hide, Math.max(tm.left, 1200));
  }, [hide]);
  const pause = useCallback(() => {
    const tm = timer.current;
    if (tm.hiding || !tm.id) return;
    clearTimeout(tm.id);
    tm.id = null;
    tm.left -= Date.now() - tm.since;
  }, []);

  useEffect(() => {
    const tm = timer.current;
    const enter = Animated.timing(anim, { toValue: 1, duration: 180, useNativeDriver: native });
    enter.start();
    resume();
    // VoiceOver ignores live regions → announce explicitly (Android/web use the live region below)
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(text);
    return () => {
      enter.stop();
      if (tm.id) clearTimeout(tm.id);
      tm.id = null;
    };
  }, [anim, native, resume, text]);

  return (
    // full-screen layout box: only the toast itself may take touches/clicks. pointerEvents as a PROP (react-native-web
    // turns an inline-style 'box-none' into invalid CSS, so the overlay swallowed every click, e.g. on the composer)
    <View style={[StyleSheet.absoluteFill, { justifyContent: 'flex-end', alignItems: 'center' }]} pointerEvents="box-none">
      <Animated.View
        accessibilityLiveRegion="polite"
        role="status"
        aria-live="polite"
        style={{
          marginBottom: insets.bottom + 96,
          marginHorizontal: 24,
          maxWidth: 520,
          opacity: anim,
          transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
        }}
      >
        <Pressable
          onHoverIn={pause}
          onHoverOut={resume}
          onPressIn={pause}
          onPressOut={resume}
          accessible={false}
          style={{
            // inverse surface from the theme (text color as background)
            backgroundColor: t.colors.text,
            paddingHorizontal: 16,
            paddingVertical: 10,
            borderRadius: t.radii.card,
            ...t.shadows.md,
          }}
        >
          <Text style={[t.typography.callout, { color: t.colors.bg, fontWeight: '500', textAlign: 'center' }]}>{text}</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}
