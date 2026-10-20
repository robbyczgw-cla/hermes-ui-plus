/**
 * Creating a bot in the app (Bots v2 slice 3, docs/BOTS-SERVER.md "Creating bots from the app"): pure, erasable TS.
 *
 * Two steps: a role (five private templates, "Eigene Rolle", or an empty "New Agent" you rename), then three fields
 * (name, main job, how it should work) plus the "may" switches. No model picker: the bot inherits the server's default
 * model. The bridge (`POST /bridge/bots`) asks the hermes-ui-plus plugin to make the Hermes profile; the bridge adds
 * its own key, the app never sends one.
 */

export type TemplateId = 'research' | 'deals' | 'travel' | 'briefing' | 'code' | 'own' | 'blank';
/** the role list of step 1, in this order ("Eigene Rolle" last; the empty agent is a link below it) */
export const ROLE_TEMPLATES: readonly TemplateId[] = ['research', 'deals', 'travel', 'briefing', 'code', 'own'];
/** templates that come with prefilled fields and three starters of their own */
export const PREFILLED: readonly TemplateId[] = ['research', 'deals', 'travel', 'briefing', 'code', 'blank'];
export const WITH_STARTERS: readonly TemplateId[] = ['research', 'deals', 'travel', 'briefing', 'code'];

export type May = { web: boolean; memory: boolean; routines: boolean; commands: boolean };
export const MAY_KEYS: readonly (keyof May)[] = ['web', 'memory', 'routines', 'commands'];

/** Spec 2.2: everything but code may search, remember and check in regularly; code remembers and runs commands. */
export function defaultMay(t: TemplateId): May {
  return t === 'code' ? { web: false, memory: true, routines: false, commands: true } : { web: true, memory: true, routines: true, commands: false };
}

/** Only the code template shows "Befehle ausführen" (always with approval); the others keep it off. */
export function showsCommands(t: TemplateId): boolean {
  return t === 'code';
}

/** Calm bot colours (Desktop-compatible `#rrggbb`), one per template first, the rest by "Farbe ändern". */
export const BOT_COLORS: readonly string[] = ['#3f7d6e', '#8a6d3b', '#5b6fa8', '#a0566b', '#6b7f3a', '#7a5ea8', '#3d7ea6', '#a8663a'];
const TEMPLATE_COLOR: Record<TemplateId, number> = { research: 6, deals: 0, travel: 2, briefing: 1, code: 5, own: 3, blank: 4 };
export function templateColor(t: TemplateId): string {
  return BOT_COLORS[TEMPLATE_COLOR[t]] ?? BOT_COLORS[0];
}
export function nextColor(color: string): string {
  const i = BOT_COLORS.indexOf(color.toLowerCase());
  return BOT_COLORS[(i + 1) % BOT_COLORS.length];
}

export const LIMITS = { title: 40, job: 160, how: 2000 } as const;

export type Draft = { template: TemplateId; title: string; job: string; how: string; may: May; color: string };

/** Step 2 prefilled from a template (texts come from i18n: `botCreate.templates.<id>.name|job|how`). */
export function draftFor(t: TemplateId, text: (key: 'name' | 'job' | 'how') => string): Draft {
  const filled = PREFILLED.includes(t);
  return {
    template: t,
    title: filled ? text('name') : '',
    job: filled ? text('job') : '',
    how: filled ? text('how') : '',
    may: defaultMay(t),
    color: templateColor(t),
  };
}

export type FieldKey = 'title' | 'job' | 'how';
export type FieldProblem = { field: FieldKey; kind: 'required' | 'tooLong'; max?: number };

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

/** What is wrong with the fields (empty list = ready). The plugin checks again. */
export function draftProblems(d: Draft): FieldProblem[] {
  const out: FieldProblem[] = [];
  const check = (field: FieldKey, value: string) => {
    if (!value) out.push({ field, kind: 'required' });
    else if (value.length > LIMITS[field]) out.push({ field, kind: 'tooLong', max: LIMITS[field] });
  };
  check('title', oneLine(d.title));
  check('job', oneLine(d.job));
  check('how', d.how.trim());
  return out;
}

/** App language → the language of the bot's SOUL (de / en / es; anything else en). */
export function soulLang(locale: string | undefined): 'de' | 'en' | 'es' {
  const l = String(locale ?? '').slice(0, 2).toLowerCase();
  return l === 'de' || l === 'es' ? l : 'en';
}

/** POST /bridge/bots body. `may.commands` only where the switch is shown. */
export function createBody(d: Draft, locale: string | undefined) {
  return {
    title: oneLine(d.title),
    job: oneLine(d.job),
    how: d.how.trim(),
    template: d.template,
    lang: soulLang(locale),
    may: { ...d.may, commands: showsCommands(d.template) && d.may.commands },
    color: d.color,
  };
}

// ------------------------------------------------------------------ bridge answers

export type CreateRight = { allowed: true } | { allowed: false; reason: string };
export type BotsConfig = { create: CreateRight; admin: boolean; limit: number; count: number };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const REASON = /^[a-z_]{2,40}$/;

