/**
 * Which view the chat column shows: the open Hermes chat or the quick thread of its connection (⚡ is a mode
 * switch: what you see is where your message goes). A draft moves along with the switch: the composer that is left
 * hands its text over and the composer that appears takes it (`takeDraft`). "Als Schnellfrage senden" (long-press
 * on Send) opens the thread and sends right away. Pure module state (no React Native imports).
 */
import { useSyncExternalStore } from 'react';

export type QuickTarget = 'quick' | 'chat';
type Draft = { target: QuickTarget; text: string; send: boolean };

let open = false;
let draft: Draft | null = null;
/** bumped on every switch / hand-over: views take their draft when it changes */
let version = 0;
const listeners = new Set<() => void>();
const emit = () => {
  version++;
  for (const fn of listeners) fn();
};

/** switch the chat column to the quick thread; `text` goes into its composer (or is sent at once with `send`) */
export function openQuick(o: { text?: string; send?: boolean } = {}): void {
  draft = o.text?.trim() ? { target: 'quick', text: o.text, send: !!o.send } : null;
  open = true;
  emit();
}

/** back to the chat; `text` (the unsent quick draft) goes into the chat's composer */
export function closeQuick(o: { text?: string } = {}): void {
  draft = o.text?.trim() ? { target: 'chat', text: o.text, send: false } : null;
  if (!open && !draft) return;
  open = false;
  emit();
}

export function isQuickOpen(): boolean {
  return open;
}

/** the draft handed to `target` (once) */
export function takeDraft(target: QuickTarget): { text: string; send: boolean } | null {
  if (!draft || draft.target !== target) return null;
  const d = draft;
  draft = null;
  return { text: d.text, send: d.send };
}

export function subscribeQuickNav(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useQuickOpen(): boolean {
  return useSyncExternalStore(subscribeQuickNav, isQuickOpen, isQuickOpen);
}

const getVersion = () => version;
/** changes on every switch / hand-over (dependency for taking a draft) */
export function useQuickNavVersion(): number {
  return useSyncExternalStore(subscribeQuickNav, getVersion, getVersion);
}
