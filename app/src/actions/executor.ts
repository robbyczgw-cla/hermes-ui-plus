/**
 * Executes a VALIDATED action against an injected environment (platform side effects). Pure
 * orchestration + toast texts (translated via `i18n`), so it is unit-testable with fakes. The
 * confirmation sheet is handled by the caller (ActionRunnerProvider) – this module never asks.
 */
import { formatClock, formatDateTime } from './dates.ts';
import type { CalendarOutcome } from './calendar.ts';
import type { AppendResult } from './lists.ts';
import type { ListBus } from './listBus.ts';
import type { ScheduleResult } from './notifications.ts';
import type { ActionI18n, ActionResult, ValidAction } from './types.ts';
import { validateUrl } from './validate.ts';
import { buildMailtoUrl, buildMapsUrls, buildSmsUrl, buildTelUrl, type Os } from './urls.ts';
import type { StartResult } from './timerStore.ts';

export type ExecEnv = {
  os: Os;
  now(): Date;
  /** Open a URL with the OS; MUST reject when nothing can handle it. */
  openUrl(url: string): Promise<void>;
  copy(text: string): Promise<void>;
  /** Send a normal user message (chat shell). Absent in the gallery. `false` = refused (a turn is running). */
  send?(text: string): void | boolean;
  addCalendarEvent(a: Extract<ValidAction, { type: 'calendar' }>): Promise<CalendarOutcome>;
  scheduleNotification(o: { title: string; body?: string; at: Date }): Promise<ScheduleResult>;
  startTimer(o: { label: string; seconds: number }): Promise<StartResult>;
  appendToList(conversationId: string, items: string[], listTitle?: string): Promise<AppendResult>;
  listBus: ListBus;
  conversationId?: string;
};

const done = (message?: string): ActionResult => ({ ok: true, status: 'done', ...(message ? { message } : {}) });
const err = (error: string): ActionResult => ({ ok: false, error });

/** Open the first URL that works. Every URL is re-checked against the scheme allow-list. */
async function openFirst(env: ExecEnv, urls: string[], unavailable: string): Promise<ActionResult> {
  for (const u of urls) {
    if (!validateUrl(u)) continue;
    try {
      await env.openUrl(u);
      return done();
    } catch {
      /* try the next candidate */
    }
  }
  return err(unavailable);
}

export async function executeAction(a: ValidAction, env: ExecEnv, i18n: ActionI18n): Promise<ActionResult> {
  try {
    return await run(a, env, i18n);
  } catch {
    return err(i18n.t('actionRunner.common.failed'));
  }
}

async function run(a: ValidAction, env: ExecEnv, { t, locale }: ActionI18n): Promise<ActionResult> {
  switch (a.type) {
    case 'copy':
      await env.copy(a.text);
      return done(t('actionRunner.exec.copied'));
    case 'send':
      if (!env.send) return err(t('actionRunner.exec.sendUnavailable'));
      // refused (turn running): not "done", so callers waiting for the send (a form) stay open
      if (env.send(a.text) === false) return err(t('chat.busy'));
      return done();
    case 'open_url': {
      const r = await openFirst(env, [a.url], t('actionRunner.exec.linkFailed'));
      return r;
    }
    case 'maps': {
      const r = await openFirst(env, buildMapsUrls(a, env.os), t('actionRunner.exec.noMapsApp'));
      return r.ok ? done(t('actionRunner.exec.mapOpening')) : r;
    }
    case 'call': {
      const r = await openFirst(env, [buildTelUrl(a.phone)], t('actionRunner.exec.phoneUnavailable'));
      return r.ok ? done(t('actionRunner.exec.phoneOpened')) : r;
    }
    case 'email': {
      const r = await openFirst(env, [buildMailtoUrl(a)], t('actionRunner.exec.noMailApp'));
      return r.ok ? done(t('actionRunner.exec.mailOpened')) : r;
    }
    case 'sms': {
      const r = await openFirst(env, [buildSmsUrl(a, env.os)], t('actionRunner.exec.messagesUnavailable'));
      return r.ok ? done(t('actionRunner.exec.smsOpened')) : r;
    }
    case 'calendar': {
      const o = await env.addCalendarEvent(a);
      if (!o.ok) {
        return err(t(o.reason === 'unsupported' ? 'actionRunner.exec.calendarUnsupported' : 'actionRunner.exec.calendarFailed'));
      }
      if (o.via === 'direct') return done(t('actionRunner.exec.calendarAdded', { calendar: o.calendarTitle }));
      if (o.saved === false) return { ok: true, status: 'cancelled', message: t('actionRunner.exec.calendarNotSaved') };
      return done(t('actionRunner.exec.calendarOpened'));
    }
    case 'reminder': {
      const r = await env.scheduleNotification({ title: t('actionRunner.notify.reminderTitle'), body: a.title, at: a.at });
      if (r.ok) return done(t('actionRunner.exec.reminderSet', { when: formatDateTime(a.at, env.now(), { t, locale }) }));
      if (r.reason === 'denied') return err(t('actionRunner.exec.notificationsDenied'));
      if (r.reason === 'unsupported') return err(t('actionRunner.exec.remindersUnsupported'));
      return err(t('actionRunner.exec.reminderFailed'));
    }
    case 'timer': {
      const r = await env.startTimer({ label: a.label, seconds: a.seconds });
      const clock = formatClock(a.seconds * 1000);
      const head =
        a.label && a.label !== 'Timer'
          ? t('actionRunner.exec.timerStartedNamed', { clock, label: a.label })
          : t('actionRunner.exec.timerStarted', { clock });
      return done(r.notified ? head : t('actionRunner.exec.timerSilent', { message: head }));
    }
    case 'add_to_list': {
      const title = a.listTitle ?? t('actionRunner.lists.defaultTitle');
      if (!env.conversationId) {
        env.listBus.publish({ type: 'create_list', title, kind: 'shopping', items: a.items });
        return done(t('actionRunner.exec.shoppingListCreated'));
      }
      const r = await env.appendToList(env.conversationId, a.items, a.listTitle);
      if (r.status === 'no_checklist') {
        env.listBus.publish({ type: 'create_list', conversationId: env.conversationId, title, kind: 'shopping', items: r.items });
        return done(t('actionRunner.exec.listCreated', { title }));
      }
      const n = r.added.length + r.reopened.length;
      if (n === 0) return done(t('actionRunner.exec.alreadyOnList'));
      const added = t('actionRunner.exec.itemsAdded', { count: n });
      return done(r.skipped.length ? t('actionRunner.exec.itemsAddedSkipped', { added, skipped: r.skipped.length }) : added);
    }
  }
}

