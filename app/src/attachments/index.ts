/**
 * Attachments (images + files, ChatGPT-style). Integration guide: ./INTEGRATION.md
 *
 * UI         <AttachmentButton/>, <AttachmentTray/>, <MessageAttachments/>, <ImageViewer/>
 * State      useAttachmentDraft({ target, conn, history })
 * Encoding   buildHermesContent(text, atts, {reader, bridge})       → string | OpenAI content parts
 *            encodeClaudeAttachments / buildClaudeUserContent       → Anthropic content blocks
 *            resolveClaudeAttachmentBlocks + createCachedReader     → history replay (append-only)
 * I/O        fileReader, pickAttachments, uploadAttachment, detectBridge, deleteAttachmentFiles,
 *            pruneAttachmentFiles, shareAttachment
 */
export type { Attachment, AttachmentKind, AttachmentStatus, AttachmentTarget, AttachmentReader, RemoteRef } from './types';
export { AttachmentError, isAttachmentError, LIMITS } from './types';

export { AttachmentButton } from './components/AttachmentButton';
export type { AttachmentButtonProps } from './components/AttachmentButton';
export { AttachmentTray } from './components/AttachmentTray';
export type { AttachmentTrayProps } from './components/AttachmentTray';
export { MessageAttachments } from './components/MessageAttachments';
export type { MessageAttachmentsProps } from './components/MessageAttachments';
export { ImageViewer } from './components/ImageViewer';

export { useAttachmentDraft } from './useAttachmentDraft';
export type { AttachmentDraft, UseAttachmentDraftOptions } from './useAttachmentDraft';

export { buildHermesContent, fileReferenceText } from './encodeHermes';
export type { HermesContentPart } from './encodeHermes';
export { DEFAULT_OPENAI_CAPS, parseOpenAICaps } from './openaiCaps';
export type { OpenAIAttachmentCaps } from './openaiCaps';
export { validateForTarget, checkAttachment } from './validate';
export { draftHasErrors, toSent } from './draft';
export type { PendingUploads } from './pendingUploads';

export { pickAttachments, openAppSettings } from './pickers';
export type { PickSource, PickResult } from './pickers';
export { fileReader, deleteAttachmentFiles, pruneAttachmentFiles } from './store';
export { liveDraftUris } from './liveDrafts';
export { uploadAttachment, detectBridge } from './upload';
export type { BridgeConn } from './upload';
export { shareAttachment } from './share';
export { formatBytes } from './mime';
