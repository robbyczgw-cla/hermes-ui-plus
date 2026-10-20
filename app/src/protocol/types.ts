/**
 * Hermes UI presentation protocol (v0) – TS source of truth.
 * Mirrors docs/SPEC.md. Only erasable TS syntax (no enums/namespaces) so that
 * Node's type stripping can run the tests.
 */

/**
 * Actions. `send`/`submit`/`open_url`/`copy` are the v0 set; the rest (v2) are device actions that
 * the app ALWAYS shows in a confirmation sheet before executing (see docs/SPEC-modules-v2.md).
 * normalizeAction() validates every variant (URL schemes, ISO dates, phone/e-mail format).
 */
export type HuiMapsMode = 'driving' | 'walking' | 'transit';

export interface HuiCalendarAction {
  type: 'calendar';
  title: string;
  /** ISO 8601 local time ("2026-10-10T14:30[:00][Z|+02:00]") or date ("2026-10-10") */
  start: string;
  end?: string;
  allDay?: boolean;
  location?: string;
  notes?: string;
}
export interface HuiReminderAction {
  type: 'reminder';
  title: string;
  /** ISO 8601 */
  at: string;
}
/** Needs `query` OR both `lat` and `lng`. */
export interface HuiMapsAction {
  type: 'maps';
  query?: string;
  lat?: number;
  lng?: number;
  mode?: HuiMapsMode;
}
export interface HuiCallAction {
  type: 'call';
  /** cleaned: optional leading "+", digits only (3–15 digits) */
  phone: string;
}
export interface HuiEmailAction {
  type: 'email';
  /** one address, or up to 5 comma-separated addresses */
  to: string;
  subject?: string;
  body?: string;
}
export interface HuiSmsAction {
  type: 'sms';
  /** cleaned like HuiCallAction.phone */
  to: string;
  body?: string;
}
export interface HuiTimerAction {
  type: 'timer';
  /** integer 1..86400 */
  seconds: number;
  label: string;
}
export interface HuiAddToListAction {
  type: 'add_to_list';
  /** 1..50 non-empty strings */
  items: string[];
  listTitle?: string;
}
/** Sends `text` plus the current values of the named calc/choice/checklist nodes (≤ 4000 chars). */
export interface HuiAskAction {
  type: 'ask';
  text: string;
  /** node ids (≤ 8) */
  include?: string[];
}

export type HuiAction =
  | { type: 'send'; text: string }
  | { type: 'submit' }
  | { type: 'open_url'; url: string }
  | { type: 'copy'; text: string }
  | HuiCalendarAction
  | HuiReminderAction
  | HuiMapsAction
  | HuiCallAction
  | HuiEmailAction
  | HuiSmsAction
  | HuiTimerAction
  | HuiAddToListAction
  | HuiAskAction;

export type HuiActionType = HuiAction['type'];

export const HUI_ACTION_TYPES: readonly HuiActionType[] = [
  'send', 'submit', 'open_url', 'copy',
  'calendar', 'reminder', 'maps', 'call', 'email', 'sms', 'timer', 'add_to_list', 'ask',
];

/** Device actions that must go through the confirmation sheet. */
export const CONFIRMED_ACTION_TYPES: readonly HuiActionType[] = [
  'calendar', 'reminder', 'maps', 'call', 'email', 'sms', 'timer', 'add_to_list',
];

export type HuiFieldKind = 'text' | 'number' | 'slider' | 'select' | 'toggle' | 'date';

export interface HuiField {
  name: string;
  label: string;
  kind: HuiFieldKind;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: string[];
  default?: string | number | boolean;
}

export type HuiGap = 's' | 'm' | 'l';
export type HuiTrend = 'up' | 'down' | 'flat';
export type HuiTone = 'info' | 'success' | 'warning' | 'danger';
export type HuiChartKind =
  | 'bar' | 'line' | 'area' | 'pie' | 'donut'
  // v3 (docs/SPEC-modules-v3.md)
  | 'hbar' | 'stacked' | 'scatter' | 'radar' | 'gauge' | 'heatmap' | 'waterfall';
export type HuiTextVariant = 'title' | 'body' | 'caption' | 'mono';

interface HuiBase {
  id?: string;
}

/**
 * Provenance of the data in a node, rendered as a small chip ("Beispielwerte", "Schätzung",
 * "Quelle: …"). `illustrative` data must also be labelled inside the node.
 */
export type HuiBasis = 'user' | 'sourced' | 'calculated' | 'estimate' | 'illustrative';
export const HUI_BASES: readonly HuiBasis[] = ['user', 'sourced', 'calculated', 'estimate', 'illustrative'];

export interface HuiProvenance {
  basis?: HuiBasis;
  source?: string;
}

export interface HuiCard extends HuiBase {
  type: 'card';
  title?: string;
  subtitle?: string;
  /** Thumbnail next to the title, resolved in the app (see HuiImage.query). */
  imageQuery?: string;
  children: HuiNode[];
}

export interface HuiStack extends HuiBase {
  type: 'stack';
  direction?: 'vertical' | 'horizontal';
  gap?: HuiGap;
  children: HuiNode[];
}

export interface HuiText extends HuiBase {
  type: 'text';
  /** inline markdown */
  text: string;
  variant?: HuiTextVariant;
}

export interface HuiCallout extends HuiBase {
  type: 'callout';
  tone: HuiTone;
  title?: string;
  text: string;
  /** live-card patch (app/src/live): the changes to the live card `card`; old apps show the callout itself */
  livePatch?: HuiLivePatch;
}
/** ops in the live-card vocabulary (live/model.ts `LiveOp`), validated by live/codec.ts */
export interface HuiLivePatch {
  card: string;
  ops: Record<string, unknown>[];
}

export interface HuiStatItem {
  label: string;
  value: string;
  delta?: string;
  trend?: HuiTrend;
  /** v3: tiny trend line, 2..60 finite numbers (fewer than 2 values are dropped) */
  sparkline?: number[];
}

