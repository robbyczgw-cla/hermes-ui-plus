/**
 * A6 "Als Bild teilen" (native): renders the answer into a clean frame (ShareFrame) inside a preview
 * sheet, captures it with react-native-view-shot and opens the system share sheet (expo-sharing).
 */
import * as Sharing from 'expo-sharing';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { captureRef, releaseCapture } from 'react-native-view-shot';
import { useT } from '../../i18n';
import type { Segment } from '../../protocol/types';
import { haptic, useTheme } from '../../ui';
import { useToast } from '../Toast';
import { AnswerIcon } from './answerIcons';
import { ShareFrame } from './ShareFrame';

export const SHARE_IMAGE_SUPPORTED = true;

export function ShareImageButton({ segments }: { segments: readonly Segment[] }) {
  const t = useTheme();
  const tr = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        onPress={() => {
          haptic('light');
          setOpen(true);
        }}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={tr('chat.answers.share.button')}
        style={({ pressed }) => [styles.iconBtn, pressed && { backgroundColor: t.colors.surfacePressed }]}
      >
        <AnswerIcon name="image" size={17} color={t.colors.muted} />
      </Pressable>
      {open ? <ShareImageSheet segments={segments} onDone={() => setOpen(false)} /> : null}
    </>
  );
}

/** the capture + share flow on its own (answer menu "Als Bild teilen"); calls onDone when finished */
export function ShareImageSheet({ segments, onDone }: { segments: readonly Segment[]; onDone(): void }) {
  const t = useTheme();
  const tr = useT();
  const toast = useToast();
  const frame = useRef<View>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!ready) return;
    let alive = true;
    let uri: string | null = null;
    // two frames: images/SVG inside the frame finish their first draw
    const id = setTimeout(async () => {
      try {
        if (!frame.current) throw new Error('no frame');
        uri = await captureRef(frame, { format: 'png', quality: 1, result: 'tmpfile', ...(Platform.OS === 'ios' ? { useRenderInContext: true } : {}) });
        if (!alive) return;
        if (!(await Sharing.isAvailableAsync())) {
          toast(tr('chat.answers.share.unavailable'));
        } else {
          await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: tr('chat.answers.share.dialogTitle') });
        }
      } catch {
        if (alive) toast(tr('chat.answers.share.failed'));
      } finally {
        if (uri) releaseCapture(uri);
        if (alive) onDone();
      }
    }, 120);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onDone} statusBarTranslucent>
      <View style={[styles.scrim, { backgroundColor: t.colors.overlay }]}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={[styles.preview, { borderColor: t.colors.border }]} onLayout={() => setReady(true)}>
            <ShareFrame ref={frame} segments={segments} />
          </View>
        </ScrollView>
        <View style={[styles.busy, { backgroundColor: t.colors.surface }]} accessibilityLiveRegion="polite">
          <ActivityIndicator size="small" color={t.colors.accent} />
          <Text style={{ color: t.colors.text, fontSize: 14 }}>{tr('chat.answers.share.busy')}</Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  iconBtn: { padding: 6, borderRadius: 8 },
  scrim: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingVertical: 40, alignItems: 'center' },
  preview: { borderRadius: 14, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, transform: [{ scale: 0.86 }] },
  busy: { position: 'absolute', bottom: 48, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999 },
});
