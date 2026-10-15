/**
 * Per-backend validation + size budgets. Pure (validate.test.ts).
 *
 * Hermes: one request body ≤ 10 MB → images (base64) + inline text must fit in
 *   `hermesPayloadBudget`; files go to the bridge (≤ 20 MB each, only a path is sent) or, without
 *   bridge, small text files are inlined.
 * Claude: the client resends the whole history every turn → the budget counts ALL attachments of
 *   the conversation (32 MB request limit). docx/xlsx are not readable by the API.
 */
import { classifyFile, formatBytes, formatSizeOverLimit, isClaudeImageMime } from './mime.ts';
import { AttachmentError, LIMITS } from './types.ts';
import { capsAllowFile, OPENAI_MAX_IMAGE_BASE64 } from './openaiCaps.ts';
import type { Attachment, AttachmentMsg, AttachmentTarget } from './types.ts';

const size = (n: number) => formatBytes(n);

export function base64Length(bytes: number): number {
  return Math.ceil(bytes / 3) * 4;
}

/** Bytes this attachment adds to a request body for `target` (rough upper bound). */
export function encodedSize(att: Attachment, target: AttachmentTarget): number {
  const cls = classifyFile(att.mimeType);
  if (att.kind === 'image' || cls === 'image') return base64Length(att.size) + 64;
  if (target.kind === 'hermes') {
    if (target.bridge) return 400; // text reference only
    return Math.ceil(att.size * 1.15) + 300; // inline text, JSON escaping
  }
  if (target.kind === 'openai') {
    if (cls === 'text') return Math.ceil(att.size * 1.15) + 300; // inlined text part
    return base64Length(att.size) + 128; // file part (data URL)
  }
  if (cls === 'pdf') return base64Length(att.size) + 128;
  return Math.ceil(att.size * 1.15) + 200; // text document
}

export function totalEncodedSize(atts: readonly Attachment[], target: AttachmentTarget): number {
  return atts.reduce((s, a) => s + encodedSize(a, target), 0);
}

/** Can the user add `n` more attachments to a draft that already has `count`? */
export function remainingSlots(count: number): number {
  return Math.max(0, LIMITS.maxAttachments - count);
}

/** Per-attachment check; returns the message key of the problem or null. */
export function checkAttachment(att: Attachment, target: AttachmentTarget): AttachmentMsg | null {
  const name = att.name;
  const cls = classifyFile(att.mimeType);
  if (cls === null && target.kind === 'openai' && !capsAllowFile(target.caps, att.mimeType)) return { key: 'attachments.validate.openaiTextOnly' };
  if (cls === null) return { key: 'attachments.validate.unsupportedType', vars: { name } };
  if (att.kind === 'image' || cls === 'image') {
    if (target.kind === 'openai' && !target.caps.images) return { key: 'attachments.validate.openaiNoImages' };
    if (!isClaudeImageMime(att.mimeType) && target.kind !== 'hermes') return { key: 'attachments.validate.unsupportedImage', vars: { name } };
    if (target.kind === 'openai' && base64Length(att.size) > OPENAI_MAX_IMAGE_BASE64) {
      return { key: 'attachments.validate.tooLarge', vars: { name, ...formatSizeOverLimit(att.size, Math.floor((OPENAI_MAX_IMAGE_BASE64 * 3) / 4)) } };
    }
    if (att.size > LIMITS.maxImageBytes) return { key: 'attachments.validate.tooLarge', vars: { name, ...formatSizeOverLimit(att.size, LIMITS.maxImageBytes) } };
    return null;
  }
  if (target.kind === 'openai') {
    if (cls === 'text') {
      if (att.size > LIMITS.maxInlineTextBytes) return { key: 'attachments.validate.tooLargeText', vars: { name, ...formatSizeOverLimit(att.size, LIMITS.maxInlineTextBytes) } };
      return null;
    }
    if (!capsAllowFile(target.caps, att.mimeType)) return { key: 'attachments.validate.openaiTextOnly' };
    if (base64Length(att.size) > Math.min(OPENAI_MAX_IMAGE_BASE64, target.caps.maxBytes)) {
      return { key: 'attachments.validate.tooLarge', vars: { name, ...formatSizeOverLimit(att.size, Math.floor((OPENAI_MAX_IMAGE_BASE64 * 3) / 4)) } };
    }
    return null;
  }
  if (target.kind === 'hermes') {
    if (target.bridge) {
      if (att.size > LIMITS.maxUploadBytes) return { key: 'attachments.validate.tooLarge', vars: { name, ...formatSizeOverLimit(att.size, LIMITS.maxUploadBytes) } };
      return null;
    }
    if (cls !== 'text') return { key: 'attachments.validate.needsBridge', vars: { limit: size(LIMITS.maxInlineTextBytes) } };
    if (att.size > LIMITS.maxInlineTextBytes) {
      return { key: 'attachments.validate.tooLargeInline', vars: { name, ...formatSizeOverLimit(att.size, LIMITS.maxInlineTextBytes) } };
    }
    return null;
  }
  // claude
  if (cls === 'pdf' && att.size > LIMITS.maxClaudePdfBytes) return { key: 'attachments.validate.tooLarge', vars: { name, ...formatSizeOverLimit(att.size, LIMITS.maxClaudePdfBytes) } };
  if (cls === 'text' && att.size > LIMITS.maxInlineTextBytes) {
    return { key: 'attachments.validate.tooLargeText', vars: { name, ...formatSizeOverLimit(att.size, LIMITS.maxInlineTextBytes) } };
  }
  return null;
}

export type ValidateOptions = {
  /** Claude: attachments already in the conversation (resent every turn) */
  history?: readonly Attachment[];
};

/**
 * Validate the attachments of ONE outgoing message. Throws AttachmentError (message key in `msg`).
 * Returns the encoded payload estimate.
 */
export function validateForTarget(atts: readonly Attachment[], target: AttachmentTarget, opts: ValidateOptions = {}): number {
  if (atts.length > LIMITS.maxAttachments) {
    throw new AttachmentError('too_many', { key: 'attachments.validate.tooMany', vars: { max: LIMITS.maxAttachments } });
  }
  for (const a of atts) {
    if (a.status === 'error') {
      throw new AttachmentError('attachment_error', a.error ?? { key: 'attachments.validate.defective', vars: { name: a.name } }, a.id);
    }
    const err = checkAttachment(a, target);
    if (err) throw new AttachmentError('unsupported', err, a.id);
  }
  const total = totalEncodedSize(atts, target);
  if (target.kind === 'hermes' && total > LIMITS.hermesPayloadBudget) {
    throw new AttachmentError('too_large', {
      key: 'attachments.validate.payloadTooLarge',
      vars: formatSizeOverLimit(total, LIMITS.hermesPayloadBudget),
    });
  }
  if (target.kind === 'openai' && total > target.caps.maxBytes) {
    throw new AttachmentError('too_large', {
      key: 'attachments.validate.payloadTooLarge',
      vars: formatSizeOverLimit(total, target.caps.maxBytes),
    });
  }
  if (target.kind === 'claude') {
    const hist = totalEncodedSize(opts.history ?? [], target);
    if (total + hist > LIMITS.claudeRequestBudget) {
      throw new AttachmentError(
        'too_large',
        hist > 0
          ? { key: 'attachments.validate.historyTooLarge', vars: { history: size(hist), max: size(LIMITS.claudeRequestBudget) } }
          : { key: 'attachments.validate.claudeTooLarge', vars: formatSizeOverLimit(total, LIMITS.claudeRequestBudget) }
      );
    }
  }
  return total;
}
