import { useRouter } from 'expo-router';
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useSyncExternalStore, type MutableRefObject } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ActionRunnerProvider, ActiveTimersBar, listBus, useActionRunner, type ListBusEvent } from '../actions';
import { ApprovalStack } from '../approvals';
import type { ApprovalChoice, ApprovalRequest } from '../hermes/types';
import type { Attachment, PendingUploads } from '../attachments';
import { useConversations } from '../conversations';
import { renameUnique, uniqueTitle } from '../conversations/title';
import type { ChatMessage, UseHermesChat } from '../hermes';
import { useHermesCapabilities } from '../hermes/useHermesCapabilities';
import type { HermesChatOptions } from '../hermes/capabilities';
import type { TurnOverride } from '../hermes/turnOverride';
import { shellState } from '../background/noticeState';
import { useT } from '../i18n';
import { metaConnFromProfile, useAutoTitle, useFollowups } from '../meta';
import { useConnection } from '../settings/ConnectionProvider';
import { usePreferences } from '../settings/PreferencesProvider';
import { chatMaxWidth } from '../settings/preferences';
import { openOnboarding } from '../onboarding/hostEvents';
import { ImageEditProvider } from '../imageedit';
import { deleteMessageState, getNodeStateStore } from '../nodestate';
import { parseMessage } from '../protocol/streamParser';
import type { HuiAction } from '../protocol/types';
import type { ConnectionProfile } from '../settings/profiles';
import { columnMaxWidth, useKeyboardShortcuts, useTheme } from '../ui';
import { stopSpeaking, useAutoRead, useStopSpeakingOn, voiceConnFromProfile } from '../voice';
import { lightHaptic, useChatActionHandler } from './actions';
import { buildAskMessage } from './ask';
import { ChatHeader } from './ChatHeader';
import { useChatShell } from './ChatShellContext';
import { MarkdownImageContext } from './MarkdownImageContext';
import { crashTestChat } from './crashTest';
import { Composer, type ComposerHandle } from './Composer';
import { useSlashCommands, type ChatOptionsControl } from './commands';
import { consumeComposerFocus, onComposerFocusRequest } from '../desktop/bridge';
import { useDesktopChatCommands } from '../desktop/chatCommands';
import { EmptyState } from './EmptyState';
import { HistoryPlaceholder } from './HistoryPlaceholder';
import { messageAreaFor } from './messageArea';
import { isLocalMessage, localChecklistMessage, type CreateListEvent } from './localMessages';
import { MessageList, type MessageListHandle } from './MessageList';
import { PendingSendContext, type PendingBubble } from './pendingSendContext';
import { ModelPicker } from './ModelPicker';
import { modelLabel } from './models';
import { useToast } from './Toast';
import { TurnActionsContext } from './turnActions';
import type { Health } from './useConnectionHealth';
import { AnswerActionsContext, type AnswerActions } from './answerActions';
import { answerModelInfo, planRetry, retryModel, type RetryVariant } from './answerMenu';
import { ChatMenu } from './ChatMenu';
import { FindBar } from './FindBar';
import { FindContext, type FindState } from './findContext';
import { findInMessages, foldText, normalizeQuery, NO_FIND, searchableText, stepMatch } from './findInChat';
import { reformatMessage } from './reformat';
import { useAnswerBranch } from './useAnswerBranch';
import { ConsentSheet } from '../compliance/Consent';
import { profileNeedsConsent } from '../compliance/consent';
import { useAiConsent } from '../compliance/store';
import { isOnboardingVisible, subscribeOnboardingVisible } from '../onboarding/hostEvents';

type Props = {
  chat: UseHermesChat;
  profile: ConnectionProfile;
  health: Health;
  offlineHint?: string;
  /** effective model of this conversation (undefined = Hermes server default) */
  model: string | undefined;
  /** store the picked model on the conversation */
  onPickModel(model: string | undefined): void;
  /** "Neuer Chat": the shell creates a new conversation (remounts this view) */
  onNewChat(): void;
  onOpenDrawer(): void;
  /** per-chat model options chip in the header (Hermes reasoning / "Schnell") */
  options?: ChatOptionsControl;
  /** thin notice under the header (e.g. "Verlauf konnte nicht geladen werden") */
  notice?: string;
  /** optional button in the notice (e.g. "Standard verwenden" after a rejected model) */
  noticeAction?: { label: string; onPress(): void };
  /** chat title for the header; default from the profile kind */
  title?: string;
  /** composer placeholder; default from the profile kind */
  placeholder?: string;
  /**
   * the chat's history is still on its way (a Hermes chat opened here for the first time): header and composer are
   * there, the message area shows a placeholder and a send waits (it would be merged against a missing history)
   */
  historyPending?: boolean;
};

