import { memo, useCallback, useMemo, useState } from 'react';
import { LayoutAnimation, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ApprovalHistory } from '../approvals/ApprovalHistory';
import { AttachmentTray, MessageAttachments } from '../attachments';
import type { ChatMessage } from '../hermes';
import { isRecovering } from '../hermes/recovery.ts';
import { textAppendRun } from '../hermes/chatState.ts';
import { AUTH_DENIED_KEY, isAuthErrorMessage } from '../hermes/authError.ts';
import { router } from 'expo-router';
import { isCut } from '../background/cut.ts';
import { useLocale, useT } from '../i18n';
import { NodeScope } from '../nodestate';
import type { HuiAction, HuiNode, Segment } from '../protocol/types';
import { skeletonShapeForRoute } from '../protocol/streamPlaceholder.ts';
import { segmentAppendRun } from '../protocol/streamParser.ts';
import {
  HuiView,
  WaitingIndicator,
  personaLoader,
  resolveWaitMode,
  routeBadgeVisible,
  seedFrom,
  useCopiedFlash,
  useMotionReduced,
  useTheme,
  waitStateOf,
  type HuiActionMeta,
  type HuiFieldValue,
} from '../ui';
import { HtmlBlock } from '../sandbox';
import { useToolDetails } from '../settings/Appearance';
import { useActiveProfile } from '../settings/ConnectionProvider';
import { usePreferences } from '../settings/PreferencesProvider';
import { scaledText } from '../settings/preferences';
import { RouteSkeleton } from '../ui';
import { SpeakButton, getSpeakerState, stopSpeaking, toggleSpeaking, type VoiceConn } from '../voice';
import { answerContextMenu, useNativeContextMenu } from '../desktop/messageMenu';
import { useCopy, useShareText } from './actions';
import { crashTestMessage } from './crashTest';
import { plainCopyText } from './format';
import { Icon, type IconName } from './icons';
import { isLocalMessage } from './localMessages';
import { Markdown } from './Markdown';
import { ReplyChip } from './ReplyChip';
import { ReformattedMarker, TransformBar } from './TransformBar';
import { parseReplyMessage, replyCopyText } from './replyMessage';
import { useMarkdownImageBase } from './MarkdownImageContext';
import { BeforeAfter } from '../imageedit/BeforeAfter';
import { resultImageUrl } from '../imageedit/core';
import { useToast } from './Toast';
import { ToolChips } from './ToolChips';
import { ContextDivider, MediaFiles, MemoryNotes, ReminderCards } from './HermesExtras';
import { memoryNotes, shouldShowCompactionDivider } from './hermesTools';
import { createMediaTagCache, extractMedia, extractMediaCached, type MediaTagCache } from './mediaTags';
import { parseReminders } from './reminder';
import { CutNotice, LateMark } from './TurnNotices';
import { FailureText } from './FailureText';
import { ProgressNotesDisclosure, ToolDetailSheet, ToolTimelinePanel, TurnFooter } from './ToolTimeline';
import { useSegments } from './useSegments';
import { usePendingBubble, useQueuedBubble, type PendingBubble } from './pendingSendContext';
import { queuedNotice } from '../hermes/pendingSend';
import { AnswerScope } from './answers/AnswerScope';
import { summaryBefore } from './answers/collapse';
import { withCitationSources } from './answers/citations';
import { withRetrievedSources } from './answers/webSources';
import { dedupeTranslations } from './answers/dedupe';
import { splitProgressNotes, type ProgressNote } from '../hermes/progressNotes';
import { SHARE_IMAGE_SUPPORTED, ShareImageSheet } from './answers/shareImage';
import { ReportSheet } from '../compliance/ReportSheet';
import { useAnswerReport, withdrawReport } from '../compliance/store';
import { ActionMenu, MenuHeader, type MenuItem } from './ActionMenu';
import { useAnswerActions } from './answerActions';
import { answerMenuItems, usedWebSearch, type AnswerModelInfo } from './answerMenu';
import { FindScope, Highlighted, useMessageHighlight } from './findContext';
import { HandOffButton, QuickMetaLine } from '../quick/QuickMeta';
import { shortModel } from '../quick/core';
import type { TFn, TKey } from '../i18n';

/**
 * HuiAction handler of the chat shell. `messageId` = the assistant message holding the node (the `ask`
 * action reads node state of that message). Returns false when the action was refused (turn running).
 */
export type ActionHandler = (action: HuiAction, values?: Record<string, HuiFieldValue>, meta?: HuiActionMeta, messageId?: string) => boolean | void;

// ---------------------------------------------------------------- user

