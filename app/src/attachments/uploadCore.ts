/**
 * UI-bridge upload contract (pure, uploadCore.test.ts):
 *   POST {origin}/bridge/uploads   origin = profile baseUrl without trailing /v1
 *   Authorization: Bearer <BRIDGE_TOKEN>, Content-Type: <mime>, X-Filename: encodeURIComponent(name)
 *   body = raw file bytes (no multipart), max 20 MB
 *   201 {id, path, name, size, mimeType} | 400/401/413/415 {error:{message,type}}
 * Bridge detection: GET {origin}/health → response header `X-Hermes-UI-Bridge: 1`.
 */
import { AttachmentError, LIMITS } from './types.ts';
import type { Attachment, AttachmentMsg, RemoteRef } from './types.ts';
import { formatBytes } from './mime.ts';

export function bridgeOrigin(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '').replace(/\/v1$/, '');
}

export function uploadUrl(baseUrl: string): string {
  return `${bridgeOrigin(baseUrl)}/bridge/uploads`;
}

export function healthUrl(baseUrl: string): string {
  return `${bridgeOrigin(baseUrl)}/health`;
}

export function uploadHeaders(att: Pick<Attachment, 'name' | 'mimeType'>, token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': att.mimeType || 'application/octet-stream',
    'X-Filename': encodeURIComponent(att.name),
    Accept: 'application/json',
  };
}

export function isBridgeHeader(value: string | null | undefined): boolean {
  return (value ?? '').trim() === '1';
}

function serverMessage(body: string): string | undefined {
  try {
    const j = JSON.parse(body) as { error?: { message?: unknown } | string };
    if (typeof j.error === 'string') return j.error;
    if (j.error && typeof j.error.message === 'string') return j.error.message;
  } catch {
    // not JSON
  }
  return undefined;
}

export function uploadErrorMessage(status: number, body: string, name: string): AttachmentMsg {
  switch (status) {
    case 401:
      return { key: 'attachments.upload.unauthorized' };
    case 404:
    case 405:
      return { key: 'attachments.upload.notSupported' };
    case 413:
      return { key: 'attachments.upload.tooLarge', vars: { name, max: formatBytes(LIMITS.maxUploadBytes) } };
    case 415:
      return { key: 'attachments.upload.unsupportedType', vars: { name } };
    case 400: {
      const reason = serverMessage(body);
      return reason ? { key: 'attachments.upload.failedWithReason', vars: { name, reason } } : { key: 'attachments.upload.failed', vars: { name } };
    }
    default:
      if (status === 0) return { key: 'attachments.upload.failedNoConnection', vars: { name } };
      return { key: 'attachments.upload.failedStatus', vars: { name, status } };
  }
}

/** Parse the upload response; throws AttachmentError with a message key. */
export function parseUploadResponse(status: number, body: string, att: Pick<Attachment, 'id' | 'name' | 'mimeType' | 'size'>): RemoteRef {
  if (status < 200 || status >= 300) throw new AttachmentError(`upload_${status}`, uploadErrorMessage(status, body, att.name), att.id);
  let j: Partial<RemoteRef> | null = null;
  try {
    j = JSON.parse(body) as Partial<RemoteRef>;
  } catch {
    j = null;
  }
  if (!j || typeof j.path !== 'string' || !j.path.startsWith('/')) {
    throw new AttachmentError('upload_bad_response', { key: 'attachments.upload.badResponse', vars: { name: att.name } }, att.id);
  }
  return {
    id: typeof j.id === 'string' ? j.id : '',
    path: j.path,
    name: typeof j.name === 'string' && j.name ? j.name : att.name,
    size: typeof j.size === 'number' ? j.size : att.size,
    mimeType: typeof j.mimeType === 'string' && j.mimeType ? j.mimeType : att.mimeType,
  };
}
