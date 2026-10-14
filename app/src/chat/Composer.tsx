import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from 'react-native';
import { AttachmentButton, AttachmentTray, draftHasErrors, useAttachmentDraft, type Attachment, type AttachmentTarget, type PendingUploads, type PickSource } from '../attachments';
import type { ConnectionProfile } from '../settings/profiles';
import { useLocale, useT } from '../i18n';
import { columnMaxWidth, scaleFont, useTheme } from '../ui';
import { usePreferences } from '../settings/PreferencesProvider';
import { chatMaxWidth, enterAction, needsLargeAttachmentConfirm } from '../settings/preferences';
import { DictationNotice, MicButton, RecordingBar, insertDictation, useDictation, voiceConnFromProfile } from '../voice';
import { useDesktopFileTarget } from '../desktop/files';
import { lightHaptic } from './actions';
import { useChatShell } from './ChatShellContext';
import { SlashPalette, completeRow, paletteState, pickRow, submitSlash, type CommandDef, type PaletteRow, type SlashBinding, type SlashPaletteHandle } from './commands';
import { Icon } from './icons';

export type ComposerHandle = {
  focus(): void;
  setText(text: string): void;
  /** a cancelled send's text comes back – only into an empty input (never overwrites what was typed since) */
  restoreText(text: string): void;
};

type Props = {
  streaming: boolean;
  disabled?: boolean;
  placeholder?: string;
  /**
   * returns false when the message was not sent (e.g. a turn is still running) → the draft is kept. `pending`:
   * uploads of `attachments` still running (only with `sendWhileUploading`) – the chat waits for them
   */
  onSend(text: string, attachments: Attachment[], pending?: PendingUploads): boolean | void;
  /** the session can take a send whose uploads still run (Hermes `pendingSend`): Send is not blocked by uploads */
  sendWhileUploading?: boolean;
  onStop(): void;
  bottomInset: number;
  /** decides attachment target (Claude / Hermes with or without bridge uploads) */
  profile: ConnectionProfile;
  /** Claude: attachments already in this chat (the history is resent → shared request budget) */
  history?: readonly Attachment[];
  /** slash command palette ("/" at the very start); omitted = none */
  slash?: SlashBinding;
};

const MAX_HEIGHT = 168;
// Web: <input type=file>. Phones/tablets (coarse pointer) also get "Kamera" (`capture` attribute opens the
// camera in iOS Safari / Android Chrome); desktop browsers have no capture, the file dialog covers photos.
function webSources(): PickSource[] {
  const w = globalThis as { matchMedia?: (q: string) => { matches: boolean }; navigator?: { maxTouchPoints?: number } };
  const touch = !!w.matchMedia?.('(pointer: coarse)').matches && (w.navigator?.maxTouchPoints ?? 0) > 0;
  return touch ? ['camera', 'library', 'document'] : ['library', 'document'];
}