/** header title per backend (session components may override via `title`) */
const KIND_TITLES: Record<string, string> = { hermes: 'Hermes', demo: 'Hermes' };

const DEMO_HEADER = { onConnect: () => void openOnboarding('choose') };

/** memo'd here: the view re-renders on every streaming update, the bar's props stay stable */
const TimersBar = memo(ActiveTimersBar);

/** the AI data-sharing consent sheet opens by itself once per app session (later: on the next send) */
let consentPrompted = false;

/** a send right after another one is refused until the hook reports `streaming` (same tick) */
const SEND_GUARD_MS = 500;

/**
 * Backend-agnostic chat UI: header, message list / starter surface, approval sheet, timers, composer.
 * Wires the shell features every backend shares: HuiAction routing (actions runner, ask, send result),
 * node state scope, voice (auto-read, Vorlesen), meta (auto title, follow-ups), local checklists
 * (add_to_list → create_list). The conversation id comes from
 * `ChatShellContext` (provided by ChatScreen), so session components only pass `chat` + `profile`.
 */
export function ChatView(props: Props) {
  // a hidden session (turn still running in a chat the user left) keeps its hooks, not its UI
  const shell = useChatShell();
  if (shell?.hidden) return null;
  return <ChatViewVisible {...props} />;
}

function ChatViewVisible(props: Props) {
  crashTestChat(props.chat.messages); // no-op unless EXPO_PUBLIC_HUI_CRASH_TEST=1
  const shell = useChatShell();
  const toast = useToast();
  const tr = useT();
  // the runner's `send` pass-through ({type:'send'} inside a confirmed flow) → the view's send
  const sendRef = useRef<(text: string) => boolean>(() => false);
  // false = refused (turn running): the runner toasts "busy" and reports the action as not done
  const onRunnerSend = useCallback((text: string) => sendRef.current(text), []);
  // "Fortsetzen" on a cut answer (MessageItem → CutNotice), without threading it through MessageList
  const continueTurn = props.chat.continueTurn;
  // card buttons of an answer (reminder "Ändern" / "Löschen"): the view's send / the composer's draft
  const prefillRef = useRef<(text: string) => void>(() => {});
  const turnActions = useMemo(
    () => ({ continueTurn, sendMessage: (text: string) => sendRef.current(text), prefillComposer: (text: string) => prefillRef.current(text) }),
    [continueTurn],
  );
  return (
    <MarkdownImageContext.Provider value={props.profile.baseUrl || null}>
      <TurnActionsContext.Provider value={turnActions}>
        <ActionRunnerProvider conversationId={shell?.conversationId} onToast={toast} onSend={onRunnerSend}>
          <ChatViewInner {...props} sendRef={sendRef} prefillRef={prefillRef} />
        </ActionRunnerProvider>
      </TurnActionsContext.Provider>
    </MarkdownImageContext.Provider>
  );
}

