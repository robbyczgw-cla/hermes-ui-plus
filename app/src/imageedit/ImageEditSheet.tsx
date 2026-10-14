/**
 * "✨ Bearbeiten" bottom sheet: image preview, "Was soll sich ändern?" + suggestion chips → a user
 * message with the image attached to the current chat backend. On-device quick edits (rotate, flip,
 * crop with presets) → send as a new image or save/share.
 */
import { Image } from 'expo-image';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { deleteAttachmentFiles } from '../attachments/store';
import { isAttachmentError, type Attachment } from '../attachments/types';
import { validateForTarget } from '../attachments/validate';
import { useT } from '../i18n';
import { SheetGrabber, SheetLayer, useSheetDialog, useTheme } from '../ui';
import { buildEditRequestText, EDIT_SUGGESTIONS, markEditAttachment, type EditGate, type EditSource } from './core';
import { centeredCrop, CROP_PRESETS, fitContain, moveRect, presetAspect, resizeRect, toImageRect, type CropPreset, type Rect } from './crop';
import { applyQuickOp, prepareEditSource, prepareWorkImage, shareImageFile, type QuickOp, type WorkImage } from './prepare';

export type ImageEditSheetProps = {
  source: EditSource | null;
  gate: EditGate;
  /** chat backend name for a11y ("an ChatGPT senden") */
  backendName: string;
  /** attachments already in the chat (Claude-style budget) */
  history?: readonly Attachment[];
  /** false = refused (turn running) → the sheet stays open */
  onSend(text: string, attachments: Attachment[]): boolean;
  onClose(sent: boolean): void;
  /** switch the profile's image generation on (backends with an image tool) */
  onEnableImageGen?: () => void;
};

export function ImageEditSheet(props: ImageEditSheetProps) {
  const { source, onClose } = props;
  const dialog = useSheetDialog();
  return (
    <Modal visible={!!source} transparent animationType={dialog ? 'fade' : 'slide'} onRequestClose={() => onClose(false)} statusBarTranslucent>
      {source ? <SheetBody key={source.uri} {...props} source={source} /> : null}
    </Modal>
  );
}

type Busy = null | 'prepare' | 'op' | 'send';

