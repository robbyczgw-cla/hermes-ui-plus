/**
 * Hermes profiles ("bots", docs/HERMES-API.md "Profiles (bots)"): one gateway serves several named bots with their
 * own model, memory and skills; every API path is mirrored under `/p/<profile>/…`. Pure, erasable TS (node:test).
 *
 * - A conversation stores its bot (`ConversationMeta.hermesProfile`, undefined = the default profile).
 * - `withBot(conn, bot)` rewrites the base URL (`https://host/v1` → `https://host/p/<bot>/v1`), so every Hermes call
 *   of the chat (chat completions, runs/approvals, sessions API, models, capabilities) reaches that bot.
 * - Bridge endpoints (`/bridge/*`, uploads, media, voice, meta) and `/health` stay at the server root
 *   (`serverRootOf`).
 */

/** Hermes' profile name rule (lowercase letter/digit first, then lowercase letters, digits, `-`, `_`; max 64). */
export const BOT_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
/** Name of the unprefixed profile in `GET /bridge/profiles`. */
export const DEFAULT_BOT = 'default';

export type HermesBot = {
  name: string;
  /** the unprefixed default profile */
  default: boolean;
  /** display name (bridge `BRIDGE_PROFILES=name=Label`) */
  label?: string;
  /** the profile's configured model (bridge, from its config.yaml) */
  model?: string;
  /** one line about the bot (bridge, Hermes Desktop's bot metadata / profile description) */
  description?: string;
  /** Desktop's bot colour (`#rrggbb`) */
  color?: string;
  /** pinned in Hermes Desktop: listed right after the default bot */
  pinned?: boolean;
  /** role template of a bot made in the app (bots/create/core.ts): its first-screen starters */
  template?: string;
};

export function isBotName(name: unknown): name is string {
  return typeof name === 'string' && BOT_NAME_RE.test(name);
}

/** Normalised bot of a conversation / request: a valid non-default name, else undefined (= default profile). */
export function botOf(name: string | null | undefined): string | undefined {
  return isBotName(name) && name !== DEFAULT_BOT ? name : undefined;
}

const PROFILE_SUFFIX = /\/p\/[a-z0-9][a-z0-9_-]{0,63}$/;

function splitBase(baseUrl: string): { root: string; v1: boolean } {
  let b = baseUrl.trim().replace(/\/+$/, '');
  const v1 = /\/v1$/i.test(b);
  if (v1) b = b.slice(0, -3);
  b = b.replace(PROFILE_SUFFIX, '');
  return { root: b, v1 };
}

/** Server root without `/v1` and without a `/p/<bot>` prefix (bridge endpoints, `/health`). */
export function serverRootOf(baseUrl: string): string {
  return splitBase(baseUrl).root;
}

/** Base URL of `bot` on the server of `baseUrl` (keeps a trailing `/v1`); default/invalid bot → the plain base. */
export function botBaseUrl(baseUrl: string, bot: string | null | undefined): string {
  const { root, v1 } = splitBase(baseUrl);
  const b = botOf(bot);
  return `${root}${b ? `/p/${b}` : ''}${v1 ? '/v1' : ''}`;
}

/** The bot a base URL addresses (undefined = default profile). */
export function botFromBaseUrl(baseUrl: string): string | undefined {
  const b = baseUrl.trim().replace(/\/+$/, '').replace(/\/v1$/i, '');
  const m = /\/p\/([a-z0-9][a-z0-9_-]{0,63})$/.exec(b);
  return m ? botOf(m[1]) : undefined;
}

/** The connection of one bot (same object for the default profile, so memoised consumers stay stable). */
export function withBot<T extends { baseUrl: string }>(conn: T, bot: string | null | undefined): T {
  const b = botOf(bot);
  if (!b) return conn;
  return { ...conn, baseUrl: botBaseUrl(conn.baseUrl, b) };
}

/**
 * Connection editor field "Hermes profiles (bots)": names separated by commas, spaces or new lines. Lower-cased,
 * invalid names and `default` dropped, de-duplicated, at most 20.
 */
export function parseBotList(text: string | null | undefined): string[] {
  const out: string[] = [];
  for (const raw of String(text ?? '').split(/[\s,;]+/)) {
    const n = raw.trim().toLowerCase();
    if (!isBotName(n) || n === DEFAULT_BOT || out.includes(n)) continue;
    out.push(n);
    if (out.length >= 20) break;
  }
  return out;
}

