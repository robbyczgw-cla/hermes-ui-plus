/**
 * Shared sheet chrome: a bottom sheet on phones, a centred dialog with a backdrop on wide windows (≥ 900 px:
 * tablet landscape, web, the desktop app). Every in-chat sheet (model picker, chat options, slash-command
 * sheets, action confirm, tool details, footnote / entity sheets, image edit, attachments) renders through
 * this, so the wide-screen behaviour lives in one place.
 *
 *   <SheetModal visible={open} onClose={close} closeLabel={tr('actions.close')}>
 *     <SheetGrabber />
 *     …content…
 *   </SheetModal>
 *
 * `onClose` covers the backdrop tap, Android back and Esc on web (useEscapeToClose: the topmost sheet closes). Omit it (e.g. while busy) to make the sheet non-dismissable.
 * Sheets that need their own Modal wrapper (keyboard avoiding, keyed bodies) use `<SheetLayer>` inside it.
 */
import { webNoTab } from '../lib/webStyle';
import type { ReactNode } from 'react';
import { Modal, Platform, Pressable, StyleSheet, View, useWindowDimensions, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import { webDialogName } from '../lib/ariaState';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isWideWidth } from '../lib/layout';
import { useEscapeToClose } from '../lib/useEscapeToClose';
import { useTheme } from '../theme';

export type SheetLayerProps = {
  /** backdrop tap; undefined = the backdrop does nothing */
  onClose?: () => void;
  /** a11y label of the backdrop ("Schließen") */
  closeLabel: string;
  /** max width of the sheet / dialog (default 640) */
  maxWidth?: number;
  /** phone: max height of the bottom sheet (e.g. '88%'); the dialog is capped at 86 % of the window */
  maxHeight?: DimensionValue;
  /** extra bottom padding on top of the safe area (default 8; the dialog uses it as plain padding) */
  bottomPadding?: number;
  /** a11y label of the sheet */
  label?: string;
  /** sheet container style (padding, …) – applied last */
  style?: StyleProp<ViewStyle>;
  /** backdrop only (content gone while the Modal still fades out) */
  empty?: boolean;
  children?: ReactNode;
};

/** true when sheets render as centred dialogs (window ≥ 900 px) */
export function useSheetDialog(): boolean {
  return isWideWidth(useWindowDimensions().width);
}

/** backdrop + positioned sheet container (no Modal) */
export function SheetLayer({ onClose, closeLabel, maxWidth = 640, maxHeight, bottomPadding = 8, label, style, empty, children }: SheetLayerProps) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const dialog = isWideWidth(width);
  // web: Esc closes the topmost sheet (ui/lib/escapeStack.ts), also for sheets without their own Modal
  useEscapeToClose(!empty, onClose);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: t.colors.overlay }]} onPress={onClose} disabled={!onClose} accessibilityRole="button" accessibilityLabel={closeLabel} {...webNoTab} />
      {empty ? null : <View style={[StyleSheet.absoluteFill, dialog ? styles.centerWrap : styles.bottomWrap]} pointerEvents="box-none">
        <View
          style={[
            styles.sheet,
            dialog ? [styles.dialog, { borderRadius: t.radii.card }] : { borderTopLeftRadius: t.radii.card, borderTopRightRadius: t.radii.card },
            {
              maxWidth,
              backgroundColor: t.dark ? t.colors.surface : t.colors.bg,
              borderColor: t.colors.border,
              paddingBottom: dialog ? 12 + bottomPadding : Math.max(insets.bottom, 12) + bottomPadding,
              maxHeight: dialog ? Math.round(height * 0.86) : maxHeight,
            },
            dialog && t.shadows.lg,
            style,
          ]}
          accessibilityViewIsModal
          aria-modal
          accessibilityLabel={label}
          // iOS VoiceOver escape gesture (two-finger Z): accessibilityViewIsModal hides the backdrop button, so this is the dismiss
          onAccessibilityEscape={onClose}
        >
          {children}
        </View>
      </View>}
    </View>
  );
}

export type SheetModalProps = SheetLayerProps & {
  visible: boolean;
  /** phone animation (default 'fade'); dialogs always fade */
  animationType?: 'fade' | 'slide';
};

export function SheetModal({ visible, animationType = 'fade', ...layer }: SheetModalProps) {
  const dialog = useSheetDialog();
  return (
    <Modal
      visible={visible}
      transparent
      animationType={dialog ? 'fade' : animationType}
      onRequestClose={layer.onClose}
      statusBarTranslucent
      supportedOrientations={['portrait', 'landscape']}
      // RNW forwards these to its role="dialog" element: the dialog itself gets the name
      {...webDialogName(layer.label, Platform.OS)}
    >
      <SheetLayer {...layer} />
    </Modal>
  );
}

/** the drag-handle bar of a bottom sheet; a small spacer in the dialog form */
export function SheetGrabber({ style }: { style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  const dialog = useSheetDialog();
  if (dialog) return <View style={styles.dialogTop} />;
  return <View style={[styles.grabber, { backgroundColor: t.colors.borderStrong }, style]} />;
}

const styles = StyleSheet.create({
  bottomWrap: { justifyContent: 'flex-end', alignItems: 'center' },
  centerWrap: { justifyContent: 'center', alignItems: 'center', padding: 24 },
  sheet: { width: '100%', borderWidth: StyleSheet.hairlineWidth, paddingTop: 8 },
  dialog: { overflow: 'hidden' },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, marginBottom: 10 },
  dialogTop: { height: 6 },
});
