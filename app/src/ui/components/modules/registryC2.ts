// Interactive modules v3 — group C2 (docs/SPEC-modules-v3.md). Owned by its module agent.
// `agenda` (day timeline, editable, calendar actions, reply) and `weather` (current/hourly/daily).
import type { ComponentType } from 'react';
import { Agenda } from './c2/Agenda';
import { Weather } from './c2/Weather';

export const registryC2: Record<string, ComponentType<{ node: never }>> = { agenda: Agenda, weather: Weather };
