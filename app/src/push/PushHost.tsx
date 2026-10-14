/**
 * App-wide push wiring (mounted once in the root layout, inside Connection + Conversations providers):
 *  - notification taps (native response listener, PWA service worker message / ?huiPush= start param) → open the chat
 *  - live inbox streams while the app is in the foreground (bridge: Hermes sessions);
 *    while a stream is connected the server sends no push for that user
 *  - refresh the device registration of enabled profiles once per app start (token rotation, time zone)
 */
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';
import { displayCommand } from '../approvals/approvalModel';
import { useConversationsInternals } from '../conversations/ConversationsProvider';
import { hermesSessions } from '../hermes/client';
import { desktopNotifyRemove, desktopWindowFocused, isDesktopApp } from '../desktop/bridge';
import { onDesktopNotificationOpen } from '../desktop/notifications';
import { useI18n } from '../i18n';
import { useConnection } from '../settings/ConnectionProvider';
import type { ConnectionProfile } from '../settings/profiles';
import { readInbox, PushApiError } from './api';
import { ApprovalBanner } from './ApprovalBanner';
import { checkApprovalOf, openPendingApproval, routeApproval, routeApprovalResolved, type ApprovalNotice, type ApprovalResolved, type ApprovalRouteDeps } from './approvalInbox';
import { notificationsModule, presentLocal, pushFetch } from './device';
import { deliverToOpenChat, emitInboxConnected } from './inboxBus';
import { emitAnswerReady } from '../background/noticeState';
import { createKeyedQueue, recoverFromInbox, routeInboxEvent } from './inboxRouting';
import { backoffMs, hermesInboxAllowed, hermesInboxSources, inboxUrl, parseTarget, pickConversation, pushFilterOf, pushServerKind, type InboxEvent, type PushTarget } from './model';
import { serverConfig, syncRegistration } from './registration';
import { runInbox } from './inboxRunner';
import { allPushSettings, loadPushSettings, usePushSettingsState } from './settingsStore';

const MAX_STREAMS = 4;

/** id of an approval's desktop notification (removed when the approval is answered elsewhere) */
const approvalTag = (requestId: string) => `approval:${requestId}`;
const handledResponses = new Set<string>();

