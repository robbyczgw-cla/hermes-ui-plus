// Starter prompt ids for the "Fertig" screen. Texts live in the i18n dictionary (onboarding.starters.* /
// onboarding.demoStarters.*). The demo prompts are translated; every language must hit its scenario keywords of
// demo/scenarios.ts (pickScenario, demo.test.ts checks all three). Pure module (tested).
import type { TKey } from '../i18n/core.ts';

export type StarterPrompt = { readonly id: string; readonly titleKey: TKey; readonly subtitleKey: TKey; readonly promptKey?: TKey; readonly prompt?: string };

export const STARTERS: readonly StarterPrompt[] = [
  { id: 'chart', titleKey: 'onboarding.starters.chart.title', subtitleKey: 'onboarding.starters.chart.subtitle', promptKey: 'onboarding.starters.chart.prompt' },
  { id: 'compare', titleKey: 'onboarding.starters.compare.title', subtitleKey: 'onboarding.starters.compare.subtitle', promptKey: 'onboarding.starters.compare.prompt' },
  { id: 'calculator', titleKey: 'onboarding.starters.calculator.title', subtitleKey: 'onboarding.starters.calculator.subtitle', promptKey: 'onboarding.starters.calculator.prompt' },
  { id: 'capabilities', titleKey: 'onboarding.starters.capabilities.title', subtitleKey: 'onboarding.starters.capabilities.subtitle', promptKey: 'onboarding.starters.capabilities.prompt' },
];

/**
 * Demo starters: the "Answers you can act on" tour. Each translated prompt is a sample request of demo/prompts.ts (a test
 * keeps the i18n texts identical to it) and reaches its scripted scenario in every language; the first, "Chart", is the
 * entry of the review notes (store/review/app-review-notes.md).
 */
export const DEMO_STARTERS: readonly StarterPrompt[] = [
  { id: 'chart', titleKey: 'onboarding.demoStarters.chart.title', subtitleKey: 'onboarding.demoStarters.chart.subtitle', promptKey: 'onboarding.demoStarters.chart.prompt' },
  { id: 'approval', titleKey: 'onboarding.demoStarters.approval.title', subtitleKey: 'onboarding.demoStarters.approval.subtitle', promptKey: 'onboarding.demoStarters.approval.prompt' },
  { id: 'checklist', titleKey: 'onboarding.demoStarters.checklist.title', subtitleKey: 'onboarding.demoStarters.checklist.subtitle', promptKey: 'onboarding.demoStarters.checklist.prompt' },
  { id: 'products', titleKey: 'onboarding.demoStarters.products.title', subtitleKey: 'onboarding.demoStarters.products.subtitle', promptKey: 'onboarding.demoStarters.products.prompt' },
  { id: 'recipe', titleKey: 'onboarding.demoStarters.recipe.title', subtitleKey: 'onboarding.demoStarters.recipe.subtitle', promptKey: 'onboarding.demoStarters.recipe.prompt' },
  { id: 'explain', titleKey: 'onboarding.demoStarters.explain.title', subtitleKey: 'onboarding.demoStarters.explain.subtitle', promptKey: 'onboarding.demoStarters.explain.prompt' },
];
