/**
 * Composer-side attachment state. One instance per composer.
 *
 *   const draft = useAttachmentDraft({ target, conn });
 *   <AttachmentButton onSelect={draft.add} disabled={!draft.canAdd} />
 *   <AttachmentTray attachments={draft.attachments} onRemove={draft.remove} onRetry={draft.retry} />
 *   const atts = await draft.prepareForSend(); // null → draft.error explains why
 *   if (atts && onSend(text, atts)) draft.commitSend(atts); // a refused send keeps the draft
 *
 * Files are uploaded to the bridge right after picking (target hermes + bridge), like ChatGPT.
 *
 * Send while uploads still run (pendingUploads.ts): `preparePending()` validates without waiting and returns the
 * attachments + a PendingUploads over the running upload tasks; `commitSend` then hands those tasks over to the
 * message (they keep running, the draft forgets them – leaving the chat no longer aborts them).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Platform } from 'react-native';
import { useT } from '../i18n';
import { applyCheck, draftHasErrors, draftIsBusy, draftReducer, needsUpload, toSent } from './draft';
import type { DraftAction, DraftAttachment } from './draft';
import { importWebFiles, openAppSettings, pickAttachments, recoverPendingPick } from './pickers';
import type { PickResult, PickSource } from './pickers';
import { setDraftUris } from './liveDrafts';
import { deleteAttachmentFiles } from './store';
import { createPendingUploads, startUploadTask, withTaskState, type PendingUploads, type UploadTask } from './pendingUploads';
import { uploadAttachment } from './upload';
import type { BridgeConn } from './upload';
import { validateForTarget, remainingSlots } from './validate';
import { isAttachmentError } from './types';
import type { Attachment, AttachmentMsg, AttachmentTarget } from './types';

export type UseAttachmentDraftOptions = {
  target: AttachmentTarget;
  /** bridge connection (baseUrl incl. /v1 + BRIDGE_TOKEN); required when target is hermes+bridge */
  conn?: BridgeConn | null;
  /** Claude: attachments already in the conversation (history is resent → shared budget) */
  history?: readonly Attachment[];
};

export type AttachmentDraft = {
  attachments: DraftAttachment[];
  /** a picker is open or images are being prepared */
  picking: boolean;
  /** any upload running */
  uploading: boolean;
  /** last error/notice, translated (picker problems, validation on send) */
  error: string | null;
  clearError(): void;
  canAdd: boolean;
  /** true when the draft can be sent (no running uploads, no error chips) */
  canSend: boolean;
  add(source: PickSource): Promise<void>;
  /** web / desktop app: dropped or pasted files */
  addFiles(files: readonly File[]): Promise<void>;
  remove(id: string): void;
  retry(id: string): void;
  /**
   * Validate for the target, wait for uploads and return the attachments to put on the ChatMessage
   * WITHOUT emptying the draft. Returns null + sets `error` when something is wrong, [] for an empty
   * draft. Call `commitSend` once the send was accepted; a refused send keeps the tray as it is.
   */
  prepareForSend(): Promise<Attachment[] | null>;
  /**
   * Send now, uploads still running: validates (no waiting) and returns the attachments as they are plus a
   * PendingUploads that follows their uploads (pendingUploads.ts). null + `error` when something is wrong.
   * Same commit rule as prepareForSend: `commitSend(attachments)` once the chat took it (hands the uploads over).
   */
  preparePending(): { attachments: Attachment[]; pending: PendingUploads } | null;
  /** the message carrying `sent` was accepted: remove exactly those from the draft (files now belong to the message) */
  commitSend(sent: readonly Attachment[]): void;
  /** prepareForSend + commitSend in one step (only for callers whose send cannot be refused) */
  takeForSend(): Promise<Attachment[] | null>;
  /** drop the draft and delete its local files (e.g. new chat) */
  discard(): void;
};

