/**
 * modules-a registry: node `type` → component (same contract as registryB: `{ node: Partial<T> }`,
 * `streaming` / `onAction` from `useHui()`). Tabs/Accordion render nested nodes through
 * `ChildRendererContext`, which HuiView provides.
 */
import type { ComponentType } from 'react';
import { Accordion } from './Accordion';
import { Checklist } from './Checklist';
import { Choice } from './Choice';
import { Confirm } from './Confirm';
import { Flashcards } from './Flashcards';
import { Quiz } from './Quiz';
import { Slots } from './Slots';
import { Sources } from './Sources';
import { Tabs } from './Tabs';
import { Timer } from './Timer';

export type ModuleComponentA = ComponentType<{ node: never }>;

export const registryA: Record<'choice' | 'checklist' | 'tabs' | 'accordion' | 'quiz' | 'flashcards' | 'sources' | 'timer' | 'slots' | 'confirm', ModuleComponentA> = {
  choice: Choice,
  checklist: Checklist,
  tabs: Tabs,
  accordion: Accordion,
  quiz: Quiz,
  flashcards: Flashcards,
  sources: Sources,
  timer: Timer,
  slots: Slots,
  confirm: Confirm,
};

export default registryA;
