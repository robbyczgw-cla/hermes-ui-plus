// Native answer modules — group E2 (coding views: `diff`, `terminal`, `changes`).
import type { ComponentType } from 'react';
import { Diff } from './e2/Diff';
import { Terminal } from './e2/Terminal';
import { Changes } from './e2/Changes';

export const registryE2: Record<string, ComponentType<{ node: never }>> = {
  diff: Diff as ComponentType<{ node: never }>,
  terminal: Terminal as ComponentType<{ node: never }>,
  changes: Changes as ComponentType<{ node: never }>,
};
