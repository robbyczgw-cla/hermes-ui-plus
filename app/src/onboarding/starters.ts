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

/** Demo starters: the translated prompts hit the keywords of the scripted mock scenarios (demo/scenarios.ts). */
export const DEMO_STARTERS: readonly StarterPrompt[] = [
  { id: 'chart', titleKey: 'onboarding.demoStarters.chart.title', subtitleKey: 'onboarding.demoStarters.chart.subtitle', promptKey: 'onboarding.demoStarters.chart.prompt' },
  { id: 'compare', titleKey: 'onboarding.demoStarters.compare.title', subtitleKey: 'onboarding.demoStarters.compare.subtitle', promptKey: 'onboarding.demoStarters.compare.prompt' },
  { id: 'loan', titleKey: 'onboarding.demoStarters.loan.title', subtitleKey: 'onboarding.demoStarters.loan.subtitle', promptKey: 'onboarding.demoStarters.loan.prompt' },
  { id: 'mixed', titleKey: 'onboarding.demoStarters.mixed.title', subtitleKey: 'onboarding.demoStarters.mixed.subtitle', promptKey: 'onboarding.demoStarters.mixed.prompt' },
];
