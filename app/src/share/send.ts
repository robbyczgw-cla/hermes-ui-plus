/** A tap in the share sheet authorizes exactly this text and these files. */
export type ConfirmedShare = { text: string; fileIds: readonly string[] };

export function shareSendDecision(confirmed: ConfirmedShare, draft: {
  text: string;
  attachments: readonly { id: string }[];
  picking: boolean;
  uploading: boolean;
  error: string | null;
  canSend: boolean;
  disabled: boolean;
  streaming: boolean;
}): 'wait' | 'send' | 'keep' {
  if (draft.picking) return 'wait';
  if (draft.error || draft.text.trim() !== confirmed.text.trim() || draft.attachments.length !== confirmed.fileIds.length ||
      draft.attachments.some((a) => !confirmed.fileIds.includes(a.id))) return 'keep';
  if (draft.canSend) return 'send';
  return draft.uploading && !draft.disabled && !draft.streaming ? 'wait' : 'keep';
}