function SheetBody({ source, gate, backendName, history, onSend, onClose, onEnableImageGen }: ImageEditSheetProps & { source: EditSource }) {
  const t = useTheme();
  const tr = useT();
  const insets = useSafeAreaInsets();
  const win = useWindowDimensions();
  const [original, setOriginal] = useState<Attachment | null>(null);
  const [work, setWork] = useState<WorkImage | null>(null);
  const [edited, setEdited] = useState(false);
  const [busy, setBusy] = useState<Busy>('prepare');
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [crop, setCrop] = useState<{ preset: CropPreset; rect: Rect } | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  // files to delete when the sheet closes (the prepared copy unless it was sent, temp results)
  const garbage = useRef<{ original: Attachment | null; sent: boolean; temps: string[] }>({ original: null, sent: false, temps: [] });

  useEffect(() => {
    let alive = true;
    prepareEditSource(source)
      .then((att) => {
        if (!alive) {
          void deleteAttachmentFiles([att]);
          return;
        }
        garbage.current.original = att;
        setOriginal(att);
        setWork({ uri: att.uri, width: att.width ?? 0, height: att.height ?? 0 });
        setBusy(null);
      })
      .catch(() => {
        if (!alive) return;
        setBusy(null);
        setError(tr('imageEdit.loadFailed'));
      });
    const g = garbage.current;
    return () => {
      alive = false;
      if (g.original && !g.sent) void deleteAttachmentFiles([g.original]);
      void deleteAttachmentFiles(g.temps.map((uri) => ({ uri })));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.uri]);

  const png = original?.mimeType === 'image/png';
  const name = original?.name ?? source.name ?? 'Bild.jpg';
  const previewH = Math.max(160, Math.min(300, Math.round(win.height * 0.32)));
  const imageRect = useMemo(() => (work ? fitContain(work.width, work.height, box.w, box.h) : null), [work, box]);
  const ready = !!work && busy === null;

  const runOp = async (op: QuickOp) => {
    if (!work) return;
    setBusy('op');
    setError(null);
    try {
      const next = await applyQuickOp(work, op, png);
      garbage.current.temps.push(next.uri);
      setWork(next);
      setEdited(true);
    } catch {
      setError(tr('imageEdit.quick.failed'));
    } finally {
      setBusy(null);
    }
  };

  const startCrop = (preset: CropPreset) => {
    if (!work || !imageRect) return;
    setCrop({ preset, rect: centeredCrop(imageRect, presetAspect(preset, work.width, work.height)) });
  };

  const applyCrop = async () => {
    if (!crop || !work || !imageRect) return;
    const rect = toImageRect(crop.rect, imageRect, work.width, work.height);
    setCrop(null);
    await runOp({ type: 'crop', rect });
  };

  const resetEdits = () => {
    if (!original) return;
    setCrop(null);
    setEdited(false);
    setWork({ uri: original.uri, width: original.width ?? 0, height: original.height ?? 0 });
  };

  /** the attachment to send: the prepared original, or the quick-edited image prepared like a picked photo */
  const attachmentForSend = async (): Promise<Attachment | null> => {
    if (!original || !work) return null;
    if (!edited) return original;
    const att = await prepareWorkImage(work, name, png);
    garbage.current.temps.push(att.uri);
    return att;
  };

  const send = async (mode: 'ai' | 'plain') => {
    if (!gate.ok || busy) return;
    setBusy('send');
    setError(null);
    try {
      const att = await attachmentForSend();
      if (!att) return;
      try {
        validateForTarget([att], gate.target, { history });
      } catch (e) {
        setError(isAttachmentError(e) ? tr(e.msg.key, e.msg.vars) : tr('imageEdit.quick.failed'));
        return;
      }
      const msgText = mode === 'ai' ? buildEditRequestText(text, tr) : '';
      const ok = onSend(msgText, [mode === 'ai' ? markEditAttachment(att) : att]);
      if (!ok) {
        setError(tr('imageEdit.busy'));
        return;
      }
      // the sent file belongs to the message now
      const g = garbage.current;
      if (att === original) g.sent = true;
      else g.temps = g.temps.filter((u) => u !== att.uri);
      onClose(true);
    } catch {
      setError(tr('imageEdit.quick.failed'));
    } finally {
      setBusy(null);
    }
  };

  const share = async () => {
    if (!work) return;
    if (!(await shareImageFile(work, edited ? name.replace(/(\.[a-z0-9]+)?$/i, `-${tr('imageEdit.quick.edited')}$1`) : name))) setError(tr('imageEdit.quick.shareFailed'));
  };

  const addSuggestion = (s: string) => {
    setText((cur) => {
      const c = cur.trim();
      if (!c) return s;
      if (c.toLowerCase().includes(s.toLowerCase())) return cur;
      return `${c.replace(/[.,;]$/, '')}, ${s.charAt(0).toLowerCase()}${s.slice(1)}`;
    });
  };

  const canAi = gate.ok && ready && !crop;
  const label = source.label ? tr('imageEdit.previewA11y', { label: source.label }) : tr('imageEdit.previewNoLabel');

  return (
    <KeyboardAvoidingView style={StyleSheet.absoluteFill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <SheetLayer onClose={() => onClose(false)} closeLabel={tr('actions.close')} label={tr('imageEdit.title')} maxHeight={win.height - insets.top - 24} bottomPadding={6} style={styles.sheet}>
        <SheetGrabber style={styles.grabber} />
        <View style={styles.head}>
          <Text style={[styles.title, { color: t.colors.text }]} accessibilityRole="header">
            {tr('imageEdit.title')}
          </Text>
          <Pressable onPress={() => onClose(false)} hitSlop={10} accessibilityRole="button" accessibilityLabel={tr('actions.close')} style={({ pressed }) => [styles.close, pressed && { backgroundColor: t.colors.surfacePressed }]}>
            <Svg width={18} height={18} viewBox="0 0 24 24">
              <Path d="M6 6l12 12M18 6 6 18" stroke={t.colors.muted} strokeWidth={2.2} strokeLinecap="round" />
            </Svg>
          </Pressable>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" scrollEnabled={!crop} contentContainerStyle={styles.content}>
          {/* preview (+ crop overlay) */}
          <View
            style={[styles.preview, { height: previewH, backgroundColor: t.colors.surfaceAlt, borderColor: t.colors.border, borderRadius: t.radii.l }]}
            onLayout={(e: LayoutChangeEvent) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
          >
            <Image source={{ uri: work?.uri ?? source.uri }} style={StyleSheet.absoluteFill} contentFit="contain" transition={120} accessibilityLabel={label} />
            {crop && imageRect ? (
              <CropOverlay
                rect={crop.rect}
                bounds={imageRect}
                aspect={work ? presetAspect(crop.preset, work.width, work.height) : null}
                onChange={(rect) => setCrop((c) => (c ? { ...c, rect } : c))}
              />
            ) : null}
            {busy === 'prepare' || busy === 'op' ? (
              <View style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: 'rgba(0,0,0,0.25)' }]} accessibilityLiveRegion="polite">
                <ActivityIndicator color="#fff" />
                <Text style={styles.busyText}>{busy === 'prepare' ? tr('imageEdit.loading') : tr('imageEdit.quick.working')}</Text>
              </View>
            ) : null}
          </View>

          {/* quick edits */}
          <Text style={[styles.section, { color: t.colors.muted }]}>{tr('imageEdit.quick.title')}</Text>
          {crop ? (
            <View style={{ gap: 8 }}>
              <View style={styles.row}>
                {CROP_PRESETS.map((p) => {
                  const active = crop.preset === p;
                  const text = p === 'free' ? tr('imageEdit.quick.free') : p;
                  return (
                    <Chip key={p} label={text} active={active} onPress={() => startCrop(p)} a11y={tr('imageEdit.quick.presetA11y', { label: text })} />
                  );
                })}
              </View>
              <Text style={[styles.hint, { color: t.colors.subtle }]}>{tr('imageEdit.quick.cropHint')}</Text>
              <View style={styles.row}>
                <ActionButton label={tr('imageEdit.quick.cancelCrop')} onPress={() => setCrop(null)} />
                <ActionButton label={tr('imageEdit.quick.applyCrop')} onPress={() => void applyCrop()} primary />
              </View>
            </View>
          ) : (
            <View style={styles.row}>
              <ToolButton icon="rotate" label={tr('imageEdit.quick.rotate')} a11y={tr('imageEdit.quick.rotateA11y')} disabled={!ready} onPress={() => void runOp({ type: 'rotate' })} />
              <ToolButton icon="flip" label={tr('imageEdit.quick.flip')} a11y={tr('imageEdit.quick.flipA11y')} disabled={!ready} onPress={() => void runOp({ type: 'flip' })} />
              <ToolButton icon="crop" label={tr('imageEdit.quick.crop')} a11y={tr('imageEdit.quick.crop')} disabled={!ready || !imageRect} onPress={() => startCrop('free')} />
              {edited ? <ToolButton icon="undo" label={tr('imageEdit.quick.undo')} a11y={tr('imageEdit.quick.undoA11y')} disabled={!ready} onPress={resetEdits} /> : null}
            </View>
          )}

          {/* AI edit */}
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={tr('imageEdit.placeholder')}
            placeholderTextColor={t.colors.subtle}
            accessibilityLabel={tr('imageEdit.inputA11y')}
            multiline
            maxLength={1000}
            style={[styles.input, { color: t.colors.text, backgroundColor: t.colors.surfaceAlt, borderColor: t.colors.border, borderRadius: t.radii.l }]}
          />
          <View style={styles.row} accessibilityLabel={tr('imageEdit.suggestionsA11y')}>
            {EDIT_SUGGESTIONS.map((id) => {
              const s = tr(`imageEdit.suggest.${id}`);
              return <Chip key={id} label={s} onPress={() => addSuggestion(s)} a11y={s} />;
            })}
          </View>

          {error ? (
            <Text style={[styles.error, { color: t.colors.danger, backgroundColor: t.colors.dangerSoft, borderRadius: t.radii.m }]} accessibilityRole="alert">
              {error}
            </Text>
          ) : null}
          {!gate.ok ? (
            <View style={[styles.notice, { backgroundColor: t.colors.warningSoft, borderRadius: t.radii.m }]} accessibilityRole="alert">
              <Text style={[styles.noticeText, { color: t.colors.text }]}>{tr(gate.reason)}</Text>
              {gate.fix === 'enableImageGen' && onEnableImageGen ? (
                <ActionButton label={tr('imageEdit.enableImageGen')} onPress={onEnableImageGen} primary />
              ) : null}
            </View>
          ) : null}

          <Pressable
            onPress={() => void send('ai')}
            disabled={!canAi || busy !== null}
            accessibilityRole="button"
            accessibilityLabel={tr('imageEdit.sendA11y', { name: backendName })}
            accessibilityState={{ disabled: !canAi || busy !== null, busy: busy === 'send' }}
            style={({ pressed }) => [
              styles.send,
              { backgroundColor: t.colors.accent, borderRadius: t.radii.pill },
              (!canAi || busy !== null) && { opacity: 0.45 },
              pressed && { opacity: 0.8 },
            ]}
          >
            {busy === 'send' ? <ActivityIndicator color={t.colors.onAccent} /> : <Text style={[styles.sendText, { color: t.colors.onAccent }]}>{`✨ ${tr('imageEdit.send')}`}</Text>}
          </Pressable>
          <View style={styles.row}>
            <ActionButton label={tr('imageEdit.quick.sendNew')} onPress={() => void send('plain')} disabled={!gate.ok || !ready || !!crop} grow />
            <ActionButton label={tr('imageEdit.quick.saveShare')} onPress={() => void share()} disabled={!ready || !!crop} grow />
          </View>
        </ScrollView>
      </SheetLayer>
    </KeyboardAvoidingView>
  );
}