export function formatBotList(list: readonly string[] | undefined): string {
  return (list ?? []).join(', ');
}

/** Invalid entries of the editor field (shown as a hint; they are not saved). */
export function invalidBotNames(text: string | null | undefined): string[] {
  return String(text ?? '')
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter((s) => s && !isBotName(s.toLowerCase()));
}

const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);

/** `GET /bridge/profiles` body → bots (default first), or null when the server answered something else. */
export function parseBridgeProfiles(json: unknown): HermesBot[] | null {
  const data = json && typeof json === 'object' ? (json as { data?: unknown }).data : undefined;
  if (!Array.isArray(data)) return null;
  const out: HermesBot[] = [];
  for (const row of data) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const isDefault = r.default === true || r.name === DEFAULT_BOT;
    const name = isDefault ? DEFAULT_BOT : r.name;
    if (!isBotName(name) || out.some((b) => b.name === name)) continue;
    const label = str(r.label, 40);
    const model = str(r.model, 120);
    const description = str(r.description, 160);
    const color = typeof r.color === 'string' && /^#[0-9a-f]{6}$/i.test(r.color) ? r.color.toLowerCase() : undefined;
    const template = typeof r.template === 'string' && /^[a-z]{2,12}$/.test(r.template) ? r.template : undefined;
    out.push({
      name, default: isDefault, ...(label ? { label } : {}), ...(model ? { model } : {}),
      ...(description ? { description } : {}), ...(color ? { color } : {}), ...(r.pinned === true ? { pinned: true } : {}),
      ...(template ? { template } : {}),
    });
  }
  out.sort((a, b) => Number(b.default) - Number(a.default));
  return out;
}

/**
 * Bots of a connection for the picker: the default profile first, then the server's (bridge) bots, then the manual
 * list, then the chat's own bot if neither knows it any more. Only the default → `[default]` (no "Bot" section).
 */
export function botEntries(o: { server?: readonly HermesBot[] | null; manual?: readonly string[]; current?: string | null }): HermesBot[] {
  const server = o.server ?? [];
  const def = server.find((b) => b.default) ?? { name: DEFAULT_BOT, default: true };
  const out: HermesBot[] = [def];
  const add = (b: HermesBot) => {
    if (!b.default && isBotName(b.name) && !out.some((x) => x.name === b.name)) out.push(b);
  };
  for (const b of server) add(b);
  for (const n of o.manual ?? []) add({ name: n, default: false });
  const cur = botOf(o.current);
  if (cur) add({ name: cur, default: false });
  return out;
}

/** Non-default bot names to sync / poll (picker order). */
export function botNames(entries: readonly HermesBot[]): string[] {
  return entries.filter((b) => !b.default).map((b) => b.name);
}

/** Display name of a bot: label, else the profile name. The default profile gets `defaultLabel`. */
export function botDisplayName(bot: Pick<HermesBot, 'name' | 'default' | 'label'> | undefined, defaultLabel: string): string {
  if (!bot || bot.default) return bot?.label ?? defaultLabel;
  return bot.label ?? bot.name;
}

/** Short badge / header text for a conversation's bot (undefined for the default profile). */
export function botBadge(bot: string | null | undefined, entries?: readonly HermesBot[]): string | undefined {
  const b = botOf(bot);
  if (!b) return undefined;
  return entries?.find((e) => e.name === b)?.label ?? b;
}

/** Structural subset of settings' ConnectionProfile (this file stays import-free). */
export type BotProfile = { kind: string; bridge?: boolean; hermesBots?: readonly string[] };

/**
 * Bots of a connection: demo → `server` (its bot list, onboarding/demo/bots.ts) or DEMO_BOTS; Hermes → the bridge list (`server`, bridge connections only) + the
 * manual list of the connection editor (+ the chat's own bot). Other kinds → [] (no bots).
 */
export function botsForProfile(p: BotProfile | undefined, server: readonly HermesBot[] | null | undefined, current?: string | null): HermesBot[] {
  if (!p) return [];
  if (p.kind === 'demo') return botEntries({ server: server ?? DEMO_BOTS, current });
  if (p.kind !== 'hermes') return [];
  return botEntries({ server: p.bridge ? server : null, manual: p.hermesBots, current });
}

/** Offline demo without its bot list (onboarding/demo/bots.ts demoBotList): Hermes only (never sent anywhere). */
export const DEMO_BOTS: readonly HermesBot[] = Object.freeze([{ name: DEFAULT_BOT, default: true }]);