export interface HuiStats extends HuiBase, HuiProvenance {
  type: 'stats';
  items: HuiStatItem[];
}

export type HuiCell = string | number | null;

export interface HuiTable extends HuiBase, HuiProvenance {
  type: 'table';
  /** max 12 */
  columns: string[];
  /** max 200 */
  rows: HuiCell[][];
  caption?: string;
}

/**
 * One data point. Shapes per chart kind (v3):
 * - bar/hbar/stacked/line/area/pie/donut/waterfall: `x` = category or number, `y` = value
 * - scatter: `x` number (non-numeric x points are dropped), `y` number, optional `label`
 * - radar: one series per entity, `x` = axis name (category), `y` = value (0..chart.max)
 * - gauge: ONE point, `series[0].data[0].y` is the value (see HuiChart.min/max/target)
 * - heatmap calendar: `x` = ISO date "YYYY-MM-DD", `y` = value
 * - heatmap matrix: `x` = column category, `y2` = row category (string), `y` = value
 * - waterfall: `y` = delta; `total: true` marks a subtotal/total bar (y = absolute value, or ignored by renderer to use running sum)
 */
export interface HuiChartPoint {
  x: string | number;
  y: number;
  /** heatmap matrix row category */
  y2?: string;
  /** scatter point label */
  label?: string;
  /** waterfall total/subtotal bar */
  total?: boolean;
}

export interface HuiChartSeries {
  name: string;
  data: HuiChartPoint[];
}

export interface HuiChart extends HuiBase, HuiProvenance {
  type: 'chart';
  kind: HuiChartKind;
  title?: string;
  unit?: string;
  xLabel?: string;
  yLabel?: string;
  series: HuiChartSeries[];
  /**
   * v3 numeric scale. radar: `max` = outer ring (default: renderer derives from data); gauge: range
   * (min default 0, max default 100), `target` = target tick. A top-level `value` on a gauge is accepted by
   * normalizeNode and moved into `series[0].data[0].y` (the ONE canonical gauge shape).
   */
  min?: number;
  max?: number;
  target?: number;
}

export interface HuiListItem {
  title: string;
  subtitle?: string;
  trailing?: string;
  icon?: string;
  /** Thumbnail (56–64 px) resolved in the app from this query (Wikipedia article title). */
  imageQuery?: string;
}

export interface HuiList extends HuiBase {
  type: 'list';
  style?: 'bullet' | 'number' | 'check';
  items: HuiListItem[];
}

export interface HuiStepItem {
  title: string;
  detail?: string;
  imageQuery?: string;
}

export interface HuiSteps extends HuiBase {
  type: 'steps';
  items: HuiStepItem[];
  current?: number;
}

export interface HuiTimelineItem {
  time: string;
  title: string;
  detail?: string;
  imageQuery?: string;
}

export interface HuiTimeline extends HuiBase {
  type: 'timeline';
  items: HuiTimelineItem[];
}

export interface HuiCompareColumn {
  title: string;
  badge?: string;
  highlight?: boolean;
  /** neutral facts/specs (dot marker; clear downsides in the text still get a minus) */
  items: string[];
  /** upsides (check marker), like `products` pros */
  pros?: string[];
  /** downsides (minus marker), like `products` cons */
  cons?: string[];
  /** Product/option photo on top of the column, resolved in the app. */
  imageQuery?: string;
}

export interface HuiCompare extends HuiBase, HuiProvenance {
  type: 'compare';
  columns: HuiCompareColumn[];
}

/**
 * Either `query` (preferred: the app resolves a real photo via Wikipedia/Wikimedia Commons, the
 * model never writes image URLs) or `url` (only a URL that came from a tool/source). If both are
 * set, `url` wins.
 */
export interface HuiImage extends HuiBase {
  type: 'image';
  url?: string;
  /** Search query, ideally the Wikipedia article title in the user's language ("Kolosseum"). */
  query?: string;
  /** Wikipedia language for `query` (default 'de'; falls back to en + Commons). */
  lang?: string;
  /** 'web' = prefer web image search via the UI bridge (products, games, current events); default Wikimedia first, web as fallback */
  source?: 'web';
  alt?: string;
  caption?: string;
  aspect?: number;
}

export interface HuiGalleryItem {
  query?: string;
  url?: string;
  caption?: string;
  /** see HuiImage.source */
  source?: 'web';
}

/** Horizontal photo carousel, 2–6 items (each needs `query` or `url`). */
export interface HuiGallery extends HuiBase {
  type: 'gallery';
  items: HuiGalleryItem[];
  /** width / height of every slide (default 4/3) */
  aspect?: number;
  lang?: string;
  /** see HuiImage.source (applies to all items without their own `source`) */
  source?: 'web';
}

export interface HuiProgress extends HuiBase {
  type: 'progress';
  label: string;
  value: number;
  max?: number;
}

export interface HuiCode extends HuiBase {
  type: 'code';
  language?: string;
  code: string;
}

export interface HuiButtonItem {
  label: string;
  action: HuiAction;
  style?: 'primary' | 'secondary';
}

export interface HuiButtons extends HuiBase {
  type: 'buttons';
  items: HuiButtonItem[];
}

export interface HuiSuggestions extends HuiBase {
  type: 'suggestions';
  items: string[];
}

export interface HuiForm extends HuiBase {
  type: 'form';
  id: string;
  title?: string;
  fields: HuiField[];
  submit: { label: string };
}

// ───────────────────────── v2 interactive modules (docs/SPEC-modules-v2.md) ─────────────────────────
// Interactive nodes ALWAYS have a string `id` after normalizeNode() (explicit, or the deterministic
// fallback described in validate.ts / docs/SPEC.md). Everything below is produced by normalizeNode,
// so renderers can rely on the caps/defaults documented here.

