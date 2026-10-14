/**
 * "✨ Bearbeiten" for chat images (sheet, quick edits, before/after). See core.ts for the logic.
 * ChatView wraps the chat in <ImageEditProvider>; image views call useImageEdit()?.open(src).
 */
export { ImageEditContext, useImageEdit } from './context';
export type { ImageEditApi } from './context';
export { ImageEditProvider } from './ImageEditProvider';
export { BeforeAfter } from './BeforeAfter';
export { editGate, findEditPairs, resultImageUrl, buildEditRequestText, isEditRequestText, EDIT_PURPOSE } from './core';
export type { EditSource, EditGate } from './core';
