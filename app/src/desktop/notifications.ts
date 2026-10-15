/**
 * Notification responses of the macOS app (mounted once via DesktopHost):
 * - click → the window comes to the front (shell) and the chat opens (PushHost's notification routing, registered
 *   with `onDesktopNotificationOpen`; same data shape as a push tap, push/model.ts `parseTarget`)
 * - "Erlauben (einmal)" / "Ablehnen" on an approval → answered right here through the existing approval endpoint
 *   (`POST /v1/runs/{runId}/approval`, under `/p/<bot>/` for a bot's chat, hermes/client.ts) without showing the
 *   window. The bridge then reports `approval_resolved` like for any other device, so an open approval card updates
 *   itself. A failure (expired, offline) shows a notification that opens the chat.
 */
import { useEffect, useLayoutEffect, useRef } from 'react';
import { respondApproval } from '../hermes';
import { withBot } from '../hermes/bots';
import type { ApprovalChoice } from '../hermes/types';
import { useT } from '../i18n';
import { parseTarget } from '../push/model';
import { useConnection } from '../settings/ConnectionProvider';
import { desktopNotify } from './bridge';
import { consumePending } from './pending';

let openHandler: ((data: unknown) => void) | null = null;
const waiting: unknown[] = [];

/** PushHost: open the target of a clicked desktop notification (items that arrived earlier are delivered now) */
export function onDesktopNotificationOpen(fn: (data: unknown) => void): () => void {
  openHandler = fn;
  for (const d of waiting.splice(0)) fn(d);
  return () => {
    if (openHandler === fn) openHandler = null;
  };
}

export function useDesktopNotifications(): void {
  const { profiles, ready } = useConnection();
  const tr = useT();
  const latest = useRef({ profiles, tr });
  useLayoutEffect(() => {
    latest.current = { profiles, tr };
  });

  useEffect(() => {
    if (!ready) return;
    const answer = async (data: unknown, choice: ApprovalChoice) => {
      const target = parseTarget(data);
      if (!target || target.kind !== 'approval' || !target.runId) return;
      const { profiles: ps, tr: t } = latest.current;
      const p = ps.find((x) => x.id === target.profileId && x.kind === 'hermes');
      if (!p) return;
      try {
        await respondApproval(withBot({ baseUrl: p.baseUrl, apiKey: p.apiKey }, target.hermesProfile), { runId: target.runId, requestId: target.requestId }, choice);
      } catch {
        await desktopNotify(t('desktop.approval.failedTitle'), t('desktop.approval.failedBody'), {
          data: data && typeof data === 'object' ? (data as Record<string, string>) : undefined,
        });
      }
    };
    return consumePending('responses', (items) => {
      for (const r of items) {
        if (r.action === 'open') {
          if (openHandler) openHandler(r.data);
          else waiting.push(r.data);
        } else if (r.action === 'approve-once') void answer(r.data, 'once');
        else if (r.action === 'deny') void answer(r.data, 'deny');
      }
    });
  }, [ready]);
}
