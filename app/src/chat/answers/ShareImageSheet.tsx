/**
 * "Share as image" sheet (answer action row + "⋯" / long-press menu): a live preview of the image (ShareFrame), the
 * question toggle, what is left out, a privacy line and the platform's actions (shareModel.ts `shareActions`):
 *   Android / iOS   Share → system share sheet
 *   browser         Download · Share (Web Share with files, where supported) · Copy (clipboard image, where supported)
 *   desktop app     Save (Downloads folder) · Copy
 * The PNG is made as soon as the frame has settled (images loaded, or their fallback after the deadline), so the
 * button press hands it on immediately (browsers only allow share / clipboard inside the tap). Nothing leaves the
 * device before the user picks an action; closing the sheet discards the image.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useT, type TKey } from '../../i18n';
import type { Segment } from '../../protocol/types';
import { Button, SheetGrabber, SheetModal, Toggle, createCaptureTracker, haptic, useSheetDialog, useTheme } from '../../ui';
import { Text } from '../../ui/primitives/Text';
import { Icon, type IconName } from '../icons';
import { useToast } from '../Toast';
import { ShareFrame } from './ShareFrame';
import { captureFrame, runShareAction, shareEnvironment, type CapturedImage, type ShareOutcome } from './shareExport';
import {
  SHARE_DEADLINE_MS,
  SHARE_FRAME_WIDTH,
  SHARE_QUIET_MS,
  planShare,
  privacyNoteKey,
  shareActions,
  shareFileName,
  shareQuestion,
  type ShareActionKind,
} from './shareModel';

/** the question toggle remembers the last choice for this app session */
let questionOn = true;

const ACTION_ICON: Record<ShareActionKind, IconName> = { share: 'share', download: 'download', save: 'download', copy: 'copy' };

const DONE_TOAST: Partial<Record<ShareOutcome, TKey>> = {
  downloaded: 'chat.answers.share.downloaded',
  saved: 'chat.answers.share.saved',
  copied: 'chat.answers.share.copied',
  unavailable: 'chat.answers.share.unavailable',
  failed: 'chat.answers.share.actionFailed',
};

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

