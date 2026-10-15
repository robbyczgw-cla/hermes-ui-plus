/**
 * Fullscreen image viewer: pinch-zoom (1–5×), pan while zoomed, double-tap to zoom, swipe down to
 * close, share button. Gesture handler + reanimated (worklets); the Modal needs its own
 * GestureHandlerRootView on Android.
 */
import { AttachmentImage } from './AttachmentImage';
import { Modal, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useT } from '../../i18n';
import { shareAttachment } from '../share';
import type { Attachment } from '../types';
import { AttIcon } from './icons';
import { useEscapeToClose } from '../../ui/lib/useEscapeToClose';

export type ImageViewerProps = {
  attachment: Attachment | null;
  onClose(): void;
  /** shows "✨ Bearbeiten" in the top bar (chat only); the viewer closes first */
  onEdit?: (attachment: Attachment) => void;
};

export function ImageViewer({ attachment, onClose, onEdit }: ImageViewerProps) {
  return (
    <Modal visible={!!attachment} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent supportedOrientations={['portrait', 'landscape']}>
      {attachment ? <ViewerContent key={attachment.id} attachment={attachment} onClose={onClose} onEdit={onEdit} /> : null}
    </Modal>
  );
}

function ViewerContent({ attachment, onClose, onEdit }: { attachment: Attachment; onClose(): void; onEdit?: (attachment: Attachment) => void }) {
  useEscapeToClose(true, onClose);
  const insets = useSafeAreaInsets();
  const tr = useT();
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);
  const dismissY = useSharedValue(0);

  const reset = () => {
    'worklet';
    scale.value = withTiming(1);
    savedScale.value = 1;
    tx.value = withTiming(0);
    ty.value = withTiming(0);
    savedTx.value = 0;
    savedTy.value = 0;
  };

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.min(5, Math.max(0.8, savedScale.value * e.scale));
    })
    .onEnd(() => {
      if (scale.value <= 1) reset();
      else savedScale.value = scale.value;
    });

  const pan = Gesture.Pan()
    .averageTouches(true)
    .onUpdate((e) => {
      if (savedScale.value > 1) {
        tx.value = savedTx.value + e.translationX;
        ty.value = savedTy.value + e.translationY;
      } else if (e.numberOfPointers === 1) {
        dismissY.value = Math.max(0, e.translationY);
      }
    })
    .onEnd((e) => {
      if (savedScale.value > 1) {
        savedTx.value = tx.value;
        savedTy.value = ty.value;
        return;
      }
      if (dismissY.value > 120 || e.velocityY > 900) runOnJS(onClose)();
      else dismissY.value = withTiming(0);
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (savedScale.value > 1) reset();
      else {
        scale.value = withTiming(2.5);
        savedScale.value = 2.5;
      }
    });

  const gesture = Gesture.Simultaneous(pinch, pan, doubleTap);

  const imageStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value + dismissY.value }, { scale: scale.value }],
  }));
  const bgStyle = useAnimatedStyle(() => ({ opacity: 1 - Math.min(0.6, dismissY.value / 400) }));

  return (
    <GestureHandlerRootView style={styles.fill}>
      <StatusBar barStyle="light-content" />
      <Animated.View style={[StyleSheet.absoluteFill, styles.bg, bgStyle]} />
      <GestureDetector gesture={gesture}>
        <Animated.View style={[styles.fill, imageStyle]} accessibilityLabel={attachment.name} accessible>
          <AttachmentImage uri={attachment.uri} style={styles.fill} contentFit="contain" transition={150} />
        </Animated.View>
      </GestureDetector>
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel={tr('actions.close')} style={styles.roundBtn}>
          <AttIcon name="close" size={22} color="#fff" strokeWidth={2.2} />
        </Pressable>
        <Text numberOfLines={1} style={styles.title}>
          {attachment.name}
        </Text>
        {onEdit ? (
          <Pressable
            onPress={() => {
              onEdit(attachment);
              onClose();
            }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={tr('imageEdit.actionA11y')}
            style={styles.pill}
          >
            <Text style={styles.pillText}>{tr('imageEdit.action')}</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={() => void shareAttachment(attachment, tr)} hitSlop={10} accessibilityRole="button" accessibilityLabel={tr('actions.share')} style={styles.roundBtn}>
          <AttIcon name="share" size={20} color="#fff" />
        </Pressable>
      </View>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  bg: { backgroundColor: '#000' },
  topBar: { position: 'absolute', left: 0, right: 0, top: 0, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 12 },
  roundBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.14)' },
  pill: { height: 40, borderRadius: 20, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.18)' },
  pillText: { color: '#fff', fontSize: 14.5, fontWeight: '600' },
  title: { flex: 1, color: '#fff', fontSize: 15, fontWeight: '500', textAlign: 'center' },
});