// choice ──
export interface HuiChoiceOption {
  /** explicit id, or fallback `o<index>` (index in the model's original options array) */
  id?: string;
  label: string;
  description?: string;
  /** emoji, ≤ 16 chars */
  icon?: string;
  imageQuery?: string;
}
export type HuiChoiceLayout = 'list' | 'grid' | 'chips';
export interface HuiChoice extends HuiBase {
  type: 'choice';
  id: string;
  question?: string;
  /** max 12 */
  options: HuiChoiceOption[];
  multiple?: boolean;
  min?: number;
  max?: number;
  allowOther?: boolean;
  layout?: HuiChoiceLayout;
  submitLabel?: string;
}

// checklist ──
export type HuiChecklistKind = 'shopping' | 'todo' | 'packing' | 'generic';
export interface HuiChecklistItem {
  /** explicit id, or fallback `i<index>` */
  id?: string;
  text: string;
  qty?: number | string;
  unit?: string;
  category?: string;
  checked?: boolean;
  note?: string;
}
export interface HuiChecklist extends HuiBase {
  type: 'checklist';
  id: string;
  title?: string;
  kind?: HuiChecklistKind;
  groupBy?: 'category' | 'none';
  /** default true (renderer) */
  editable?: boolean;
  /** max 200 */
  items: HuiChecklistItem[];
  /** live card (app/src/live): Hermes keeps this list up to date under the same `id`; item ids are stable */
  live?: boolean;
  /** live card finished (read-only, leaves the tray); a later version without it reopens the card */
  closed?: boolean;
}

// calc ──
export type HuiCalcInputKind = 'slider' | 'number' | 'select' | 'toggle';
export interface HuiCalcSelectOption {
  label: string;
  value: string | number;
}
export interface HuiCalcInput {
  /** identifier [A-Za-z_][A-Za-z0-9_]* , unique among inputs; usable in expressions */
  name: string;
  label: string;
  kind: HuiCalcInputKind;
  min?: number;
  max?: number;
  /** > 0 */
  step?: number;
  /** number for slider/number (clamped into [min,max]), boolean for toggle, option value for select */
  default: number | boolean | string;
  unit?: string;
  /** select only, max 30 */
  options?: HuiCalcSelectOption[];
}
export type HuiCalcFormat = 'number' | 'currency' | 'percent' | 'duration' | 'integer';
export interface HuiCalcOutput {
  /** identifier; later outputs may reference earlier named outputs */
  name?: string;
  label: string;
  /** safe-expression source, ≤ 500 chars (longer expressions drop the output) */
  expr: string;
  format?: HuiCalcFormat;
  /** integer 0..10 */
  decimals?: number;
  unit?: string;
  emphasis?: boolean;
}
export interface HuiCalcChart {
  kind: 'line' | 'bar';
  sweep: { input: string; from: number; to: number; /** integer 2..200 */ steps: number };
  /** expression ≤ 500 chars */
  y: string;
  label?: string;
}
export interface HuiCalc extends HuiBase, HuiProvenance {
  type: 'calc';
  id: string;
  title?: string;
  /** max 12 */
  inputs: HuiCalcInput[];
  /** max 12 */
  outputs: HuiCalcOutput[];
  chart?: HuiCalcChart;
  note?: string;
}

// map ──
export interface HuiMapMarker {
  /** -90..90 */
  lat: number;
  /** -180..180 */
  lng: number;
  title: string;
  description?: string;
  /** integer 1..999 */
  number?: number;
  imageQuery?: string;
}
export interface HuiMap extends HuiBase, HuiProvenance {
  type: 'map';
  title?: string;
  /** max 30 */
  markers: HuiMapMarker[];
  route?: boolean;
  animate?: boolean;
  center?: { lat: number; lng: number };
  /** integer 1..19 */
  zoom?: number;
}

// recipe ──
export interface HuiRecipeIngredient {
  /** numeric (scalable). Unparseable text quantities ("eine Prise") are moved to `unit`. */
  qty?: number;
  unit?: string;
  item: string;
  /** plural of a unit-less item ("onions") for scaled amounts */
  plural?: string;
  group?: string;
}
export interface HuiRecipeStep {
  text: string;
  /** integer 1..86400 */
  timerSeconds?: number;
}
export interface HuiRecipe extends HuiBase {
  type: 'recipe';
  id: string;
  title: string;
  imageQuery?: string;
  /** 0 < servings ≤ 100; default 4 when missing */
  servings: number;
  /** minutes */
  time?: { prep?: number; cook?: number; total?: number };
  /** max 60 */
  ingredients: HuiRecipeIngredient[];
  /** max 40 */
  steps: HuiRecipeStep[];
  /** max 10 */
  tips?: string[];
}

// tabs / accordion ──
export interface HuiTab {
  /** live trip only: the day's stable id */
  id?: string;
  label: string;
  /** a day tab of an agenda split by days (validate.ts agendaByDays) without a day name: shown as "Tag 2" / "Day 2" */
  day?: number;
  children: HuiNode[];
}
export interface HuiTabs extends HuiBase {
  type: 'tabs';
  /** max 6 */
  tabs: HuiTab[];
  /** live trip card (app/src/live): day tabs of `agenda` nodes (+ an optional `map` tab), kept up to date under `id` */
  live?: boolean;
  /** live trip only: the card's title */
  title?: string;
  closed?: boolean;
}
export interface HuiAccordionItem {
  title: string;
  children: HuiNode[];
}
export interface HuiAccordion extends HuiBase {
  type: 'accordion';
  /** max 20 */
  items: HuiAccordionItem[];
  /** initially open item (non-negative integer; may exceed items.length while streaming) */
  open?: number;
}

// quiz / flashcards ──
export interface HuiQuizQuestion {
  q: string;
  /** 1..10 strings */
  options: string[];
  /** index into options; array (sorted, unique) for multi-answer questions */
  answer: number | number[];
  explanation?: string;
}
export interface HuiQuiz extends HuiBase {
  type: 'quiz';
  id: string;
  title?: string;
  /** max 30. Questions without a valid answer are dropped. */
  questions: HuiQuizQuestion[];
}
export interface HuiFlashcard {
  front: string;
  back: string;
}
export interface HuiFlashcards extends HuiBase {
  type: 'flashcards';
  id: string;
  title?: string;
  /** max 100 */
  cards: HuiFlashcard[];
}

