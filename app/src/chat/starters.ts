// Start screen content (pure, node-tested): time-of-day greeting + the starter tiles. Each starter is picked
// to produce one kind of interactive answer (checklist, agenda + map, decision, chart, recipe with timers,
// steps), and its tile shows a stroke icon of that card type. Prompts are sent as the user's message, so
// they are translated like the rest of the UI; every language hits the demo scenarios (pickScenario). On a real
// Hermes the tile is the first message of a chat, so each prompt is self-contained (dish and people, places, what to
// weigh): the first answer can be a card instead of a question back (starters.test.ts pins this).
import type { TFn } from '../i18n/core.ts';

export const STARTER_KINDS = ['checklist', 'agenda', 'compare', 'chart', 'recipe', 'explain'] as const;
export type StarterKind = (typeof STARTER_KINDS)[number];

/** Icon (chat/icons.tsx) per starter: a hint of the card the answer will contain. */
export const STARTER_ICONS = {
  checklist: 'checklist',
  agenda: 'calendar',
  compare: 'scale',
  chart: 'barChart',
  recipe: 'timer',
  explain: 'bulb',
} as const satisfies Record<StarterKind, string>;

export type Starter = { key: StarterKind; title: string; subtitle: string; prompt: string };

export function chatStarters(t: TFn): Starter[] {
  return STARTER_KINDS.map((key) => ({
    key,
    title: t(`chat.empty.starter.${key}.title`),
    subtitle: t(`chat.empty.starter.${key}.subtitle`),
    prompt: t(`chat.empty.starter.${key}.prompt`),
  }));
}

export type DayPart = 'morning' | 'day' | 'evening' | 'night';

/** 5–11 morning · 11–18 day · 18–23 evening · 23–5 night (local hours). */
export function dayPart(hour: number): DayPart {
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  if (h >= 5 && h < 11) return 'morning';
  if (h >= 11 && h < 18) return 'day';
  if (h >= 18 && h < 23) return 'evening';
  return 'night';
}

/** "Guten Abend." / "Guten Abend, Alice." (name optional; there is no user-name field yet). */
export function greeting(t: TFn, hour: number, name?: string): string {
  const part = dayPart(hour);
  const n = name?.trim();
  return n ? t(`chat.empty.greeting.${part}Name`, { name: n }) : t(`chat.empty.greeting.${part}`);
}

/** Monogram / avatar initial of the assistant name (first letter/digit, upper-cased; '?' if none). */
export function avatarInitial(name: string): string {
  const ch = Array.from(name.trim()).find((c) => /[\p{L}\p{N}]/u.test(c));
  return ch ? ch.toLocaleUpperCase() : '?';
}
