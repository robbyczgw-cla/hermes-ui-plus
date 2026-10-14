import { createContext, useContext } from 'react';
import type { EditSource } from './core.ts';

/**
 * "✨ Bearbeiten" entry point for image views (fullscreen viewers, long-press on chat images).
 * Provided by the chat (ImageEditProvider in ChatView); null outside a chat → no edit action shown.
 */
export type ImageEditApi = { open(src: EditSource): void };

export const ImageEditContext = createContext<ImageEditApi | null>(null);

export function useImageEdit(): ImageEditApi | null {
  return useContext(ImageEditContext);
}