function ChatViewInner({
  chat,
  profile,
  health,
  offlineHint,
  model,
  onPickModel,
  onNewChat,
  onOpenDrawer,
  options,
  notice,
  noticeAction,
  title,
  placeholder,
  historyPending = false,
  sendRef,
  prefillRef,
}: Props & { sendRef: MutableRefObject<(text: string) => boolean>; prefillRef: MutableRefObject<(text: string) => void> }) {
  const t = useTheme();
  const tr = useT();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const shell = useChatShell();
  const conversationId = shell?.conversationId;
  // "Neuer Chat" also when this (empty) chat is bound to another profile than the active one (N1)
  const activeProfileId = useConnection().active.id;
  const { messages, send, retry, replaceMessages } = chat;
  const streaming = chat.status === 'streaming';
  const keyboardVisible = useKeyboardVisible();
  const listRef = useRef<MessageListHandle>(null);
  const composerRef = useRef<ComposerHandle>(null);
  // desktop app: focus requests (new chat via shortcut / tray / ⌘N); hidden background sessions do not take them
  const hiddenSession = !!shell?.hidden;
  useEffect(() => {
    if (hiddenSession) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = onComposerFocusRequest(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (composerRef.current && consumeComposerFocus()) composerRef.current.focus();
      }, 80);
    });
    return () => {
      clearTimeout(timer);
      off();
    };
  }, [hiddenSession]);
  const [modelOpen, setModelOpen] = useState(false);
  const [modelQuery, setModelQuery] = useState<string | undefined>(undefined); // "/model <name>" prefills the search
  // "Erneut versuchen ▸ Mit anderem Modell…": the same picker, the pick is a one-turn override (not stored)
  const [retryPick, setRetryPick] = useState(false);
  const openModel = useCallback(() => setModelOpen(true), []);
  const closeModel = useCallback(() => {
    setModelOpen(false);
    setModelQuery(undefined);
    // picked (onPick runs first) or dismissed: the next opening is the chat's own picker again
    setRetryPick(false);
  }, []);
  // sessions may pass an inline onPickModel: keep the picker's prop stable (it is memo'd)
  const pickRef = useRef(onPickModel);
  useEffect(() => {
    pickRef.current = onPickModel;
  }, [onPickModel]);

  // latest values for callbacks that must stay stable (memoized message rows)
  const live = useRef({ status: chat.status, messages, lastSendAt: 0, historyPending });
  useEffect(() => {
    live.current.status = chat.status;
    live.current.messages = messages;
    live.current.historyPending = historyPending;
  }, [chat.status, messages, historyPending]);
  const isBusy = useCallback(() => live.current.status === 'streaming' || Date.now() - live.current.lastSendAt < SEND_GUARD_MS, []);

  // a send waiting for its uploads (Hermes `pendingSend`): Stop / × cancel it and give the text back to the composer
  const uploadWait = chat.pendingSend;
  const chatStop = chat.stop;
  const stop = useCallback(() => {
    if (!uploadWait) return chatStop();
    const text = uploadWait.cancel();
    if (text) composerRef.current?.restoreText(text);
  }, [uploadWait, chatStop]);
  const pendingBubble = useMemo<PendingBubble | null>(
    () => (uploadWait ? { messageId: uploadWait.messageId, retry: uploadWait.retry, remove: uploadWait.remove, cancel: stop } : null),
    [uploadWait, stop],
  );

  // ---- sending (reports whether it actually sent → interactive nodes lock only on success)
  const sendMessage = useCallback(
    (text: string, attachments: Attachment[] = [], pending?: PendingUploads): boolean => {
      if (!text.trim() && !attachments.length) return false;
      if (isBusy()) return false;
      // history still loading: the draft stays, the user sees why
      if (live.current.historyPending) {
        toast(tr('conversations.sync.loading'));
        return false;
      }
      // the hook refuses while its own turn runs or after unmount → report it (nodes stay open, draft stays)
      if (!send(text, attachments, pending)) return false;
      live.current.lastSendAt = Date.now();
      requestAnimationFrame(() => listRef.current?.scrollToBottom(true));
      return true;
    },
    [send, isBusy, toast, tr],
  );
  // ---- AI data-sharing consent (compliance/consent.ts, Apple 5.1.2(i)): asked before the first message to a
  // non-demo backend and again after a text version bump. A refused send is parked and goes out on "weiter".
  const consent = useAiConsent();
  const consentBlocked = profileNeedsConsent(profile) && !consent.current;
  const [consentOpen, setConsentOpen] = useState(false);
  // first use (existing installs): the sheet opens by itself once per app session
  const [autoDismissed, setAutoDismissed] = useState(consentPrompted);
  // not by itself while an onboarding flow is on screen (it asks in its own consent step)
  const onboardingShown = useSyncExternalStore(subscribeOnboardingVisible, isOnboardingVisible, isOnboardingVisible);
  const consentVisible = consentBlocked && consent.loaded && (consentOpen || (!autoDismissed && !shell?.hidden && !onboardingShown));
  const pendingSend = useRef<{ text: string; attachments: Attachment[]; fromComposer: boolean } | null>(null);
  const blockedRef = useRef(consentBlocked);
  useEffect(() => {
    blockedRef.current = consentBlocked;
  }, [consentBlocked]);
  useEffect(() => {
    if (consentVisible) consentPrompted = true;
  }, [consentVisible]);
  const gatedSend = useCallback(
    (text: string, attachments: Attachment[], fromComposer: boolean, pending?: PendingUploads): boolean => {
      if (!blockedRef.current) return sendMessage(text, attachments, pending);
      if (!text.trim() && !attachments.length) return false;
      pendingSend.current = { text, attachments, fromComposer };
      setConsentOpen(true);
      return false; // draft stays
    },
    [sendMessage],
  );
  const flushPending = useCallback(() => {
    const p = pendingSend.current;
    pendingSend.current = null;
    if (!p) return;
    // composer drafts with attachments stay in the composer (one more tap on send); everything else goes out now
    if (p.fromComposer && p.attachments.length) return;
    if (sendMessage(p.text, p.attachments) && p.fromComposer) composerRef.current?.setText('');
  }, [sendMessage]);
  const acceptAiConsent = consent.accept;
  const acceptConsent = useCallback(() => {
    setConsentOpen(false);
    setAutoDismissed(true);
    void acceptAiConsent();
  }, [acceptAiConsent]);
  const laterConsent = useCallback(() => {
    pendingSend.current = null;
    setConsentOpen(false);
    setAutoDismissed(true);
  }, []);
  // accepted (here, in onboarding or loaded late) → the parked send goes out
  useEffect(() => {
    if (consentBlocked || !pendingSend.current) return;
    const raf = requestAnimationFrame(flushPending);
    return () => cancelAnimationFrame(raf);
  }, [consentBlocked, flushPending]);
  const composerSend = useCallback(
    (text: string, attachments: Attachment[], pending?: PendingUploads) => gatedSend(text, attachments, true, pending),
    [gatedSend],
  );
  const sendGated = useCallback((text: string, attachments: Attachment[] = []) => gatedSend(text, attachments, false), [gatedSend]);
  const sendText = useCallback((text: string) => sendGated(text), [sendGated]);
  useEffect(() => {
    sendRef.current = sendText;
  }, [sendRef, sendText]);
  useEffect(() => {
    prefillRef.current = (text: string) => {
      composerRef.current?.setText(text);
      composerRef.current?.focus();
    };
  }, [prefillRef]);

  // ---- HuiActions
  const run = useActionRunner();
  const runAction = useCallback((a: HuiAction, options?: { confirm?: boolean; hint?: string }) => run(a, options), [run]);
  const buildAsk = useCallback(
    async (action: Extract<HuiAction, { type: 'ask' }>, messageId: string | undefined) => {
      const all = live.current.messages;
      const own = all.find((m) => m.id === messageId);
      // the message holding the button first, then the rest of the chat (newest first)
      const ordered = [...(own ? [own] : []), ...all.filter((m) => m !== own && m.role === 'assistant').reverse()];
      const nodes: unknown[] = [];
      for (const m of ordered) for (const s of parseMessage(m.text)) if (s.kind === 'hui' && s.node) nodes.push(s.node);
      const records = conversationId ? await getNodeStateStore().getRecord(conversationId) : {};
      return buildAskMessage(action.text, action.include, nodes, records, messageId);
    },
    [conversationId],
  );
  const onAction = useChatActionHandler({ send: sendText, isBusy, run: runAction, buildAsk });

  const retryWith = useCallback(
    (override?: TurnOverride) => {
      lightHaptic();
      // the regenerated answer gets a new id: drop the node state of the old one
      const last = live.current.messages[live.current.messages.length - 1];
      if (conversationId && last?.role === 'assistant' && !isLocalMessage(last)) deleteMessageState(conversationId, last.id);
      retry(override);
    },
    [retry, conversationId],
  );
  const onRetry = useCallback(() => retryWith(), [retryWith]);
  const pickModel = useCallback(
    (m: string | undefined) => {
      if (retryPick) retryWith({ model: retryModel(profile.kind, m, profile.model) });
      else pickRef.current(m);
    },
    [retryPick, retryWith, profile.kind, profile.model],
  );

  const newChat = useCallback(() => {
    if (streaming) stop();
    stopSpeaking();
    lightHaptic();
    onNewChat();
  }, [streaming, stop, onNewChat]);

  const openSettings = useCallback(() => {
    Keyboard.dismiss();
    router.push('/settings');
  }, [router]);

  const openDrawer = useCallback(() => {
    Keyboard.dismiss();
    onOpenDrawer();
  }, [onOpenDrawer]);

  // ---- voice: auto-read finished replies, stop on conversation switch / unmount
  const voiceConn = useMemo(
    () => voiceConnFromProfile(profile),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [profile.kind, profile.baseUrl, profile.apiKey, profile.bridge],
  );
  useAutoRead(messages, voiceConn);
  useStopSpeakingOn(conversationId);

  // ---- meta: auto title (+ Hermes session PATCH when synced) and follow-up chips
  const metaConn = useMemo(
    () => metaConnFromProfile(profile),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [profile.kind, profile.baseUrl, profile.apiKey, profile.bridge],
  );
  const convs = useConversations();
  const meta = conversationId ? convs.get(conversationId) : undefined;
  // Settings → Chat → Auto-Titel / Folgefragen (off: no meta request at all)
  const { prefs } = usePreferences();
  useAutoTitle(messages, {
    enabled: prefs.autoTitles,
    bridge: metaConn,
    conversationKey: conversationId,
    hasTitle: !!meta && meta.titleSource !== 'auto',
    onTitle: (newTitle) => {
      if (!conversationId) return;
      const cur = convs.get(conversationId);
      if (!cur || cur.titleSource === 'user') return; // the user renamed it meanwhile
      // N8: Hermes titles are unique per server → pick a free variant ("… #2") up front, retry on a conflict
      const taken = convs.list.filter((c) => c.id !== conversationId).flatMap((c) => [c.title, c.remote?.title]);
      const title = uniqueTitle(newTitle, taken);
      convs.setAutoTitle(conversationId, title); // stays replaceable by Hermes titles (not a user rename)
      const remote = shell?.remote;
      if (!remote?.isSynced(cur)) return;
      const isConflict = (e: unknown) => (e as { code?: unknown } | null)?.code === 'invalid_title';
      void renameUnique(newTitle, taken, (t) => remote.rename(cur, t), isConflict).then((done) => {
        // best effort; the server took another variant → show that one
        if (done && done !== title && convs.get(conversationId)?.titleSource !== 'user') convs.setAutoTitle(conversationId, done);
      });
    },
  });
  const followups = useFollowups(messages, { bridge: metaConn, conversationKey: conversationId, enabled: prefs.showFollowups });

  // ---- add_to_list without a checklist → insert a LOCAL checklist message (never sent to the model)
  const pendingLists = useRef<CreateListEvent[]>([]);
  const flushLists = useCallback((): boolean => {
    if (!pendingLists.current.length) return true;
    if (!replaceMessages) {
      pendingLists.current = [];
      return false;
    }
    const next: ChatMessage[] = [...live.current.messages, ...pendingLists.current.map((e) => localChecklistMessage(e, Date.now(), Math.random, tr('chat.list.defaultTitle')))];
    if (!replaceMessages(next)) return false; // streaming → retried after the turn
    live.current.messages = next; // a second list in the same tick must build on this one
    pendingLists.current = [];
    requestAnimationFrame(() => listRef.current?.scrollToBottom(true));
    return true;
  }, [replaceMessages, tr]);
  useEffect(
    () =>
      listBus.subscribe((e: ListBusEvent) => {
        // only events of THIS chat (events without a conversation come from screens outside a chat, e.g. the gallery)
        if (e.type !== 'create_list' || !conversationId || e.conversationId !== conversationId) return;
        pendingLists.current.push({ title: e.title, kind: e.kind, items: e.items });
        if (!flushLists()) toast(tr('chat.list.pendingToast'));
      }),
    [conversationId, flushLists, toast, tr],
  );
  useEffect(() => {
    if (!streaming && pendingLists.current.length) flushLists();
  }, [streaming, flushLists]);

  // Approval sheet (Hermes only). Hidden locally via "Schließen" (e.g. after a 409); a chip re-opens it.
  // Approval cards (Hermes; demo/other backends only have the single `approval`). Queue, hide chip, expiry: ApprovalStack.
  const approvals = useMemo(() => chat.approvals ?? (chat.approval ? [chat.approval] : []), [chat.approvals, chat.approval]);
  const respondApprovalFor = chat.respondApprovalFor;
  const respondSingle = chat.respondApproval;
  const onApprovalRespond = useCallback(
    (a: ApprovalRequest, c: ApprovalChoice) => (respondApprovalFor ? respondApprovalFor(a, c) : respondSingle(c)),
    [respondApprovalFor, respondSingle],
  );

  // backends that resend the history: attachments already in this chat share the request budget
  const resendsHistory = profile.kind !== 'hermes';
  const history = useStableList(
    useMemo(
      () => (resendsHistory ? messages.flatMap((m) => (m.role === 'user' ? (m.attachments ?? []) : [])) : undefined),
      [resendsHistory, messages],
    ),
  );

  const onTimerDone = useCallback((tm: { label: string }) => toast(tr('chat.timerDone', { label: tm.label })), [toast, tr]);
  const kindTitle = KIND_TITLES[profile.kind] ?? 'Hermes';
  const shownTitle = title ?? kindTitle;

  // approval cards line up with the message column on wide windows (Settings → Chatbreite)
  const columnMax = columnMaxWidth(chatMaxWidth(prefs), 12);
  const columnStyle = useMemo(() => (columnMax === undefined ? undefined : { width: '100%' as const, maxWidth: columnMax, alignSelf: 'center' as const }), [columnMax]);

  const onEditSent = useCallback(() => toast(tr('imageEdit.sent')), [toast, tr]);
  const area = messageAreaFor(messages.length, historyPending);

  // slash palette (commands/)
  const slash = useSlashCommands({
    enabled: true,
    chat,
    profile,
    backendName: shownTitle,
    model,
    options,
    newChat,
    retry: onRetry,
    stop,
    openModel: (q) => {
      setModelQuery(q);
      setModelOpen(true);
    },
    fill: (v) => composerRef.current?.setText(v),
    sendText: sendGated,
  });

  // ---- answer "⋯" menu (MessageItem): branch, retry variants, model line of the header
  const hermesConn = useMemo(() => (profile.kind === 'hermes' ? { baseUrl: profile.baseUrl, apiKey: profile.apiKey } : undefined), [profile.kind, profile.baseUrl, profile.apiKey]);
  const serverDefault = useHermesCapabilities(hermesConn).catalog?.currentModel;
  const getMessages = useCallback(() => live.current.messages, []);
  const branchFrom = useAnswerBranch({ conversationId, profile, messages: getMessages, sessionId: chat.sessionId });
  const effort = chatEffort(profile, meta?.modelOptions);
  const answerActions = useMemo<AnswerActions>(
    () => ({
      kind: profile.kind,
      canBranch: !!conversationId,
      branchFrom: (id) => void branchFrom(id),
      retry: (variant: RetryVariant) => {
        if (isBusy()) {
          toast(tr('chat.busy'));
          return;
        }
        const plan = planRetry(variant, { kind: profile.kind, noWebNote: tr('menus.answer.noWebNote') });
        if (plan.type === 'retry') retryWith(plan.override);
        else if (plan.type === 'reformat') sendText(reformatMessage(plan.kind, tr));
        else {
          setRetryPick(true);
          setModelQuery(undefined);
          setModelOpen(true);
        }
      },
      modelInfo: (m) =>
        answerModelInfo({ kind: profile.kind, reported: m.metrics?.model ?? (m as { model?: string }).model, selected: model, serverDefault, effort }),
    }),
    [profile.kind, conversationId, branchFrom, isBusy, toast, tr, retryWith, sendText, model, serverDefault, effort],
  );

  // ---- "Im Chat suchen" (chat menu, ⌘/Ctrl+F): find bar, highlighted matches, scroll to the current one
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findFocus, setFindFocus] = useState(0);
  const findTerm = useDeferredValue(findQuery);
  const found = useMemo(() => (findOpen ? findInMessages(messages, findTerm, foldedSearchText) : NO_FIND), [findOpen, messages, findTerm]);
  const findTotal = found.matches.length;
  // current match per search term: a new term starts at the newest match
  const findKey = findOpen ? findTerm : '';
  const [findSel, setFindSel] = useState<{ key: string; idx: number }>({ key: '', idx: -1 });
  const findIdx = findSel.key === findKey ? findSel.idx : findTotal - 1;
  const findPos = findIdx >= findTotal ? findTotal - 1 : findIdx;
  const stepFind = (dir: 1 | -1) => setFindSel({ key: findKey, idx: stepMatch(findPos, findTotal, dir) });
  const currentMatch = findPos >= 0 ? found.matches[findPos] : undefined;
  const findActive = findOpen && !!normalizeQuery(findTerm);
  const findState = useMemo<FindState | null>(
    () => (findActive ? { query: findTerm, ids: found.messageIds, currentId: currentMatch?.messageId } : null),
    [findActive, findTerm, found.messageIds, currentMatch?.messageId],
  );
  const currentMatchId = currentMatch?.messageId;
  useEffect(() => {
    if (currentMatchId) listRef.current?.scrollToMessage(currentMatchId);
  }, [currentMatchId, findPos]);
  const openFind = useCallback(() => {
    setFindOpen(true);
    setFindFocus((n) => n + 1);
  }, []);
  const closeFind = useCallback(() => {
    setFindOpen(false);
    setFindQuery('');
  }, []);
  useKeyboardShortcuts((cmd) => {
    if (cmd !== 'find' || !shellState.chatFocused || !live.current.messages.length) return false;
    openFind();
  });
  // desktop app: ⇧⌘C "Letzte Antwort kopieren" (desktop/chatCommands.ts)
  useDesktopChatCommands(() => live.current.messages);

  // ---- chat menu (header ⋯ / wide title): find, export, pin, rename, archive, delete
  const [chatMenuOpen, setChatMenuOpen] = useState(false);
  const openChatMenu = useCallback(() => {
    Keyboard.dismiss();
    setChatMenuOpen(true);
  }, []);
  const chatMenu = (
    <ChatMenu
      open={chatMenuOpen}
      onClose={() => setChatMenuOpen(false)}
      meta={meta}
      hasMessages={messages.length > 0}
      onFind={openFind}
      onExport={() => slash.run('export')}
      onPin={() => {
        if (!meta) return;
        convs.pin(meta.id);
        toast(meta.pinned ? tr('menus.chat.unpinned') : tr('menus.chat.pinned'));
      }}
      onRename={(title) => slash.run('title', title)}
      onArchive={() => {
        if (!meta) return;
        const next = !meta.archived;
        convs.archive(meta.id, next);
        toast(next ? tr('menus.chat.archived') : tr('menus.chat.unarchived'));
        // archived chats leave the main list: continue in a fresh chat (a running turn keeps going in the background)
        if (next) onNewChat();
      }}
      onDelete={() => slash.run('delete')}
    />
  );

  return (
    <ImageEditProvider profile={profile} backendName={shownTitle} history={history} send={sendGated} onSent={onEditSent}>
    <View style={[styles.flex, { backgroundColor: t.colors.bg }]}>
      <ChatHeader
        topInset={insets.top}
        title={shownTitle}
        chatTitle={meta?.title}
        profileName={profile.name}
        health={health}
        offlineLabel={offlineHint}
        streaming={streaming}
        canReset={messages.length > 0 || profile.id !== activeProfileId}
        modelLabel={modelLabel(profile.kind, model)}
        onNewChat={newChat}
        onSettings={openSettings}
        onMenu={openDrawer}
        onModel={openModel}
        options={options}
        demo={profile.kind === 'demo' ? DEMO_HEADER : undefined}
        onChatMenu={!conversationId ? undefined : openChatMenu}
      />
      {findOpen ? (
        <FindBar
          query={findQuery}
          onChange={setFindQuery}
          total={findTotal}
          current={findPos}
          active={findActive}
          onPrev={() => stepFind(-1)}
          onNext={() => stepFind(1)}
          onClose={closeFind}
          focusKey={findFocus}
        />
      ) : null}
      {notice && noticeAction ? (
        <View style={[styles.noticeRow, { backgroundColor: t.colors.surfaceAlt }]} accessibilityRole="alert">
          <Text style={[styles.noticeText, { color: t.colors.muted }]} numberOfLines={2}>
            {notice}
          </Text>
          <Pressable onPress={noticeAction.onPress} accessibilityRole="button" hitSlop={8}>
            <Text style={{ color: t.colors.accent, fontSize: 13, fontWeight: '600' }}>{noticeAction.label}</Text>
          </Pressable>
        </View>
      ) : notice ? (
        <Text style={[styles.notice, { color: t.colors.muted, backgroundColor: t.colors.surfaceAlt }]} numberOfLines={2} accessibilityRole="alert">
          {notice}
        </Text>
      ) : null}
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        {area === 'list' ? (
          <AnswerActionsContext.Provider value={answerActions}>
            <FindContext.Provider value={findState}>
              <PendingSendContext.Provider value={pendingBubble}>
              <MessageList
                ref={listRef}
                messages={messages}
                onAction={onAction}
                onRetry={onRetry}
                conversationId={conversationId}
                voiceConn={voiceConn}
                followups={followups}
                historyTruncated={!!meta?.historyTruncated}
              />
              </PendingSendContext.Provider>
            </FindContext.Provider>
          </AnswerActionsContext.Provider>
        ) : area === 'placeholder' ? (
          <HistoryPlaceholder />
        ) : (
          <EmptyState
            onPick={sendText}
            profileName={profile.name}
            assistantName={shownTitle}
            offline={health === 'offline'}
            offlineHint={offlineHint}
            onOpenSettings={openSettings}
          />
        )}
        <TimersBar onTimerDone={onTimerDone} />
        <View style={columnStyle}>
          <ApprovalStack approvals={approvals} onRespond={onApprovalRespond} onClose={chat.dismissApproval} focus={chat.approvalFocus} style={styles.sheet} />
        </View>
        <Composer
          ref={composerRef}
          streaming={streaming}
          placeholder={placeholder ?? tr('chat.composer.placeholderFor', { name: shownTitle })}
          onSend={composerSend}
          onStop={stop}
          sendWhileUploading={uploadWait !== undefined}
          bottomInset={keyboardVisible ? 8 : insets.bottom}
          profile={profile}
          history={history}
          slash={slash.binding}
        />
      </KeyboardAvoidingView>
      <ModelPicker
        open={modelOpen}
        onClose={closeModel}
        profile={profile}
        current={model}
        onPick={pickModel}
        initialQuery={modelQuery}
        title={retryPick ? tr('menus.answer.retryModelTitle') : undefined}
      />
      {slash.sheet}
      {chatMenu}
      <ConsentSheet visible={consentVisible} onAccept={acceptConsent} onLater={laterConsent} />
    </View>
    </ImageEditProvider>
  );
}