export const UserMessage = memo(function UserMessage({ message }: { message: ChatMessage }) {
  crashTestMessage(message.text); // no-op unless EXPO_PUBLIC_HUI_CRASH_TEST=1
  const t = useTheme();
  const tr = useT();
  const copy = useCopy();
  // protocol replies (`[choice:…] …`, `[form:…] {…}`, ask lines): the stored text stays the machine string,
  // the user sees the free text (if any) + a short localized "↩ …" chip per reply
  const reply = useMemo(() => parseReplyMessage(message.text, tr), [message.text, tr]);
  const bubbleText = reply ? reply.head : message.text;
  const copyText = reply ? replyCopyText(reply) : message.text;
  const hasText = !!bubbleText.trim();
  // Settings: Darstellung → Nachrichtenstil (Blase / Schlicht) + Schriftgröße, Chat → Zeitstempel
  const { prefs } = usePreferences();
  const plain = prefs.bubbleStyle === 'plain';
  const textSize = scaledText(16, 23, t.fontScale);
  const doCopy = () => copy(copyText, tr('chat.message.copied'));
  const hl = useMessageHighlight(message.id); // "Im Chat suchen"
  // VoiceOver: the bubble is one element (plain text, no controls inside); long-press copy is offered as
  // an accessibility action so it stays reachable without the gesture
  const a11yCopy = {
    accessibilityActions: [{ name: 'longpress', label: tr('actions.copy') }],
    onAccessibilityAction: (e: { nativeEvent: { actionName: string } }) => {
      if (e.nativeEvent.actionName === 'longpress') doCopy();
    },
  };
  return (
    <View style={styles.userRow}>
      {message.sendPending ? (
        <PendingAttachments message={message} />
      ) : (
        <MessageAttachments attachments={message.attachments} align="end" />
      )}
      {hasText ? (
        <Pressable
          onLongPress={doCopy}
          delayLongPress={350}
          style={({ pressed }) => [
            styles.userBubble,
            plain
              ? [styles.userPlain, { borderRightColor: t.colors.accent }, pressed && { opacity: 0.6 }]
              : [{ backgroundColor: t.colors.surfaceAlt, borderRadius: t.radii.xl }, pressed && { backgroundColor: t.colors.surfacePressed }],
          ]}
          accessibilityHint={tr('chat.message.longPressCopy')}
          {...a11yCopy}
        >
          <Text style={[styles.userText, textSize, { color: t.colors.text }, plain && styles.userPlainText]} selectable={Platform.OS === 'web'}>
            {hl ? <Highlighted text={bubbleText} hl={hl} /> : bubbleText}
          </Text>
        </Pressable>
      ) : null}
      {reply
        ? reply.replies.map((r, i) => (
            <Pressable key={`${r.kind}:${r.id}:${i}`} onLongPress={doCopy} delayLongPress={350} accessible={false} style={styles.replyRow}>
              <ReplyChip text={r.display} />
            </Pressable>
          ))
        : null}
      {message.sendQueued ? <QueuedActions message={message} /> : null}
      {prefs.showTimestamps ? <Timestamp at={message.createdAt} /> : null}
    </View>
  );
});

/**
 * A user message that was still waiting for its uploads – or for the server to accept its turn – when the app stopped
 * (`sendQueued`, hermes/pendingSend.ts): not sent. "Erneut senden" checks Hermes first, uploads what is missing and starts the turn; "Verwerfen" puts the
 * text back into the composer. Never sent without this tap (the conversation may have moved on).
 */