/** GET /bridge/bots. null = this bridge has no such route (older bridge, direct Hermes): no create button. */
export function parseBotsConfig(json: unknown): BotsConfig | null {
  if (!isObj(json) || !isObj(json.create)) return null;
  const c = json.create;
  const create: CreateRight = c.allowed === true ? { allowed: true } : { allowed: false, reason: typeof c.reason === 'string' && REASON.test(c.reason) ? c.reason : 'unknown' };
  const n = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : d);
  return { create, admin: json.admin === true, limit: n(json.limit, 50), count: n(json.count, 0) };
}

export type CreatedBot = { name: string; label?: string; description?: string; color?: string; template?: TemplateId };

const TEMPLATES: readonly TemplateId[] = ['research', 'deals', 'travel', 'briefing', 'code', 'own', 'blank'];
export function isTemplateId(v: unknown): v is TemplateId {
  return typeof v === 'string' && (TEMPLATES as readonly string[]).includes(v);
}

/** `{bot}` of a 201 / 200 answer; null when it is not a bot. */
export function parseCreated(json: unknown): CreatedBot | null {
  const b = isObj(json) && isObj(json.bot) ? json.bot : null;
  if (!b || typeof b.name !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(b.name) || b.name === 'default') return null;
  const s = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
  const color = typeof b.color === 'string' && /^#[0-9a-f]{6}$/i.test(b.color) ? b.color.toLowerCase() : undefined;
  return {
    name: b.name,
    ...(s(b.label, LIMITS.title) ? { label: s(b.label, LIMITS.title) } : {}),
    ...(s(b.description, LIMITS.job) ? { description: s(b.description, LIMITS.job) } : {}),
    ...(color ? { color } : {}),
    ...(isTemplateId(b.template) ? { template: b.template } : {}),
  };
}

/** Why a create failed, for the message under the button (never server free text). */
export type CreateFailure =
  | { kind: 'exists' }
  | { kind: 'limit'; limit: number }
  | { kind: 'forbidden' }
  | { kind: 'invalid'; field: string }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'server'; reason: string }
  | { kind: 'offline' };

/** An error answer of POST /bridge/bots (status + JSON body) → what the form shows. */
export function createFailure(status: number, json: unknown): CreateFailure {
  const e = isObj(json) && isObj(json.error) ? json.error : {};
  const code = typeof e.code === 'string' ? e.code : '';
  const reason = typeof e.reason === 'string' && REASON.test(e.reason) ? e.reason : '';
  if (code === 'exists') return { kind: 'exists' };
  if (code === 'limit') return { kind: 'limit', limit: typeof e.limit === 'number' ? e.limit : 50 };
  if (status === 403 || code === 'bots_forbidden') return { kind: 'forbidden' };
  if (code === 'invalid_field') return { kind: 'invalid', field: typeof e.field === 'string' ? e.field.slice(0, 40) : 'body' };
  if (code === 'bots_unavailable') return { kind: 'unavailable', reason: reason || 'unknown' };
  if (status === 504 || code === 'timeout') return { kind: 'server', reason: 'timeout' };
  if (code === 'create_failed') return { kind: 'server', reason: 'create_failed' };
  return { kind: 'server', reason: 'unknown' };
}

/** The field a failure points at (red outline), if any. */
export function failureField(f: CreateFailure | null): FieldKey | null {
  if (!f) return null;
  if (f.kind === 'exists') return 'title';
  if (f.kind === 'invalid' && (f.field === 'title' || f.field === 'job' || f.field === 'how')) return f.field;
  return null;
}

/** The owner's one command for the empty state (admin devices only). */
export const ENABLE_COMMAND = 'hermes-ui-plus-bridge bots enable';

/** Reasons where the owner's switch is the fix (the empty state shows the command to admin devices). */
export function ownerCanEnable(reason: string): boolean {
  return reason === 'owner_off';
}

// ------------------------------------------------------------------ what the Bots tab offers

/** Reasons the owner can fix on the server; an admin device sees the Bots tab with the reason (and, for owner_off, the
 *  command) even before the first bot exists. Everything else (no plugin, switched off on purpose) keeps the 0.1 look. */
const OWNER_FIXABLE = ['owner_off', 'multiplex_off', 'not_root_profile'];

export type CreateOffer = { kind: 'create' } | { kind: 'owner'; reason: string; command: boolean } | null;

/** The Bots tab's create part: the "Neuer Bot" button, the owner's note, or nothing. */
export function createOffer(cfg: BotsConfig | null): CreateOffer {
  if (!cfg) return null;
  if (cfg.create.allowed) return { kind: 'create' };
  const reason = cfg.create.reason;
  return { kind: 'owner', reason, command: cfg.admin && ownerCanEnable(reason) };
}

/** Does the create right alone make the Bots tab worth showing (no bot besides the default yet)? */
export function createShowsTab(cfg: BotsConfig | null): boolean {
  if (!cfg) return false;
  return cfg.create.allowed || (cfg.admin && OWNER_FIXABLE.includes(cfg.create.reason));
}
