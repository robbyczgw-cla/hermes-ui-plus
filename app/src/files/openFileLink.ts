/** A file link tapped inside running text (web): the system path of the file actions, never the bare URL in place. */
import type { FileLink } from './fileLinks';
import { parseSizeText } from './fileLinks';
import { openWebFile } from './webFileActions';
import { browserFileDeps, fetchFileBytes } from './webFileDom';

export function openFileLink(link: FileLink): void {
  const src = { key: link.href, name: link.name, mime: link.mime, url: link.href, downloadUrl: link.downloadUrl, size: parseSizeText(link.sizeText) };
  void openWebFile(src, browserFileDeps(src, () => fetchFileBytes(link.href)), { system: true }).catch(() => undefined);
}
