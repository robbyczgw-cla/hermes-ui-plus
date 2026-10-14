// <HtmlBlock html complete onAction theme? /> — renders a model-generated ```hui-html fragment
// in an isolated WebView (iframe on web), progressively while it streams.
//
// Flow: the frame loads a static shell document once (shell.ts). Each streamed update is
// sanitized/closed (partialHtml.ts) and pushed in (throttled) where idiomorph morphs it into
// the live DOM — no reloads, no flashing. When `complete` turns true the final markup is
// morphed once more and the extracted <script>s run exactly once. The shell reports its
// content height (ResizeObserver) and the block animates to it, capped at `maxHeight`.
//
// Architecture follows OpenIntelligentUI's Open Generative UI renderer (MIT, (c) Atai Barkai /
// CopilotKit, refs/OpenIntelligentUI …/open-generative-ui/renderer.tsx), adapted to a single
// long-lived WebView instead of separate preview/final iframes.
import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  FadeOut,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useT } from '../i18n';
import { useSettledAfter } from '../ui/lib/useSettledAfter';
import type { Theme } from '../ui';
import { createActionGate } from './actionGate';
import type { HtmlFrameHandle, TouchPhase } from './frameTypes';
import { HtmlFrame } from './HtmlFrame';
import { IDIOMORPH_JS } from './idiomorph';
import { parseSandboxMessage, type HtmlBlockAction } from './messages';
import { hasVisibleContent, processHtml } from './partialHtml';
import { buildShellDocument, shellLabels } from './shell';
import { useSandboxTheme, type HtmlBlockTheme } from './theme';

/** Min. spacing of streamed DOM updates pushed into the frame (final update is immediate). */
export const STREAM_THROTTLE_MS = 100;

export type HtmlBlockProps = {
  /** Raw fragment as streamed so far (```hui-html block body). */
  html: string;
  /** True once the block's closing fence arrived. Scripts run only then (once). */
  complete: boolean;
  /** Widget actions (window.hermes.send / copy / openUrl), already validated and gesture-gated.
   *  Without a handler, copy/open_url fall back to clipboard / Linking, send is ignored. */
  onAction?: (action: HtmlBlockAction) => void;
  /** App theme or forced scheme; default: `useTheme()` from ../ui. */
  theme?: HtmlBlockTheme;
  /** Height cap; taller content scrolls inside the block. */
  maxHeight?: number;
  /** Height of the loading shimmer before the first paint. */
  placeholderHeight?: number;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};

type Sent = { body: string; css: string; final: boolean; html: string };

/** Web: how long an action may wait for the shell's port tap that arrives after it. */
const WEB_TAP_WAIT_MS = 500;

/** Streamed content lower than this (px) is treated as "nothing visible yet" → shimmer stays. */
const MIN_STREAM_VISIBLE_HEIGHT = 40;

