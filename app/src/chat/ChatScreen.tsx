import { isConversationVisible } from '../flavor';
import { useFocusEffect, useRouter } from 'expo-router';
import { Suspense, type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { setActiveConversation } from '../actions/activeConversation.ts';
import { markRead, shellState } from '../background/noticeState';
import { keptSessions, mountedSessionIds, turnRegistry } from '../background/turnRegistry';
import {
  ConversationDrawer,
  ConversationSidebar,
  setSidebarPrefs,
  toggleSidebar,
  useSidebarPrefs,
  useApplyRemoteTranscript,
  useConversation,
  useConversations,
  useHermesSessionSync,
  useRemotePrefetch,
  useRemoteTranscript,
  type ConversationMeta,
  type RemoteTranscript,
  type UseConversation,
} from '../conversations';
import { HermesOptionsSheet, chatOptionsSummary, effectiveChatOptions, useHermesCapabilities, useHermesChat } from '../hermes';
import { useT } from '../i18n';
import { isDesktopApp, onDesktopCommand, requestComposerFocus } from '../desktop/bridge';
import { useWindowVibrancy } from '../desktop/chrome';
import { deleteConversationState } from '../nodestate';
import { useStarterPrompt } from '../onboarding/starterPrompt';
import { useApprovalOpener, useInboxConnected, useInboxHandler } from '../push';
import { useConnection } from '../settings/ConnectionProvider';
import { usePreference, usePreferences } from '../settings/PreferencesProvider';
import type { ConnectionProfile } from '../settings/profiles';
import { isWideWidth, sidebarWidthFor, useKeyboardShortcuts, useTheme } from '../ui';
import { stopSpeaking } from '../voice';
import { ChatBoundary, crashStorage } from './ChatBoundary';
import { ChatLayoutContext, type ChatLayout } from './ChatLayoutContext';
import { emptyChatRebindTarget, resolveChatProfile } from './chatProfile.ts';
import { ChatShellContext, type ChatShell } from './ChatShellContext';
import { clearCrashMarker, readCrashMarker, shouldStartFresh } from './crashMarker';
import { ChatView, ChatViewPending, SessionPending } from './ChatView';
import { historyPendingFor } from './messageArea';
import { MissingConnection } from './MissingConnection';
import { SESSION_COMPONENTS } from './sessionRegistry';
import { effectiveModel, modelLabel, overrideFor } from './models';
import { useModelFallback } from './useModelFallback';
import { useConnectionHealth } from './useConnectionHealth';
import { sessionOptions, usePersistOnNewMessage } from './useSessionPersistence';
import { usePendingApprovalTarget } from '../approvals/usePendingApprovalTarget';

export type SessionProps = {
  conversationId: string;
  profile: ConnectionProfile;
  onNewChat(): void;
  onOpenDrawer(): void;
};

/**
 * Multi-chat shell: the open conversation (persisted) decides profile + backend. Each conversation
 * gets its own session component (`key={conversation.id}`): the chat hooks read `sessionId` and
 * `initialMessages` only on mount. Shell-wide wiring lives here (Hermes session sync, drawer,
 * node-state cleanup); per-chat features live in ChatView (via ChatShellContext).
 */
export function ChatScreen() {
  const t = useTheme();
  // macOS app: the sidebar material shows through the sidebar; the chat column paints the background itself
  const vibrancy = useWindowVibrancy();
  const router = useRouter();
  const { active, profiles, ready: connReady, setActive } = useConnection();
  const convs = useConversations();
  const [drawerOpen, setDrawerOpen] = useState(false);
  // ≥ 900 px: persistent, collapsible sidebar instead of the drawer (state remembered, ui/lib/layout.ts)
  const { width: windowW } = useWindowDimensions();
  const wide = isWideWidth(windowW);
  const sidebar = useSidebarPrefs();
  const sidebarOpen = wide && !sidebar.collapsed;
  const sidebarW = sidebarWidthFor(sidebar.width, windowW);
  const layout = useMemo<ChatLayout>(() => ({ wide, sidebarOpen }), [wide, sidebarOpen]);
  const [searchFocus, setSearchFocus] = useState(0); // ⌘/Ctrl+K: bump → the list focuses its search field
  if (wide && drawerOpen) setDrawerOpen(false); // grown past the breakpoint: the sidebar takes over

  // Hermes sessions as source of truth: list sync on start / foreground / drawer open; older sessions on demand.
  // "Chats: only this device" (chatScope.ts): no app chat from another device is listed, paged or fetched ahead
  const chatScope = usePreference('chatScope');
  const sync = useHermesSessionSync(profiles, { enabled: connReady, scope: chatScope });
  const { refresh: refreshSessions, remote } = sync;

  const openConv = convs.activeId ? convs.get(convs.activeId) : undefined;
  // a stored chat of a kind this build hides (flavor.ts) is not restored: a new chat starts instead
  const activeConv = openConv && isConversationVisible(openConv) ? openConv : undefined;
  const { ready: convsReady, create } = convs;

  // The last active chat crashed while rendering on the previous run (persisted crash marker) →
  // open a fresh empty chat instead; the crashed one stays in the drawer.
  const [crashChecked, setCrashChecked] = useState(false);
  const crashCheckStarted = useRef(false);
  // read at mount, in parallel with the profiles and the conversation index (one storage round trip less on
  // the way to the first chat paint); applied once both are loaded
  const [crashMarker] = useState(() => readCrashMarker(crashStorage));
  useEffect(() => {
    if (!connReady || !convsReady || crashCheckStarted.current) return;
    crashCheckStarted.current = true;
    void crashMarker.then((marker) => {
      if (shouldStartFresh(marker, convs.activeId ?? undefined)) {
        console.warn('[chat] last chat crashed on the previous run → opening a new chat', marker?.conversationId, marker?.message);
        create(active);
      }
      if (marker) void clearCrashMarker(crashStorage, marker.conversationId);
      setCrashChecked(true);
    });
  }, [connReady, convsReady, convs.activeId, create, active, crashMarker]);

  // first start / the open chat was deleted → start a new chat on the active profile
  useEffect(() => {
    if (!connReady || !convsReady || !crashChecked) return;
    if (!activeConv) create(active);
  }, [connReady, convsReady, crashChecked, activeConv, create, active]);

  // A chat runs on the profile it was started with – never on a profile of another kind (its history
  // and that profile's key would go to the wrong backend). Deleted profile → "Verbindung fehlt": the
  // user picks another profile of the same kind (persisted on the chat; `rebound` bridges the render until the
  // index update lands) or starts a new chat.
  // (A Hermes session unknown to the picked server starts with empty server-side history; the local
  // transcript is still shown.)
  const [rebound, setRebound] = useState<Record<string, string>>({});
  const resolved = useMemo(
    () => resolveChatProfile(activeConv, profiles, active, activeConv ? rebound[activeConv.id] : undefined),
    [activeConv, profiles, active, rebound],
  );
  const profile = resolved.status === 'ok' ? resolved.profile : null;
  const rebind = useCallback(
    (profileId: string) => {
      if (!activeConv) return;
      const convId = activeConv.id;
      const picked = profiles.find((p) => p.id === profileId);
      // same kind only (the reducer ignores anything else); persisted so the choice survives restarts
      if (!picked || picked.kind !== activeConv.profileKind) return;
      convs.setProfile(convId, { id: picked.id, kind: picked.kind });
      setRebound((r) => ({ ...r, [convId]: profileId }));
      if (profileId !== active.id) setActive(profileId);
    },
    [activeConv, profiles, convs, active.id, setActive],
  );

  // N1: the open chat is still empty and the active profile changed (pairing finished, connection added or
  // switched) → the empty chat follows it (no history, nothing leaks; the demo banner goes away). Chats with
  // messages keep their profile. ChatBoundary is keyed by profile id → the session remounts on the new backend.
  const rebindTo = emptyChatRebindTarget(activeConv, active, activeConv ? turnRegistry.isRunning(activeConv.id) : false);
  const rebindDraft = convs.rebindDraft;
  useEffect(() => {
    if (connReady && activeConv && rebindTo) rebindDraft(activeConv.id, rebindTo);
  }, [connReady, activeConv, rebindTo?.id, rebindTo?.kind, rebindDraft]); // eslint-disable-line react-hooks/exhaustive-deps

  // the open chat for deferred UI work (undo-window commits must not fire into a chat the user left)
  const openId = activeConv?.id ?? null;
  useLayoutEffect(() => {
    setActiveConversation(openId);
    shellState.openConversationId = openId;
    if (openId) markRead(openId); // "neue Antwort" dot in the drawer ends when the chat is opened
  }, [openId]);
  useEffect(
    () => () => {
      setActiveConversation(null);
      shellState.openConversationId = null;
    },
    [],
  );
  // "Antwort ist da" routing: settings / gallery on top → the chat is not what the user sees
  useFocusEffect(
    useCallback(() => {
      shellState.chatFocused = true;
      return () => {
        shellState.chatFocused = false;
      };
    }, []),
  );

  // A running turn belongs to its conversation, not to the screen: chats the user left while their answer is
  // still streaming keep their session mounted (hidden) until the turn ends (background/turnRegistry), so
  // switching chats / opening the drawer or settings never cuts the stream. At most MAX_BACKGROUND_TURNS.
  const running = useSyncExternalStore(turnRegistry.subscribe, turnRegistry.snapshot, turnRegistry.snapshot);
  const kept = useMemo(() => keptSessions(openId, running), [openId, running]);

  // Hermes chats never opened here (started elsewhere): their transcripts are fetched ahead once the app is idle after
  // a list sync and when the drawer opens, so the first tap on one is instant (active profile, drawer filter, ≤ 4)
  const [prefetchKick, setPrefetchKick] = useState(0);
  const isMounted = useCallback((id: string) => id === openId || kept.includes(id), [openId, kept]);
  useRemotePrefetch(connReady ? active : undefined, { syncStatus: sync.status, lastSyncAt: sync.lastSyncAt, kick: prefetchKick, isMounted, scope: chatScope });

  const openConversation = useCallback(
    (meta: ConversationMeta) => {
      const p = profiles.find((x) => x.id === meta.profileId);
      if (p && p.id !== active.id) setActive(p.id);
      convs.setActiveId(meta.id);
      setDrawerOpen(false);
    },
    [profiles, active.id, setActive, convs],
  );

  const newChat = useCallback(() => {
    stopSpeaking();
    create(active); // also sets it active; re-uses an empty draft of this profile
    setDrawerOpen(false);
  }, [create, active]);

  // desktop app (Tauri): global shortcut / tray / ⌘N → fresh chat with the composer focused
  useEffect(
    () =>
      onDesktopCommand((c) => {
        if (c === 'new-chat') newChat();
        requestComposerFocus();
      }),
    [newChat],
  );

  const onDeleted = useCallback(
    (id: string) => {
      void deleteConversationState(id); // persisted node state (checklists, choices, …) of that chat
      if (id === activeConv?.id) create(active);
    },
    [activeConv?.id, create, active],
  );

  const openSettings = useCallback(() => {
    setDrawerOpen(false);
    router.push('/settings');
  }, [router]);

  // Error screen → "Verbindung wechseln": whatever is picked in settings, coming back must not land
  // in the crashed chat again (picking the same profile keeps the open chat) → start a new chat.
  const switchFromCrashed = useRef<string | null>(null);
  const switchConnection = useCallback(() => {
    switchFromCrashed.current = activeConv?.id ?? null;
    router.push('/settings');
  }, [router, activeConv?.id]);
  useFocusEffect(
    useCallback(() => {
      const crashed = switchFromCrashed.current;
      if (!crashed) return;
      switchFromCrashed.current = null;
      if (convs.activeId === crashed) create(active);
    }, [convs.activeId, create, active]),
  );

  const resetChat = useCallback(async (id: string) => {
    await deleteConversationState(id);
  }, []);

  const profileName = useCallback((id: string) => profiles.find((p) => p.id === id)?.name, [profiles]);
  const openDrawer = useCallback(() => {
    if (wide) setSidebarPrefs({ collapsed: false });
    else setDrawerOpen(true);
    void refreshSessions();
    setPrefetchKick((n) => n + 1);
  }, [refreshSessions, wide]);

  // web / desktop app: ⌘/Ctrl+B sidebar, ⌘/Ctrl+K search, ⌘/Ctrl+N (or ⇧⌘O) new chat. Not while settings /
  // gallery are on top. The Tauri menu owns ⌘N there (its accelerator fires `new-chat` above).
  useKeyboardShortcuts((cmd) => {
    if (!shellState.chatFocused) return false;
    if (cmd === 'find') return false; // the open chat view's find bar (ChatView)
    if (cmd === 'toggle-sidebar') {
      if (wide) toggleSidebar();
      else if (drawerOpen) setDrawerOpen(false);
      else openDrawer();
    } else if (cmd === 'search') {
      openDrawer();
      setSearchFocus((n) => n + 1);
    } else {
      if (isDesktopApp()) return false;
      newChat();
      requestComposerFocus();
    }
  });

  const activeId = activeConv?.id;
  const shell = useMemo<ChatShell | null>(() => (activeId ? { conversationId: activeId, remote } : null), [activeId, remote]);

  // Wait for stored profiles + conversations (AsyncStorage, a few ms) so we never ping/stream with preset defaults.
  if (!connReady || !convsReady || !crashChecked || !activeConv || !shell) return <View style={[styles.flex, { backgroundColor: t.colors.bg }]} />;

  const listProps = {
    activeId: activeConv.id,
    // the open chat was archived from the list: continue in a new chat (its running turn keeps going)
    onArchived: (ids: string[]) => {
      if (ids.includes(activeConv.id)) create(active);
    },
    onSelect: openConversation,
    onNewChat: newChat,
    onDeleted,
    onOpenSettings: openSettings,
    profileName,
    remote,
    older: sync.older,
    searchFocus,
  };
  // phone: slide-in drawer (also closes when the window grows past the breakpoint)
  const drawer = wide ? null : <ConversationDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} {...listProps} />;
  // the root row: [sidebar (wide)] [chat] + the drawer overlay (absolute, last child)
  const frame = (content: ReactNode) => (
    <ChatLayoutContext.Provider value={layout}>
      <View style={[styles.flex, styles.row, { backgroundColor: vibrancy ? 'transparent' : t.colors.bg }]}>
        {sidebarOpen ? <ConversationSidebar width={sidebarW} onCollapse={() => setSidebarPrefs({ collapsed: true })} {...listProps} /> : null}
        <View style={[styles.flex, vibrancy && { backgroundColor: t.colors.bg }]}>{content}</View>
        {drawer}
      </View>
    </ChatLayoutContext.Provider>
  );
  // sessions of chats with a running turn that are not open (rendered hidden, see `kept`)
  const slot = (id: string, p: ConnectionProfile, kind: string, visible: boolean) => (
    <SessionSlot
      key={id}
      conversationId={id}
      profile={p}
      kind={kind}
      visible={visible}
      remote={remote}
      onNewChat={newChat}
      onOpenDrawer={openDrawer}
      onResetChat={resetChat}
      onSwitchConnection={switchConnection}
    />
  );
  const hiddenSlot = (id: string) => {
    const meta = convs.get(id);
    if (!meta) return null; // deleted while running → unmounted → aborted
    const r = resolveChatProfile(meta, profiles, active, rebound[id]);
    return r.status === 'ok' ? slot(id, r.profile, meta.profileKind, false) : null; // profile deleted → stopped
  };
  const hiddenSlots = (exclude: string | null) => kept.filter((id) => id !== exclude).map(hiddenSlot);

  if (!profile) {
    return frame(
      <>
        <MissingConnection
          kind={resolved.status === 'missing' ? resolved.kind : activeConv.profileKind}
          candidates={resolved.status === 'missing' ? resolved.candidates : []}
          onPick={rebind}
          onNewChat={newChat}
          onOpenSettings={openSettings}
          onOpenDrawer={openDrawer}
        />
        {hiddenSlots(null)}
      </>,
    );
  }

  // stable order (by id): switching between a hidden running chat and the open one only flips visibility,
  // React never re-parents (= remounts) a session
  const ids = mountedSessionIds(activeConv.id, kept);
  return frame(<>{ids.map((id) => (id === activeConv.id ? slot(id, profile, activeConv.profileKind, true) : hiddenSlot(id)))}</>);
}

