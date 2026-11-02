/**
 * Keeps one local notification per pending approval, two minutes before Hermes denies it by itself
 * (bots/approvalReminder.ts). Mounted once in push/PushHost.tsx; renders nothing. Native only: on the web a page
 * cannot schedule notifications for when it is closed, and an open page shows the card and the "Wartet auf dich" row.
 * A tap opens the approval like the first notice (same `data` shape as PushHost's presentApproval).
 */
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { cancelLocalNotification, listLocalNotifications, scheduleLocalNotification } from '../actions/notifications';
import { botsNow } from '../hermes/useHermesBots';
import { useT } from '../i18n';
import { allPushSettings, usePushSettingsState } from '../push/settingsStore';
import { useConnection } from '../settings/ConnectionProvider';
import { plannedReminders, reminderDiff, REMINDER_TAG, scheduledReminders } from './approvalReminder';
import { levelOf } from './notify';
import { useAttention } from './state';

export function ApprovalReminders() {
  const items = useAttention();
  const tr = useT();
  const { profiles } = useConnection();
  const push = usePushSettingsState();
  const running = useRef<Promise<void>>(Promise.resolve());
  // requests seen in this app run: only their reminders are cancelled when they disappear (answered / resolved)
  const known = useRef(new Set<string>());
  const key = items.map((i) => `${i.requestId}:${i.expiresAt ?? ''}:${i.bot ?? ''}`).join('|') + `#${JSON.stringify(Object.fromEntries(Object.entries(push.profiles).map(([id, s]) => [id, s.bots ?? {}])))}`;

  useEffect(() => {
    if (Platform.OS === 'web' || !push.loaded) return;
    // one sync at a time (list → cancel → schedule), so two quick changes never schedule a request twice
    running.current = running.current.then(async () => {
      const now = Date.now();
      for (const i of items) known.current.add(i.requestId);
      const planned = plannedReminders(items, now, (profileId, bot) => levelOf(allPushSettings()[profileId]?.bots, bot));
      const scheduled = scheduledReminders(await listLocalNotifications());
      if (!planned.length && !scheduled.length) return;
      const { cancel, add } = reminderDiff(planned, scheduled, { known: known.current, now });
      for (const id of cancel) await cancelLocalNotification(id);
      for (const r of add) {
        const p = profiles.find((x) => x.id === r.item.profileId);
        if (!p) continue;
        const bot = r.item.bot ? (botsNow(p).find((b) => b.name === r.item.bot)?.label ?? r.item.bot) : (botsNow(p).find((b) => b.default)?.label ?? tr('bots.roster.defaultName'));
        await scheduleLocalNotification({
          title: tr('bots.reminder.title', { name: bot }),
          body: tr('bots.reminder.body'),
          at: new Date(r.at),
          ask: false, // never a permission prompt out of the blue: the first notice already asked
          data: {
            src: 'hermes',
            kind: 'approval',
            profileId: p.id,
            ...(r.item.sessionId ? { sessionId: r.item.sessionId } : {}),
            ...(r.item.bot ? { hermesProfile: r.item.bot } : {}),
            ...(r.item.runId ? { runId: r.item.runId } : {}),
            requestId: r.item.requestId,
            [REMINDER_TAG]: r.item.requestId,
            huiApprovalAt: String(r.at),
          },
        });
      }
    }).catch(() => {});
    // `key` covers items and levels
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, push.loaded]);
  return null;
}