export function HtmlBlock({
  html,
  complete,
  onAction,
  theme: themeInput,
  maxHeight = 640,
  placeholderHeight = 160,
  style,
  accessibilityLabel,
}: HtmlBlockProps) {
  const tr = useT();
  const { theme, scheme, css: themeCss } = useSandboxTheme(themeInput);

  const [generation, setGeneration] = useState(0);
  const [ready, setReady] = useState(false);
  const [painted, setPainted] = useState(false);
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const frameRef = useRef<HtmlFrameHandle>(null);
  const readyRef = useRef(false);
  const sentRef = useRef<Sent | null>(null);
  const sentThemeRef = useRef('');
  const lastPushRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = useRef({ complete, html });
  latestRef.current = { complete, html };
  const onActionRef = useRef(onAction);
  onActionRef.current = onAction;

  // Shell document: built once per generation with the theme of that moment. Later theme
  // changes are pushed as messages — changing the source would reload the WebView.
  const shellRef = useRef<{ generation: number; html: string } | null>(null);
  if (!shellRef.current || shellRef.current.generation !== generation) {
    shellRef.current = {
      generation,
      html: buildShellDocument({ themeCss, scheme, idiomorphJs: IDIOMORPH_JS, opaqueBackground: Platform.OS === 'web', labels: shellLabels(tr) }),
    };
    sentThemeRef.current = themeCss;
  }
  const gate = useMemo(() => createActionGate(), [generation]); // eslint-disable-line react-hooks/exhaustive-deps

  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  const flush = useCallback(() => {
    timerRef.current = null;
    const frame = frameRef.current;
    if (!frame || !readyRef.current) return;
    const { complete: final, html: raw } = latestRef.current;
    const s = sentRef.current;
    if (s?.final) return;
    if (s && s.html === raw && s.final === final) return;
    // Sanitize only the update that can reach the frame, after the readiness / throttle checks.
    // Doing this in render rescans the whole growing fragment for every token, including updates
    // superseded before the 100 ms flush and content received while the WebView is still loading.
    const p = processHtml(raw, final);
    if (s && s.body === p.body && s.css === p.css && s.final === final) return;
    if (!final && !s && !hasVisibleContent(p) && !p.css) return; // nothing to show yet
    frame.post({ t: 'render', body: p.body, css: p.css, final, scripts: final ? p.scripts : [] });
    sentRef.current = { body: p.body, css: p.css, final, html: raw };
    lastPushRef.current = Date.now();
  }, []);

  const reload = useCallback(() => {
    clearTimer();
    sentRef.current = null;
    readyRef.current = false;
    setReady(false);
    setPainted(false);
    setError(null);
    setGeneration((g) => g + 1);
  }, []);

  // Push streamed content (throttled) / final content (immediately).
  useEffect(() => {
    if (!ready) return;
    const s = sentRef.current;
    if (s?.final) {
      // Final content already rendered + scripts ran: a different block body means a regenerated
      // answer -> start over with a fresh document.
      if (s.html !== html || !complete) reload();
      return;
    }
    if (complete) {
      clearTimer();
      flush();
      return;
    }
    const wait = STREAM_THROTTLE_MS - (Date.now() - lastPushRef.current);
    if (wait <= 0) {
      clearTimer();
      flush();
    } else if (!timerRef.current) {
      timerRef.current = setTimeout(flush, wait);
    }
  }, [complete, html, ready, flush, reload]);

  useEffect(() => clearTimer, []);

  // Live theme switch without reload.
  useEffect(() => {
    if (!ready || sentThemeRef.current === themeCss) return;
    frameRef.current?.post({ t: 'theme', css: themeCss, scheme });
    sentThemeRef.current = themeCss;
  }, [ready, themeCss, scheme]);

  const markReady = useCallback(() => {
    if (readyRef.current) return;
    readyRef.current = true;
    setReady(true);
  }, []);

  // An action that arrives while the finger is still down waits for the touch end (see actionGate.ts). Web: an
  // action without a known tap waits briefly for the shell's port tap (port and window messages aren't ordered).
  const pendingRef = useRef<{ action: HtmlBlockAction; at: number } | null>(null);
  const handleAction = useCallback(
    (action: HtmlBlockAction) => {
      const verdict = gate.check(action, Date.now());
      if (!verdict.ok) {
        if (verdict.reason === 'pending' || (verdict.reason === 'no_gesture' && Platform.OS === 'web')) {
          pendingRef.current = { action, at: Date.now() };
        }
        else if (__DEV__) console.warn(`[HtmlBlock] action ${action.type} blocked: ${verdict.reason}`);
        return;
      }
      const handler = onActionRef.current;
      if (handler) return handler(action);
      if (action.type === 'copy') void Clipboard.setStringAsync(action.text);
      else if (action.type === 'open_url') void Linking.openURL(action.url).catch(() => {});
      else if (__DEV__) console.warn('[HtmlBlock] send ignored: no onAction handler');
    },
    [gate],
  );

  const onMessage = useCallback(
    (raw: unknown) => {
      const msg = parseSandboxMessage(raw);
      if (!msg) return;
      switch (msg.t) {
        case 'ready':
          markReady();
          break;
        case 'height':
          setContentHeight(msg.h);
          break;
        case 'paint':
        case 'done':
          setPainted(true);
          break;
        case 'error':
          setError((prev) => prev ?? msg.message);
          break;
        case 'action':
          handleAction(msg.action);
          break;
      }
    },
    [markReady, handleAction],
  );

  const onCrash = useCallback((reason: string) => {
    readyRef.current = false;
    setError(reason);
  }, []);

  const onTouch = useCallback(
    (phase: TouchPhase, x: number, y: number) => {
      const now = Date.now();
      if (phase === 'start') gate.touchStart(x, y, now);
      else if (phase === 'move') gate.touchMove(x, y);
      else if (phase === 'cancel') gate.touchCancel();
      else {
        gate.touchEnd(x, y, now);
        const p = pendingRef.current;
        pendingRef.current = null;
        if (p && now - p.at < 1_500) handleAction(p.action); // re-check now that the tap is known
      }
    },
    [gate, handleAction],
  );
  const onTap = useCallback(
    () => {
      const now = Date.now();
      gate.noteFrameTap(now);
      const p = pendingRef.current;
      pendingRef.current = null;
      if (p && now - p.at < WEB_TAP_WAIT_MS) handleAction(p.action);
    },
    [gate, handleAction],
  );

  // ---------------------------------------------------------------- height
  const capped = contentHeight != null && contentHeight > maxHeight;
  // While streaming, the first paint is often visually empty: a wrapper <div> whose <style> or
  // children haven't arrived yet (a few px high). Keep the shimmer (and its height) until there is
  // something worth showing, otherwise the block collapses to an empty strip ("white area").
  const shown = painted && contentHeight != null && (complete || contentHeight >= MIN_STREAM_VISIBLE_HEIGHT);
  const target = shown ? Math.max(1, Math.min(contentHeight, maxHeight)) : placeholderHeight;
  const reducedMotion = useReducedMotion();
  const height = useSharedValue(placeholderHeight);
  useEffect(() => {
    height.value = reducedMotion ? target : withTiming(target, { duration: 180, easing: Easing.out(Easing.cubic) });
  }, [target, reducedMotion, height]);
  const heightStyle = useAnimatedStyle(() => ({ height: height.value }));
  // settled: React owns the current height (a dropped animated value would clip the frame back to the
  // placeholder height while the content is already taller)
  const heightSettled = useSettledAfter(reducedMotion ? 0 : 240, [target, reducedMotion]);

  const c = theme.colors;
  return (
    <View style={[styles.root, style]}>
      <Animated.View style={[styles.frame, heightStyle, heightSettled ? { height: target } : null]}>
        <HtmlFrame
          key={generation}
          ref={frameRef}
          shellHtml={shellRef.current.html}
          scheme={scheme}
          scrollEnabled={capped}
          onMessage={onMessage}
          onLoaded={markReady}
          onCrash={onCrash}
          onTouch={onTouch}
          onTap={onTap}
          accessibilityLabel={accessibilityLabel ?? tr('sandbox.block.a11y')}
        />
        {!shown && <LoadingShimmer theme={theme} label={complete ? tr('sandbox.block.loading') : tr('sandbox.block.creating')} />}
      </Animated.View>
      {error != null && (
        <View style={[styles.error, { backgroundColor: c.dangerSoft, borderColor: c.border, borderRadius: theme.radii.s }]} accessibilityRole="alert">
          <View style={styles.errorText}>
            <Text style={[theme.typography.caption, { color: c.danger, fontWeight: '600' }]}>{tr('sandbox.block.errorTitle')}</Text>
            <Text style={[theme.typography.caption, { color: c.muted }]} numberOfLines={2}>
              {error || tr('sandbox.error.unknown')}
            </Text>
          </View>
          <Pressable
            onPress={reload}
            accessibilityRole="button"
            accessibilityLabel={tr('sandbox.block.reloadA11y')}
            hitSlop={8}
            style={({ pressed }) => [styles.reload, { borderColor: c.borderStrong, borderRadius: theme.radii.s, opacity: pressed ? 0.6 : 1 }]}
          >
            <Text style={[theme.typography.caption, { color: c.text, fontWeight: '600' }]}>{tr('sandbox.block.reload')}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function LoadingShimmer({ theme, label }: { theme: Theme; label: string }) {
  const reduced = useReducedMotion();
  const pulse = useSharedValue(0.55);
  useEffect(() => {
    if (reduced) return;
    pulse.value = withRepeat(withTiming(1, { duration: 750, easing: Easing.inOut(Easing.quad) }), -1, true);
    return () => cancelAnimation(pulse);
  }, [reduced, pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));
  const c = theme.colors;
  return (
    <Animated.View
      exiting={FadeOut.duration(200)}
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, styles.shimmer, { backgroundColor: c.surfaceAlt, borderColor: c.border, borderRadius: theme.radii.m }]}
      accessibilityLabel={label}
    >
      <Animated.View style={[styles.shimmerBars, pulseStyle]}>
        <View style={[styles.bar, { width: '45%', height: 14, backgroundColor: c.skeleton }]} />
        <View style={[styles.bar, { width: '100%', backgroundColor: c.skeleton }]} />
        <View style={[styles.bar, { width: '82%', backgroundColor: c.skeleton }]} />
      </Animated.View>
      <Text style={[theme.typography.micro, { color: c.subtle }]}>{label}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { width: '100%' },
  frame: { width: '100%', overflow: 'hidden' },
  shimmer: { padding: 14, justifyContent: 'space-between', borderWidth: StyleSheet.hairlineWidth },
  shimmerBars: { gap: 10 },
  bar: { height: 10, borderRadius: 5 },
  error: {
    marginTop: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  errorText: { flex: 1, gap: 2 },
  reload: { paddingVertical: 6, paddingHorizontal: 10, borderWidth: StyleSheet.hairlineWidth },
});
