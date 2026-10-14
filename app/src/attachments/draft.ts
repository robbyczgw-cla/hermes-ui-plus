/**
 * Composer draft state (pure, draft.test.ts). The hook useAttachmentDraft.ts drives it.
 */
import { checkAttachment } from './validate.ts';
import type { Attachment, AttachmentTarget } from './types.ts';

/** Where an error came from: `check` errors are recomputed when the target (profile) changes. */
export type DraftAttachment = Attachment & { errorSource?: 'check' | 'upload' | 'prepare' };

export type DraftAction =
  | { type: 'add'; attachments: DraftAttachment[] }
  | { type: 'remove'; id: string }
  | { type: 'patch'; id: string; patch: Partial<DraftAttachment> }
  | { type: 'retarget'; target: AttachmentTarget }
  | { type: 'clear' }
  /** the message with these attachments was sent: drop exactly them (anything added meanwhile stays) */
  | { type: 'sent'; ids: readonly string[] };

export function newAttachmentId(): string {
  let hex = '';
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c && typeof c.getRandomValues === 'function') {
    const a = c.getRandomValues(new Uint8Array(8));
    for (let i = 0; i < a.length; i++) hex += a[i].toString(16).padStart(2, '0');
  } else {
    for (let i = 0; i < 16; i++) hex += Math.floor(Math.random() * 16).toString(16);
  }
  return `att-${hex}`;
}

/** File must go to the bridge before sending. */
export function needsUpload(att: Attachment, target: AttachmentTarget): boolean {
  return target.kind === 'hermes' && target.bridge && att.kind === 'file' && !att.remoteRef;
}

/** Apply the per-target check: sets/clears `check` errors, keeps upload/prepare errors. */
export function applyCheck(att: DraftAttachment, target: AttachmentTarget): DraftAttachment {
  if (att.status === 'uploading') return att;
  if (att.status === 'error' && att.errorSource && att.errorSource !== 'check') return att;
  const err = checkAttachment(att, target);
  if (err) return { ...att, status: 'error', error: err, errorSource: 'check' };
  if (att.status === 'error') return { ...att, status: 'ready', error: undefined, errorSource: undefined };
  return att;
}

export function draftReducer(state: DraftAttachment[], action: DraftAction): DraftAttachment[] {
  switch (action.type) {
    case 'add':
      return [...state, ...action.attachments];
    case 'remove':
      return state.filter((a) => a.id !== action.id);
    case 'patch':
      return state.map((a) => (a.id === action.id ? { ...a, ...action.patch } : a));
    case 'retarget':
      return state.map((a) => applyCheck(a, action.target));
    case 'clear':
      return [];
    case 'sent': {
      const ids = new Set(action.ids);
      return state.filter((a) => !ids.has(a.id));
    }
  }
}

export function draftIsBusy(atts: readonly Attachment[]): boolean {
  return atts.some((a) => a.status === 'uploading');
}

export function draftHasErrors(atts: readonly Attachment[]): boolean {
  return atts.some((a) => a.status === 'error');
}

/** What gets stored on the sent ChatMessage (drops draft-only fields). */
export function toSent(att: DraftAttachment): Attachment {
  const { errorSource: _e, progress: _p, error: _err, ...rest } = att;
  return { ...rest, status: 'ready' };
}