// ------------------------------------------------------------------ crop overlay

function CropOverlay({ rect, bounds, aspect, onChange }: { rect: Rect; bounds: Rect; aspect: number | null; onChange(r: Rect): void }) {
  const tr = useT();
  const live = useRef({ rect, bounds, aspect, onChange, start: rect });
  live.current.rect = rect;
  live.current.bounds = bounds;
  live.current.aspect = aspect;
  live.current.onChange = onChange;
  const mover = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          live.current.start = live.current.rect;
        },
        onPanResponderMove: (_e, g) => live.current.onChange(moveRect(live.current.start, g.dx, g.dy, live.current.bounds)),
      }),
    [],
  );
  const sizer = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          live.current.start = live.current.rect;
        },
        onPanResponderMove: (_e, g) => live.current.onChange(resizeRect(live.current.start, g.dx, g.dy, live.current.bounds, live.current.aspect)),
      }),
    [],
  );
  const shade = 'rgba(0,0,0,0.5)';
  // keyboard/screen-reader users: nudge the frame with the a11y actions
  const a11yActions = [{ name: 'increment', label: '+' }, { name: 'decrement', label: '−' }] as const;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, height: rect.y, backgroundColor: shade }} />
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: rect.y + rect.h, bottom: 0, backgroundColor: shade }} />
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, width: rect.x, top: rect.y, height: rect.h, backgroundColor: shade }} />
      <View pointerEvents="none" style={{ position: 'absolute', left: rect.x + rect.w, right: 0, top: rect.y, height: rect.h, backgroundColor: shade }} />
      <View
        {...mover.panHandlers}
        accessible
        accessibilityLabel={tr('imageEdit.quick.cropFrameA11y')}
        style={[styles.cropFrame, { left: rect.x, top: rect.y, width: rect.w, height: rect.h }, Platform.OS === 'web' ? ({ cursor: 'move', touchAction: 'none' } as object) : null]}
      >
        <View pointerEvents="none" style={[styles.third, { left: '33.33%', top: 0, bottom: 0, width: StyleSheet.hairlineWidth }]} />
        <View pointerEvents="none" style={[styles.third, { left: '66.66%', top: 0, bottom: 0, width: StyleSheet.hairlineWidth }]} />
        <View pointerEvents="none" style={[styles.third, { top: '33.33%', left: 0, right: 0, height: StyleSheet.hairlineWidth }]} />
        <View pointerEvents="none" style={[styles.third, { top: '66.66%', left: 0, right: 0, height: StyleSheet.hairlineWidth }]} />
      </View>
      <View
        {...sizer.panHandlers}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={tr('imageEdit.quick.cropHandleA11y')}
        accessibilityActions={a11yActions as unknown as { name: string; label: string }[]}
        onAccessibilityAction={(e) => {
          const d = e.nativeEvent.actionName === 'increment' ? 20 : -20;
          onChange(resizeRect(rect, d, d, bounds, aspect));
        }}
        hitSlop={12}
        style={[styles.handle, { left: rect.x + rect.w - 22, top: rect.y + rect.h - 22 }, Platform.OS === 'web' ? ({ cursor: 'nwse-resize', touchAction: 'none' } as object) : null]}
      >
        <View style={styles.handleDot} />
      </View>
    </View>
  );
}

