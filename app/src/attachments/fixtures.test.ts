/// <reference types="node" />
// Shared fixtures for the attachments tests (not a test file itself).
import type { Attachment, AttachmentReader } from './types.ts';

export function att(p: Partial<Attachment> & Pick<Attachment, 'name' | 'mimeType'>): Attachment {
  return {
    id: p.id ?? `att-${p.name}`,
    kind: p.kind ?? (p.mimeType.startsWith('image/') ? 'image' : 'file'),
    size: p.size ?? 1000,
    uri: p.uri ?? `file:///docs/attachments/${p.name}`,
    status: p.status ?? 'ready',
    ...p,
  };
}

/** In-memory reader: content keyed by attachment id. Counts reads. */
export function memReader(files: Record<string, string>): AttachmentReader & { reads: number } {
  const r = {
    reads: 0,
    async base64(a: Attachment) {
      r.reads++;
      const c = files[a.id];
      if (c === undefined) throw new Error('ENOENT');
      return Buffer.from(c, 'utf8').toString('base64');
    },
    async text(a: Attachment) {
      r.reads++;
      const c = files[a.id];
      if (c === undefined) throw new Error('ENOENT');
      return c;
    },
  };
  return r;
}
