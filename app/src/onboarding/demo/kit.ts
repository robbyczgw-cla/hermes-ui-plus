// Shared building blocks of the offline demo scenarios (types, language helper, hui fence builder).
// Pure; no UI imports. Scenario files import from here, not from each other.
import type { Flavor } from '../../flavor.ts';

export type DemoTool = { name: string; label: string; emoji: string; ms: number };
export type DemoApproval = {
  command: string;
  description: string;
  pattern_key: string;
  pattern_keys: string[];
  /** steps replayed after "Allow once / session / always" (default: a short generic confirmation) */
  allow?: DemoStep[];
  /** steps replayed after "Deny" (default: a short generic note) */
  deny?: DemoStep[];
};
export type DemoStep =
  | { text: string }
  | { reasoning: string }
  | { tool: DemoTool }
  | { status: { kind: string; text: string } }
  | { wait: number }
  | { approval: DemoApproval }
  | { fail: 'error' | 'drop' };

/** `lang`: UI language of the chat (all demo answers and the demo chrome follow it). */
export type DemoLang = 'de' | 'en' | 'es';
export type DemoContext = {
  userText: string;
  turn: number;
  sessionId: string;
  now: Date;
  lang?: DemoLang;
  flavor?: Flavor;
  /** scenario of the last answer that is not itself a reformat (what a `[reformat:…]` chip refers to) */
  previousScenario?: string;
};

/** pick the text for the demo language (German when unknown) */
export const L = (ctx: Pick<DemoContext, 'lang'>, de: string, en: string, es: string): string => (ctx.lang === 'en' ? en : ctx.lang === 'es' ? es : de);
export const langOf = (ctx: Pick<DemoContext, 'lang'>): DemoLang => ctx.lang ?? 'de';

/** `format` = RouteFormat emitted as `hermes.ui.route` (as the UI bridge would). */
export type DemoScenario = { format: string; steps: (ctx: DemoContext) => DemoStep[] };

export const hui = (node: unknown) => '```hui\n' + JSON.stringify(node, null, 2) + '\n```\n';
export const suggestions = (...items: string[]) => hui({ type: 'suggestions', items });
export const xy = (pairs: [string, number][]) => pairs.map(([x, y]) => ({ x, y }));

export const DAYS: Record<DemoLang, string[]> = {
  de: ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'],
  en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  es: ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'],
};
/** weekday labels of the demo language paired with values */
export const days = (ctx: Pick<DemoContext, 'lang'>, ys: number[]): [string, number][] => ys.map((y, i) => [DAYS[langOf(ctx)][i], y]);

/** `YYYY-MM-DD` of `now` plus `plus` days (local time) */
export function isoDay(now: Date, plus = 0): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + plus);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** A tool step with the usual terminal/search/file icons. */
export const tool = {
  terminal: (label: string, ms = 700): DemoStep => ({ tool: { name: 'terminal', label, emoji: '\u{1F4BB}', ms } }),
  search: (label: string, ms = 900): DemoStep => ({ tool: { name: 'web_search', label, emoji: '\u{1F50D}', ms } }),
  file: (label: string, ms = 600): DemoStep => ({ tool: { name: 'read_file', label, emoji: '\u{1F4C4}', ms } }),
  browser: (label: string, ms = 1000): DemoStep => ({ tool: { name: 'browser', label, emoji: '\u{1F310}', ms } }),
};