// ------------------------------------------------------------------ small controls

function Chip({ label, onPress, active, a11y }: { label: string; onPress(): void; active?: boolean; a11y: string }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={active !== undefined ? { selected: active } : undefined}
      style={({ pressed }) => [
        styles.chip,
        { borderColor: active ? t.colors.accent : t.colors.border, backgroundColor: active ? t.colors.accentSoft : pressed ? t.colors.surfacePressed : t.colors.surfaceAlt },
      ]}
    >
      <Text style={[styles.chipText, { color: active ? t.colors.accent : t.colors.text }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function ActionButton({ label, onPress, primary, disabled, grow }: { label: string; onPress(): void; primary?: boolean; disabled?: boolean; grow?: boolean }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [
        styles.action,
        grow && { flexGrow: 1, flexBasis: 200 },
        { borderRadius: t.radii.pill, borderColor: primary ? t.colors.accent : t.colors.borderStrong, backgroundColor: primary ? t.colors.accent : pressed ? t.colors.surfacePressed : 'transparent' },
        disabled && { opacity: 0.45 },
      ]}
    >
      <Text style={[styles.actionText, { color: primary ? t.colors.onAccent : t.colors.text }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

type ToolIcon = 'rotate' | 'flip' | 'crop' | 'undo';

function ToolButton({ icon, label, a11y, onPress, disabled }: { icon: ToolIcon; label: string; a11y: string; onPress(): void; disabled?: boolean }) {
  const t = useTheme();
  const c = t.colors.text;
  const p = { stroke: c, strokeWidth: 1.9, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [styles.tool, { borderColor: t.colors.border, borderRadius: t.radii.m, backgroundColor: pressed ? t.colors.surfacePressed : t.colors.surfaceAlt }, disabled && { opacity: 0.45 }]}
    >
      <Svg width={20} height={20} viewBox="0 0 24 24">
        {icon === 'rotate' ? (
          <>
            <Path d="M20 11a8 8 0 1 0-2.3 5.7" {...p} />
            <Path d="M20 4v7h-7" {...p} />
          </>
        ) : icon === 'flip' ? (
          <>
            <Path d="M12 3v18" {...p} strokeDasharray="2 2.5" />
            <Path d="M9 7 3 17h6zM15 7l6 10h-6z" {...p} />
          </>
        ) : icon === 'crop' ? (
          <>
            <Path d="M6 2v14a2 2 0 0 0 2 2h14" {...p} />
            <Path d="M2 6h14a2 2 0 0 1 2 2v14" {...p} />
          </>
        ) : (
          <>
            <Path d="M9 14 4 9l5-5" {...p} />
            <Path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" {...p} />
          </>
        )}
      </Svg>
      <Text style={[styles.toolText, { color: c }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sheet: { paddingHorizontal: 0 },
  grabber: { marginBottom: 6 },
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 4 },
  title: { flex: 1, fontSize: 17, fontWeight: '600' },
  close: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: 14, paddingBottom: 4, gap: 10 },
  preview: { width: '100%', overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
  center: { alignItems: 'center', justifyContent: 'center', gap: 8 },
  busyText: { color: '#fff', fontSize: 13, fontWeight: '500' },
  section: { fontSize: 12.5, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 2 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  hint: { fontSize: 12.5 },
  tool: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, minHeight: 44, borderWidth: StyleSheet.hairlineWidth },
  toolText: { fontSize: 14, fontWeight: '500' },
  input: { minHeight: 48, maxHeight: 120, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12, fontSize: 16, borderWidth: StyleSheet.hairlineWidth, textAlignVertical: 'top' },
  chip: { paddingHorizontal: 12, minHeight: 36, justifyContent: 'center', borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, maxWidth: '100%' },
  chipText: { fontSize: 13.5, fontWeight: '500' },
  error: { fontSize: 13.5, paddingHorizontal: 12, paddingVertical: 8 },
  notice: { padding: 12, gap: 10 },
  noticeText: { fontSize: 14, lineHeight: 20 },
  send: { minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  sendText: { fontSize: 16, fontWeight: '600' },
  action: { minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, borderWidth: 1 },
  actionText: { fontSize: 14.5, fontWeight: '600' },
  cropFrame: { position: 'absolute', borderWidth: 2, borderColor: '#fff' },
  third: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.6)' },
  handle: { position: 'absolute', width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  handleDot: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff', borderWidth: 2, borderColor: 'rgba(0,0,0,0.45)' },
});
