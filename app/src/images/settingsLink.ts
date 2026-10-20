/**
 * "Einstellungen" link in the note under an image block without photos (images/miss.ts). The hui renderer knows no
 * routes: the app shell registers how to open the settings (filtered to the right row), or 'none' when its settings
 * have no image rows (the note then says what still helps, miss.ts missNoteAction); without a registration
 * (component gallery, tests, share-as-image) the note shows no link.
 */
import { useSyncExternalStore } from 'react';
import type { ImageMissSetting } from './miss.ts';

export type ImageSettingsOpener = (target: Exclude<ImageMissSetting, null>) => void;

let opener: ImageSettingsOpener | 'none' | null = null;
const listeners = new Set<() => void>();

/** Called by the app shell (returns an unregister function). */
export function setImageSettingsOpener(fn: ImageSettingsOpener | 'none' | null): () => void {
  opener = fn;
  listeners.forEach((l) => l());
  return () => {
    if (opener !== fn) return;
    opener = null;
    listeners.forEach((l) => l());
  };
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const get = () => opener;

export function useImageSettingsOpener(): ImageSettingsOpener | 'none' | null {
  return useSyncExternalStore(subscribe, get, get);
}
