// Interactive modules v4 — group D1 (places, products; docs/SPEC-modules-v4.md). Owned by modules-d1.
import type { ComponentType } from 'react';
import { Places } from './d1/Places';
import { Products } from './d1/Products';

export const registryD1: Record<string, ComponentType<{ node: never }>> = {
  places: Places,
  products: Products,
};
