/**
 * Upload to the UI bridge (`POST {origin}/bridge/uploads`, raw body, see uploadCore.ts) and bridge
 * detection. Native: expo-file-system `File.upload` (streams from disk, real progress events);
 * web: fetch with the blob (no progress → indeterminate).
 */
import { fetch as expoFetch } from 'expo/fetch';
import { File, UploadType } from 'expo-file-system';
import { Platform } from 'react-native';
import { healthUrl, isBridgeHeader, parseUploadResponse, uploadHeaders, uploadUrl } from './uploadCore';
import { AttachmentError, isAttachmentError } from './types';
import type { Attachment, RemoteRef } from './types';
import { webAttachments } from './webStore';

export type BridgeConn = { baseUrl: string; apiKey: string };

export type UploadOptions = {
  signal?: AbortSignal;
  /** 0..1, or undefined when the platform reports no progress */
  onProgress?: (fraction: number | undefined) => void;
};

export async function uploadAttachment(att: Attachment, conn: BridgeConn, opts: UploadOptions = {}): Promise<RemoteRef> {
  const url = uploadUrl(conn.baseUrl);
  const headers = uploadHeaders(att, conn.apiKey);
  try {
    if (Platform.OS === 'web') {
      opts.onProgress?.(undefined);
      const blob = await webAttachments().blob(att.uri);
      const res = await fetch(url, { method: 'POST', headers, body: blob, signal: opts.signal });
      return parseUploadResponse(res.status, await res.text(), att);
    }
    const res = await new File(att.uri).upload(url, {
      httpMethod: 'POST',
      uploadType: UploadType.BINARY_CONTENT,
      headers,
      mimeType: att.mimeType,
      signal: opts.signal,
      onProgress: (p) => opts.onProgress?.(p.totalBytes > 0 ? Math.min(1, p.bytesSent / p.totalBytes) : undefined),
    });
    return parseUploadResponse(res.status, res.body, att);
  } catch (e) {
    if (isAttachmentError(e)) throw e;
    if (opts.signal?.aborted) throw new AttachmentError('upload_aborted', { key: 'attachments.upload.aborted' }, att.id);
    return parseUploadResponse(0, '', att); // throws "failedNoConnection"
  }
}

/** `GET {origin}/health` → true when the response carries `X-Hermes-UI-Bridge: 1`. */
export async function detectBridge(baseUrl: string, timeoutMs = 6000): Promise<boolean> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await expoFetch(healthUrl(baseUrl), { method: 'GET', signal: ctrl.signal });
    return isBridgeHeader(res.headers.get('x-hermes-ui-bridge'));
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}