function QueuedActions({ message }: { message: ChatMessage }) {
  const t = useTheme();
  const tr = useT();
  const q = useQueuedBubble();
  const st = q?.state(message.id);
  const checking = st?.phase === 'checking';
  const notSent = queuedNotice(message) === 'request' ? 'chat.message.queuedNotSentRequest' : 'chat.message.queuedNotSent';
  const note = checking ? 'chat.message.queuedChecking' : st?.notice === 'checkFailed' ? 'chat.message.queuedCheckFailed' : notSent;
  const canResend = !!q && !checking && !q.busy;
  return (
    <View style={styles.pendingWrap}>
      <Text style={[styles.pendingText, styles.queuedNote, { color: checking ? t.colors.muted : t.colors.danger }]} accessibilityLiveRegion="polite" accessibilityRole={checking ? undefined : 'alert'}>
        {tr(note)}
      </Text>
      {q && !checking ? (
        <View style={styles.pendingRow}>
          <Pressable
            onPress={() => q.discard(message.id)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={tr('chat.message.queuedDiscardA11y')}
          >
            <Text style={[styles.pendingText, { color: t.colors.muted, fontWeight: '600' }]}>{tr('chat.message.queuedDiscard')}</Text>
          </Pressable>
          <Pressable
            onPress={() => q.resend(message.id)}
            disabled={!canResend}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canResend }}
            accessibilityLabel={tr('chat.message.queuedResendA11y')}
          >
            <Text style={[styles.pendingText, { color: canResend ? t.colors.accent : t.colors.muted, fontWeight: '600' }]}>{tr('chat.message.queuedResend')}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

/**
 * A user message sent while its uploads still run (hermes/pendingSend.ts): the attachments with their progress
 * (the composer's tray look: % / bar, tap a failed one to retry, × removes it) and a "sends once the upload is
 * done · Abbrechen" line. The turn starts by itself when every upload is done.
 */
function PendingAttachments({ message }: { message: ChatMessage }) {
  const t = useTheme();
  const tr = useT();
  const bubble: PendingBubble | null = usePendingBubble(message.id);
  const atts = message.attachments ?? [];
  const failed = atts.some((a) => a.status === 'error');
  return (
    <View style={styles.pendingWrap}>
      {atts.length ? <AttachmentTray attachments={atts} onRemove={(id) => bubble?.remove(id)} onRetry={bubble ? (id) => bubble.retry(id) : undefined} /> : null}
      <View style={styles.pendingRow} accessibilityLiveRegion="polite">
        <Text style={[styles.pendingText, { color: failed ? t.colors.danger : t.colors.muted }]} accessibilityRole={failed ? 'alert' : undefined}>
          {tr(failed ? 'chat.message.pendingFailed' : 'chat.message.pendingUploads')}
        </Text>
        {bubble ? (
          <Pressable onPress={bubble.cancel} hitSlop={8} accessibilityRole="button" accessibilityLabel={tr('chat.message.pendingCancelA11y')}>
            <Text style={[styles.pendingText, { color: t.colors.accent, fontWeight: '600' }]}>{tr('chat.message.pendingCancel')}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------- assistant

type AssistantProps = {
  message: ChatMessage;
  isLast: boolean;
  /** first answer of the chat (B9: compaction then stays a tool-timeline note, no divider) */
  isFirstTurn?: boolean;
  onAction: ActionHandler;
  onRetry: () => void;
  /** persisted node state scope (nodestate) – undefined outside a stored conversation */
  conversationId?: string;
  /** UI bridge for "Vorlesen" (null → on-device voice) */
  voiceConn?: VoiceConn | null;
  /** follow-up suggestions node (meta) – only on the last answer */
  followups?: HuiNode | null;
  /** "✨ Bearbeiten": uri of the image the previous (edit request) message sent → before/after slider */
  compareBefore?: string;
  /** a later `[reformat:…]` request refers to this answer → "umgeformt ↓" marker (A1) */
  reformatted?: boolean;
};

export const AssistantMessage = memo(function AssistantMessage({ conversationId, ...props }: AssistantProps) {
  // FindScope: "Im Chat suchen" marks the matches of this answer (findContext.tsx)
  const body = (
    <FindScope messageId={props.message.id}>
      <AssistantBody {...props} conversationId={conversationId} />
    </FindScope>
  );
  return conversationId ? (
    <NodeScope conversationId={conversationId} messageId={props.message.id} createdAt={props.message.createdAt}>
      {body}
    </NodeScope>
  ) : (
    body
  );
});

function AssistantBody({ message, isLast, isFirstTurn = false, onAction: onShellAction, onRetry, voiceConn = null, followups, compareBefore, reformatted, conversationId }: AssistantProps) {
  const t = useTheme();
  const tr = useT();
  const copy = useCopy();
  const share = useShareText();
  const toast = useToast();
  const id = message.id;
  // bind the message id (ask action) – stable per message so memoized segments don't re-render
  const onAction = useCallback<ActionHandler>((a, v, m) => onShellAction(a, v, m, id), [onShellAction, id]);
  const local = isLocalMessage(message);
  // generated images on the assistant message; skip those already shown inline as a hui image
  const atts = message.attachments;
  const extraAtts = useMemo(() => atts?.filter((a) => !message.text.includes(a.uri)), [atts, message.text]);
  const streaming = message.status === 'streaming';
  // Hermes: stream lost after the turn was accepted – the answer is being fetched (hermes/recovery.ts)
  const recovering = isRecovering(message);
  // 401/403 / "Invalid bridge token": human text + "Verbindung bearbeiten" (hermes/authError.ts)
  const authError = isAuthErrorMessage(message);
  // UX1: interim notes before tool calls ("Ich schaue kurz nach…") leave the answer body for the tool
  // timeline; the answer is the text after the last tool round (Settings → Antworten keeps them inline)
  const notesInline = usePreferences().prefs['answers.progressNotes'];
  const split = notesInline ? null : splitProgressNotes(message);
  const shownText = split ? split.answer : message.text;
  // same notes → same array (memoized timeline rows / disclosure don't re-render per streamed token)
  const notesKey = split?.notes.length ? split.notes.map((n) => `${n.toolId}\u0000${n.at}\u0000${n.text}`).join('\u0001') : '';
  const progressNotes = useMemo(() => (split?.notes.length ? split.notes : NO_NOTES), [notesKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // Hermes `MEDIA:<path>` tags become file chips / inline images below the answer; the raw path is not shown
  // while streaming only the tail after the last complete line is scanned again (per-message memo, mediaTags.ts; it
  // checks that the text still extends what it froze, so a discarded render or a replaced answer cannot corrupt it)
  const mediaCaches = useMemo<[MediaTagCache, MediaTagCache]>(() => [createMediaTagCache(), createMediaTagCache()], []);
  // the answer text's append run (chatState.ts): parsers skip their full-text "still the same start?" compare
  const textRun = textAppendRun(message);
  const shownRun = shownText === message.text ? textRun : undefined;
  const media = useMemo(() => {
    const extract = (text: string, i: 0 | 1) =>
      streaming ? extractMediaCached(text, true, mediaCaches[i], i === 0 ? shownRun : textRun) : extractMedia(text, false);
    const m = extract(shownText, 0);
    // tags inside interim notes still become file chips
    return shownText === message.text ? m : { ...m, refs: extract(message.text, 1).refs };
  }, [shownText, message.text, streaming, mediaCaches, shownRun, textRun]);
  const rawSegments = useSegments(media.text, !streaming, message.id, media.text === shownText ? shownRun : undefined);
  // finished answers: B3 closing `[n]` sources list → sources block + numeric pills; UX8 duplicated translation text
  const cited = useMemo(
    () => (streaming ? { segments: rawSegments, cites: 0, research: false } : withCitationSources(dedupeTranslations(rawSegments))),
    [rawSegments, streaming],
  );
  // WSP / web search: cited items joined with what the turn's web tools retrieved (snippets, "not retrieved" hint)
  const turnTools = message.tools;
  const segments = useMemo(() => (streaming ? cited.segments : withRetrievedSources(cited.segments, turnTools)), [cited.segments, turnTools, streaming]);
  const hasRich = segments.some((s) => s.kind !== 'markdown');
  // the answer's own follow-ups (skill: `suggestions` at the end) win over the bridge's meta follow-ups: one zone only
  const ownSuggestions = segments.some((s) => s.kind === 'hui' && s.node?.type === 'suggestions');
  // skeleton shape announced by the router (`component` refines `format`, e.g. choice → slots)
  const routeShape = skeletonShapeForRoute(message.route?.format, message.route?.component) ?? null;
  const showSkeleton = streaming && !!routeShape && !hasRich;
  const empty = !media.text.trim();
  // copy text is built lazily in the handlers (O(text) per streaming update otherwise); "is there any
  // copyable text" = any markdown segment (text outside ```hui / ```hui-html blocks)
  const hasCopy = segments.some((sg) => sg.kind === 'markdown');
  const copyText = () => plainCopyText(media.text);
  // Werkzeug-Details: off = no tool UI · compact = chips · verbose = timeline panel + footer + sheet
  const mode = useToolDetails().toolDetails;
  const verbose = mode === 'verbose';
  const followupsRow = useMemo(() => (followups && followups.type === 'suggestions' ? ({ ...followups, layout: 'row' } as HuiNode) : followups), [followups]);
  const [sheetKey, setSheetKey] = useState<string | null>(null);
  const showReasoning = !!message.reasoning && !verbose;
  const uiPrefs = usePreferences().prefs;
  const showTime = uiPrefs.showTimestamps;
  // waiting delight (ui/loaders): context-aware indicator + rotating status line until the first content
  const reducedMotion = useMotionReduced();
  const waitMode = resolveWaitMode(uiPrefs.waitingAnimations, reducedMotion);
  const profile = useActiveProfile();
  const persona = useMemo(() => personaLoader(profile), [profile]);
  const seed = useMemo(() => seedFrom(id), [id]);
  // Hermes extras (hermesTools.ts / reminder.ts): context-compression divider, "gemerkt" notes, reminder cards, media bridge
  const compacted = useMemo(() => shouldShowCompactionDivider(message, isFirstTurn), [message.trace, message.tools, isFirstTurn]); // eslint-disable-line react-hooks/exhaustive-deps
  const notes = useMemo(() => (streaming ? [] : memoryNotes(message.tools)), [streaming, message.tools]);
  const reminders = useMemo(() => (streaming ? [] : parseReminders(message.tools)), [streaming, message.tools]);
  const mediaConn = useMemo(() => (profile?.kind === 'hermes' && profile.bridge && profile.baseUrl ? { baseUrl: profile.baseUrl, apiKey: profile.apiKey } : null), [profile]);
  const waitState = useMemo(() => waitStateOf({ tools: message.tools, routeShape }), [message.tools, routeShape]);
  const waitStartedAt = message.createdAt || undefined;
  // the status row sits ABOVE a route skeleton (where the first streamed line will appear), never on top of its
  // cards; self-labeled skeleton shapes need it only while a tool runs
  const thinking = streaming && empty && (!showSkeleton || routeBadgeVisible(routeShape!, waitState));
  const mdBase = useMarkdownImageBase();
  const compareAfter = useMemo(() => (compareBefore && !streaming ? resultImageUrl(message, mdBase) : null), [compareBefore, streaming, message, mdBase]);
  // Settings → Schriftgröße also reaches the shell texts around the answer (Markdown scales itself)
  const fs = (size: number, line: number) => scaledText(size, line, t.fontScale);
  // answer "⋯" / long-press menu (answerMenu.ts): header (time + model), branch, retry ▸, copy/share, "Melden" last.
  // "Antwort melden" (Play AI-generated content policy) keeps its report sheet (compliance/)
  const report = useAnswerReport(id);
  const actions = useAnswerActions();
  const { formatDate, formatRelative, locale } = useLocale();
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [imageOpen, setImageOpen] = useState(false);
  const failed = message.status === 'error';
  const reportable = !local && !streaming && !failed;
  const menuItems = useMemo<MenuItem[]>(() => {
    if (!menuOpen) return [];
    const keys = answerMenuItems({
      local,
      streaming,
      failed,
      isLast,
      busy: false,
      hasText: hasCopy,
      recovering,
      usedWeb: usedWebSearch(message),
      shareImage: SHARE_IMAGE_SUPPORTED && uiPrefs['answers.shareImage'],
      reported: !!report.report,
      canBranch: !!actions?.canBranch,
      canHandOff: !!actions?.handOff && !!message.quick,
    });
    const items: MenuItem[] = [];
    for (const k of keys) {
      switch (k) {
        case 'handOff':
          if (actions?.handOff) items.push({ key: k, icon: 'branch', label: tr('quick.handOff.action'), hint: tr('quick.handOff.a11y'), onPress: () => actions.handOff?.(id) });
          break;
        case 'branch':
          if (actions) items.push({ key: k, icon: 'branch', label: tr('menus.answer.branch'), onPress: () => actions.branchFrom(id) });
          break;
        case 'retry':
          if (!actions) break;
          items.push({
            key: k,
            icon: 'retry',
            label: tr('menus.answer.retry'),
            submenu: [
              { key: 'same', icon: 'retry', label: tr('menus.answer.retrySame'), onPress: () => actions.retry('same') },
              // quick answers have their own model setting (Settings → Schnellfrage)
              ...(actions.quick ? [] : [{ key: 'model', icon: 'spark' as const, label: tr('menus.answer.retryModel'), hint: tr('menus.answer.retryModelHint'), onPress: () => actions.retry('model') }]),
              { key: 'longer', icon: 'plus', label: tr('menus.answer.retryLonger'), onPress: () => actions.retry('longer') },
              { key: 'shorter', icon: 'compress', label: tr('menus.answer.retryShorter'), onPress: () => actions.retry('shorter') },
            ],
          });
          break;
        case 'noWeb':
          if (actions) items.push({ key: k, icon: 'globe', label: tr('menus.answer.noWeb'), onPress: () => actions.retry('noWeb') });
          break;
        case 'copy':
          items.push({ key: k, icon: 'copy', label: tr('actions.copy'), onPress: () => copy(plainCopyText(media.text), tr('chat.message.answerCopied')) });
          break;
        case 'copyMarkdown':
          items.push({ key: k, icon: 'code', label: tr('menus.answer.copyMarkdown'), onPress: () => copy(media.text.trim(), tr('menus.answer.markdownCopied')) });
          break;
        case 'share':
          items.push({ key: k, icon: 'share', label: tr('actions.share'), onPress: () => void share(plainCopyText(media.text)) });
          break;
        case 'shareImage':
          items.push({ key: k, icon: 'image', label: tr('menus.answer.shareImage'), onPress: () => setImageOpen(true) });
          break;
        case 'report':
          items.push({ key: k, icon: 'flag', label: tr('compliance.report.action'), onPress: () => setReportOpen(true), quiet: true });
          break;
        case 'undoReport':
          items.push({ key: k, icon: 'flag', label: tr('compliance.report.undo'), onPress: () => withdrawReport(id), quiet: true });
          break;
      }
    }
    return items;
  }, [menuOpen, local, streaming, failed, isLast, hasCopy, recovering, message, uiPrefs, report.report, actions, tr, copy, share, media.text, id]);
  const menuHeader = useMemo(() => {
    if (!menuOpen) return null;
    const lines: string[] = [];
    const at = message.createdAt;
    if (at && Number.isFinite(at)) {
      const today = new Date(at).toDateString() === new Date().toDateString();
      const absolute = formatDate(at, today ? { timeStyle: 'short' } : { dateStyle: 'medium', timeStyle: 'short' });
      lines.push(tr('menus.answer.time', { relative: formatRelative(at), absolute }));
    }
    if (message.quick) lines.push(tr('quick.meta.menuLine', { model: shortModel(message.quick.model) ?? '–' }));
    else if (actions && !local) lines.push(modelLine(actions.modelInfo(message), tr));
    return <MenuHeader lines={lines} />;
  }, [menuOpen, message, actions, local, tr, formatDate, formatRelative]);
  const openMenu = !streaming ? () => setMenuOpen(true) : undefined;
  // macOS app: right-click → native menu with the answer actions (desktop/messageMenu.ts); {} elsewhere
  const nativeMenu = useNativeContextMenu(() => {
    if (streaming || recovering) return null;
    const keys = answerMenuItems({ local, streaming, failed, isLast, busy: false, hasText: hasCopy, recovering, usedWeb: false, shareImage: false, reported: !!report.report, canBranch: !!actions?.canBranch });
    const sp = getSpeakerState();
    const speaking = sp.messageId === id && (sp.status === 'playing' || sp.status === 'paused' || sp.status === 'loading');
    return answerContextMenu(
      keys,
      {
        copy: () => copy(plainCopyText(media.text), tr('chat.message.answerCopied')),
        copyMarkdown: () => copy(media.text.trim(), tr('menus.answer.markdownCopied')),
        retry: actions ? () => actions.retry('same') : undefined,
        speak: local ? undefined : speaking ? stopSpeaking : () => toggleSpeaking({ id, text: shownText, conn: voiceConn, t: tr, locale }),
        speaking,
        share: () => void share(plainCopyText(media.text)),
        branch: actions ? () => actions.branchFrom(id) : undefined,
      },
      tr,
    );
  });
  const sheets = (
    <>
      {menuOpen ? <ActionMenu visible onClose={() => setMenuOpen(false)} label={tr('menus.answer.title')} header={menuHeader} items={menuItems} /> : null}
      {reportOpen ? (
        <ReportSheet visible messageId={id} conversationId={conversationId} answerText={copyText} onClose={() => setReportOpen(false)} onToast={toast} />
      ) : null}
      {imageOpen ? <ShareImageSheet segments={segments} onDone={() => setImageOpen(false)} /> : null}
    </>
  );

  if (report.hidden && !streaming) {
    // reported: hidden until the user taps "Gemeldet – anzeigen?" (this session); undo via the menu after showing
    return (
      <View style={styles.assistant}>
        <Pressable
          onPress={report.reveal}
          accessibilityRole="button"
          accessibilityLabel={tr('compliance.report.hiddenA11y')}
          style={({ pressed }) => [styles.reportedCover, { backgroundColor: t.colors.surfaceAlt, borderRadius: t.radii.m }, pressed && { opacity: 0.7 }]}
        >
          <Icon name="flag" size={15} color={t.colors.muted} />
          <Text style={[fs(13.5, 18), { color: t.colors.muted, flex: 1 }]}>{tr('compliance.report.hidden')}</Text>
          <Icon name="eye" size={16} color={t.colors.muted} />
        </Pressable>
        {sheets}
      </View>
    );
  }

  return (
    <Pressable
      {...nativeMenu}
      onLongPress={openMenu}
      delayLongPress={400}
      style={styles.assistant}
      // P0-2: an accessible Pressable is ONE VoiceOver element that hides every control inside the answer
      // (checklist boxes, choices, sliders, links). Keep the long-press gesture for sighted users; screen
      // reader users copy via the "Kopieren" button in the action row below.
      accessible={false}
      focusable={false}
    >
      {mode === 'compact' && message.tools.length ? <ToolChips tools={message.tools} /> : null}
      {verbose ? <ToolTimelinePanel message={message} onOpen={setSheetKey} notes={progressNotes} /> : null}
      {!verbose && progressNotes.length ? <ProgressNotesDisclosure notes={progressNotes} /> : null}
      <ApprovalHistory log={message.approvalLog} />
      {showReasoning ? <Reasoning text={message.reasoning ?? ''} live={streaming && empty} /> : null}
      {thinking && !showReasoning && !message.approval ? <WaitingIndicator state={waitState} mode={waitMode} seed={seed} persona={persona} startedAt={waitStartedAt} /> : null}
      {streaming && (message.statusNote || (empty && progressNotes.length)) ? (
        // server status line, else the agent's latest interim note while its tools run (UX1)
        <Text style={[styles.statusNote, fs(13, 18), { color: t.colors.muted }]} numberOfLines={2} accessibilityLiveRegion="polite">
          {message.statusNote || progressNotes[progressNotes.length - 1].text}
        </Text>
      ) : null}
      {compareBefore && compareAfter ? <BeforeAfter before={compareBefore} after={compareAfter} /> : null}
      {extraAtts?.length && !streaming ? (
        <View style={styles.attachments}>
          <MessageAttachments attachments={extraAtts} align="start" />
        </View>
      ) : null}
      {compacted ? <ContextDivider /> : null}
      <AnswerScope segments={segments} streaming={streaming} cites={cited.cites}>
        {segments.map((seg, i) => (seg.kind === 'hui' && seg.node?.type === 'suggestions' && !uiPrefs.showFollowups ? null : (
          <SegmentView
            key={seg.key}
            seg={seg}
            first={i === 0}
            live={streaming && !message.approval && i === segments.length - 1}
            onAction={onAction}
            route={routeShape}
            collapse={seg.kind === 'markdown' && (summaryBefore(segments, i) || (cited.research && i === firstMarkdown(segments) ? 'section' : false))}
          />
        )))}
      </AnswerScope>
      {showSkeleton && routeShape ? (
        <View style={empty && !thinking ? undefined : styles.segGap}>
          <RouteSkeleton format={routeShape} />
        </View>
      ) : null}
      {!streaming && media.refs.length ? <MediaFiles refs={media.refs} conn={mediaConn} /> : null}
      {notes.length ? <MemoryNotes notes={notes} /> : null}
      {reminders.length ? <ReminderCards reminders={reminders} /> : null}
      {message.truncated ? (
        <Text style={[styles.stopped, fs(12.5, 17), { color: t.colors.subtle }]}>{tr('chat.message.truncated')}</Text>
      ) : null}
      {message.textCapped ? (
        <Text style={[styles.stopped, fs(12.5, 17), { color: t.colors.subtle }]}>{tr('chat.message.capped')}</Text>
      ) : null}
      {isCut(message) ? (
        // direct backend, app was in the background: calm notice with "Fortsetzen" / "Neu starten" (background/cut.ts)
        <CutNotice message={message} isLast={isLast} onRetry={onRetry} />
      ) : message.status === 'error' ? (
        <View style={[styles.errorBox, { backgroundColor: t.colors.dangerSoft, borderRadius: t.radii.m }]}>
          <Icon name="alert" size={18} color={t.colors.danger} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[styles.errorTitle, fs(14, 19), { color: t.colors.danger }]}>{tr('chat.message.failed')}</Text>
            {message.error ? <FailureText message={message} override={authError && !message.errorText ? tr(AUTH_DENIED_KEY) : undefined} /> : null}
          </View>
          {isLast && authError && profile ? (
            // rejected key / token: retrying is pointless – open the profile editor of this connection
            <Pressable
              onPress={() => router.push({ pathname: '/settings', params: { edit: profile.id } })}
              style={({ pressed }) => [styles.retryBtn, { borderColor: t.colors.borderStrong }, pressed && { opacity: 0.6 }]}
              accessibilityRole="button"
            >
              <Text style={[styles.retryText, fs(13, 18), { color: t.colors.text }]}>{tr('chat.message.editConnection')}</Text>
            </Pressable>
          ) : isLast ? (
            <Pressable
              onPress={onRetry}
              style={({ pressed }) => [styles.retryBtn, { borderColor: t.colors.borderStrong }, pressed && { opacity: 0.6 }]}
              accessibilityRole="button"
            >
              <Icon name="retry" size={15} color={t.colors.text} />
              <Text style={[styles.retryText, fs(13, 18), { color: t.colors.text }]}>{tr('chat.message.retry')}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {recovering ? (
        <Text style={[styles.stopped, fs(12.5, 17), { color: t.colors.muted }]} accessibilityLiveRegion="polite">
          {tr('chat.message.recovering')}
        </Text>
      ) : message.status === 'stopped' ? (
        <Text style={[styles.stopped, fs(12.5, 17), { color: t.colors.subtle }]}>{tr('chat.message.stopped')}</Text>
      ) : message.status === 'done' ? (
        <LateMark message={message} />
      ) : null}
      {message.quick && !streaming ? (
        // quick answer: "⚡ model · 1,6 s" in place of the turn footer (no tools to show)
        message.status === 'done' ? <QuickMetaLine stamp={message.quick} /> : null
      ) : (
        <>
          {verbose && !streaming ? <TurnFooter message={message} onOpen={setSheetKey} /> : null}
          {mode === 'compact' && !streaming ? <TurnFooter message={message} tokens={false} /> : null}
        </>
      )}
      {verbose && sheetKey ? <ToolDetailSheet message={message} rowKey={sheetKey} onClose={() => setSheetKey(null)} /> : null}
      {/* N5: no action row under an answer that is still being fetched (stream lost, recovery running) */}
      {!streaming && !recovering && message.status !== 'error' && (hasCopy || reportable) ? (
        <View style={styles.actionsRow}>
          {/* visible row: Kopieren · Vorlesen · Teilen · ⋯ (retry variants, branch, image, Melden live in the menu) */}
          {hasCopy ? <CopyButton onCopy={() => copy(copyText(), tr('chat.message.answerCopied'))} /> : null}
          {local || !hasCopy ? null : <SpeakButton message={shownText === message.text ? message : { id: message.id, text: shownText }} conn={voiceConn} onError={toast} />}
          {hasCopy ? <IconButton icon="share" label={tr('actions.share')} onPress={() => void share(copyText())} /> : null}
          {openMenu ? <IconButton icon="more" label={tr('menus.answer.more')} onPress={openMenu} /> : null}
          {showTime ? <Timestamp at={message.createdAt} inline /> : null}
          {/* quick thread, newest answer: the way on to the full agent */}
          {actions?.handOff && message.quick && isLast && !local ? <HandOffButton onPress={() => actions.handOff?.(id)} /> : null}
        </View>
      ) : showTime && !streaming ? (
        <Timestamp at={message.createdAt} />
      ) : null}
      {reformatted && !streaming ? <ReformattedMarker /> : null}
      {/* A1 "Umformen" chips: last finished answer only (the tag reformats "the last answer"); not under quick answers */}
      {isLast && !local && !actions?.quick && message.status !== 'stopped' ? <TransformBar message={message} onAction={onAction} segments={segments} text={media.text} /> : null}
      {followups && isLast && !streaming && uiPrefs.showFollowups && !ownSuggestions ? (
        <View style={styles.followups}>
          {/* follow-ups: vertical list of full questions (Suggestions layout "row") */}
          <HuiView node={followupsRow} onAction={onAction} />
        </View>
      ) : null}
      {sheets}
    </Pressable>
  );
}

const NO_NOTES: readonly ProgressNote[] = [];

/** "Modell: Sonnet 5.5 · Denken: Hoch" (unknown parts omitted) */
function modelLine(info: AnswerModelInfo, tr: TFn): string {
  const model = info.isDefault
    ? info.model
      ? tr('menus.answer.modelDefaultNamed', { model: info.model })
      : tr('menus.answer.modelDefault')
    : info.model;
  const parts = [model ? tr('menus.answer.model', { model }) : '', info.effort ? tr('menus.answer.effortPart', { effort: tr(`menus.effort.${info.effort}` as TKey) }) : ''];
  return parts.filter(Boolean).join(' · ');
}

/** index of the first non-empty markdown segment (B3 research collapse applies to it), -1 if none */
function firstMarkdown(segments: readonly Segment[]): number {
  return segments.findIndex((s) => s.kind === 'markdown' && !!s.text.trim());
}

/** Settings → Chat → Zeitstempel: time today, date + time otherwise. */
function Timestamp({ at, inline }: { at: number; inline?: boolean }) {
  const t = useTheme();
  const { formatDate } = useLocale();
  const size = scaledText(11.5, 15, t.fontScale);
  if (!at || !Number.isFinite(at)) return null;
  const today = new Date(at).toDateString() === new Date().toDateString();
  const label = formatDate(at, today ? { timeStyle: 'short' } : { dateStyle: 'short', timeStyle: 'short' });
  return (
    <Text style={[styles.time, size, inline && styles.timeInline, { color: t.colors.subtle }]} numberOfLines={1}>
      {label}
    </Text>
  );
}

/** "Kopieren" in the action row: check + "Kopiert" for COPIED_MS after a tap (same state as the code boxes). */
function CopyButton({ onCopy }: { onCopy: () => void }) {
  const t = useTheme();
  const tr = useT();
  const [copied, flashCopied] = useCopiedFlash();
  return (
    <Pressable
      onPress={() => {
        onCopy();
        flashCopied();
      }}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={copied ? tr('actions.copied') : tr('actions.copy')}
      style={({ pressed }) => [styles.iconBtn, styles.copyBtn, pressed && { backgroundColor: t.colors.surfacePressed }]}
    >
      <Icon name={copied ? 'check' : 'copy'} size={17} color={copied ? t.colors.success : t.colors.muted} />
      {/* icon only: a "Kopiert" label pushed the neighbouring actions ~48 dp (E2E round 7); the toast says it */}
    </Pressable>
  );
}

function IconButton({ icon, label, onPress }: { icon: Extract<IconName, 'copy' | 'retry' | 'share' | 'more'>; label: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.iconBtn, pressed && { backgroundColor: t.colors.surfacePressed }]}
    >
      <Icon name={icon} size={17} color={t.colors.muted} />
    </Pressable>
  );
}

const SegmentView = memo(function SegmentView({
  seg,
  first,
  live,
  onAction,
  route,
  collapse = false,
}: {
  seg: Segment;
  first: boolean;
  live: boolean;
  onAction: ActionHandler;
  /** A2: markdown after a `summary` node folds long text ("Weiterlesen"); `'section'`: B3 research answer */
  collapse?: boolean | 'section';
  /** router hint (`message.route.format`) – shapes the placeholder of a block that just started */
  route: string | null;
}) {
  const gap = first ? undefined : styles.segGap;
  switch (seg.kind) {
    case 'markdown':
      if (!seg.text.trim()) return null;
      return (
        <View style={gap}>
          <Markdown text={seg.text} streaming={live} collapse={collapse} run={segmentAppendRun(seg)} />
        </View>
      );
    case 'hui':
      return (
        <View style={gap}>
          <HuiSegment seg={seg} onAction={onAction} route={route} />
        </View>
      );
    case 'html':
      return (
        <View style={gap}>
          <HtmlBlock html={seg.html} complete={seg.complete} onAction={(a) => onAction(a, undefined, { source: 'html' })} />
        </View>
      );
  }
});

function HuiSegment({ seg, onAction, route }: { seg: Extract<Segment, { kind: 'hui' }>; onAction: ActionHandler; route: string | null }) {
  const t = useTheme();
  const tr = useT();
  // a block that starts streaming takes over from the route skeleton in place: no fade (it would
  // blink the identical placeholder); blocks that are complete on mount (history) fade in as before
  const [fadeIn] = useState(seg.complete);
  // while streaming, HuiView always renders something: the node, its own skeleton, or a placeholder
  // shaped like the (guessed) type / router hint – never an empty area (protocol huiStreamView)
  if ((seg.node || !seg.complete) && !seg.fallback) {
    return <HuiView node={seg.node} streaming={!seg.complete} onAction={onAction} routeFormat={route} animateIn={fadeIn} />;
  }
  if (seg.node) {
    // the block was not a renderable node: its content as a readable list + the raw block on demand
    return (
      <View>
        <Text style={[styles.fallbackNote, { color: t.colors.muted }, scaledText(12.5, 17, t.fontScale)]}>{tr('chat.message.componentFallback')}</Text>
        <HuiView node={seg.node} streaming={false} onAction={onAction} routeFormat={route} animateIn={fadeIn} />
        <RawBlock raw={seg.raw} />
      </View>
    );
  }
  return (
    <View>
      <View style={[styles.errorBox, { backgroundColor: t.colors.surfaceAlt, borderRadius: t.radii.m }]}>
        <Icon name="alert" size={16} color={t.colors.muted} />
        <Text style={[{ flex: 1, color: t.colors.muted }, scaledText(13, 18, t.fontScale)]}>
          {seg.error ? tr('chat.message.componentErrorDetail', { error: seg.error }) : tr('chat.message.componentError')}
        </Text>
      </View>
      <RawBlock raw={seg.raw} />
    </View>
  );
}

/** Collapsed "Rohdaten anzeigen" for a hui block that could not be rendered as intended. */
function RawBlock({ raw }: { raw: string }) {
  const t = useTheme();
  const tr = useT();
  const [open, setOpen] = useState(false);
  if (!raw.trim()) return null;
  return (
    <View style={styles.rawWrap}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={styles.reasoningHead}
      >
        <Text style={[styles.reasoningTitle, scaledText(13, 18, t.fontScale), { color: t.colors.muted }]}>
          {open ? tr('chat.message.hideRaw') : tr('chat.message.showRaw')}
        </Text>
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} color={t.colors.muted} />
      </Pressable>
      {open ? (
        <ScrollView horizontal style={[styles.rawBody, { backgroundColor: t.colors.surfaceAlt, borderRadius: t.radii.s }]} contentContainerStyle={{ padding: 10 }}>
          <Text selectable style={[styles.rawText, { color: t.colors.muted }]}>
            {raw.length > 20000 ? raw.slice(0, 20000) + '…' : raw}
          </Text>
        </ScrollView>
      ) : null}
    </View>
  );
}

/** Collapsible "thinking" (delta.reasoning_content). */
function Reasoning({ text, live }: { text: string; live: boolean }) {
  const t = useTheme();
  const tr = useT();
  const [open, setOpen] = useState(false);
  const titleSize = scaledText(13.5, 18, t.fontScale);
  const bodySize = scaledText(13.5, 20, t.fontScale);
  return (
    <View style={styles.reasoning}>
      <Pressable
        onPress={() => {
          if (Platform.OS !== 'web') LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
          setOpen((o) => !o);
        }}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={styles.reasoningHead}
      >
        <Text style={[styles.reasoningTitle, titleSize, { color: t.colors.muted }]}>{live ? tr('chat.thinking.live') : tr('chat.thinking.done')}</Text>
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} color={t.colors.muted} />
      </Pressable>
      {open ? (
        <View style={[styles.reasoningBody, { borderLeftColor: t.colors.borderStrong }]}>
          <Text style={[styles.reasoningText, bodySize, { color: t.colors.muted }]} selectable>
            {text.trim()}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  userRow: { flexDirection: 'column', alignItems: 'flex-end', gap: 6, paddingLeft: 56 },
  pendingWrap: { alignSelf: 'flex-end', alignItems: 'flex-end', maxWidth: '100%' },
  pendingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' },
  pendingText: { fontSize: 13 },
  queuedNote: { textAlign: 'right', marginBottom: 4 },
  userBubble: { paddingHorizontal: 16, paddingVertical: 10, maxWidth: '100%' },
  userText: { fontSize: 16, lineHeight: 23 },
  userPlain: { borderRightWidth: 2, paddingRight: 12, paddingLeft: 0, paddingVertical: 2, borderRadius: 0 },
  userPlainText: { textAlign: 'right' },
  time: { fontSize: 11.5, marginTop: 2, fontVariant: ['tabular-nums'] },
  timeInline: { marginTop: 0, marginLeft: 6 },
  replyRow: { maxWidth: '100%', alignItems: 'flex-end' },
  assistant: { width: '100%' },
  segGap: { marginTop: 14 },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, marginTop: 8 },
  fallbackNote: { marginBottom: 6 },
  rawWrap: { marginTop: 8 },
  rawBody: { marginTop: 6, maxHeight: 320 },
  rawText: { fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }), fontSize: 12, lineHeight: 17 },
  errorTitle: { fontSize: 14, fontWeight: '600' },
  retryBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6 },
  retryText: { fontSize: 13, fontWeight: '500' },
  stopped: { fontSize: 12.5, marginTop: 6 },
  statusNote: { fontSize: 13, fontStyle: 'italic', marginBottom: 6 },
  reasoning: { marginBottom: 10 },
  reasoningHead: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingVertical: 2 },
  reasoningTitle: { fontSize: 13.5, fontWeight: '500' },
  reasoningBody: { borderLeftWidth: 2, paddingLeft: 10, marginTop: 6 },
  reasoningText: { fontSize: 13.5, lineHeight: 20 },
  actionsRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 6, marginLeft: -6 },
  attachments: { marginBottom: 10 },
  followups: { marginTop: 12 },
  iconBtn: { padding: 6, borderRadius: 8 },
  copyBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  reportedCover: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, alignSelf: 'flex-start' },
});