// sources / timer ──
export interface HuiSource {
  title: string;
  /** absolute http(s) URL, no credentials */
  url: string;
  snippet?: string;
  siteName?: string;
}
export interface HuiSources extends HuiBase {
  type: 'sources';
  /** max 12 */
  items: HuiSource[];
}
export interface HuiTimer extends HuiBase, HuiTimerV2Fields {
  type: 'timer';
  id: string;
  label: string;
  /** integer 0..86400; 0 = not (yet) known, e.g. while streaming or for `until`/`stopwatch`/`timers` */
  seconds: number;
  autostart?: boolean;
}

// slots / confirm ──
export interface HuiSlot {
  /** explicit id, or fallback `s<index>` */
  id?: string;
  /** ISO 8601 */
  start: string;
  end?: string;
  label?: string;
  note?: string;
}
export interface HuiSlots extends HuiBase {
  type: 'slots';
  id: string;
  title?: string;
  /** max 20 */
  slots: HuiSlot[];
  /** IANA zone name, e.g. "Europe/Berlin" */
  timezone?: string;
  noneLabel?: string;
}
export interface HuiConfirm extends HuiBase {
  type: 'confirm';
  id: string;
  title: string;
  text?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: HuiTone;
}

// ───────────────────────── v3 modules (docs/SPEC-modules-v3.md) ─────────────────────────

// translation ── (not interactive)
export interface HuiTranslationText {
  /** language code, sanitized: [a-z]{2,3}(-[A-Za-z0-9]{2,8})? ("de", "en", "pt-BR", "zh-Hant"), default 'und' */
  lang: string;
  text: string;
}
export interface HuiTranslationTarget extends HuiTranslationText {
  romanization?: string;
}
export interface HuiTranslation extends HuiBase {
  type: 'translation';
  source: HuiTranslationText;
  /** 1..4 (empty while streaming) */
  targets: HuiTranslationTarget[];
  note?: string;
}

// poll ──
export interface HuiPollOption {
  /** explicit id, or fallback `o<index>` */
  id?: string;
  label: string;
  /** ≤ 16 chars */
  emoji?: string;
}
export interface HuiPoll extends HuiBase {
  type: 'poll';
  id: string;
  question: string;
  /** 2..8 (fewer while streaming) */
  options: HuiPollOption[];
  multiple?: boolean;
  /** pass-the-phone voter names, ≤ 12 unique */
  voters?: string[];
  allowAdd?: boolean;
  anonymous?: boolean;
}

// agenda ──
export type HuiAgendaKind = 'work' | 'meal' | 'travel' | 'free' | 'event' | 'sport' | 'focus';
export const HUI_AGENDA_KINDS: readonly HuiAgendaKind[] = ['work', 'meal', 'travel', 'free', 'event', 'sport', 'focus'];
export interface HuiAgendaBlock {
  /** explicit id, or fallback `b<index>` */
  id?: string;
  /** "HH:MM" (24 h, zero-padded) – ISO date-times are reduced to their time part */
  start: string;
  /** "HH:MM"; always after start (otherwise dropped to start+60 min, capped at 23:59) */
  end: string;
  title: string;
  location?: string;
  kind?: HuiAgendaKind;
  note?: string;
}
export interface HuiAgenda extends HuiBase {
  type: 'agenda';
  id: string;
  /** ISO date YYYY-MM-DD */
  date?: string;
  title?: string;
  /** ≤ 30, sorted by start */
  blocks: HuiAgendaBlock[];
  editable?: boolean;
  /** live trip card of one day (app/src/live) */
  live?: boolean;
  closed?: boolean;
}

// weather ──
export type HuiWeatherCondition =
  | 'clear' | 'sunny' | 'partly' | 'cloudy' | 'overcast' | 'fog' | 'drizzle' | 'rain'
  | 'showers' | 'thunder' | 'snow' | 'sleet' | 'wind' | 'clear-night' | 'partly-night';
export const HUI_WEATHER_CONDITIONS: readonly HuiWeatherCondition[] = [
  'clear', 'sunny', 'partly', 'cloudy', 'overcast', 'fog', 'drizzle', 'rain',
  'showers', 'thunder', 'snow', 'sleet', 'wind', 'clear-night', 'partly-night',
];
export interface HuiWeatherCurrent {
  temp: number;
  condition: HuiWeatherCondition;
  feelsLike?: number;
  /** km/h (or mph for unit 'F'), 0..400 */
  wind?: number;
  /** percent 0..100 */
  humidity?: number;
  /** precipitation probability percent 0..100 */
  precip?: number;
}
export interface HuiWeatherHour {
  /** "HH:MM" or ISO date-time (valid) */
  time: string;
  temp: number;
  condition: HuiWeatherCondition;
  /** percent 0..100 */
  precip?: number;
}
export interface HuiWeatherDay {
  /** ISO date YYYY-MM-DD */
  date: string;
  /** min ≤ max (swapped if reversed) */
  min: number;
  max: number;
  condition: HuiWeatherCondition;
  precip?: number;
}
export interface HuiWeather extends HuiBase, HuiProvenance {
  type: 'weather';
  location: string;
  unit?: 'C' | 'F';
  current?: HuiWeatherCurrent;
  /** ≤ 24 */
  hourly?: HuiWeatherHour[];
  /** ≤ 10 */
  daily?: HuiWeatherDay[];
}

