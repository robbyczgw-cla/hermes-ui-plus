// Interactive modules v3 — group C1 (docs/SPEC-modules-v3.md). Owned by modules-c1.
// translation (bilingual cards, not interactive) · poll (pass-the-phone voting → `[poll:<id>] …`).
import type { ComponentType } from 'react';
import { Poll } from './c1/Poll';
import { Translation } from './c1/Translation';

export const registryC1: Record<string, ComponentType<{ node: never }>> = {
  translation: Translation as ComponentType<{ node: never }>,
  poll: Poll as ComponentType<{ node: never }>,
};
