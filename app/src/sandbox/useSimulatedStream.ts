import { useCallback, useEffect, useRef, useState } from 'react';
import { chunkString, type ChunkOptions } from './sandboxSamples';

/**
 * Demo helper: replays `text` chunk by chunk like a streaming model.
 * `const { html, complete, restart } = useSimulatedStream(sample.html, { intervalMs: 40 })`
 */
export function useSimulatedStream(text: string, opts: ChunkOptions & { intervalMs?: number; autoStart?: boolean } = {}) {
  const { intervalMs = 40, autoStart = true, min, max, seed } = opts;
  const [state, setState] = useState({ html: '', complete: false });
  const [run, setRun] = useState(autoStart ? 1 : 0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!run) return;
    const chunks = chunkString(text, { min, max, seed });
    let i = 0;
    let acc = '';
    setState({ html: '', complete: false });
    timer.current = setInterval(() => {
      if (i >= chunks.length) {
        if (timer.current) clearInterval(timer.current);
        setState({ html: acc, complete: true });
        return;
      }
      acc += chunks[i++];
      setState({ html: acc, complete: false });
    }, intervalMs);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [text, run, intervalMs, min, max, seed]);

  const restart = useCallback(() => setRun((r) => r + 1), []);
  return { ...state, restart };
}