type SlotProps = {
  conversationId: string;
  profile: ConnectionProfile;
  kind: string;
  /** false: a chat the user left while its turn still runs – hooks stay, ChatView renders nothing */
  visible: boolean;
  remote: ChatShell['remote'];
  onNewChat(): void;
  onOpenDrawer(): void;
  onResetChat(id: string): Promise<void>;
  onSwitchConnection(): void;
};

/** One conversation's session (open or hidden-running), with its own shell context and crash boundary. */
function SessionSlot({ conversationId: id, profile, kind, visible, remote, onNewChat, onOpenDrawer, onResetChat, onSwitchConnection }: SlotProps) {
  const shell = useMemo<ChatShell>(() => ({ conversationId: id, remote, hidden: !visible }), [id, remote, visible]);
  const resetChat = useCallback(() => onResetChat(id), [onResetChat, id]);
  const sessionProps: SessionProps = { conversationId: id, profile, onNewChat, onOpenDrawer };
  // Hermes renders inline; every other backend is its own lazy chunk (sessionRegistry, integration-B). While that
  // chunk loads: the chat's header + composer with the history placeholder, like every session before its transcript
  const Session = kind === 'hermes' ? undefined : SESSION_COMPONENTS[kind];
  const pending = <SessionPending profile={profile} model={effectiveModel(kind, undefined, profile.model)} onNewChat={onNewChat} onOpenDrawer={onOpenDrawer} />;
  return (
    <View style={visible ? styles.flex : styles.hidden}>
      <ChatShellContext.Provider value={shell}>
        {/* keyed by chat + profile: a crash never survives a switch; per-message boundaries live in MessageList */}
        <ChatBoundary
          key={`${id}:${profile.id}`}
          conversationId={id}
          profileId={profile.id}
          onNewChat={onNewChat}
          onResetChat={resetChat}
          onSwitchConnection={onSwitchConnection}
        >
          {Session ? (
            <Suspense fallback={pending}>
              <Session key={id} {...sessionProps} />
            </Suspense>
          ) : (
            <HermesSession key={id} {...sessionProps} />
          )}
        </ChatBoundary>
      </ChatShellContext.Provider>
    </View>
  );
}

