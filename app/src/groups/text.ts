/**
 * Texts of the group chat built from codes (literal keys, so the i18n checks see each one). Pure, erasable TS.
 */
import type { TFn } from '../i18n/core.ts';
import type { GroupEntry, GroupFailure } from './core.ts';

export function failureText(f: GroupFailure, tr: TFn): string {
  switch (f) {
    case 'offline':
      return tr('groups.errors.offline');
    case 'off':
      return tr('groups.errors.off');
    case 'members':
      return tr('groups.errors.members');
    case 'running':
      return tr('groups.errors.running');
    case 'busy':
      return tr('groups.errors.busy');
    case 'gone':
      return tr('groups.errors.gone');
    case 'tooLong':
      return tr('groups.errors.tooLong');
    case 'unknown':
      return tr('groups.errors.unknown');
    case 'limit':
      return tr('groups.errors.limit');
    default:
      return tr('groups.errors.server');
  }
}

/** why a bot could not answer (bridge note code) */
export function reasonText(code: string | undefined, tr: TFn): string {
  switch (code) {
    case 'not_connected':
      return tr('groups.note.reasons.not_connected');
    case 'unknown_bot':
      return tr('groups.note.reasons.unknown_bot');
    case 'busy':
      return tr('groups.note.reasons.busy');
    case 'timeout':
      return tr('groups.note.reasons.timeout');
    case 'bridge_error':
      return tr('groups.note.reasons.bridge_error');
    default:
      return tr('groups.note.reasons.upstream_error');
  }
}

/**
 * The grey line of a note / hand-over. `waitingNow`: the approval of this note is still open (the line says "wartet",
 * with "Öffnen"); afterwards it says that the bot asked in its own chat.
 */
export function noteText(e: Extract<GroupEntry, { kind: 'note' | 'handoff' }>, nameOf: (key: string) => string, tr: TFn, o: { waitingNow?: boolean; max?: number } = {}): string {
  if (e.kind === 'handoff') {
    return e.text ? tr('groups.note.handoff', { from: nameOf(e.bot), to: nameOf(e.to), task: e.text }) : tr('groups.note.handoffBare', { from: nameOf(e.bot), to: nameOf(e.to) });
  }
  const name = e.bot ? nameOf(e.bot) : '';
  switch (e.note) {
    case 'approval':
      return o.waitingNow ? tr('groups.note.approvalWaiting', { name }) : tr('groups.note.approvalDone', { name });
    case 'error':
      return e.bot ? tr('groups.note.error', { name, reason: reasonText(e.code, tr) }) : tr('groups.note.errorRound');
    case 'capped': {
      const max = o.max ?? 8;
      const waiting = (e.waiting ?? []).map(nameOf);
      return waiting.length ? tr('groups.note.cappedWaiting', { max, names: waiting.join(', ') }) : tr('groups.note.capped', { max });
    }
    case 'stopped':
      return tr('groups.note.stopped');
    case 'quiet':
      return tr('groups.note.quiet');
    case 'interrupted':
      return tr('groups.note.interrupted');
    default:
      return '';
  }
}
