/**
 * Waiting delight – pure logic (no React, node-testable; waiting.test.ts):
 *   what is happening (first token / tool / announced UI format) → indicator kind + status phrase pool,
 *   seeded phrase rotation (never the same phrase twice in a row), long-wait tiers, settings mode,
 *   persona loader style (chameleon personas → chameleon). Phrases live in the i18n namespace `waiting` (de/en/es).
 */
import type { TKey } from '../../i18n/core.ts';

// ------------------------------------------------------------------ kinds

/** All animated indicators of the loader library (components: Loader.tsx). */
export const LOADER_KINDS = [
  'dots', // morphing dots
  'orbit', // orbiting particles
  'sparkle', // pulsing stars
  'wave', // typing wave (equalizer bars)
  'ring', // breathing ring + ripple
  'blob', // liquid blob
  'scan', // scanning line over a page
  'chameleon', // slowly shifting colors (chameleon persona)
  'magnifier', // searching sweep
  'gear', // meshing gears
  'page', // page flip
  'pencil', // drawing pencil
  'bars', // chart bars growing
  'grid', // table cells filling
  'pin', // map pin drop
  'pulse', // simple dots (Dezent)
] as const;
export type LoaderKind = (typeof LOADER_KINDS)[number];

export function isLoaderKind(v: unknown): v is LoaderKind {
  return typeof v === 'string' && (LOADER_KINDS as readonly string[]).includes(v);
}

/** Kinds offered as persona style in the profile editor ('pulse' is the Dezent fallback, not a style). */
export const PERSONA_LOADER_KINDS: readonly LoaderKind[] = LOADER_KINDS.filter((k) => k !== 'pulse');

/** Playful indicators for "waiting for the first token" – one is picked per message (seed). */
export const FIRST_TOKEN_LOADERS: readonly LoaderKind[] = ['sparkle', 'orbit', 'dots', 'wave', 'ring', 'blob'];

// ------------------------------------------------------------------ settings mode

/** Settings → Darstellung → Warte-Animationen. */
export type WaitingAnimationsPref = 'playful' | 'subtle' | 'off';
export const WAITING_ANIMATION_PREFS: readonly WaitingAnimationsPref[] = ['playful', 'subtle', 'off'];
/** Effective mode: playful = varied indicators + rotating phrases · subtle = simple dots + static text · off = text only. */
export type WaitMode = WaitingAnimationsPref;

/** Reduced motion (OS or app setting "Animationen") turns Verspielt into Dezent. */
export function resolveWaitMode(pref: WaitingAnimationsPref | undefined, reducedMotion: boolean): WaitMode {
  // default: the calm monochrome variant; the colourful loaders are opt-in ("Verspielt")
  const p = pref && WAITING_ANIMATION_PREFS.includes(pref) ? pref : 'subtle';
  return p === 'playful' && reducedMotion ? 'subtle' : p;
}

// ------------------------------------------------------------------ state

export type ToolCategory = 'search' | 'web' | 'code' | 'file' | 'image' | 'memory' | 'other';
export const TOOL_CATEGORIES: readonly ToolCategory[] = ['search', 'web', 'code', 'file', 'image', 'memory', 'other'];

/** Tool function name → category (same keyword logic as chat/format.ts toolEmoji). */
export function toolCategory(name: string): ToolCategory {
  const k = name.toLowerCase();
  if (/search|such|lookup/.test(k)) return 'search';
  if (/image|paint|draw|dall|picture|imagine/.test(k)) return 'image';
  if (/browse|fetch|web|url|http|page|scrape/.test(k)) return 'web';
  if (/terminal|shell|bash|exec|command|python|code|calc|interpreter|run/.test(k)) return 'code';
  if (/file|read|write|doc|pdf/.test(k)) return 'file';
  if (/memory|remember|recall|note/.test(k)) return 'memory';
  return 'other';
}

export type WaitState =
  | { kind: 'first' }
  | { kind: 'tool'; category: ToolCategory }
  | { kind: 'route'; shape: string };

/** What the turn is waiting for. Precedence: running tool > announced UI format > first token. */
export function waitStateOf(input: { tools?: readonly { name: string; status: string }[]; routeShape?: string | null }): WaitState {
  const tools = input.tools ?? [];
  for (let i = tools.length - 1; i >= 0; i--) {
    if (tools[i].status === 'running') return { kind: 'tool', category: toolCategory(tools[i].name) };
  }
  if (input.routeShape && input.routeShape !== 'text') return { kind: 'route', shape: input.routeShape };
  return { kind: 'first' };
}