// decision ──
export interface HuiDecisionCriterion {
  /** explicit id, or fallback `c<index>` */
  id?: string;
  label: string;
  /** 0..10 (default 5) */
  weight: number;
}
export interface HuiDecisionOption {
  /** explicit id, or fallback `o<index>` */
  id?: string;
  label: string;
  /**
   * Keyed by the CANONICAL criterion id (the model may key by id or by label – normalizeNode rewrites
   * keys to ids; unknown keys dropped). Values clamped to 0..10; missing = absent.
   */
  scores: Record<string, number>;
  note?: string;
}
export interface HuiDecision extends HuiBase {
  type: 'decision';
  id: string;
  title?: string;
  /** 2..8 (fewer while streaming) */
  criteria: HuiDecisionCriterion[];
  /** 2..6 (fewer while streaming) */
  options: HuiDecisionOption[];
  note?: string;
}

// rank ──
export interface HuiRankItem {
  /** explicit id, or fallback `i<index>` */
  id?: string;
  label: string;
  description?: string;
}
export interface HuiRank extends HuiBase {
  type: 'rank';
  id: string;
  prompt?: string;
  /** 2..10 (fewer while streaming) */
  items: HuiRankItem[];
  submitLabel?: string;
}

// scale ──
export type HuiScaleStyle = 'slider' | 'stars' | 'emoji' | 'segments';
export interface HuiScale extends HuiBase {
  type: 'scale';
  id: string;
  question: string;
  /** default 1 */
  min: number;
  /** default 5; max > min, range ≤ 100 (stars/emoji/segments: ≤ 10 steps) */
  max: number;
  step?: number;
  style?: HuiScaleStyle;
  labels?: { min?: string; max?: string };
  /** ≤ 10 */
  emojis?: string[];
}

// ───────────────────────── v4 modules (docs/SPEC-modules-v4.md) ─────────────────────────
// Stable contract: module agents code against these. Strings are sanitized/capped by validate.ts;
// arrays are capped (excess dropped); invalid items (missing required fields) are dropped, never an error.

// summary ── (A2 TL;DR head, not interactive)
export interface HuiSummary extends HuiBase {
  type: 'summary';
  /** ≤ 600 chars, '' while streaming */
  text: string;
  /** max 4, each ≤ 200 chars */
  points?: string[];
  /** ≤ 200 chars */
  verdict?: string;
}

// places ──
export type HuiPlacePrice = '€' | '€€' | '€€€' | '€€€€';
export const HUI_PLACE_PRICES: readonly HuiPlacePrice[] = ['€', '€€', '€€€', '€€€€'];
export interface HuiPlace {
  /** explicit id (unique), else fallback `p<index>` (index in the model's original array) */
  id: string;
  name: string;
  category?: string;
  address?: string;
  /** lat and lng are only present together; -90..90 / -180..180 */
  lat?: number;
  lng?: number;
  /** 0..5 */
  rating?: number;
  /** integer ≥ 0 */
  reviews?: number;
  price?: HuiPlacePrice;
  openNow?: boolean;
  /** weekday lines ("Mo 9:00–18:00"), max 7 */
  hours?: string[];
  /** e.g. "Heute 9:00–18:00" or "öffnet 9:00" */
  hoursToday?: string;
  /** normalized: digits with optional leading + */
  phone?: string;
  /** absolute http(s) URL */
  website?: string;
  imageQuery?: string;
  /** absolute http(s) URL; goes through the image trust policy (images/trust.ts) */
  image?: string;
  /** e.g. "350 m", "12 min zu Fuß" */
  distance?: string;
  note?: string;
  /** max 8 */
  tags?: string[];
}
export type HuiPlacesLayout = 'carousel' | 'list';
export interface HuiPlaces extends HuiBase, HuiProvenance {
  type: 'places';
  id: string;
  title?: string;
  /** default carousel (renderer decides when undefined) */
  layout?: HuiPlacesLayout;
  /** max 10 */
  places: HuiPlace[];
}

// products ──
export interface HuiProductSpec {
  label: string;
  value: string;
}
export interface HuiProductScore {
  /** ≤ 40 chars */
  label: string;
  /** 0..10 (one decimal) */
  value: number;
}
export interface HuiProductOffer {
  merchant: string;
  /** number (in the product's currency) or a display string; undefined = unknown */
  price?: number | string;
  /** absolute http(s) URL (always opened through the confirmed open_url action) */
  url: string;
}
export interface HuiProduct {
  /** explicit id (unique), else fallback `p<index>` */
  id: string;
  name: string;
  brand?: string;
  imageQuery?: string;
  /** absolute http(s) URL; image trust policy applies */
  image?: string;
  /** ≥ 0 */
  price?: number;
  /** ISO code ("EUR") or symbol ("€"), ≤ 8 chars */
  currency?: string;
  priceNote?: string;
  /** 0..5 */
  rating?: number;
  reviews?: number;
  /** e.g. "Bester Preis", ≤ 40 chars */
  badge?: string;
  /** one-line verdict for ranked lists ("Beste Ergonomie, etwas schwer"), ≤ 160 chars */
  verdict?: string;
  /** per-category scores 0..10 (max 5), e.g. Ergonomie 9 · 2D 8 · 3D 7 */
  scores?: HuiProductScore[];
  /** max 6 */
  specs?: HuiProductSpec[];
  /** max 6 each */
  pros?: string[];
  cons?: string[];
  /** max 4; offers without a valid url are dropped */
  offers?: HuiProductOffer[];
  /** absolute http(s) URL */
  url?: string;
  /** the user's target price (watchlist), ≥ 0, in `currency`; only a price the user named */
  target?: number;
}
export type HuiProductsLayout = 'carousel' | 'grid';
export interface HuiProducts extends HuiBase, HuiProvenance {
  type: 'products';
  id: string;
  title?: string;
  layout?: HuiProductsLayout;
  /** max 10 */
  products: HuiProduct[];
  /** offer "Vergleichen" (multi-select 2–3) */
  compare?: boolean;
  /** ranked top list (order = rank): vertical numbered rows instead of the carousel */
  ranked?: boolean;
  /** live watchlist card (app/src/live): Hermes keeps prices up to date under `id` */
  live?: boolean;
  closed?: boolean;
}

