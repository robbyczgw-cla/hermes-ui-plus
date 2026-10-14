/** Bound a complete operation even when the transport ignores abort (including body reads). */
export async function withDeadline<T>(ms: number, request: (signal: AbortSignal) => Promise<T>, parent?: AbortSignal): Promise<T> {
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const deadline = new Promise<never>((_, reject) => {
    const stop = (name: string) => {
      const error = Object.assign(new Error(name === 'TimeoutError' ? 'timeout' : 'aborted'), { name });
      // Settle independently of native cancellation. Promise.race observes late rejections too.
      reject(error);
      ctrl.abort();
    };
    onAbort = () => stop('AbortError');
    if (parent?.aborted) { onAbort(); return; }
    parent?.addEventListener('abort', onAbort);
    timer = setTimeout(() => stop('TimeoutError'), ms);
  });
  try {
    return await Promise.race([deadline, ctrl.signal.aborted ? deadline : request(ctrl.signal)]);
  } finally {
    clearTimeout(timer);
    if (onAbort) parent?.removeEventListener('abort', onAbort);
  }
}
