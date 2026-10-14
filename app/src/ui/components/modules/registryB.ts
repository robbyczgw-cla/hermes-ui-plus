/**
 * modules-b registry: node `type` → component. HuiView (modules-a) merges this into its
 * renderer switch: `const C = registryB[node.type]; if (C) return <C node={node as never} />`.
 * Every component takes `{ node: Partial<T> }` (node may be partial while streaming) and reads
 * `streaming` / `onAction` from `useHui()`.
 */
import type { ComponentType } from 'react';
import { Calc } from './Calc';
import { MapNode } from './MapNode';
import { Recipe } from './Recipe';

export type ModuleComponent = ComponentType<{ node: never }>;

export const registryB: Record<'calc' | 'recipe' | 'map', ModuleComponent> = { calc: Calc, recipe: Recipe, map: MapNode };

export default registryB;