// timer v2 (backward compatible: the v1 fields id/label/seconds/autostart keep their meaning) ──
export type HuiTimerMode = 'countdown' | 'stopwatch';
export interface HuiTimerItem {
  /** explicit id (unique), else fallback `t<index>` */
  id: string;
  /** may be '' */
  label: string;
  /** integer 1..86400 */
  seconds: number;
}
export interface HuiTimerV2Fields {
  /** countdown target, ISO 8601 with time part (or date-only = local midnight); invalid → dropped */
  until?: string;
  mode?: HuiTimerMode;
  /** multi-timer, max 6; items without seconds are dropped */
  timers?: HuiTimerItem[];
}

// guide ──
export interface HuiGuideStep {
  /** explicit id (unique), else fallback `s<index>` */
  id: string;
  /** ≤ 200 chars; derived from the body when the model only sent a body */
  title: string;
  /** markdown, ≤ 2000 chars, may be '' */
  body: string;
  imageQuery?: string;
  tip?: string;
  warning?: string;
  /** inline timer, integer 1..86400 */
  seconds?: number;
}
export interface HuiGuide extends HuiBase {
  type: 'guide';
  id: string;
  title: string;
  intro?: string;
  /** max 20 */
  steps: HuiGuideStep[];
  /** label of the "Ich hänge fest" button */
  stuckLabel?: string;
}

// workout ──
export type HuiWorkoutKind = 'strength' | 'cardio' | 'mobility' | 'mixed';
export const HUI_WORKOUT_KINDS: readonly HuiWorkoutKind[] = ['strength', 'cardio', 'mobility', 'mixed'];
export interface HuiExercise {
  /** explicit id (unique), else fallback `e<index>` */
  id: string;
  name: string;
  /** integer 1..50 */
  sets?: number;
  /** integer 1..1000, or a short string ("8-12", "AMRAP", "bis Muskelversagen"); numeric strings become numbers */
  reps?: number | string;
  /** duration per set (holds, cardio), integer 1..86400 */
  seconds?: number;
  /** free text with unit ("60 kg", "Körpergewicht"), ≤ 30 chars */
  weight?: string;
  /** integer 0..3600 */
  restSeconds?: number;
  note?: string;
  imageQuery?: string;
}
export interface HuiWorkout extends HuiBase {
  type: 'workout';
  id: string;
  title: string;
  kind?: HuiWorkoutKind;
  warmup?: string;
  /** max 20 */
  exercises: HuiExercise[];
  cooldown?: string;
}

// studyplan ──
export type HuiStudyTaskKind = 'learn' | 'practice' | 'review' | 'test';
export const HUI_STUDY_TASK_KINDS: readonly HuiStudyTaskKind[] = ['learn', 'practice', 'review', 'test'];
export interface HuiStudyTask {
  /** explicit id (unique in the plan), else fallback `t<week>-<day>-<task>` (original indexes) */
  id: string;
  text: string;
  /** integer 1..1440 */
  minutes?: number;
  kind?: HuiStudyTaskKind;
}
export interface HuiStudyDay {
  /** `d<week>-<day>` (original indexes) */
  id: string;
  /** "Mo", "Tag 3" … may be '' */
  label: string;
  /** max 20 */
  tasks: HuiStudyTask[];
}
export interface HuiStudyWeek {
  /** `w<week>` (original index) */
  id: string;
  /** "Woche 1: Grundlagen" */
  label: string;
  /** max 14 */
  days: HuiStudyDay[];
}
export interface HuiStudyPlan extends HuiBase {
  type: 'studyplan';
  id: string;
  title: string;
  goal?: string;
  /** max 26 (undefined while streaming) */
  weeks?: HuiStudyWeek[];
}

// vocab ──
export interface HuiVocabItem {
  /** explicit id (unique), else fallback `v<index>` (original index) – key for the Leitner state */
  id: string;
  term: string;
  translation: string;
  example?: string;
  note?: string;
  romanization?: string;
}
export type HuiVocabMode = 'cards' | 'quiz' | 'type';
export interface HuiVocab extends HuiBase {
  type: 'vocab';
  id: string;
  title?: string;
  /** language code of `term` (sanitized like translation.lang, default 'und') */
  from: string;
  /** language code of `translation` */
  to: string;
  /** max 40 */
  items: HuiVocabItem[];
  /** start mode, renderer default: cards */
  mode?: HuiVocabMode;
}

// mindmap ──
export interface HuiMindNode {
  /** explicit id (unique), else path fallback: root `m`, children `m-<i>`, `m-<i>-<j>` … (original indexes) */
  id: string;
  label: string;
  note?: string;
  children?: HuiMindNode[];
}
export interface HuiMindmap extends HuiBase {
  type: 'mindmap';
  id: string;
  title?: string;
  /** root = depth 0; nodes deeper than 4 and beyond 60 nodes in total (pre-order) are dropped */
  root: HuiMindNode;
}

// paths ──
/** Verdict tone of a path badge: neutral (baseline), good (recommended / interesting), warn (caution), bad (avoid). */
export type HuiPathTone = 'neutral' | 'good' | 'warn' | 'bad';
export const HUI_PATH_TONES: readonly HuiPathTone[] = ['neutral', 'good', 'warn', 'bad'];
/** Fixed icon set of path nodes (model synonyms are mapped by normalizeNode; unknown names are dropped). */
export type HuiPathIcon =
  | 'laptop' | 'desktop' | 'phone' | 'server' | 'cloud' | 'disk' | 'folder' | 'file' | 'database'
  | 'network' | 'lock' | 'user' | 'globe' | 'app' | 'container' | 'vm' | 'terminal';
