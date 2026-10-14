/**
 * Files into the open chat in the desktop app (mounted once via DesktopHost):
 * - drop files anywhere on the window (HTML5 drag & drop – Tauri's own drop handler is off)
 * - ⌘V with an image / files on the clipboard (screenshots, "Copy Image", Finder) – rich text keeps pasting as text
 *   (policy.ts)
 * - files dropped on the dock icon / "Open With" (the shell hands over their paths, `desktop_read_file`)
 * all become attachments of the visible chat's composer, which registers itself with `useDesktopFileTarget`.
 */
import { useEffect, useRef } from 'react';
import { shellState } from '../background/noticeState';
import { normalizeMime } from '../attachments/mime';
import { useToast } from '../chat/Toast';
import { useT } from '../i18n';
import { invokeDesktop, isDesktopApp } from './bridge';
import { consumePending, type OpenedFile } from './pending';
import { shouldAttachPaste } from './policy';

/** conversation id → the composer's "add these files" (false: this chat takes no attachments) */
const targets = new Map<string, (files: File[]) => boolean>();

/** Composer: receive dropped / pasted files while its chat is the open one. `add` undefined = cannot attach. */
export function useDesktopFileTarget(conversationId: string | undefined, add: ((files: File[]) => void) | undefined): void {
  const ref = useRef(add);
  useEffect(() => {
    ref.current = add;
  });
  useEffect(() => {
    if (!conversationId || !isDesktopApp()) return;
    const fn = (files: File[]) => {
      if (!ref.current) return false;
      ref.current(files);
      return true;
    };
    targets.set(conversationId, fn);
    return () => {
      if (targets.get(conversationId) === fn) targets.delete(conversationId);
    };
  }, [conversationId]);
}

function openTarget(): ((files: File[]) => boolean) | undefined {
  const id = shellState.chatFocused ? shellState.openConversationId : null;
  return id ? targets.get(id) : undefined;
}

function hasFiles(dt: DataTransfer | null): boolean {
  return !!dt && Array.from(dt.types ?? []).includes('Files');
}

export function useDesktopFiles(): void {
  const tr = useT();
  const toast = useToast();
  const latest = useRef({ tr, toast });
  useEffect(() => {
    latest.current = { tr, toast };
  });

  useEffect(() => {
    const attach = (files: File[]): boolean => {
      const { tr: t, toast: say } = latest.current;
      const target = openTarget();
      if (!target) {
        say(t('desktop.files.noTarget'));
        return false;
      }
      if (!target(files)) {
        say(t('desktop.files.unsupported'));
        return false;
      }
      return true;
    };
    const onDragOver = (e: DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = openTarget() ? 'copy' : 'none';
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return;
      e.preventDefault();
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length) attach(files);
    };
    const onPaste = (e: ClipboardEvent) => {
      const cd = e.clipboardData;
      if (!cd || !shellState.chatFocused) return;
      const files = Array.from(cd.files ?? []);
      if (!shouldAttachPaste({ fileCount: files.length, types: Array.from(cd.types ?? []), text: cd.getData('text/plain') })) return;
      e.preventDefault();
      e.stopPropagation();
      attach(files);
    };
    document.addEventListener('dragover', onDragOver);
    document.addEventListener('drop', onDrop);
    document.addEventListener('paste', onPaste, true);

    // dock icon / Open With: read the files the shell allowed, then attach (waits a little for the chat after a cold start)
    const offOpened = consumePending('files', (items: OpenedFile[]) => {
      void (async () => {
        const files: File[] = [];
        for (const f of items) {
          const buf = await invokeDesktop<ArrayBuffer>('desktop_read_file', { path: f.path });
          if (buf instanceof ArrayBuffer) files.push(new File([buf], f.name, { type: normalizeMime(null, f.name) }));
          else latest.current.toast(latest.current.tr('desktop.files.readFailed', { name: f.name }));
        }
        if (!files.length) return;
        for (let i = 0; i < 40 && !openTarget(); i++) await new Promise((r) => setTimeout(r, 200));
        attach(files);
      })();
    });
    return () => {
      document.removeEventListener('dragover', onDragOver);
      document.removeEventListener('drop', onDrop);
      document.removeEventListener('paste', onPaste, true);
      offOpened();
    };
  }, []);
}
