/**
 * Native right-click menu for chat answers in the macOS app (Tauri menu API, `desktop_context_menu`). The menu is
 * built by the message row from the same item keys as its in-app "⋯" menu (chat/answerMenu.ts); a right-click with
 * selected text keeps the system menu (Copy, Look Up, Translate, …), and outside the desktop app nothing changes
 * (long-press / "⋯" stay the menu there).
 */
import { useMemo, useRef, useEffect } from 'react';
import type { TFn } from '../i18n';
import { invokeDesktop, isDesktopMac, onDesktopEvent } from './bridge';

export type NativeMenuItem = { id: string; label: string; enabled?: boolean } | { separator: true };
export type NativeMenu = { items: NativeMenuItem[]; run(action: string): void };

/** the answer actions offered natively; `undefined` = not available for this answer */
export type AnswerMenuActions = {
  copy?: () => void;
  copyMarkdown?: () => void;
  retry?: () => void;
  speak?: () => void;
  speaking?: boolean;
  share?: () => void;
  /** "Share as Image…": the share-as-image sheet */
  shareImage?: () => void;
  branch?: () => void;
};

/**
 * Copy · Copy as Markdown │ Retry · Read Aloud · Share… · Share as Image… │ Continue in New Chat. `keys` = what the in-app menu offers
 * for this answer (answerMenuItems), so both menus agree on availability.
 */
export function answerContextMenu(keys: readonly string[], a: AnswerMenuActions, t: TFn): NativeMenu | null {
  const has = (k: string) => keys.includes(k);
  const groups: { id: string; label: string; fn?: () => void }[][] = [
    [
      { id: 'copy', label: t('desktop.ctx.copy'), fn: has('copy') ? a.copy : undefined },
      { id: 'copyMarkdown', label: t('desktop.ctx.copyMarkdown'), fn: has('copyMarkdown') ? a.copyMarkdown : undefined },
    ],
    [
      { id: 'retry', label: t('desktop.ctx.retry'), fn: has('retry') ? a.retry : undefined },
      { id: 'speak', label: a.speaking ? t('desktop.ctx.stopReading') : t('desktop.ctx.readAloud'), fn: has('copy') ? a.speak : undefined },
      { id: 'share', label: t('desktop.ctx.share'), fn: has('share') ? a.share : undefined },
      { id: 'shareImage', label: t('desktop.ctx.shareImage'), fn: has('shareImage') ? a.shareImage : undefined },
    ],
    [{ id: 'branch', label: t('desktop.ctx.branch'), fn: has('branch') ? a.branch : undefined }],
  ];
  const items: NativeMenuItem[] = [];
  const run = new Map<string, () => void>();
  for (const g of groups) {
    const live = g.filter((x) => x.fn);
    if (!live.length) continue;
    if (items.length) items.push({ separator: true });
    for (const x of live) {
      items.push({ id: x.id, label: x.label });
      run.set(x.id, x.fn!);
    }
  }
  if (!run.size) return null;
  return { items, run: (action) => run.get(action)?.() };
}

let seq = 0;
let pending: { token: string; run: (action: string) => void } | null = null;
let bound = false;

function bind(): void {
  if (bound) return;
  bound = true;
  onDesktopEvent((e) => {
    if (e.cmd !== 'context-action' || !pending || e.token !== pending.token || !e.action) return;
    const p = pending;
    pending = null;
    p.run(e.action);
  });
}

type ContextMenuEvent = { preventDefault(): void };

/**
 * Props for the row's Pressable (`onContextMenu`, web only): `{}` outside the macOS app. Typed as `object` so it can
 * be spread into RN components whose props do not list DOM events.
 */
export function useNativeContextMenu(build: () => NativeMenu | null): object {
  const ref = useRef(build);
  useEffect(() => {
    ref.current = build;
  });
  return useMemo(() => {
    if (!isDesktopMac()) return {};
    return {
      onContextMenu: (e: ContextMenuEvent) => {
        // a text selection keeps WebKit's own menu (Copy / Look Up / Translate / Speech)
        if (typeof window !== 'undefined' && window.getSelection()?.toString().trim()) return;
        const menu = ref.current();
        if (!menu) return;
        e.preventDefault();
        bind();
        const token = `m${++seq}`;
        pending = { token, run: menu.run };
        void invokeDesktop('desktop_context_menu', { token, items: menu.items });
      },
    };
  }, []);
}
