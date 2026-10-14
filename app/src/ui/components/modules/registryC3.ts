// Interactive modules v3 — group C3 (docs/SPEC-modules-v3.md). Owned by its module agent.
import type { ComponentType } from 'react';
import { Decision } from './c3/Decision';
import { Rank } from './c3/Rank';
import { Scale } from './c3/Scale';

export const registryC3: Record<string, ComponentType<{ node: never }>> = {
  decision: Decision,
  rank: Rank,
  scale: Scale,
};