/**
 * Header and composer from the first frame, for every chat. The chat hook mounts once the LOCAL transcript is in
 * (its `initialMessages`; usually synchronous from memory, else one storage read – meanwhile ChatViewPending shows
 * the same frame). A synced chat's Hermes transcript is NOT waited for here: a chat opened for the first time (no
 * local copy) mounts at once with the history placeholder in its message area, and the fetched transcript is merged
 * in when it arrives (useApplyRemoteTranscript).
 */
function HermesSession(props: SessionProps) {
  const t = useTheme();
  const conv = useConversation(props.conversationId);
  const transcript = useRemoteTranscript(props.conversationId, props.profile);
  if (!conv.meta) return <View style={[styles.flex, { backgroundColor: t.colors.bg }]} />; // deleted / not in the index
  if (!conv.ready) {
    const model = effectiveModel('hermes', conv.meta.model, props.profile.model);
    return <ChatViewPending profile={props.profile} model={model} onNewChat={props.onNewChat} onOpenDrawer={props.onOpenDrawer} />;
  }
  return <HermesSessionInner {...props} conv={conv} transcript={transcript} />;
}

function HermesSessionInner({ conv, transcript, profile, onNewChat, onOpenDrawer }: SessionProps & { conv: UseConversation; transcript: RemoteTranscript }) {
  const tr = useT();
  const model = effectiveModel('hermes', conv.meta?.model, profile.model);
  const conn = useMemo(
    () => ({
      baseUrl: profile.baseUrl,
      apiKey: profile.apiKey,
      model,
      sessionKey: profile.sessionKey,
      // the UI bridge injects the bootstrap system message itself and takes file uploads
      bootstrap: !profile.bridge,
      bridge: !!profile.bridge,
    }),
    [profile.baseUrl, profile.apiKey, model, profile.sessionKey, profile.bridge],
  );
  // per-chat reasoning / "Schnell" (read at send time; hidden when the model reports no support)
  const caps = useHermesCapabilities(profile);
  const modelCaps = caps.modelCaps(model);
  const modelOptions = conv.meta?.modelOptions;
  // branched from an earlier answer: the copied turns go along as context until Hermes accepted a turn (answerMenu.ts)
  const { setBranchSeed } = useConversations();
  const convId = conv.meta?.id;
  const onBranchSeedUsed = useCallback(() => {
    if (convId) setBranchSeed(convId, undefined);
  }, [convId, setBranchSeed]);
  const { prefs } = usePreferences();
  const chat = useHermesChat(conn, {
    ...sessionOptions(conv),
    modelOptions: effectiveChatOptions(modelOptions, modelCaps),
    followups: prefs.showFollowups,
    approvalTimeoutSeconds: caps.caps?.approvalTimeoutSeconds,
    branchSeed: conv.meta?.branchSeed,
    onBranchSeedUsed,
  });
  // notification tap "Hermes braucht eine Freigabe" → openPendingApproval(conversationId, runId) (approvals/stackModel.ts)
  usePendingApprovalTarget(conv.meta?.id, chat.openApproval);
  usePersistOnNewMessage(conv, chat.messages, { stop: chat.stop, label: profile.name, profileId: profile.id });
  const applyPending = useApplyRemoteTranscript(chat, transcript, conv);
  const historyPending = historyPendingFor({ settled: transcript.settled, applyPending });
  // stream lost after Hermes took the turn: the session's inbox event / an inbox reconnect completes the answer
  useInboxHandler(conv.meta?.id, (ev) => chat.applyInbox?.(ev));
  useInboxConnected(profile.id, () => chat.recoverNow?.());
  // notification tap / banner "Freigabe nötig": bring the pending approval card of this chat to the front
  useApprovalOpener(conv.meta?.id, chat.openApproval, chat.checkApprovals);
  useStarterPrompt(conv.meta?.id, chat.send); // onboarding "Fertig" starter prompt (OnboardingHost)
  const { health, denied, recheck } = useConnectionHealth(profile.baseUrl, profile.apiKey);

  // A failed request is a good moment to re-check reachability.
  const lastStatus = chat.messages[chat.messages.length - 1]?.status;
  useEffect(() => {
    if (lastStatus === 'error') recheck();
  }, [lastStatus, recheck]);

  const [optsOpen, setOptsOpen] = useState(false);
  // a picked provider model the server rejects → offer "Standard"
  const resetModel = useCallback(() => conv.setModel(overrideFor('hermes', undefined, profile.model)), [conv, profile.model]);
  const fallback = useModelFallback(chat.messages, conv.meta?.model, modelLabel('hermes', model), resetModel);
  const summary = chatOptionsSummary(modelOptions);
  // servers without /v1/capabilities and /api/model/options (bridge, mock, older Hermes) report nothing → no chip
  const supportsOptions = (!!caps.caps || !!caps.catalog) && (modelCaps.reasoning || modelCaps.fast);
  const options = useMemo(
    () =>
      supportsOptions
        ? {
            label: summary || tr('chat.header.options.default'),
            active: !!summary,
            onPress: () => setOptsOpen(true),
            // slash commands /reasoning, /fast set the options directly
            value: modelOptions,
            onChange: conv.setModelOptions,
            caps: { reasoning: modelCaps.reasoning, fast: modelCaps.fast, canDisableReasoning: modelCaps.canDisableReasoning },
          }
        : undefined,
    [supportsOptions, summary, tr, modelOptions, conv.setModelOptions, modelCaps.reasoning, modelCaps.fast, modelCaps.canDisableReasoning],
  );

  return (
    <>
      <ChatView
        chat={chat}
        profile={profile}
        // key / token rejected (401/403): like the other backends' credential problems – status text instead of "ist bereit"
        health={denied ? 'offline' : health}
        offlineHint={denied ? tr('backends.hermes.errors.authDenied') : undefined}
        model={model}
        onPickModel={(m) => conv.setModel(overrideFor('hermes', m, profile.model))}
        onNewChat={onNewChat}
        onOpenDrawer={onOpenDrawer}
        options={options}
        notice={transcript.error ?? fallback.notice}
        noticeAction={transcript.error ? undefined : fallback.noticeAction}
        historyPending={historyPending}
      />
      {supportsOptions ? (
        <HermesOptionsSheet
          open={optsOpen}
          onClose={() => setOptsOpen(false)}
          value={modelOptions}
          onChange={conv.setModelOptions}
          caps={modelCaps}
          subtitle={model}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row' },
  hidden: { display: 'none' },
});