const refuseSend = () => false;
const noop = () => {};

/**
 * The chat's frame while its stored transcript is read from local storage (a chat not in memory yet, usually a few
 * ms): the same header, history placeholder and composer the chat view shows, so a chat never opens as an empty
 * screen. Nothing can be sent yet; the real view replaces it as soon as the transcript is in.
 */
export function ChatViewPending({ profile, model, onNewChat, onOpenDrawer, title }: Pick<Props, 'profile' | 'model' | 'onNewChat' | 'onOpenDrawer' | 'title'>) {
  const shell = useChatShell();
  const t = useTheme();
  const tr = useT();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const convs = useConversations();
  const meta = shell?.conversationId ? convs.get(shell.conversationId) : undefined;
  const kindTitle = KIND_TITLES[profile.kind] ?? 'Hermes';
  const shownTitle = title ?? kindTitle;
  const openSettings = useCallback(() => router.push('/settings'), [router]);
  if (shell?.hidden) return null;
  return (
    <View style={[styles.flex, { backgroundColor: t.colors.bg }]}>
      <ChatHeader
        topInset={insets.top}
        title={shownTitle}
        chatTitle={meta?.title}
        profileName={profile.name}
        health="checking"
        streaming={false}
        canReset={false}
        modelLabel={modelLabel(profile.kind, model)}
        onNewChat={onNewChat}
        onSettings={openSettings}
        onMenu={onOpenDrawer}
        // the same buttons as the chat view (nothing to act on yet): the header does not change when it takes over
        onChatMenu={!shell?.conversationId ? undefined : noop}
      />
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <HistoryPlaceholder hint={profile.kind === 'hermes'} />
        <Composer
          streaming={false}
          disabled
          placeholder={tr('chat.composer.placeholderFor', { name: shownTitle })}
          onSend={refuseSend}
          onStop={noop}
          bottomInset={insets.bottom}
          profile={profile}
        />
      </KeyboardAvoidingView>
    </View>
  );
}

