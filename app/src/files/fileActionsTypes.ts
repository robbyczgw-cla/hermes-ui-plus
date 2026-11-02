import type { WebFileSource } from './webFile.ts';
import type { FileDeps, FileFailure } from './webFileActions.ts';

/** "Öffnen" / "Sichern" for one file in a chat (web / desktop; native renders nothing, see WebFileActions.tsx). */
export type WebFileActionsProps = {
  src: WebFileSource;
  /** the bytes (signed URL, bridge with token, local store) */
  fetchBytes: () => Promise<Blob>;
  /** `small` buttons inside a card (default) */
  size?: 'small' | 'regular';
};

export type PdfViewerProps = {
  src: WebFileSource;
  deps: FileDeps;
  onClose: () => void;
  onSave: () => void;
  /** "Jetzt sichern" after iOS refused the share sheet for lack of a fresh tap */
  saveNow: boolean;
  saving: boolean;
  /** the file the system shows (viewer failed or the user asks for it) */
  onOpenSystem: () => void;
};

export type PdfError = FileFailure | 'broken' | 'noViewer';