export const HUI_PATH_ICONS: readonly HuiPathIcon[] = [
  'laptop', 'desktop', 'phone', 'server', 'cloud', 'disk', 'folder', 'file', 'database',
  'network', 'lock', 'user', 'globe', 'app', 'container', 'vm', 'terminal',
];
export interface HuiPathBadge {
  text: string;
  /** default 'neutral' */
  tone: HuiPathTone;
}
export interface HuiPathStep {
  /** short label, ≤ 60 chars */
  label: string;
  icon?: HuiPathIcon;
  /** small second line, ≤ 80 chars */
  detail?: string;
}
export interface HuiPathItem {
  /** explicit id (unique), else fallback `p<index>` (original index) */
  id: string;
  title: string;
  badge?: HuiPathBadge;
  /** ≤ 6 nodes (may be empty while streaming) */
  path: HuiPathStep[];
  /** one muted line */
  note?: string;
}
export interface HuiPaths extends HuiBase, HuiProvenance {
  type: 'paths';
  id: string;
  title?: string;
  /** 2..6 (fewer while streaming; ≤ 6 kept) */
  items: HuiPathItem[];
  /** rows are a single choice: tap sends `[paths:<id>] <title>` */
  select?: boolean;
}

// blocks ──
/** Box look: `soft` = filled (grey or tone tint), `framed` = outlined. */
export type HuiBlockStyle = 'soft' | 'framed';
export const HUI_BLOCK_STYLES: readonly HuiBlockStyle[] = ['soft', 'framed'];
export interface HuiBlockItem {
  /** short label, ≤ 60 chars */
  label: string;
  /** muted second line under a hairline ("Kernel 1"), ≤ 80 chars */
  sub?: string;
  /** icon of the `paths` set (HuiPathIcon) */
  icon?: HuiPathIcon;
  /** default 'soft' */
  style?: HuiBlockStyle;
  /** default 'neutral' */
  tone?: HuiPathTone;
}
export interface HuiBlockBase {
  /** full-width shared layer under the grid ("1 Linux-Kernel") */
  label: string;
  sub?: string;
  icon?: HuiPathIcon;
}
export interface HuiBlockColumn {
  title?: string;
  /** boxes per row 1..3 (default: 1 for one box, 3 for 3 or 9 boxes, else 2) */
  grid?: 1 | 2 | 3;
  /** 1..12 (≤ 12 kept) */
  items: HuiBlockItem[];
  base?: HuiBlockBase;
}
/** Architecture / building-block diagram: 1–3 columns of boxes, each with an optional shared base layer. Display-only. */
export interface HuiBlocks extends HuiBase, HuiProvenance {
  type: 'blocks';
  title?: string;
  /** 1..3 (fewer while streaming; ≤ 3 kept) */
  columns: HuiBlockColumn[];
  /** muted line under the card ("Vereinfachtes Architekturmodell – …") */
  caption?: string;
}

// coding views (diff, terminal, changes) ──
/** What happened to a file: canonical git-style status (`created` / `new` → added, `moved` → renamed …). */
export type HuiFileStatus = 'added' | 'modified' | 'deleted' | 'renamed';
export const HUI_FILE_STATUSES: readonly HuiFileStatus[] = ['added', 'modified', 'deleted', 'renamed'];
export interface HuiDiffHunk {
  /** first line number on the old / new side (1-based; 0 for an empty side) */
  oldStart: number;
  newStart: number;
  /** text after the second `@@` (function context), ≤ 200 chars */
  header?: string;
  /** unified lines with their prefix: `" ctx"`, `"+add"`, `"-del"`, `"\\ No newline at end of file"` (≤ MAX_DIFF_LINES per file) */
  lines: string[];
}
export interface HuiDiffFile {
  /** path after the change (the old path for a deleted file) */
  path: string;
  /** path before a rename */
  oldPath?: string;
  status?: HuiFileStatus;
  /** code language for the header ("ts"), else guessed from the extension */
  language?: string;
  binary?: boolean;
  /** structured hunks … */
  hunks?: HuiDiffHunk[];
  /** … or this file's unified diff text (headers optional) … */
  patch?: string;
  /** … or the whole old / new text: the app computes the line diff (≤ MAX_DIFF_TEXT chars each) */
  before?: string;
  after?: string;
}
/**
 * Unified diff of one or more files. Either `patch` (standard unified diff text, also what a ```diff fence
 * holds) or structured `files`. Display-only; per-file collapse / copy / split view are local UI state.
 */
export interface HuiDiff extends HuiBase {
  type: 'diff';
  title?: string;
  /** standard unified diff text (git diff / diff -u), possibly several files */
  patch?: string;
  files?: HuiDiffFile[];
  /** preferred layout; `split` only takes effect on wide screens. Default auto (unified on phones). */
  view?: 'unified' | 'split';
}

export type HuiTerminalStatus = 'running' | 'done' | 'error';
/** A shell command and its output (ANSI SGR colours, `\r` progress lines). Display-only. */
export interface HuiTerminal extends HuiBase {
  type: 'terminal';
  title?: string;
  /** the command line as typed (multi-line allowed) */
  command?: string;
  /** working directory shown before the prompt */
  cwd?: string;
  /** raw output (stdout + stderr) incl. ANSI escapes; ≤ MAX_TERMINAL_OUTPUT chars (the tail is kept) */
  output?: string;
  /** absolute offset of `output[0]` in the whole output when `output` is a retained tail window (live tool output:
   * the host drops chars from the front); lets the view keep earlier lines and parse only what was appended */
  outputStart?: number;
  /** chars cut from the head of a longer output (`true`: an unknown amount) */
  truncated?: number | true;
  exitCode?: number;
  durationMs?: number;
  /** default: `running` without an exit code while the answer streams, else done / error from the exit code */
  status?: HuiTerminalStatus;
}

