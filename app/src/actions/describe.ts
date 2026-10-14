/** Confirmation-sheet texts: what exactly will happen, in the active language. */
import type { TKey } from '../i18n/core.ts';
import { formatDateTime, formatDuration, formatRange } from './dates.ts';
import type { ActionDescription, ActionI18n, MapMode, ValidAction } from './types.ts';
import { coord } from './urls.ts';

const MODE_KEYS = {
  driving: 'actionRunner.describe.maps.mode.driving',
  walking: 'actionRunner.describe.maps.mode.walking',
  transit: 'actionRunner.describe.maps.mode.transit',
} as const satisfies Record<MapMode, TKey>;

function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
}

function join(parts: (string | undefined)[]): string {
  return parts.filter(Boolean).join(' · ');
}

function row(label: string, value: string | undefined): { label: string; value: string }[] {
  return value ? [{ label, value }] : [];
}

/** `ref` = "now", decides whether the year is shown. */
export function describeAction(a: ValidAction, i18n: ActionI18n, ref: Date = new Date()): ActionDescription {
  const { t } = i18n;
  const summary = (title: string, details: string) => t('actionRunner.describe.summary', { title, details });
  switch (a.type) {
    case 'calendar': {
      const when = formatRange(a.start, a.end, a.allDay, ref, i18n);
      const title = t('actionRunner.describe.calendar.title');
      return {
        title,
        summary: summary(title, join([clip(a.title, 80), when, a.location && clip(a.location, 60)])),
        rows: [
          { label: t('actionRunner.describe.row.title'), value: a.title },
          { label: t('actionRunner.describe.row.when'), value: when },
          ...row(t('actionRunner.describe.row.location'), a.location),
          ...row(t('actionRunner.describe.row.notes'), a.notes && clip(a.notes, 200)),
        ],
        hint: t('actionRunner.describe.calendar.hint'),
        confirmLabel: t('actionRunner.describe.calendar.confirm'),
        icon: 'calendar',
      };
    }
    case 'reminder': {
      const when = formatDateTime(a.at, ref, i18n);
      const title = t('actionRunner.describe.reminder.title');
      return {
        title,
        summary: summary(title, join([clip(a.title, 80), when])),
        rows: [
          { label: t('actionRunner.describe.row.text'), value: a.title },
          { label: t('actionRunner.describe.row.when'), value: when },
        ],
        hint: t('actionRunner.describe.reminder.hint'),
        confirmLabel: t('actionRunner.describe.reminder.confirm'),
        icon: 'calendar',
      };
    }
    case 'maps': {
      const where = a.query ?? `${coord(a.lat!)}, ${coord(a.lng!)}`;
      const route = a.mode ? t('actionRunner.describe.maps.routeDetail', { mode: t(MODE_KEYS[a.mode]) }) : undefined;
      const title = a.mode ? t('actionRunner.describe.maps.route') : t('actionRunner.describe.maps.open');
      return {
        title,
        summary: summary(title, join([clip(where, 100), route])),
        rows: [
          { label: a.mode ? t('actionRunner.describe.row.destination') : t('actionRunner.describe.row.location'), value: where },
          ...row(t('actionRunner.describe.row.travel'), a.mode ? t(MODE_KEYS[a.mode]) : undefined),
        ],
        hint: t('actionRunner.describe.maps.hint'),
        confirmLabel: t('actionRunner.describe.open'),
        icon: 'external',
      };
    }
    case 'call': {
      const title = t('actionRunner.describe.call.title');
      return {
        title,
        summary: summary(title, a.phone),
        rows: [{ label: t('actionRunner.describe.row.number'), value: a.phone }],
        hint: t('actionRunner.describe.call.hint'),
        confirmLabel: t('actionRunner.describe.call.confirm'),
        icon: 'external',
      };
    }
    case 'email': {
      const title = t('actionRunner.describe.email.title');
      return {
        title,
        summary: summary(title, join([a.to.join(', '), a.subject && clip(a.subject, 80)])),
        rows: [
          { label: t('actionRunner.describe.row.to'), value: a.to.join(', ') },
          ...row(t('actionRunner.describe.row.subject'), a.subject),
          ...row(t('actionRunner.describe.row.text'), a.body && clip(a.body, 300)),
        ],
        hint: t('actionRunner.describe.email.hint'),
        confirmLabel: t('actionRunner.describe.draftConfirm'),
        icon: 'send',
      };
    }
    case 'sms': {
      const title = t('actionRunner.describe.sms.title');
      return {
        title,
        summary: summary(title, join([a.to.join(', '), a.body && clip(a.body, 80)])),
        rows: [
          { label: t('actionRunner.describe.row.to'), value: a.to.join(', ') },
          ...row(t('actionRunner.describe.row.text'), a.body && clip(a.body, 300)),
        ],
        hint: t('actionRunner.describe.sms.hint'),
        confirmLabel: t('actionRunner.describe.draftConfirm'),
        icon: 'send',
      };
    }
    case 'timer': {
      const duration = formatDuration(a.seconds, i18n);
      const title = t('actionRunner.describe.timer.title');
      return {
        title,
        summary: summary(title, join([duration, clip(a.label, 60)])),
        rows: [
          { label: t('actionRunner.describe.row.duration'), value: duration },
          { label: t('actionRunner.describe.row.name'), value: a.label },
        ],
        hint: t('actionRunner.describe.timer.hint'),
        confirmLabel: t('actionRunner.describe.timer.confirm'),
        icon: 'check',
      };
    }
    case 'add_to_list': {
      const n = a.items.length;
      const preview = clip(a.items.slice(0, 4).join(', ') + (n > 4 ? ` … (+${n - 4})` : ''), 120);
      return {
        title: t('actionRunner.describe.list.title', { count: n }),
        summary: summary(t('actionRunner.describe.list.addTitle'), preview),
        rows: [
          { label: t('actionRunner.describe.list.rowLabel', { count: n }), value: a.items.join('\n') },
          ...row(t('actionRunner.describe.row.list'), a.listTitle),
        ],
        hint: t('actionRunner.describe.list.hint'),
        confirmLabel: t('actionRunner.describe.list.confirm'),
        icon: 'check',
      };
    }
    case 'copy': {
      const title = t('actionRunner.describe.copy');
      return {
        title,
        summary: summary(title, clip(a.text, 100)),
        rows: [{ label: t('actionRunner.describe.row.text'), value: clip(a.text, 300) }],
        confirmLabel: title,
        icon: 'copy',
      };
    }
    case 'open_url':
      return {
        title: t('actionRunner.describe.link.title'),
        summary: summary(t('actionRunner.describe.link.title'), clip(a.url, 100)),
        rows: [{ label: t('actionRunner.describe.row.address'), value: a.url }],
        hint: t('actionRunner.describe.link.hint'),
        confirmLabel: t('actionRunner.describe.open'),
        icon: 'external',
      };
    case 'send':
      return {
        title: t('actionRunner.describe.send.title'),
        summary: t('actionRunner.describe.send.summary', { text: clip(a.text, 100) }),
        rows: [{ label: t('actionRunner.describe.row.text'), value: a.text }],
        confirmLabel: t('actionRunner.describe.send.confirm'),
        icon: 'send',
      };
  }
}

/**
 * Actions that need the confirmation sheet. `copy`/`send` and web links (`open_url` http/https) pass straight
 * through; `open_url` with tel:/sms:/mailto:/geo: is confirmed like the call/sms/email actions (review L1).
 */
export function needsConfirmation(a: ValidAction): boolean {
  if (a.type === 'open_url') return !/^https?:/i.test(a.url);
  return a.type !== 'copy' && a.type !== 'send';
}

/**
 * Review M2: a button may only send what it shows. True when the `send` text is the visible label (whitespace and
 * case aside); otherwise the chat shows the confirmation sheet with the full text first.
 */
export function sendMatchesLabel(label: string, text: string): boolean {
  const norm = (x: string) => x.normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
  return norm(label) !== '' && norm(label) === norm(text);
}
