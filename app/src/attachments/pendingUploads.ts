// Uploads that outlive the composer: "Send" while files are still uploading (pure, pendingUploads.test.ts).
//
//   UploadTask      one bridge upload; progress / result go to whoever is subscribed right now. The composer draft
//                   subscribes while the file sits in the tray; on send the task is handed to the chat, not restarted.
//   PendingUploads  the attachments of a sent message whose uploads are not all done yet. The chat shows the user
//                   bubble at once (per-attachment progress), starts the turn when every upload is done, offers
//                   retry / remove on a failed one and aborts everything on cancel.
import { needsUpload, toSent, type DraftAttachment } from './draft.ts';
import { isAttachmentError } from './types.ts';
import type { Attachment, AttachmentMsg, AttachmentTarget, RemoteRef } from './types.ts';

export type UploadFn = (att: Attachment, opts: { signal: AbortSignal; onProgress(fraction: number | undefined): void }) => Promise<RemoteRef>;

export type UploadTask = {
  readonly id: string;
  state(): 'running' | 'done' | 'failed' | 'aborted';
  /** 0..1, undefined = no progress reported (web) */
  progress(): number | undefined;
  ref(): RemoteRef | undefined;
  error(): AttachmentMsg | undefined;
  /** called on every change (progress in whole percent, done, failed); returns unsubscribe */
  subscribe(fn: () => void): () => void;
  abort(): void;
  /** settles when the task is no longer running (never rejects) */
  readonly settled: Promise<void>;
};

export function startUploadTask(att: Attachment, upload: UploadFn): UploadTask {
  const ctrl = new AbortController();
  const listeners = new Set<() => void>();
  let state: ReturnType<UploadTask['state']> = 'running';
  let progress: number | undefined = 0;
  let ref: RemoteRef | undefined;
  let error: AttachmentMsg | undefined;
  let lastPct = 0;
  const emit = () => {
    for (const fn of Array.from(listeners)) fn();
  };
  const settled = upload(att, {
    signal: ctrl.signal,
    onProgress: (f) => {
      if (state !== 'running') return;
      const pct = f === undefined ? -1 : Math.floor(f * 100);
      if (pct === lastPct) return;
      lastPct = pct;
      progress = f;
      emit();
    },
  }).then(
    (r) => {
      if (state !== 'running') return;
      state = 'done';
      ref = r;
      progress = 1;
      emit();
    },
    (e: unknown) => {
      if (state !== 'running') return;
      state = ctrl.signal.aborted ? 'aborted' : 'failed';
      error = isAttachmentError(e) ? e.msg : { key: 'attachments.upload.failedGeneric' };
      progress = undefined;
      emit();
    },
  );
  return {
    id: att.id,
    state: () => state,
    progress: () => progress,
    ref: () => ref,
    error: () => error,
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    abort() {
      if (state !== 'running') return;
      state = 'aborted';
      ctrl.abort();
      emit();
    },
    settled,
  };
}

/** The draft attachment as the task currently sees it (status / progress / remoteRef / error). */
export function withTaskState(att: DraftAttachment, task: UploadTask): DraftAttachment {
  switch (task.state()) {
    case 'running':
      return { ...att, status: 'uploading', progress: task.progress(), error: undefined, errorSource: undefined };
    case 'done':
      return { ...att, status: 'ready', remoteRef: task.ref(), progress: 1, error: undefined, errorSource: undefined };
    case 'failed':
      return { ...att, status: 'error', error: task.error(), errorSource: 'upload', progress: undefined };
    case 'aborted':
      return att;
  }
}

export type PendingState = 'uploading' | 'ready' | 'failed' | 'cancelled';

export type PendingHandlers = {
  /** attachment states changed (progress, done, failed, retried, removed) */
  onChange(atts: Attachment[]): void;
  /** every upload is done: the attachments to send (status ready, remote refs set). Called once. */
  onReady(sent: Attachment[]): void;
};