/** Stable key of a state (effect dependencies, React keys). */
export function waitStateKey(s: WaitState): string {
  return s.kind === 'tool' ? `tool:${s.category}` : s.kind === 'route' ? `route:${s.shape}` : 'first';
}

const TOOL_LOADER: Record<ToolCategory, LoaderKind> = {
  search: 'magnifier',
  web: 'scan',
  code: 'gear',
  file: 'page',
  image: 'pencil',
  memory: 'sparkle',
  other: 'orbit',
};

/** Announced UI format / node type → mini icon that morphs into the skeleton. */
export function routeLoader(shape: string): LoaderKind {
  switch (shape) {
    case 'chart':
    case 'stats':
    case 'progress':
      return 'bars';
    case 'table':
    case 'compare':
    case 'paths':
    case 'blocks':
    case 'slots':
      return 'grid';
    case 'map':
      return 'pin';
    case 'image':
    case 'gallery':
    case 'diagram':
      return 'pencil';
    case 'calculator':
    case 'calc':
    case 'timer':
    case 'interactive':
    case 'code':
      return 'gear';
    case 'recipe':
    case 'steps':
    case 'timeline':
    case 'list':
    case 'checklist':
    case 'sources':
      return 'scan';
    default:
      return 'pencil';
  }
}

/** Indicator for a state. playful: context icon (tools/route) or persona / seeded pick; subtle: dots; off: none. */
export function indicatorFor(state: WaitState, opts: { mode?: WaitMode; persona?: LoaderKind | null; seed?: number } = {}): LoaderKind | null {
  const mode = opts.mode ?? 'playful';
  if (mode === 'off') return null;
  if (mode === 'subtle') return 'pulse';
  if (state.kind === 'tool') return TOOL_LOADER[state.category];
  if (state.kind === 'route') return routeLoader(state.shape);
  if (opts.persona) return opts.persona;
  const seed = Math.abs(Math.floor(opts.seed ?? 0));
  return FIRST_TOKEN_LOADERS[seed % FIRST_TOKEN_LOADERS.length];
}

/** Skeletons that already carry their own caption ("Erstellt Rechner …"): no badge on top (except for tools). */
const SELF_LABELED_SHAPES = new Set(['diagram', 'calculator', 'interactive']);
export function routeBadgeVisible(shape: string, state: WaitState): boolean {
  return state.kind === 'tool' || !SELF_LABELED_SHAPES.has(shape);
}

// ------------------------------------------------------------------ long waits

/** >10 s: subtle progress hint „Dauert etwas länger…“; >30 s: „Ich bin noch dran“. */
export const LONG_WAIT_MS = { slow: 10_000, still: 30_000 } as const;
export type WaitTier = 0 | 1 | 2;

export function waitTier(elapsedMs: number): WaitTier {
  if (!Number.isFinite(elapsedMs)) return 0;
  if (elapsedMs >= LONG_WAIT_MS.still) return 2;
  if (elapsedMs >= LONG_WAIT_MS.slow) return 1;
  return 0;
}

/** ms until the next tier starts (null when already at the last tier). */
export function msUntilNextTier(elapsedMs: number): number | null {
  const e = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  if (e < LONG_WAIT_MS.slow) return LONG_WAIT_MS.slow - e;
  if (e < LONG_WAIT_MS.still) return LONG_WAIT_MS.still - e;
  return null;
}

/** Phrase rotation interval (playful mode). */
export const PHRASE_ROTATE_MS = 2500;

// ------------------------------------------------------------------ phrase pools (i18n keys)

