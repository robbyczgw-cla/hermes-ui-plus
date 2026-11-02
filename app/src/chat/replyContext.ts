/**
 * Quote / reply wiring between the message rows and the chat view (quote.ts): "Antworten" on a message puts a quote
 * into the composer, a tap on a sent quote jumps to the cited message, which flashes briefly. The flash is a tiny
 * store read per row, so only the two rows whose state changes re-render.
 */
import { createContext, useContext, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { createStore } from '../background/noticeState';
import { foldText } from './findInChat';
import type { Quote } from './quoteWire';

export type ReplyActions = {
  /** false without a composer to quote into (read-only Bot Chat): "Antworten" is not offered, a tap on a quote still works */
  canQuote: boolean;
  /** "Antworten": quote this message (or the part selected in it) into the composer */
  reply(messageId: string, selection?: string): void;
  /** a quote in a sent message was tapped: show the cited message (`fromId` = the quoting message) */
  jump(fromId: string, quote: Quote): void;
};

export const ReplyContext = createContext<ReplyActions | null>(null);

export function useReply(): ReplyActions | null {
  return useContext(ReplyContext);
}

/** how long a jumped-to message stays marked */
export const FLASH_MS = 1800;

const flash = createStore<string | null>(null);
let flashTimer: ReturnType<typeof setTimeout> | null = null;

export function flashMessage(id: string): void {
  if (flashTimer) clearTimeout(flashTimer);
  flash.set(null);
  flash.set(id);
  flashTimer = setTimeout(() => {
    flashTimer = null;
    if (flash.get() === id) flash.set(null);
  }, FLASH_MS);
}

export function useFlashed(id: string): boolean {
  return useSyncExternalStore(
    flash.subscribe,
    () => flash.get() === id,
    () => false,
  );
}

/** web: the last non-empty text selection (a click on a menu button collapses it before the handler runs) */
let lastSelection: { text: string; at: number } | null = null;
let tracking = false;
const SELECTION_FRESH_MS = 8000;

function readSelection(): string {
  const w = globalThis as { getSelection?: () => { toString(): string } | null };
  return w.getSelection?.()?.toString().replace(/\s+/g, ' ').trim() ?? '';
}

/** web: start following the selection (called when a chat row mounts; idempotent) */
export function trackSelection(): void {
  if (tracking || Platform.OS !== 'web') return;
  const d = (globalThis as { document?: { addEventListener(type: string, fn: () => void): void } }).document;
  if (!d) return;
  tracking = true;
  d.addEventListener('selectionchange', () => {
    const text = readSelection();
    if (text.length >= 2) lastSelection = { text, at: Date.now() };
  });
}

/**
 * Web: the text the user selected, if it lies inside `messageText` (a selection elsewhere on the page is ignored).
 * Native: '' (the menu quotes the start of the message).
 */
export function selectionWithin(messageText: string): string {
  if (Platform.OS !== 'web') return '';
  const now = readSelection();
  const sel = now.length >= 2 ? now : lastSelection && Date.now() - lastSelection.at < SELECTION_FRESH_MS ? lastSelection.text : '';
  if (sel.length < 2) return '';
  const hit = foldText(messageText.replace(/\s+/g, ' ')).includes(foldText(sel));
  if (hit) lastSelection = null;
  return hit ? sel : '';
}
