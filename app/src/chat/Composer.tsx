import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from 'react-native';
import { Text, TextInput } from '../ui/primitives/Text';
import { AttachmentButton, AttachmentTray, draftHasErrors, useAttachmentDraft, type Attachment, type AttachmentTarget, type PendingUploads, type PickSource } from '../attachments';
import type { ConnectionProfile } from '../settings/profiles';
import { useLocale, useT } from '../i18n';
import { columnMaxWidth, useTheme } from '../ui';
import { usePreferences } from '../settings/PreferencesProvider';
import { chatMaxWidth, enterAction, needsLargeAttachmentConfirm } from '../settings/preferences';
import { DictationNotice, MicButton, RecordingBar, insertDictation, useDictation, voiceConnFromProfile } from '../voice';
import { useDesktopFileTarget } from '../desktop/files';
import { useShareDelivery } from '../share/useShare';
import type { ShareDelivery } from '../share/inbox';
import { retryShare } from '../share/inbox';
import { shareSendDecision, type ConfirmedShare } from '../share/send';
import { lightHaptic } from './actions';
import { useChatShell } from './ChatShellContext';
import { ActionMenu } from './ActionMenu';
import { useToast } from './Toast';
import { SlashPalette, completeRow, paletteState, pickRow, submitSlash, type CommandDef, type PaletteRow, type SlashBinding, type SlashPaletteHandle } from './commands';
import { Icon } from './icons';
import { a11yState } from '../ui/lib/a11yState';

export type ComposerHandle = {
  focus(): void;
  setText(text: string): void;
  /**
   * a cancelled send's text comes back – only into an empty input (never overwrites what was typed since);
   * `append`: added below what was typed instead (a discarded queued message must not get lost)
   */
  restoreText(text: string, append?: boolean): void;
  /** the unsent text, removed from the composer (handed over when switching to / from the quick thread) */
  takeText(): string;
};

/**
 * Quick answers (app/src/quick): the ⚡ switch between the chat and the quick thread of its connection, and
 * long-press on Send → "Als Schnellfrage senden". Omitted = quick is not available here (nothing changes).
 */
