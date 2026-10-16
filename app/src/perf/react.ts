// React side of the perf probe (probe.ts): no-ops unless EXPO_PUBLIC_HUI_PERF is set at bundle time.
import { Profiler, createElement, useLayoutEffect, type ReactNode } from 'react';
import { PERF, PERF_LEVEL, perfCommit, perfNow, perfOnRender, perfOpen } from './probe';

/**
 * `node` inside a `<Profiler id>` in level-2 perf builds (React's profiling renderer reports its render time), else
 * `node` itself: no extra element or fiber in normal builds.
 */
export function perfWrap(id: string, node: ReactNode, key?: string | number): ReactNode {
  return PERF_LEVEL < 2 ? node : createElement(Profiler, { id, key, onRender: perfOnRender }, node);
}

/** the newest answer rendered `textLen` chars: measured from this render to its layout effect (after the commit) */
export const usePerfCommit: (isLast: boolean, textLen: number, streaming: boolean) => void = PERF
  ? (isLast, textLen, streaming) => {
      const t0 = perfNow();
      useLayoutEffect(() => {
        if (isLast) perfCommit(textLen, streaming, t0);
      });
    }
  : () => {};

/** a message list committed `count` messages of `key` (chat open / history load) */
export const usePerfOpen: (key: string, count: number) => void = PERF
  ? (key, count) => {
      const t0 = perfNow();
      useLayoutEffect(() => {
        perfOpen(key, count, t0);
      }, [key, count]); // eslint-disable-line react-hooks/exhaustive-deps
    }
  : () => {};
