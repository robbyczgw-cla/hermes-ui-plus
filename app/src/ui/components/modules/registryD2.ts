// Interactive modules v4 — group D2 (guide, workout, timer v2; docs/SPEC-modules-v4.md). Owned by modules-d2.
import type { ComponentType } from 'react';
import { Guide } from './d2/Guide';
import { Timer } from './d2/TimerV2';
import { Workout } from './d2/Workout';

export const registryD2: Record<string, ComponentType<{ node: never }>> = {
  timer: Timer,
  guide: Guide,
  workout: Workout,
};