export interface HuiChangedFile {
  path: string;
  oldPath?: string;
  status: HuiFileStatus;
  additions?: number;
  deletions?: number;
  /** the file's unified diff (tap opens it) */
  patch?: string;
  hunks?: HuiDiffHunk[];
  binary?: boolean;
  /** touched by the agent in this session (the "<agent> only" filter); unset = unknown */
  byAgent?: boolean;
}
/** Files touched by an agent turn with +/- counts; a file with a diff opens it on tap. Display-only. */
export interface HuiChanges extends HuiBase {
  type: 'changes';
  title?: string;
  /** one line under the title ("Refactored the stream parser") */
  summary?: string;
  /** ≤ MAX_CHANGED_FILES */
  files: HuiChangedFile[];
  /** combined unified diff; files without their own patch / hunks take theirs from it (by path) */
  patch?: string;
  /** display name of the agent for the "<agent> only" filter ("Hermes"); default "Agent" */
  agent?: string;
}

export type HuiKnownNode =
  | HuiCard
  | HuiStack
  | HuiText
  | HuiCallout
  | HuiStats
  | HuiTable
  | HuiChart
  | HuiList
  | HuiSteps
  | HuiTimeline
  | HuiCompare
  | HuiImage
  | HuiGallery
  | HuiProgress
  | HuiCode
  | HuiButtons
  | HuiSuggestions
  | HuiForm
  | HuiChoice
  | HuiChecklist
  | HuiCalc
  | HuiMap
  | HuiRecipe
  | HuiTabs
  | HuiAccordion
  | HuiQuiz
  | HuiFlashcards
  | HuiSources
  | HuiTimer
  | HuiSlots
  | HuiConfirm
  | HuiTranslation
  | HuiPoll
  | HuiAgenda
  | HuiWeather
  | HuiDecision
  | HuiRank
  | HuiScale
  | HuiSummary
  | HuiPlaces
  | HuiProducts
  | HuiGuide
  | HuiWorkout
  | HuiStudyPlan
  | HuiVocab
  | HuiMindmap
  | HuiPaths
  | HuiBlocks
  | HuiDiff
  | HuiTerminal
  | HuiChanges;

/**
 * Discriminated union on `type`.
 *
 * Runtime note: normalizeNode()/the stream parser let nodes with an UNKNOWN
 * `type` through as-is (cast to HuiNode) so renderers can show a neutral
 * fallback card with the JSON. Renderers must therefore always have a
 * `default:` branch (or check `isKnownNodeType(node.type)`), never assume the
 * type is one of the union members.
 */
export type HuiNode = HuiKnownNode;

export type HuiNodeType = HuiKnownNode['type'];

export const HUI_NODE_TYPES: readonly HuiNodeType[] = [
  'card',
  'stack',
  'text',
  'callout',
  'stats',
  'table',
  'chart',
  'list',
  'steps',
  'timeline',
  'compare',
  'image',
  'gallery',
  'progress',
  'code',
  'buttons',
  'suggestions',
  'form',
  'choice',
  'checklist',
  'calc',
  'map',
  'recipe',
  'tabs',
  'accordion',
  'quiz',
  'flashcards',
  'sources',
  'timer',
  'slots',
  'confirm',
  'translation',
  'poll',
  'agenda',
  'weather',
  'decision',
  'rank',
  'scale',
  'summary',
  'places',
  'products',
  'guide',
  'workout',
  'studyplan',
  'vocab',
  'mindmap',
  'paths',
  'blocks',
  'diff',
  'terminal',
  'changes',
];

/**
 * Node types that keep user state (persisted per conversationId:messageId:nodeId) and therefore
 * always carry a stable `id` after normalizeNode() (explicit or deterministic fallback).
 */
export const INTERACTIVE_NODE_TYPES: ReadonlySet<HuiNodeType> = new Set<HuiNodeType>([
  'form', 'choice', 'checklist', 'calc', 'recipe', 'quiz', 'flashcards', 'timer', 'slots', 'confirm',
  'poll', 'agenda', 'decision', 'rank', 'scale',
  'places', 'products', 'map', 'guide', 'workout', 'studyplan', 'vocab', 'mindmap', 'paths', 'changes',
]);

export function isInteractiveNodeType(t: string): boolean {
  return (INTERACTIVE_NODE_TYPES as ReadonlySet<string>).has(t);
}

export function isKnownNodeType(t: string): t is HuiNodeType {
  return (HUI_NODE_TYPES as readonly string[]).includes(t);
}

export type Segment =
  | { key: string; kind: 'markdown'; text: string }
  | {
      key: string;
      kind: 'hui';
      complete: boolean;
      raw: string;
      node: HuiNode | null;
      error?: string;
      /** `node` is only a readable view of a block that could not be rendered as such (see readableFallback) */
      fallback?: boolean;
    }
  | { key: string; kind: 'html'; complete: boolean; html: string };

export type RouteFormat =
  | 'text'
  | 'table'
  | 'chart'
  | 'stats'
  | 'compare'
  | 'steps'
  | 'timeline'
  | 'form'
  | 'diagram'
  | 'calculator'
  | 'map'
  | 'interactive'
  | 'image'
  | 'choice'
  | 'checklist'
  | 'recipe'
  | 'quiz'
  | 'calc'
  | 'timer'
  | 'translation'
  | 'poll'
  | 'agenda'
  | 'weather'
  | 'decision'
  | 'rank'
  | 'scale'
  | 'places'
  | 'products'
  | 'guide'
  | 'workout'
  | 'studyplan'
  | 'vocab'
  | 'mindmap'
  | 'paths'
  | 'blocks'
  | 'diff'
  | 'terminal'
  | 'changes';

export interface RouteDecision {
  format: RouteFormat;
  component?: string;
  confidence: number;
  reason: string;
  model: string;
  ms: number;
}

export const ROUTE_FORMATS: readonly RouteFormat[] = [
  'text', 'table', 'chart', 'stats', 'compare', 'steps', 'timeline', 'form',
  'diagram', 'calculator', 'map', 'interactive', 'image',
  'choice', 'checklist', 'recipe', 'quiz', 'calc', 'timer',
  'translation', 'poll', 'agenda', 'weather', 'decision', 'rank', 'scale',
  'places', 'products', 'guide', 'workout', 'studyplan', 'vocab', 'mindmap', 'paths', 'blocks',
  'diff', 'terminal', 'changes',
];