const range = (prefix: string, n: number): TKey[] => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}` as TKey);

export const FIRST_PHRASES: readonly TKey[] = range('waiting.first.p', 15);
export const SLOW_PHRASES: readonly TKey[] = range('waiting.slow.p', 6);
export const STILL_PHRASES: readonly TKey[] = range('waiting.still.p', 6);
export const TOOL_PHRASES: Record<ToolCategory, readonly TKey[]> = Object.fromEntries(
  TOOL_CATEGORIES.map((c) => [c, range(`waiting.tool.${c}.p`, 3)]),
) as unknown as Record<ToolCategory, readonly TKey[]>;

/** Formats with their own „Baut …“ phrase; anything else → generic. */
export const ROUTE_PHRASE_SHAPES = [
  'chart', 'table', 'stats', 'compare', 'map', 'recipe', 'steps', 'timeline', 'list', 'form', 'diagram',
  'calculator', 'image', 'checklist', 'quiz', 'choice', 'timer', 'interactive', 'code', 'flashcards',
] as const;
const ROUTE_ALIASES: Record<string, string> = { calc: 'calculator', gallery: 'image', progress: 'stats', slots: 'choice' };

export function routePhraseKey(shape: string): TKey {
  const s = ROUTE_ALIASES[shape] ?? shape;
  return ((ROUTE_PHRASE_SHAPES as readonly string[]).includes(s) ? `waiting.route.${s}` : 'waiting.route.generic') as TKey;
}

const ROUTE_EXTRA: readonly TKey[] = range('waiting.route.extra', 3);
export const SLOW_HEADLINE = SLOW_PHRASES[0];
export const STILL_HEADLINE = STILL_PHRASES[0];

/**
 * Phrase pool for a state + tier. pool[0] = the headline: shown first after every change and as the
 * static text in Dezent / Aus.
 */
export function statusPool(state: WaitState, tier: WaitTier): readonly TKey[] {
  if (state.kind === 'first') return tier === 2 ? STILL_PHRASES : tier === 1 ? SLOW_PHRASES : FIRST_PHRASES;
  const base = state.kind === 'tool' ? TOOL_PHRASES[state.category] : [routePhraseKey(state.shape), ...ROUTE_EXTRA];
  if (tier === 0) return base;
  return [tier === 2 ? STILL_HEADLINE : SLOW_HEADLINE, ...base];
}

// ------------------------------------------------------------------ seeded rotation

/** Small deterministic PRNG (mulberry32) → floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** String → 32-bit seed (FNV-1a), e.g. per message id so every answer gets its own indicator. */
export function seedFrom(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Random element of `pool` that differs from `prev` (when the pool has an alternative). */
export function nextPhrase<T>(pool: readonly T[], prev: T | undefined, rnd: () => number): T {
  if (!pool.length) throw new Error('empty phrase pool');
  const candidates = pool.length > 1 && prev !== undefined && pool.includes(prev) ? pool.filter((p) => p !== prev) : pool;
  const i = Math.min(candidates.length - 1, Math.floor(rnd() * candidates.length));
  return candidates[i];
}

export type PhraseRotator<T> = {
  /** next phrase from `pool`, never equal to the previous one; `forced` (e.g. the headline) wins unless it repeats */
  next(pool: readonly T[], forced?: T): T;
  readonly current: T | undefined;
};

export function createPhraseRotator<T = TKey>(seed: number): PhraseRotator<T> {
  const rnd = mulberry32(seed);
  let cur: T | undefined;
  return {
    next(pool, forced) {
      cur = forced !== undefined && forced !== cur ? forced : nextPhrase(pool, cur, rnd);
      return cur;
    },
    get current() {
      return cur;
    },
  };
}

/** First `n` phrases a rotator yields for a fixed pool (headline first) – tests / Gallery preview. */
export function phraseSequence<T>(pool: readonly T[], n: number, seed: number): T[] {
  const r = createPhraseRotator<T>(seed);
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(r.next(pool, i === 0 ? pool[0] : undefined));
  return out;
}

// ------------------------------------------------------------------ persona

/** Profile field `loaderStyle`: a LoaderKind or 'auto' (= heuristic, default). */
export type LoaderStylePref = LoaderKind | 'auto';

/**
 * Extra persona names (whole words, case-insensitive) that get the chameleon on 'auto'. Build-time config
 * (`EXPO_PUBLIC_PERSONA_NAMES`, comma separated; personal builds set it from the private overlay).
 */
export const PERSONA_NAMES: readonly string[] = parsePersonaNames(process.env.EXPO_PUBLIC_PERSONA_NAMES);

export function parsePersonaNames(raw: string | undefined | null): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^[\p{L}\p{N}_-]{1,40}$/u.test(s));
}

/**
 * Persona loader of the active profile: explicit `loaderStyle` wins; 'auto' → chameleon for
 * chameleon personas (profile name or model) and for `names` (PERSONA_NAMES), otherwise none (seeded variety).
 */
export function personaLoader(
  p: { loaderStyle?: string; name?: string; model?: string; baseUrl?: string } | null | undefined,
  names: readonly string[] = PERSONA_NAMES,
): LoaderKind | null {
  if (!p) return null;
  if (p.loaderStyle && p.loaderStyle !== 'auto' && isLoaderKind(p.loaderStyle) && p.loaderStyle !== 'pulse') return p.loaderStyle;
  const hay = `${p.name ?? ''} ${p.model ?? ''} ${p.baseUrl ?? ''}`.toLowerCase();
  if (/chamel|chamäleon|camaleón|camaleon/.test(hay)) return 'chameleon';
  const words = hay.split(/[^\p{L}\p{N}_]+/u);
  return names.some((n) => words.includes(n)) ? 'chameleon' : null;
}
