// Answer polish v4 (summary; docs/SPEC-modules-v4.md part A). Owned by polish-answers.
import type { ComponentType } from 'react';
import { Summary } from './Summary';

export const registryPolish: Record<string, ComponentType<{ node: never }>> = {
  summary: Summary,
};