export function useAttachmentDraft(opts: UseAttachmentDraftOptions): AttachmentDraft {
  // the ref is the source of truth (async upload callbacks + takeForSend read it), state mirrors it
  const stateRef = useRef<DraftAttachment[]>([]);
  const [attachments, setAttachments] = useState<DraftAttachment[]>([]);
  const dispatch = useCallback((action: DraftAction) => {
    stateRef.current = draftReducer(stateRef.current, action);
    setAttachments(stateRef.current);
  }, []);
  const [picking, setPicking] = useState(false);
  const tr = useT();
  const [notice, setNotice] = useState<AttachmentMsg[] | null>(null);
  const error = useMemo(() => (notice ? notice.map((m) => tr(m.key, m.vars)).join('\n') : null), [notice, tr]);
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });
  const uploads = useRef(new Map<string, { task: UploadTask; unsub: () => void }>());

  const targetKey =
    opts.target.kind === 'hermes'
      ? `hermes:${opts.target.bridge ? 1 : 0}`
      : opts.target.kind === 'openai'
        ? `openai:${opts.target.caps.images ? 1 : 0}:${opts.target.caps.maxBytes}:${opts.target.caps.files.join(',')}`
        : 'claude';

  const newTask = useCallback((att: Attachment, conn: BridgeConn) => startUploadTask(att, (a, o) => uploadAttachment(a, conn, o)), []);

  const startUpload = useCallback((att: DraftAttachment) => {
    const { target, conn } = optsRef.current;
    if (!needsUpload(att, target) || uploads.current.has(att.id)) return;
    if (!conn) {
      dispatch({ type: 'patch', id: att.id, patch: { status: 'error', error: { key: 'attachments.upload.noBridge' }, errorSource: 'upload' } });
      return;
    }
    const task = newTask(att, conn);
    dispatch({ type: 'patch', id: att.id, patch: { status: 'uploading', progress: 0, error: undefined, errorSource: undefined } });
    // progress (whole percent) / done / failed → the chip; an aborted task (removed chip) reports nothing
    const unsub = task.subscribe(() => {
      if (task.state() === 'aborted') return;
      const cur = stateRef.current.find((a) => a.id === att.id);
      if (cur) dispatch({ type: 'patch', id: att.id, patch: withTaskState(cur, task) });
      if (task.state() !== 'running') uploads.current.delete(att.id);
    });
    uploads.current.set(att.id, { task, unsub });
  }, [dispatch, newTask]);

  // profile switch: re-check every item, start uploads that are now needed
  useEffect(() => {
    optsRef.current = opts;
    dispatch({ type: 'retarget', target: opts.target });
    for (const a of stateRef.current) if (a.status === 'ready') startUpload(a);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey, startUpload, dispatch]);

  const accept = useCallback(
    (res: PickResult) => {
      if (res.attachments.length) {
        const checked = res.attachments.map((a) => applyCheck(a, optsRef.current.target));
        dispatch({ type: 'add', attachments: checked });
        for (const a of checked) if (a.status === 'ready') startUpload(a);
      }
      if (res.errors.length) {
        if (res.permissionDenied && Platform.OS !== 'web') {
          const msg = res.errors.map((m) => tr(m.key, m.vars)).join('\n');
          Alert.alert(tr('attachments.permission.title'), msg, [
            { text: tr('actions.cancel'), style: 'cancel' },
            { text: tr('attachments.permission.settings'), onPress: openAppSettings },
          ]);
        } else {
          setNotice(res.errors);
        }
      }
    },
    [startUpload, dispatch, tr]
  );

  // Android: recover a camera photo after the activity was recreated
  useEffect(() => {
    void recoverPendingPick().then((r) => {
      if (r) accept(r);
    });
  }, [accept]);

  // abort running uploads on unmount
  useEffect(() => {
    const map = uploads.current;
    return () => {
      for (const u of map.values()) u.task.abort();
    };
  }, []);

  const add = useCallback(
    async (source: PickSource) => {
      setNotice(null);
      setPicking(true);
      try {
        // each file joins the tray (and starts uploading) as soon as it is prepared, not after the whole pick
        const res = await pickAttachments(source, remainingSlots(stateRef.current.length), (att) =>
          accept({ attachments: [att], errors: [], canceled: false })
        );
        accept({ ...res, attachments: [] });
      } finally {
        setPicking(false);
      }
    },
    [accept]
  );

  const addFiles = useCallback(
    async (files: readonly File[]) => {
      if (!files.length) return;
      setNotice(null);
      setPicking(true);
      try {
        const res = await importWebFiles(files, remainingSlots(stateRef.current.length), (att) =>
          accept({ attachments: [att], errors: [], canceled: false })
        );
        accept({ ...res, attachments: [] });
      } finally {
        setPicking(false);
      }
    },
    [accept]
  );

  const remove = useCallback((id: string) => {
    const u = uploads.current.get(id);
    if (u) {
      u.unsub();
      u.task.abort();
      uploads.current.delete(id);
    }
    const att = stateRef.current.find((a) => a.id === id);
    dispatch({ type: 'remove', id });
    if (att) void deleteAttachmentFiles([att]);
  }, [dispatch]);

  const retry = useCallback(
    (id: string) => {
      const att = stateRef.current.find((a) => a.id === id);
      if (!att) return;
      const checked = applyCheck({ ...att, status: 'ready', error: undefined, errorSource: undefined }, optsRef.current.target);
      dispatch({ type: 'patch', id, patch: checked });
      if (checked.status === 'ready') startUpload(checked);
    },
    [startUpload, dispatch]
  );

  const prepareForSend = useCallback(async (): Promise<Attachment[] | null> => {
    setNotice(null);
    await Promise.all([...uploads.current.values()].map((u) => u.task.settled));
    const list = stateRef.current;
    if (list.length === 0) return [];
    const { target, history } = optsRef.current;
    try {
      validateForTarget(list, target, { history });
      if (list.some((a) => needsUpload(a, target))) {
        setNotice([{ key: 'attachments.send.notUploaded' }]);
        return null;
      }
    } catch (e) {
      setNotice([isAttachmentError(e) ? e.msg : { key: 'attachments.send.failed' }]);
      return null;
    }
    return list.map(toSent);
  }, []);

  const preparePending = useCallback((): { attachments: Attachment[]; pending: PendingUploads } | null => {
    setNotice(null);
    const list = stateRef.current;
    const { target, conn, history } = optsRef.current;
    try {
      validateForTarget(list, target, { history });
    } catch (e) {
      setNotice([isAttachmentError(e) ? e.msg : { key: 'attachments.send.failed' }]);
      return null;
    }
    const tasks = new Map<string, UploadTask>();
    for (const [id, u] of uploads.current) tasks.set(id, u.task);
    const pending = createPendingUploads(list, tasks, {
      target,
      start: (att) =>
        conn ? newTask(att, conn) : startUploadTask(att, async () => Promise.reject(new Error('no bridge'))),
    });
    return { attachments: list.map((a) => ({ ...a })), pending };
  }, [newTask]);

  const commitSend = useCallback(
    (sent: readonly Attachment[]) => {
      if (!sent.length) return;
      // running uploads now belong to the sent message (pendingUploads): stop following, never abort them
      for (const a of sent) {
        const u = uploads.current.get(a.id);
        if (!u) continue;
        u.unsub();
        uploads.current.delete(a.id);
      }
      dispatch({ type: 'sent', ids: sent.map((a) => a.id) });
    },
    [dispatch],
  );

  const takeForSend = useCallback(async (): Promise<Attachment[] | null> => {
    const atts = await prepareForSend();
    if (atts) commitSend(atts);
    return atts;
  }, [prepareForSend, commitSend]);

  const discard = useCallback(() => {
    for (const u of uploads.current.values()) u.task.abort();
    uploads.current.clear();
    const list = stateRef.current;
    dispatch({ type: 'clear' });
    void deleteAttachmentFiles(list);
  }, [dispatch]);

  // keep unsent files out of the start-up prune
  const [owner] = useState(() => `d${Math.random().toString(36).slice(2)}`);
  useEffect(() => {
    setDraftUris(owner, attachments.map((a) => a.uri));
  }, [owner, attachments]);
  useEffect(() => () => setDraftUris(owner, []), [owner]);

  const uploading = draftIsBusy(attachments);
  return useMemo(
    () => ({
      attachments,
      picking,
      uploading,
      error,
      clearError: () => setNotice(null),
      canAdd: !picking && remainingSlots(attachments.length) > 0,
      canSend: !uploading && !picking && !draftHasErrors(attachments),
      add,
      addFiles,
      remove,
      retry,
      prepareForSend,
      preparePending,
      commitSend,
      takeForSend,
      discard,
    }),
    [attachments, picking, uploading, error, add, addFiles, remove, retry, prepareForSend, preparePending, commitSend, takeForSend, discard]
  );
}