export type PendingUploads = {
  /** current per-attachment states (what the bubble shows) */
  snapshot(): Attachment[];
  state(): PendingState;
  /** start listening (the chat took the send). Calls onReady at once when nothing is left to wait for */
  attach(h: PendingHandlers): void;
  /** a failed upload: start it again */
  retry(id: string): void;
  /** drop one attachment from the message (aborts its upload); returns it (its files are the caller's) */
  remove(id: string): Attachment | undefined;
  /** abort every upload; returns the attachments (files are the caller's) */
  cancel(): Attachment[];
};

export type PendingDeps = {
  target: AttachmentTarget;
  /** starts a fresh upload of `att` (retry) */
  start(att: Attachment): UploadTask;
};

/**
 * `atts`: the draft attachments at the moment of sending (already validated for the target); `tasks`: their running
 * uploads by attachment id (handed over from the draft, not restarted). Nothing is subscribed before `attach`, so a
 * send the chat refuses leaves the tasks untouched with the draft.
 */
export function createPendingUploads(atts: readonly DraftAttachment[], tasks: ReadonlyMap<string, UploadTask>, deps: PendingDeps): PendingUploads {
  let list: DraftAttachment[] = atts.map((a) => {
    const task = tasks.get(a.id);
    if (task) return withTaskState(a, task);
    // "uploading" without a task to follow would wait forever: offer retry instead
    return a.status === 'uploading' ? { ...a, status: 'error', error: { key: 'attachments.upload.failedGeneric' }, errorSource: 'upload', progress: undefined } : a;
  });
  const running = new Map<string, { task: UploadTask; unsub: () => void }>();
  let handlers: PendingHandlers | null = null;
  let cancelled = false;
  let readyFired = false;

  const waiting = (a: DraftAttachment) => a.status === 'uploading' || needsUpload(a, deps.target);
  const state = (): PendingState => {
    if (cancelled) return 'cancelled';
    if (list.some((a) => a.status === 'error')) return 'failed';
    if (list.some(waiting)) return 'uploading';
    return 'ready';
  };
  const check = () => {
    if (!handlers || cancelled) return;
    handlers.onChange(list.map((a) => ({ ...a })));
    if (state() === 'ready' && !readyFired) {
      readyFired = true;
      handlers.onReady(list.map(toSent));
    }
  };
  const follow = (task: UploadTask) => {
    running.get(task.id)?.unsub();
    const unsub = task.subscribe(() => {
      if (cancelled || task.state() === 'aborted') return;
      list = list.map((a) => (a.id === task.id ? withTaskState(a, task) : a));
      if (task.state() !== 'running') running.delete(task.id);
      check();
    });
    running.set(task.id, { task, unsub });
    // it may have finished between the snapshot and now
    list = list.map((a) => (a.id === task.id ? withTaskState(a, task) : a));
    if (task.state() !== 'running') {
      unsub();
      running.delete(task.id);
    }
  };

  return {
    snapshot: () => list.map((a) => ({ ...a })),
    state,
    attach(h) {
      if (handlers || cancelled) return;
      handlers = h;
      for (const a of list) {
        const task = tasks.get(a.id);
        if (task) follow(task);
      }
      check();
    },
    retry(id) {
      const a = list.find((x) => x.id === id);
      if (!a || a.status !== 'error' || cancelled) return;
      const task = deps.start({ ...a, status: 'ready', error: undefined });
      list = list.map((x) => (x.id === id ? withTaskState(x, task) : x));
      follow(task);
      check();
    },
    remove(id) {
      const a = list.find((x) => x.id === id);
      if (!a || cancelled) return undefined;
      const r = running.get(id);
      if (r) {
        r.unsub();
        r.task.abort();
        running.delete(id);
      }
      list = list.filter((x) => x.id !== id);
      check();
      return a;
    },
    cancel() {
      if (cancelled) return [];
      cancelled = true;
      for (const r of running.values()) {
        r.unsub();
        r.task.abort();
      }
      running.clear();
      return list.map((a) => ({ ...a }));
    },
  };
}