export function ShareImageSheet({
  segments,
  cites = 0,
  question,
  onDone,
}: {
  segments: readonly Segment[];
  /** highest `[n]` citation of the answer (footnote pills) */
  cites?: number;
  /** the user message this answer replies to (display text); null = none */
  question: string | null;
  onDone(): void;
}) {
  const t = useTheme();
  const tr = useT();
  const toast = useToast();
  const dialog = useSheetDialog();
  const { width: winW, height: winH } = useWindowDimensions();
  const plan = useMemo(() => planShare(segments), [segments]);
  const q = useMemo(() => shareQuestion(question), [question]);
  const env = useMemo(() => shareEnvironment(), []);
  const actions = shareActions(env);
  const [fileName] = useState(() => shareFileName(new Date()));
  const [withQuestion, setWithQuestion] = useState(questionOn);
  const tracker = useMemo(() => createCaptureTracker({ quietMs: SHARE_QUIET_MS, deadlineMs: SHARE_DEADLINE_MS }), []);
  const frame = useRef<View>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [shot, setShot] = useState<{ key: string; img: CapturedImage } | null>(null);
  const shotRef = useRef<CapturedImage | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [running, setRunning] = useState<ShareActionKind | null>(null);
  const showQuestion = withQuestion && !!q;
  const key = `${showQuestion ? 1 : 0}|${size?.width ?? 0}x${size?.height ?? 0}|${attempt}`;
  const ready = !!shot && shot.key === key;

  // the image: once the frame has settled, and again whenever it changes (question toggled, layout moved)
  useEffect(() => {
    if (!size || plan.empty) return;
    let alive = true;
    (async () => {
      await tracker.whenSettled();
      // the last fallback / layout change paints first
      await nextFrame();
      await nextFrame();
      if (!alive || !frame.current) return;
      try {
        const img = await captureFrame(frame.current, size, t.colors.bg, fileName);
        if (!alive) {
          img.release();
          return;
        }
        shotRef.current?.release();
        shotRef.current = img;
        setShot({ key, img });
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(
    () => () => {
      tracker.dispose();
      shotRef.current?.release();
      shotRef.current = null;
    },
    [tracker],
  );

  const toggleQuestion = (on: boolean) => {
    questionOn = on;
    setWithQuestion(on);
  };

  const run = (kind: ShareActionKind) => {
    if (!shot || !ready || running) return;
    haptic('light');
    // straight from the tap: browsers refuse share / clipboard after an await
    const p = runShareAction(kind, shot.img, { fileName, title: tr('chat.answers.share.dialogTitle') });
    setRunning(kind);
    p.catch((): ShareOutcome => 'failed').then((outcome) => {
      setRunning(null);
      const msg = DONE_TOAST[outcome];
      if (msg) toast(tr(msg));
      if (outcome !== 'cancelled' && outcome !== 'failed' && outcome !== 'unavailable') onDone();
    });
  };

  // preview: the real frame, scaled to the sheet
  const sheetW = Math.min(dialog ? 640 : winW, 640);
  const scale = Math.min(1, (sheetW - 40) / SHARE_FRAME_WIDTH);
  const previewH = size ? Math.round(size.height * scale) : 0;
  const busy = !plan.empty && !failed && !ready;

  return (
    <SheetModal visible onClose={running ? undefined : onDone} closeLabel={tr('actions.close')} label={tr('chat.answers.share.title')} maxHeight="94%">
      <SheetGrabber />
      <View style={styles.head}>
        <Text style={[t.typography.headline, { color: t.colors.text }]} accessibilityRole="header">
          {tr('chat.answers.share.title')}
        </Text>
      </View>
      {plan.empty ? (
        <View style={styles.pad}>
          <Note icon="image" text={tr('chat.answers.share.nothing')} />
        </View>
      ) : (
        <ScrollView style={{ maxHeight: Math.round(winH * (dialog ? 0.56 : 0.5)) }} contentContainerStyle={styles.previewScroll} showsVerticalScrollIndicator={false}>
          <View
            style={[styles.preview, { width: Math.round(SHARE_FRAME_WIDTH * scale), height: previewH || 220, borderColor: t.colors.border, borderRadius: t.radii.control, backgroundColor: t.colors.bg }]}
            accessible
            accessibilityRole="image"
            accessibilityLabel={tr('chat.answers.share.previewA11y')}
          >
            <View pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={{ width: SHARE_FRAME_WIDTH, transform: [{ scale }], transformOrigin: 'top left', opacity: size ? 1 : 0 }}>
              <ShareFrame
                ref={frame}
                parts={plan.parts}
                segments={segments}
                cites={cites}
                question={showQuestion ? q : null}
                tracker={tracker}
                onSize={(width, height) => setSize((s) => (s && s.width === width && s.height === height ? s : { width, height }))}
              />
            </View>
            {size ? null : (
              <View style={[StyleSheet.absoluteFill, styles.center]}>
                <ActivityIndicator color={t.colors.muted} />
              </View>
            )}
          </View>
        </ScrollView>
      )}
      <View style={[styles.pad, styles.controls]}>
        {q && !plan.empty ? (
          <View style={styles.toggleRow}>
            <Text style={[t.typography.body, styles.flex, { color: t.colors.text }]}>{tr('chat.answers.share.question')}</Text>
            <Toggle value={withQuestion} onValueChange={toggleQuestion} accessibilityLabel={tr('chat.answers.share.question')} />
          </View>
        ) : null}
        {plan.widgets > 0 && !plan.empty ? <Note icon="code" text={tr('chat.answers.share.widgetsLeftOut', { count: plan.widgets })} /> : null}
        {plan.empty ? null : <Note icon="lock" text={tr(`chat.answers.share.${privacyNoteKey(env)}`)} />}
        {failed ? (
          <View style={styles.actions}>
            <Text style={[t.typography.callout, styles.flex, { color: t.colors.danger }]} accessibilityRole="alert">
              {tr('chat.answers.share.failed')}
            </Text>
            <Button
              label={tr('chat.answers.share.retry')}
              size="small"
              onPress={() => {
                setFailed(false);
                setAttempt((a) => a + 1);
              }}
            />
          </View>
        ) : (
          <View style={styles.actions}>
            {busy ? (
              <View style={[styles.flex, styles.busyRow]} accessibilityLiveRegion="polite">
                <ActivityIndicator size="small" color={t.colors.muted} />
                <Text style={[t.typography.caption, { color: t.colors.muted }]}>{tr('chat.answers.share.busy')}</Text>
              </View>
            ) : (
              <View style={styles.flex} />
            )}
            {plan.empty ? (
              <Button label={tr('actions.close')} onPress={onDone} />
            ) : (
              actions.map((kind, i) => {
                const primary = i === actions.length - 1;
                return (
                  <Button
                    key={kind}
                    label={tr(`chat.answers.share.action.${kind}`)}
                    variant={primary ? 'primary' : 'secondary'}
                    icon={(color, s) => <Icon name={ACTION_ICON[kind]} size={s} color={color} />}
                    disabled={!ready || (!!running && running !== kind)}
                    loading={running === kind}
                    onPress={() => run(kind)}
                    accessibilityHint={tr(`chat.answers.share.hint.${kind}`)}
                    testID={`share-image-${kind}`}
                  />
                );
              })
            )}
          </View>
        )}
      </View>
    </SheetModal>
  );
}

function Note({ icon, text }: { icon: IconName; text: string }) {
  const t = useTheme();
  return (
    <View style={styles.note}>
      <Icon name={icon} size={14} color={t.colors.muted} />
      <Text style={[t.typography.caption, styles.flex, { color: t.colors.muted }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { paddingHorizontal: 20, paddingBottom: 12 },
  pad: { paddingHorizontal: 20 },
  previewScroll: { alignItems: 'center', paddingHorizontal: 20, paddingBottom: 4 },
  preview: { overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
  center: { alignItems: 'center', justifyContent: 'center' },
  controls: { gap: 12, paddingTop: 14 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  flex: { flex: 1, minWidth: 0 },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', paddingTop: 2 },
  busyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
