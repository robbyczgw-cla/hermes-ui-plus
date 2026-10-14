/**
 * useAutoTitle / useFollowups – both react to live streaming → done transitions of the chat's messages
 * (opening an old chat triggers nothing) and are best-effort: errors are swallowed.
 * A feature_off answer disables the bridge's meta calls for the rest of the session.
 */
import { useEffect, useRef, useState } from 'react';
import type { Lang } from '../i18n/core';
import { fetchMeta } from './bridge';
import { buildMetaMessages, followupsNode, MetaError, newlyFinished, planMeta, statusMapOf } from './core';
import type { MetaConn, MetaMessage, MetaWant } from './core';
import type { HuiNode } from '../protocol/types';

const disabledOrigins = new Set<string>();
const originOf = (c: MetaConn) => c.baseUrl.trim();

type Common = { bridge: MetaConn | null; conversationKey: string | null | undefined; lang?: Lang; enabled?: boolean };

function useLiveFinished(messages: readonly MetaMessage[], conversationKey: string | null | undefined, onFinished: (msg: MetaMessage) => void) {
  const prev = useRef<Map<string, string>>(new Map());
  const keyRef = useRef(conversationKey);
  const cb = useRef(onFinished);
  useEffect(() => {
    cb.current = onFinished;
  });
  useEffect(() => {
    if (keyRef.current !== conversationKey) {
      keyRef.current = conversationKey;
      prev.current = statusMapOf(messages); // new conversation: baseline, no events
      return;
    }
    const finished = newlyFinished(prev.current, messages);
    prev.current = statusMapOf(messages);
    const last = finished[finished.length - 1];
    if (last) cb.current(last);
  }, [messages, conversationKey]);
}

/**
 * Title once after the first completed assistant turn. `onTitle(title)` is yours: set the local title and PATCH
 * the Hermes session title (hermes-sessions API) if available. `hasTitle` = the conversation already has one.
 */
export function useAutoTitle(
  messages: readonly MetaMessage[],
  o: Common & { hasTitle: boolean; onTitle: (title: string) => void },
): void {
  const done = useRef<string | null | undefined>(undefined);
  const opts = useRef(o);
  useEffect(() => {
    opts.current = o;
  });
  useLiveFinished(messages, o.conversationKey, (msg) => {
    const c = opts.current;
    if (c.enabled === false || !c.bridge || disabledOrigins.has(originOf(c.bridge))) return;
    const key = c.conversationKey ?? '';
    if (done.current === key) return;
    if (!planMeta(msg, { title: true, followups: false, titleDone: false, hasTitle: c.hasTitle })) return;
    done.current = key;
    const bridge = c.bridge;
    const turns = buildMetaMessages(messages);
    fetchMeta(bridge, turns, ['title'], { lang: c.lang })
      .then((r) => {
        if (r.title && opts.current.conversationKey === c.conversationKey) opts.current.onTitle(r.title);
      })
      .catch((e) => {
        if (e instanceof MetaError && e.code === 'feature_off') disabledOrigins.add(originOf(bridge));
        else if (done.current === key) done.current = undefined; // allow a retry after the next turn
      });
  });
}

/**
 * Follow-up chips after each finished turn, unless the answer has an interactive hui node. Returns a
 * `suggestions` HuiNode (render it under the last assistant message) or null. Cleared when the user sends.
 */
export function useFollowups(messages: readonly MetaMessage[], o: Common): HuiNode | null {
  const [node, setNode] = useState<{ forId: string; node: HuiNode } | null>(null);
  const opts = useRef(o);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => {
    opts.current = o;
  });
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    abort.current?.abort();
    setNode(null);
  }, [o.conversationKey]);

  const last = messages[messages.length - 1];
  // A new user message or a streaming answer hides stale chips.
  const visible = node && last && last.id === node.forId && last.status === 'done' ? node.node : null;

  useLiveFinished(messages, o.conversationKey, (msg) => {
    const c = opts.current;
    if (c.enabled === false || !c.bridge || disabledOrigins.has(originOf(c.bridge))) return;
    const plan = planMeta(msg, { title: false, followups: true, titleDone: true, hasTitle: true });
    if (!plan) return;
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    const want: MetaWant[] = ['followups'];
    const bridge = c.bridge;
    const key = c.conversationKey;
    fetchMeta(bridge, buildMetaMessages(messages), want, { lang: c.lang, signal: ctrl.signal })
      .then((r) => {
        const n = followupsNode(r.followups, `followups-${msg.id}`);
        if (n && !ctrl.signal.aborted && opts.current.conversationKey === key) setNode({ forId: msg.id, node: n });
      })
      .catch((e) => {
        if (e instanceof MetaError && e.code === 'feature_off') disabledOrigins.add(originOf(bridge));
      });
  });
  return visible;
}
