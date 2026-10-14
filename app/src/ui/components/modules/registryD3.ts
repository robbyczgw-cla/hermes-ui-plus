// Interactive modules v4 — group D3 (studyplan, vocab, mindmap; docs/SPEC-modules-v4.md). Owned by modules-d3.
import type { ComponentType } from 'react';
import { Mindmap } from './d3/Mindmap';
import { StudyPlan } from './d3/StudyPlan';
import { Vocab } from './d3/Vocab';

export const registryD3: Record<string, ComponentType<{ node: never }>> = {
  studyplan: StudyPlan as ComponentType<{ node: never }>,
  vocab: Vocab as ComponentType<{ node: never }>,
  mindmap: Mindmap as ComponentType<{ node: never }>,
};