// memo: the chat view re-renders on every streaming update; the composer's props stay stable meanwhile
export const Composer = memo(forwardRef<ComposerHandle, Props>(function Composer(
  { streaming, disabled, placeholder, onSend, onStop, bottomInset, profile, history, slash, sendWhileUploading },
  ref,
) {
  const t = useTheme();
  const tr = useT();
  const { formatNumber } = useLocale();
  // Settings: Chat → Enter sendet / Große Anhänge bestätigen, Darstellung → Schriftgröße
  const { prefs } = usePreferences();
  const inputSize = scaleFont(16, 22, t.fontScale);
  // wide windows: the composer is centred and as wide as the message column (Settings → Chatbreite)
  const columnWidth = columnMaxWidth(chatMaxWidth(prefs), COMPOSER_PAD);
  const [text, setText] = useState('');
  // Hermes: own target (bridge uploads); demo: no attachments
  const target: AttachmentTarget = { kind: 'hermes', bridge: profile.kind === 'hermes' && !!profile.bridge };
  const canAttach = profile.kind !== 'demo';
  const draft = useAttachmentDraft({
    target,
    conn: profile.kind === 'hermes' && profile.bridge ? { baseUrl: profile.baseUrl, apiKey: profile.apiKey } : null,
    history: profile.kind === 'hermes' ? undefined : history,
  });
  // the composer lives inside the per-conversation session: leaving the chat drops the unsent draft + its files
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  });
  useEffect(() => () => draftRef.current.discard(), []);
  const [sending, setSending] = useState(false);
  // react-native-web textareas don't auto-grow → track content height there
  const [webHeight, setWebHeight] = useState<number | undefined>(undefined);
  const input = useRef<TextInput>(null);

  // Dictation (voice/INTEGRATION.md §1): the transcript is inserted at the caret, never sent by itself.
  const voiceConn = useMemo(
    () => voiceConnFromProfile(profile),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [profile.kind, profile.baseUrl, profile.apiKey, profile.bridge],
  );
  const selection = useRef<{ start: number; end: number } | undefined>(undefined);
  const dictation = useDictation({
    conn: voiceConn,
    onText: (dictated) => {
      setText((cur) => insertDictation(cur, dictated, selection.current).text);
      selection.current = undefined;
    },
  });
  // a dictation notice ("Ohne Mikrofon-Zugriff …") belongs to this visit of this chat (voice/dictationNotice.ts):
  // it goes when the chat screen loses focus (Settings, gallery) or the chat changes
  const dismissNotice = dictation.dismissNotice;
  useFocusEffect(useCallback(() => () => dismissNotice('left'), [dismissNotice]));
  const convId = useChatShell()?.conversationId;
  // desktop app: files dropped on the window / the dock icon and pasted images land in this draft (desktop/files.ts)
  useDesktopFileTarget(convId, canAttach && !disabled ? draft.addFiles : undefined);
  const shownConv = useRef(convId);
  useEffect(() => {
    if (shownConv.current === convId) return;
    shownConv.current = convId;
    dismissNotice('chatChanged');
  }, [convId, dismissNotice]);
  useImperativeHandle(ref, () => ({
    focus: () => input.current?.focus(),
    setText: (v: string) => {
      setText(v);
      input.current?.focus();
    },
    restoreText: (v: string) => setText((cur) => (cur.trim() ? cur : v)),
  }));

  const hasContent = !!text.trim() || draft.attachments.length > 0;
  // uploads still running do not block Send when the chat can wait for them (bubble shows the progress)
  const sendNowUploading = !!sendWhileUploading && draft.uploading && !draft.picking && !draftHasErrors(draft.attachments);
  const canSend = hasContent && !disabled && !streaming && !sending && (draft.canSend || sendNowUploading);

  // ---- slash palette (commands/): never sends the raw "/…" text except via the explicit "Als Text senden" row
  const slashRef = useRef<SlashPaletteHandle>(null);
  const [slashDismissed, setSlashDismissed] = useState(false);
  const palette = useMemo(() => (slash ? paletteState(text, slash.visible, slash.describe) : null), [slash, text]);
  if (slashDismissed && !palette) setSlashDismissed(false); // closed with Esc: reopens with the next "/"
  const runCommand = (b: SlashBinding, def: CommandDef, arg: string) => {
    const av = b.availability(def.id);
    if (!av.visible || !av.enabled) return b.notify(b.whyNot(def));
    setText('');
    selection.current = undefined;
    setWebHeight(undefined);
    b.run(def, arg);
  };
  const onPickRow = (row: PaletteRow) => {
    if (!palette || !slash) return;
    const r = pickRow(row, palette.input);
    if (r.action === 'fill') setText(r.text);
    else if (r.action === 'run') runCommand(slash, r.def, r.arg);
    else void submit(true);
  };
  const onCompleteRow = (row: PaletteRow) => {
    const next = palette && completeRow(row, palette.input);
    if (next) setText(next);
  };

  const submit = async (raw = false) => {
    if (slash && !raw) {
      const r = submitSlash(text, slash.visible);
      if (r.action === 'run') return runCommand(slash, r.def, r.arg);
      if (r.action === 'fill') return setText(r.text);
      if (r.action === 'unavailable') return slash.notify(slash.whyNot(r.def));
      if (r.action === 'choose') return setSlashDismissed(false);
    }
    if (!canSend) return;
    const sizes = draft.attachments.map((a) => a.size);
    if (needsLargeAttachmentConfirm(sizes, prefs)) {
      const mb = formatNumber(sizes.reduce((a, b) => a + (b > 0 ? b : 0), 0) / (1024 * 1024), { maximumFractionDigits: 1 });
      const ok = await confirmAsync(tr('settings.confirmLarge.title'), tr('settings.confirmLarge.text', { size: `${mb} MB` }), tr('settings.confirmLarge.send'), tr('actions.cancel'));
      if (!ok) return;
    }
    lightHaptic();
    if (sendNowUploading && draft.uploading) {
      // the bubble appears now with per-file progress; the turn starts when the uploads are done
      const prep = draft.preparePending();
      if (!prep) return; // draft.error explains why
      if (onSend(text.trim(), prep.attachments, prep.pending) === false) return; // refused → draft kept, uploads too
      draft.commitSend(prep.attachments); // the running uploads now belong to the message
      setText('');
      selection.current = undefined;
      setWebHeight(undefined);
      return;
    }
    setSending(true);
    try {
      const atts = await draft.prepareForSend(); // validates, waits for uploads (draft stays)
      if (atts === null) return; // draft.error explains why
      if (onSend(text.trim(), atts) === false) return; // refused (turn running) → keep text + attachments
      draft.commitSend(atts);
      setText('');
      selection.current = undefined;
      setWebHeight(undefined);
    } finally {
      setSending(false);
    }
  };

  // Web: Enter sends (setting "Enter sendet"), Shift+Enter = newline, Cmd/Ctrl+Enter always sends
  const onKeyPress = (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
    if (Platform.OS !== 'web') return;
    const ne = e.nativeEvent as TextInputKeyPressEventData & { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean; isComposing?: boolean };
    if (slashRef.current?.onKey(ne.key, { shift: ne.shiftKey, composing: ne.isComposing })) {
      e.preventDefault();
      return;
    }
    if (ne.key !== 'Enter') return;
    if (enterAction({ shift: ne.shiftKey, meta: ne.metaKey, ctrl: ne.ctrlKey, composing: ne.isComposing }, prefs.sendOnEnter) === 'send') {
      e.preventDefault();
      void submit();
    }
  };

  const showStop = streaming;
  return (
    <View style={[styles.outer, { paddingBottom: Math.max(bottomInset, 8), backgroundColor: t.colors.bg }, columnWidth !== undefined && { width: '100%', maxWidth: columnWidth, alignSelf: 'center' }]}>
      {slash && palette && !slashDismissed ? (
        <SlashPalette ref={slashRef} state={palette} binding={slash} onPick={onPickRow} onComplete={onCompleteRow} onDismiss={() => setSlashDismissed(true)} />
      ) : null}
      <View
        style={[
          styles.box,
          {
            backgroundColor: t.dark ? t.colors.surface : t.colors.bg,
            borderColor: t.colors.borderStrong,
            borderRadius: 26,
          },
          !t.dark && t.shadows.sm,
        ]}
      >
        <AttachmentTray attachments={draft.attachments} onRemove={draft.remove} onRetry={draft.retry} pending={draft.picking} />
        <View style={styles.inputRow}>
          {dictation.active ? (
            <RecordingBar dictation={dictation} style={styles.recording} />
          ) : (
            <>
              {canAttach ? (
                <AttachmentButton
                  onSelect={(src) => void draft.add(src)}
                  disabled={!draft.canAdd || streaming}
                  busy={draft.picking}
                  sources={Platform.OS === 'web' ? webSources() : undefined}
                />
              ) : (
                <View style={styles.noAttach} />
              )}
              <TextInput
                ref={input}
                value={text}
                onChangeText={setText}
                onSelectionChange={(e) => (selection.current = e.nativeEvent.selection)}
                placeholder={placeholder ?? tr('chat.composer.placeholder')}
                placeholderTextColor={t.colors.subtle}
                multiline
                style={[styles.input, inputSize, { color: t.colors.text, fontFamily: t.fonts.sans }, Platform.OS === 'web' && ({ outlineStyle: 'none', height: webHeight ?? 22, paddingTop: 0, paddingBottom: 0, marginVertical: 7 } as object)]}
                onKeyPress={onKeyPress}
                onContentSizeChange={
                  Platform.OS === 'web'
                    ? (e) => setWebHeight(Math.min(MAX_HEIGHT, Math.max(22, e.nativeEvent.contentSize.height)))
                    : undefined
                }
                textAlignVertical="center"
                accessibilityLabel={tr('chat.composer.input.a11y')}
                enterKeyHint="send"
                submitBehavior="newline"
              />
            </>
          )}
          {/* the MicButton stays mounted for the whole recording (it is the ✓ / hold-to-talk target) */}
          {!showStop && (dictation.active || !hasContent) ? (
            <MicButton dictation={dictation} size={36} disabled={disabled || sending} />
          ) : (
            <Pressable
              onPress={showStop ? onStop : () => void submit()}
              disabled={!showStop && !canSend}
              accessibilityRole="button"
              accessibilityLabel={showStop ? tr('chat.composer.stop') : tr('actions.send')}
              hitSlop={6}
              style={({ pressed }) => [
                styles.sendBtn,
                {
                  backgroundColor: showStop || canSend ? t.colors.text : t.colors.surfacePressed,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Icon name={showStop ? 'stop' : 'send'} size={showStop ? 16 : 18} color={showStop || canSend ? t.colors.bg : t.colors.subtle} strokeWidth={2.4} />
            </Pressable>
          )}
        </View>
      </View>
      <DictationNotice dictation={dictation} />
      {draft.error ? (
        <Text onPress={draft.clearError} style={[styles.error, { color: t.colors.danger }]} accessibilityRole="alert" accessibilityHint={tr('chat.composer.error.dismissHint')}>
          {draft.error}
        </Text>
      ) : null}
    </View>
  );
}));

/** Native: Alert with cancel/confirm; web: window.confirm. Resolves false on dismiss. */
function confirmAsync(title: string, message: string, ok: string, cancel: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    const w = globalThis as { confirm?: (m: string) => boolean };
    return Promise.resolve(typeof w.confirm === 'function' ? w.confirm(`${title}\n\n${message}`) : true);
  }
  return new Promise((resolve) =>
    Alert.alert(
      title,
      message,
      [
        { text: cancel, style: 'cancel', onPress: () => resolve(false) },
        { text: ok, onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    ),
  );
}

/** horizontal padding around the input box (the box lines up with the message column, see columnMaxWidth) */
const COMPOSER_PAD = 12;

const styles = StyleSheet.create({
  outer: { paddingHorizontal: COMPOSER_PAD, paddingTop: 6 },
  box: {
    flexDirection: 'column',
    borderWidth: StyleSheet.hairlineWidth,
    paddingLeft: 7,
    paddingRight: 7,
    paddingVertical: 7,
    minHeight: 52,
  },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  recording: { flex: 1 },
  noAttach: { width: 6 },
  error: { fontSize: 13, paddingHorizontal: 18, paddingTop: 4 },
  input: {
    flex: 1,
    fontSize: 16,
    lineHeight: 22,
    maxHeight: MAX_HEIGHT,
    paddingTop: Platform.OS === 'ios' ? 9 : 7,
    paddingBottom: Platform.OS === 'ios' ? 9 : 7,
    paddingHorizontal: 0,
  },
  sendBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: 1 },
});