/**
 * A lazy session (sessionRegistry: demo and every other backend) before its stored transcript is in – the lazy chunk
 * itself (Suspense) or the storage read: the same header + composer frame as the loaded chat with the history
 * placeholder in the message area (ChatViewPending), the rule HermesSession follows, instead of a blank frame. Blank
 * only for a chat that is not in the index (deleted).
 */
export function SessionPending({
  exists = true,
  profile,
  model,
  onNewChat,
  onOpenDrawer,
  title,
}: Pick<Props, 'profile' | 'onNewChat' | 'onOpenDrawer' | 'title'> & { model?: string; exists?: boolean }) {
  const t = useTheme();
  if (!exists) return <View style={[styles.flex, { backgroundColor: t.colors.bg }]} />;
  return <ChatViewPending profile={profile} model={model} onNewChat={onNewChat} onOpenDrawer={onOpenDrawer} title={title} />;
}

/** folded searchable text per message object ("Im Chat suchen"): streaming only re-folds the growing answer */
const foldCache = new WeakMap<object, string>();
function foldedSearchText(m: Pick<ChatMessage, 'id' | 'role' | 'text'>): string {
  let f = foldCache.get(m);
  if (f === undefined) {
    f = foldText(searchableText(m));
    foldCache.set(m, f);
  }
  return f;
}