export type ComposerQuick = {
  /** this composer belongs to the quick thread (⚡ on, text only, brass outline) */
  active: boolean;
  /** show the ⚡ switch (Settings → "⚡ im Eingabefeld anzeigen"; always shown in the quick thread) */
  showToggle: boolean;
  /** ⚡ pressed: switch views, the unsent text moves along */
  onToggle(text: string): void;
  /** long-press on Send in the chat: send this text as a quick question */
  onSendQuick?(text: string): void;
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
  quick?: ComposerQuick;
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
  { streaming, disabled, placeholder, onSend, onStop, bottomInset, profile, history, slash, sendWhileUploading, quick },
  ref,
) {
  const t = useTheme();
  const tr = useT();
  const toast = useToast();
  const quickActive = !!quick?.active;
  const { formatNumber } = useLocale();
  // Settings: Chat → Enter sendet / Große Anhänge bestätigen, Darstellung → Schriftgröße
  const { prefs } = usePreferences();
  const inputSize = t.typography.reading;
  // wide windows: the composer is centred and as wide as the message column (Settings → Chatbreite)
  const columnWidth = columnMaxWidth(chatMaxWidth(prefs), COMPOSER_PAD);
  const [text, setText] = useState('');
  // Hermes: own target (bridge uploads); demo: no attachments
  const target: AttachmentTarget = { kind: 'hermes', bridge: profile.kind === 'hermes' && !!profile.bridge };
  const canAttach = !quickActive && profile.kind !== 'demo';
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
  const textRef = useRef(text);
  useEffect(() => {
    textRef.current = text;
  }, [text]);
  useImperativeHandle(ref, () => ({
    focus: () => input.current?.focus(),
    setText: (v: string) => {
      setText(v);
      input.current?.focus();
    },
    restoreText: (v: string, append?: boolean) => setText((cur) => (!cur.trim() ? v : append ? `${cur.trimEnd()}\n\n${v}` : cur)),
    takeText: () => {
      const v = textRef.current;
      textRef.current = '';
      setText('');
      return v;
    },
  }));

  // "Share to HUI+" (share/): a share confirmed in the share sheet for this chat lands in the draft and is sent right
  // away – the user already tapped Send there. Anything that cannot go now (upload failed offline, a turn still
  // running, own unsent text in this composer) stays in the draft with a notice: never sent half, never dropped.
  const [shareSend, setShareSend] = useState<ConfirmedShare | null>(null);
  const receiveShare = async (d: ShareDelivery) => {
    const own = !!textRef.current.trim() || draftRef.current.attachments.length > 0;
    const fileIds: string[] = [];
    if (d.files.length && !canAttach) toast(tr('share.composer.noFiles'));
    else if (d.files.length) {
      const web = d.files.flatMap((f) => (f.webFile ? [f.webFile] : []));
      const native = d.files.filter((f) => !f.webFile);
      if (web.length) fileIds.push(...await draftRef.current.addFiles(web));
      if (native.length) fileIds.push(...await draftRef.current.addShared(native));
    }
    if (fileIds.length !== d.files.length) {
      // Preparation failed: keep the original payload available for another target / retry.
      for (const id of fileIds) draftRef.current.remove(id);
      retryShare(d);
      toast(tr('share.composer.kept'));
      return;
    }
    d.release?.();
    if (d.text) setText((cur) => (cur.trim() ? `${cur.trimEnd()}\n\n${d.text}` : d.text));
    if (d.fillOnly) return;
    if (own) toast(tr('share.composer.kept'));
    else setShareSend({ text: d.text, fileIds });
  };
  // not the quick thread, and not the disabled placeholder composer shown while the session loads (ChatView): it is
  // replaced by the real one, whose unmount would discard the draft – the share waits in the inbox for the real one
  useShareDelivery(quickActive || disabled ? undefined : convId, receiveShare);

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

  // the confirmed share: send once its files are prepared (and uploaded, unless the chat can wait for uploads)
  useEffect(() => {
    if (!shareSend) return;
    const decision = shareSendDecision(shareSend, { text, attachments: draft.attachments, picking: draft.picking, uploading: draft.uploading, error: draft.error, canSend, disabled: !!disabled, streaming });
    if (decision === 'wait') return;
    setShareSend(null);
    if (decision === 'send') {
      void submit(true);
      return;
    }
    toast(tr('share.composer.kept'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareSend, text, draft.picking, draft.uploading, draft.attachments, draft.error, canSend, disabled, streaming]);

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

  // ---- quick answers: ⚡ switches views (the draft moves along), long-press on Send sends as a quick question
  const [sendMenu, setSendMenu] = useState(false);
  const clearDraftText = () => {
    setText('');
    selection.current = undefined;
    setWebHeight(undefined);
  };
  const toggleQuick = () => {
    if (!quick) return;
    if (!quick.active && draft.attachments.length) return toast(tr('quick.composer.noAttachments'));
    lightHaptic();
    const v = text;
    clearDraftText();
    quick.onToggle(v);
  };
  const sendQuick = () => {
    if (!quick?.onSendQuick || !text.trim()) return;
    if (draft.attachments.length) return toast(tr('quick.composer.noAttachments'));
    const v = text.trim();
    clearDraftText();
    quick.onSendQuick(v);
  };
  const canSendQuick = !!quick?.onSendQuick && !quickActive && !!text.trim() && !disabled && !sending;

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
            // quick thread: a brass outline marks where this message goes
            borderColor: quickActive ? t.colors.accent : t.colors.borderStrong,
            borderRadius: t.radii.card,
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
                style={[inputSize, styles.input, { color: t.colors.text, fontFamily: t.fonts.sans }, Platform.OS === 'web' && ({ outlineStyle: 'none', height: webHeight ?? inputSize.lineHeight, paddingTop: 0, paddingBottom: 0, marginVertical: 7 } as object)]}
                onKeyPress={onKeyPress}
                onContentSizeChange={
                  Platform.OS === 'web'
                    ? (e) => setWebHeight(Math.min(MAX_HEIGHT, Math.max(inputSize.lineHeight, e.nativeEvent.contentSize.height)))
                    : undefined
                }
                textAlignVertical="center"
                accessibilityLabel={tr('chat.composer.input.a11y')}
                testID="composer-input"
                enterKeyHint="send"
                submitBehavior="newline"
              />
            </>
          )}
          {quick && (quickActive || quick.showToggle) && !dictation.active ? <QuickToggle active={quickActive} onPress={toggleQuick} /> : null}
          {/* the MicButton stays mounted for the whole recording (it is the ✓ / hold-to-talk target) */}
          {showStop ? (
            // its own element (not the send button relabelled): TalkBack / VoiceOver and UI tests always find it
            <Pressable
              key="stop"
              onPress={onStop}
              testID="composer-stop"
              accessible
              accessibilityRole="button"
              accessibilityLabel={tr('chat.composer.stop')}
              hitSlop={6}
              style={({ pressed }) => [styles.sendBtn, { backgroundColor: t.colors.text, opacity: pressed ? 0.7 : 1 }]}
            >
              <Icon name="stop" size={16} color={t.colors.bg} strokeWidth={2.4} />
            </Pressable>
          ) : dictation.active || !hasContent ? (
            <MicButton dictation={dictation} size={36} disabled={disabled || sending} />
          ) : (
            <Pressable
              key="send"
              onPress={() => void submit()}
              onLongPress={canSendQuick ? () => {
                lightHaptic();
                setSendMenu(true);
              } : undefined}
              delayLongPress={400}
              disabled={!canSend}
              testID="composer-send"
              accessibilityRole="button"
              accessibilityLabel={tr('actions.send')}
              accessibilityActions={canSendQuick ? [{ name: 'longpress', label: tr('quick.composer.sendAsQuick') }] : undefined}
              onAccessibilityAction={(e) => {
                if (e.nativeEvent.actionName === 'longpress') sendQuick();
              }}
              hitSlop={6}
              style={({ pressed }) => [
                styles.sendBtn,
                {
                  backgroundColor: canSend ? t.colors.text : t.colors.surfacePressed,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Icon name="send" size={18} color={canSend ? t.colors.bg : t.colors.subtle} strokeWidth={2.4} />
            </Pressable>
          )}
        </View>
      </View>
      <DictationNotice dictation={dictation} />
      {sendMenu ? (
        <ActionMenu
          visible
          onClose={() => setSendMenu(false)}
          label={tr('quick.composer.sendMenu')}
          items={[{ key: 'quick', icon: 'bolt', label: tr('quick.composer.sendAsQuick'), hint: tr('quick.composer.sendAsQuickHint'), onPress: sendQuick }]}
        />
      ) : null}
      {draft.error ? (
        <Text onPress={draft.clearError} style={[t.typography.caption, styles.error, { color: t.colors.danger }]} accessibilityRole="alert" accessibilityHint={tr('chat.composer.error.dismissHint')}>
          {draft.error}
        </Text>
      ) : null}
    </View>
  );
}));

