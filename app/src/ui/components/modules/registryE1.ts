// Native answer modules — group E1 (`paths`: ways / variants with a verdict; `blocks`: architecture / building blocks).
import type { ComponentType } from 'react';
import { Paths } from './e1/Paths';
import { Blocks } from './e1/Blocks';

export const registryE1: Record<string, ComponentType<{ node: never }>> = {
  paths: Paths as ComponentType<{ node: never }>,
  blocks: Blocks as ComponentType<{ node: never }>,
};
