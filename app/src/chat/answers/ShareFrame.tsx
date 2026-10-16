/**
 * Share-as-image frame: the answer as the chat renders it – text and cards, in their current state (ticked items,
 * the chosen option: node state is read from the same store) – without chat chrome, on the theme background, at a
 * fixed width (SHARE_FRAME_WIDTH). On top, optionally, the user's question as a small bubble; at the bottom a quiet
 * footer with the wordmark. Rendered in capture mode (ui/lib/capture.tsx): no motion, rails as grids, static map
 * sketch, and images hold the capture until they are drawn (or show their fallback after the deadline).
 * Long answers keep their full height up to SHARE_MAX_BODY_HEIGHT, then fade out with a "continues in the chat" line.
 */
import { LinearGradient } from 'expo-linear-gradient';
import { forwardRef, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { brand, shareWordmark } from '../../brand';
import { FLAVOR } from '../../flavor';
import { useT } from '../../i18n';
import type { Segment } from '../../protocol/types';
import { CaptureProvider, HuiView, useCaptureBusy, useTheme, withAlpha, type CaptureTracker } from '../../ui';
import { PetasosMark } from '../../ui/primitives/PetasosMark';
import { Text } from '../../ui/primitives/Text';
import { Icon } from '../icons';
import { Markdown } from '../Markdown';
import { AnswerScope } from './AnswerScope';
import { clipBody, SHARE_FRAME_WIDTH, type SharePart } from './shareModel';

export { SHARE_FRAME_WIDTH } from './shareModel';

export type ShareFrameProps = {
  parts: readonly SharePart[];
  /** all segments of the answer (footnote targets of the answer scope) */
  segments: readonly Segment[];
  cites: number;
  /** header line; null = none */
  question: string | null;
  tracker: CaptureTracker;
  /** laid-out size of the whole frame (logical px) */
  onSize?: (width: number, height: number) => void;
};

const noop = () => {};

export const ShareFrame = forwardRef<View, ShareFrameProps>(function ShareFrame(props, ref) {
  return (
    <CaptureProvider tracker={props.tracker}>
      <FrameBody {...props} frameRef={ref} />
    </CaptureProvider>
  );
});

function FrameBody({ parts, segments, cites, question, onSize, frameRef }: ShareFrameProps & { frameRef: React.ForwardedRef<View> }) {
  const t = useTheme();
  const tr = useT();
  const [contentH, setContentH] = useState(0);
  const clip = clipBody(contentH);
  // the body has to be measured before the frame is final
  useCaptureBusy(contentH === 0);
  const onLayout = (e: LayoutChangeEvent) => onSize?.(Math.round(e.nativeEvent.layout.width), Math.ceil(e.nativeEvent.layout.height));
  return (
    <View ref={frameRef} collapsable={false} onLayout={onLayout} style={[styles.frame, { backgroundColor: t.colors.bg }]}>
      <View style={styles.body}>
        {question ? (
          <View style={[styles.question, { backgroundColor: t.colors.surfaceAlt, borderRadius: t.radii.card, borderBottomRightRadius: t.radii.inline }]}>
            <Text style={[t.typography.callout, { color: t.colors.text }]} numberOfLines={3}>
              {question}
            </Text>
          </View>
        ) : null}
        <View style={clip.clipped ? { height: clip.height, overflow: 'hidden' } : null}>
          <View onLayout={(e) => setContentH(e.nativeEvent.layout.height)} style={styles.parts}>
            <AnswerScope segments={segments} streaming={false} cites={cites}>
              {parts.map((p) =>
                p.kind === 'markdown' ? (
                  <Markdown key={p.key} text={p.text} />
                ) : p.kind === 'hui' ? (
                  <HuiView key={p.key} node={p.node} animateIn={false} onAction={noop} />
                ) : (
                  <WidgetPlaceholder key={p.key} />
                ),
              )}
            </AnswerScope>
          </View>
          {clip.clipped ? <LinearGradient pointerEvents="none" colors={[withAlpha(t.colors.bg, 0), t.colors.bg]} style={styles.fade} /> : null}
        </View>
        {clip.clipped ? (
          <Text style={[t.typography.caption, styles.more, { color: t.colors.muted }]}>{tr('chat.answers.share.continues')}</Text>
        ) : null}
      </View>
      <ShareFooter />
    </View>
  );
}

/** where a sandboxed HTML widget sits in the chat: it cannot be drawn into an image, the image says so quietly */
function WidgetPlaceholder() {
  const t = useTheme();
  const tr = useT();
  return (
    <View style={[styles.widget, { borderColor: t.colors.borderStrong, borderRadius: t.radii.control }]}>
      <Icon name="code" size={15} color={t.colors.muted} />
      <Text style={[t.typography.caption, styles.flex, { color: t.colors.muted }]}>{tr('chat.answers.share.widgetPlaceholder')}</Text>
    </View>
  );
}

/** "◖ HUI+  interactive chat for Hermes Agent ……… hermesui.xyz" – small, quiet, one line */
function ShareFooter() {
  const t = useTheme();
  const tr = useT();
  const official = FLAVOR === 'hermes';
  const site = brand().homepage?.replace(/^https?:\/\//, '').replace(/\/$/, '') ?? null;
  return (
    <View style={[styles.footer, { borderTopColor: t.colors.border }]}>
      {official ? <PetasosMark width={22} /> : <View style={[styles.dot, { backgroundColor: t.colors.accent }]} />}
      <Text style={[styles.wordmark, { color: t.colors.text }]}>{shareWordmark()}</Text>
      {official ? (
        <Text style={[styles.tagline, { color: t.colors.muted }]} numberOfLines={1}>
          {tr('chat.answers.share.tagline')}
        </Text>
      ) : null}
      <View style={styles.spacer} />
      {site ? <Text style={[styles.site, { color: t.colors.subtle }]}>{site}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { width: SHARE_FRAME_WIDTH },
  body: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 20, gap: 16 },
  question: { alignSelf: 'flex-end', maxWidth: '86%', paddingHorizontal: 13, paddingVertical: 8 },
  parts: { gap: 14 },
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 140 },
  more: { marginTop: -4 },
  footer: { marginHorizontal: 20, paddingTop: 12, paddingBottom: 16, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 7 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  wordmark: { fontSize: 13, lineHeight: 16, fontWeight: '700', letterSpacing: 0.2 },
  tagline: { fontSize: 12, lineHeight: 16, flexShrink: 1 },
  spacer: { flex: 1, minWidth: 6 },
  widget: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderStyle: 'dashed', paddingHorizontal: 14, paddingVertical: 12 },
  flex: { flex: 1, minWidth: 0 },
  site: { fontSize: 10.5, lineHeight: 14, letterSpacing: 0.3 },
});
