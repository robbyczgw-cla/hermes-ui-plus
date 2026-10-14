/**
 * Prepare picked files one after the other (native image decode/resize is memory-heavy: never two 12 MP
 * originals at once) and hand each one out as soon as it is ready, so the composer shows it and starts its
 * upload while the next one is still being prepared. Pure (prepareEach.test.ts).
 */
import { isAttachmentError } from './types.ts';
import type { Attachment, AttachmentMsg } from './types.ts';

export type PrepareOutcome = { attachments: Attachment[]; errors: AttachmentMsg[] };

export async function prepareEach<T>(
  items: readonly T[],
  /** the prepared attachment, or `{ skip }` with the message for a file that is not taken (e.g. a video) */
  prepare: (item: T, index: number) => Promise<Attachment | { skip: AttachmentMsg }>,
  opts: { onPrepared?: (att: Attachment) => void; fallbackError: (item: T) => AttachmentMsg }
): Promise<PrepareOutcome> {
  const out: PrepareOutcome = { attachments: [], errors: [] };
  for (let i = 0; i < items.length; i++) {
    try {
      const r = await prepare(items[i], i);
      if ('skip' in r) {
        out.errors.push(r.skip);
        continue;
      }
      out.attachments.push(r);
      opts.onPrepared?.(r);
    } catch (e) {
      out.errors.push(isAttachmentError(e) ? e.msg : opts.fallbackError(items[i]));
    }
  }
  return out;
}