/** ⚡ in the composer: a switch (on = the quick thread is shown and this composer asks quick questions). */
function QuickToggle({ active, onPress }: { active: boolean; onPress(): void }) {
  const t = useTheme();
  const tr = useT();
  return (
    <Pressable
      onPress={onPress}
      testID="composer-quick"
      hitSlop={6}
      accessibilityRole="switch"
      {...a11yState({ checked: active })}
      accessibilityLabel={tr('quick.composer.toggle')}
      accessibilityHint={active ? tr('quick.composer.toggleOnHint') : tr('quick.composer.toggleOffHint')}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.quickBtn,
        active ? { backgroundColor: t.colors.accentSoft } : (pressed || hovered) && { backgroundColor: t.colors.surfacePressed },
        pressed && { opacity: 0.75 },
      ]}
    >
      <Icon name={active ? 'boltFilled' : 'bolt'} size={18} color={active ? t.colors.accent : t.colors.muted} strokeWidth={active ? 1.5 : 1.9} />
    </Pressable>
  );
}

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
  error: { paddingHorizontal: 18, paddingTop: 4 },
  input: {
    flex: 1,
    maxHeight: MAX_HEIGHT,
    paddingTop: Platform.OS === 'ios' ? 9 : 7,
    paddingBottom: Platform.OS === 'ios' ? 9 : 7,
    paddingHorizontal: 0,
  },
  sendBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: 1 },
  quickBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: 1, marginRight: -4 },
});