export function PushHost({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { profiles, active, setActive, ready: connReady } = useConnection();
  const { controller, store, ready: convReady } = useConversationsInternals();
  const { t, lang } = useI18n();
  const pushState = usePushSettingsState();
  // "Freigabe nötig" banner (approval of another chat); at most one, the newest
  const [approvalBanner, setApprovalBanner] = useState<{ n: ApprovalNotice; profileId: string; conversationId?: string; preview: boolean } | null>(null);
  const latest = useRef({ profiles, active, setActive, controller, store, t });
  useLayoutEffect(() => {
    latest.current = { profiles, active, setActive, controller, store, t };
  });

  // ---------- Hermes: fetch the session and merge it (creates the drawer entry / bumps lastActive → transcript reload)
  const refreshHermesSession = useCallback(async (p: ConnectionProfile, sessionId: string) => {
    const s = await hermesSessions({ baseUrl: p.baseUrl, apiKey: p.apiKey }).get(sessionId);
    // the profile's session filter applies: a cron/Telegram session never becomes a chat unless enabled
    latest.current.controller.mergeRemote({ id: p.id, kind: 'hermes' }, [s], { filter: pushFilterOf(p) });
  }, []);

  // ---------- open a chat from a notification tap
  const openTarget = useCallback(
    async (target: PushTarget | null) => {
      if (!target || target.src === 'test') return;
      const { profiles: ps, active: act, setActive: setAct, controller: ctl } = latest.current;
      // "Antwort fertig" (background/BackgroundTurnHost): the conversation is known
      if (target.src === 'turn') {
        const conv = ctl.list().find((c) => c.id === target.conversationId);
        if (!conv) return;
        const owner = ps.find((x) => x.id === conv.profileId);
        if (owner && owner.id !== act.id) setAct(owner.id);
        ctl.setActive(conv.id);
        router.navigate('/');
        return;
      }
      const p = ps.find((x) => x.id === target.profileId);
      if (!p) return;
      if (p.id !== act.id) setAct(p.id);
      let conv = pickConversation(ctl.list(), p, target);
      if (p.kind === 'hermes' && target.sessionId) {
        try {
          await refreshHermesSession(p, target.sessionId);
        } catch {
          /* offline: open what we have */
        }
        conv = pickConversation(ctl.list(), p, target);
      }
      if (!conv && p.kind !== 'hermes') {
        conv = ctl.create({ id: p.id, kind: p.kind }, { fresh: true }); // never re-target the user's open draft
        if (target.agent && target.agent !== p.model) ctl.setModel(conv.id, target.agent);
      }
      if (conv) ctl.setActive(conv.id);
      router.navigate('/');
      // approval push / banner: restore the card (the chat rebuilds it from GET /v1/runs/{runId}); delivered once mounted
      if (conv && target.kind === 'approval') openPendingApproval(conv.id, target.runId);
    },
    [router, refreshHermesSession],
  );

  // native: taps (warm + cold start)
  useEffect(() => {
    if (Platform.OS === 'web' || !connReady || !convReady) return;
    let sub: { remove(): void } | null = null;
    let cancelled = false;
    void notificationsModule().then(async (N) => {
      if (!N || cancelled) return;
      const handle = (r: { notification: { request: { identifier: string; content: { data?: unknown } } } } | null) => {
        if (!r || handledResponses.has(r.notification.request.identifier)) return;
        handledResponses.add(r.notification.request.identifier);
        void openTarget(parseTarget(r.notification.request.content.data));
      };
      sub = N.addNotificationResponseReceivedListener(handle);
      try {
        handle(await N.getLastNotificationResponseAsync());
      } catch {
        /* not available */
      }
    });
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [connReady, convReady, openTarget]);

  // desktop app: a clicked notification (answer, approval, inbox) opens its target like a push tap
  useEffect(() => {
    if (!isDesktopApp() || !connReady || !convReady) return;
    return onDesktopNotificationOpen((data) => void openTarget(parseTarget(data)));
  }, [connReady, convReady, openTarget]);

  // web: service worker click → message to an open window, or a new window with ?huiPush=<json>
  useEffect(() => {
    if (Platform.OS !== 'web' || !connReady || !convReady || typeof window === 'undefined') return;
    try {
      const url = new URL(window.location.href);
      const raw = url.searchParams.get('huiPush');
      if (raw) {
        url.searchParams.delete('huiPush');
        window.history.replaceState(null, '', url.pathname + url.search + url.hash);
        void openTarget(parseTarget(raw));
      }
    } catch {
      /* ignore */
    }
    const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined;
    if (!sw) return;
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string; data?: unknown } | null;
      if (d?.type === 'hui-push-open') void openTarget(parseTarget(d.data));
    };
    sw.addEventListener('message', onMsg);
    return () => sw.removeEventListener('message', onMsg);
  }, [connReady, convReady, openTarget]);

  // ---------- registration refresh once per start
  const refreshed = useRef(false);
  useEffect(() => {
    if (!connReady || !pushState.loaded || refreshed.current) return;
    refreshed.current = true;
    const settings = allPushSettings();
    for (const p of profiles) {
      if (settings[p.id]?.enabled) void syncRegistration(p, t, lang).catch(() => {});
    }
  }, [connReady, pushState.loaded, profiles, t, lang]);

  // "Cron-Berichte anzeigen" changed → re-register so the bridge's device scope (push sources) follows
  const scopeKey = profiles.filter((p) => pushServerKind(p) === 'bridge').map((p) => `${p.id}:${hermesInboxSources(p).join('+')}`).join(',');
  const lastScope = useRef<string | null>(null);
  useEffect(() => {
    if (!connReady || !pushState.loaded) return;
    const prev = lastScope.current;
    lastScope.current = scopeKey;
    if (prev === null || prev === scopeKey) return; // first run: covered by the start refresh above
    const settings = allPushSettings();
    for (const p of profiles) {
      if (pushServerKind(p) === 'bridge' && settings[p.id]?.enabled) void syncRegistration(p, t, lang).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connReady, pushState.loaded, scopeKey]);

  useEffect(() => {
    void loadPushSettings();
  }, []);

  // ---------- inbox event routing
  const handleInbox = useCallback(
    async (p: ConnectionProfile, ev: InboxEvent, foreground: boolean) => {
      const { controller: ctl, store: st, t: tr } = latest.current;
      if (p.kind === 'hermes') {
        // cron reports / other sources: no chat, no notification unless the profile shows them
        if (!hermesInboxAllowed(p, ev)) return;
        if (ev.sessionId) {
          // an answer whose stream the app lost → completes that message in place (same conversation, no 2nd copy)
          const r = await recoverFromInbox({ controller: ctl, deliverToOpenChat }, p, ev).catch(() => null);
          // a chat that is not open got its lost answer: "Antwort ist da" (the open chat reports via onTurnEnd)
          if (r?.recovered) emitAnswerReady({ conversationId: r.conversationId, message: r.recovered, late: true });
          await refreshHermesSession(p, ev.sessionId).catch(() => {});
        }
      } else {
        await routeInboxEvent({ controller: ctl, activeId: () => st.get().activeId, deliverToOpenChat }, p, ev);
      }
      if (!foreground) {
        const s = allPushSettings()[p.id];
        const preview = s?.preview !== 'off';
        await presentLocal({
          title: ev.title || p.name,
          body: preview ? ev.content.replace(/```[\s\S]*?(```|$)/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140) || tr('push.newMessage') : tr('push.newMessage'),
          data: { src: 'hermes', profileId: p.id, ...(ev.sessionId ? { sessionId: ev.sessionId } : {}), ...(ev.agent ? { agent: ev.agent } : {}) },
        });
      }
    },
    [refreshHermesSession],
  );
  // ---------- approvals (bridge `hui.approval` / `hui.approval_resolved`)
  const approvalDeps = useCallback(
    (p: ConnectionProfile): ApprovalRouteDeps => ({
      controller: latest.current.controller,
      activeId: () => latest.current.store.get().activeId,
      banner: (n, conversationId) => setApprovalBanner({ n, profileId: p.id, conversationId, preview: allPushSettings()[p.id]?.preview !== 'off' }),
      clearBanner: (requestId) => setApprovalBanner((b) => (b?.n.requestId === requestId ? null : b)),
      openPending: openPendingApproval,
      checkPending: checkApprovalOf,
    }),
    [],
  );
  // local "Hermes wartet auf deine Freigabe" notification; in the desktop app with "allow once" / "deny" buttons
  const presentApproval = useCallback(async (p: ConnectionProfile, n: ApprovalNotice) => {
    const tr = latest.current.t;
    const preview = allPushSettings()[p.id]?.preview !== 'off';
    await presentLocal({
      title: tr('push.approval.notifyTitle'),
      body: preview && n.command ? displayCommand(n.command).text.replace(/\s+/g, ' ').trim().slice(0, 140) : tr('push.approval.notifyBody'),
      data: { src: 'hermes', kind: 'approval', profileId: p.id, ...(n.sessionId ? { sessionId: n.sessionId } : {}), runId: n.runId, requestId: n.requestId, messageId: n.id },
      tag: approvalTag(n.requestId),
      kind: 'approval',
    });
  }, []);
  const handleApproval = useCallback(
    async (p: ConnectionProfile, n: ApprovalNotice, foreground: boolean) => {
      if (p.kind !== 'hermes') return;
      // desktop app in the background (the inbox stream stays open there): a notification with "allow once" / "deny"
      // buttons, and the banner / card as usual for when the user comes back
      if (isDesktopApp() && !desktopWindowFocused()) void presentApproval(p, n);
      if (!foreground) {
        // streams close in the background, so this is the web "not focused" case: local notification like the server push
        if (!isDesktopApp()) await presentApproval(p, n);
        return;
      }
      routeApproval(approvalDeps(p), p, n);
    },
    [approvalDeps, presentApproval],
  );
  const handleApprovalResolved = useCallback(
    async (p: ConnectionProfile, r: ApprovalResolved) => {
      if (isDesktopApp()) desktopNotifyRemove(approvalTag(r.requestId)); // answered elsewhere: the buttons are moot
      if (p.kind === 'hermes') routeApprovalResolved(approvalDeps(p), p, r);
    },
    [approvalDeps],
  );
  const openApprovalBanner = useCallback(() => {
    const b = approvalBanner;
    setApprovalBanner(null);
    if (!b) return;
    void openTarget({ src: 'hermes', profileId: b.profileId, sessionId: b.n.sessionId ?? undefined, kind: 'approval', runId: b.n.runId, requestId: b.n.requestId });
  }, [approvalBanner, openTarget]);

  // serialised per profile: a burst of events (one chunk / a `since=` replay) must not overwrite each other
  const [inboxQueue] = useState(createKeyedQueue);
  const onInbox = useCallback(
    (p: ConnectionProfile, ev: InboxEvent, foreground: boolean) => inboxQueue(p.id, () => handleInbox(p, ev, foreground)).catch(() => {}),
    [inboxQueue, handleInbox],
  );

  // ---------- inbox streams (foreground only)
  const streamProfiles = profiles
    .filter((p) => pushServerKind(p) && (p.id === active.id || pushState.profiles[p.id]?.enabled))
    .slice(0, MAX_STREAMS);
  const streamKey = streamProfiles.map((p) => `${p.id}|${p.baseUrl}|${p.apiKey.slice(-6)}|${p.kind === 'hermes' ? hermesInboxSources(p).join('+') : ''}`).join(',');

  useEffect(() => {
    if (!connReady || !convReady || !streamProfiles.length) return;
    let appActive = AppState.currentState === 'active' || Platform.OS === 'web';
    const runners = new Map<string, AbortController>();
    const lastTs = new Map<string, number>();

    const startOne = (p: ConnectionProfile) => {
      if (runners.has(p.id)) return;
      const ctrl = new AbortController();
      runners.set(p.id, ctrl);
      const fatal = (e: unknown) => e instanceof PushApiError && [401, 403, 404].includes(e.status); // no point retrying
      void runInbox({
        signal: ctrl.signal,
        loadConfig: () => serverConfig(p),
        isFatal: fatal,
        backoff: backoffMs,
        connect: async (ready) => {
          const url = inboxUrl(p, { since: lastTs.get(p.id), sources: p.kind === 'hermes' ? hermesInboxSources(p) : undefined });
          if (!url) throw new PushApiError('no inbox url', 404);
          await readInbox(pushFetch, url, p.apiKey, {
            signal: ctrl.signal,
            onReady: () => {
              ready();
              emitInboxConnected(p.id); // reconnected: open chats look for answers lost with the connection
            },
            onEvent: (ev) => {
              lastTs.set(p.id, Math.max(lastTs.get(p.id) ?? 0, ev.timestamp));
              void onInbox(p, ev, appActive);
            },
            onApproval: (a) => void inboxQueue(p.id, () => handleApproval(p, a, appActive)).catch(() => {}),
            onApprovalResolved: (r) => void inboxQueue(p.id, () => handleApprovalResolved(p, r)).catch(() => {}),
          });
        },
      }).finally(() => {
        // finished (unsupported / fatal / stopped): a later start may create a new runner
        if (runners.get(p.id) === ctrl) runners.delete(p.id);
      });
    };
    const stopAll = () => {
      for (const c of runners.values()) c.abort();
      runners.clear();
    };
    const sync = () => (appActive ? streamProfiles.forEach(startOne) : stopAll());
    sync();
    const sub = AppState.addEventListener('change', (s) => {
      // desktop app: Hermes keeps running in the menu bar with the window closed – keep listening (approvals)
      const next = s === 'active' || (Platform.OS === 'web' && (s !== 'background' || isDesktopApp()));
      if (next === appActive) return;
      appActive = next;
      sync(); // background: close the streams so the server falls back to push
    });
    return () => {
      sub.remove();
      stopAll();
    };
    // streamKey captures the relevant profile fields
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connReady, convReady, streamKey, onInbox, inboxQueue, handleApproval, handleApprovalResolved]);

  return (
    <>
      {children}
      {approvalBanner ? (
        <ApprovalBanner
          key={approvalBanner.n.requestId}
          command={approvalBanner.preview && approvalBanner.n.command ? displayCommand(approvalBanner.n.command).text : undefined}
          expiresAt={approvalBanner.n.expiresAt}
          onOpen={openApprovalBanner}
          onClose={() => setApprovalBanner(null)}
        />
      ) : null}
    </>
  );
}