/** reasoning effort of the chat for the answer menu header (per-chat option or the profile setting) */
function chatEffort(profile: ConnectionProfile, options: HermesChatOptions | undefined): string | undefined {
  switch (profile.kind) {
    case 'hermes':
      return options?.reasoning;
    default:
      return undefined;
  }
}

/**
 * Same items (by identity) as last render → the previous array. `messages` changes on every streaming
 * update, but the user attachments derived from it don't: keeps memo'd consumers (Composer,
 * ImageEditProvider) from re-rendering.
 */
function useStableList<T>(list: readonly T[] | undefined): readonly T[] | undefined {
  const ref = useRef(list);
  const prev = ref.current;
  if (prev !== list && !(prev && list && prev.length === list.length && prev.every((x, i) => x === list[i]))) ref.current = list;
  return ref.current;
}

function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const a = Keyboard.addListener(showEvt, () => setVisible(true));
    const b = Keyboard.addListener(hideEvt, () => setVisible(false));
    return () => {
      a.remove();
      b.remove();
    };
  }, []);
  return visible;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  sheet: { marginHorizontal: 12, marginBottom: 8 },
  notice: { fontSize: 12.5, textAlign: 'center', paddingHorizontal: 16, paddingVertical: 6 },
  noticeRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 6 },
  noticeText: { flex: 1, fontSize: 12.5 },
});
