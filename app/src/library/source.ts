/**
 * Where Skills & memory come from for one connection + bot (docs/SKILLS-MEMORY.md):
 *   - the UI bridge's `/bridge/library/*` when the hermes-ui-plus plugin serves this bot (full list, SKILL.md, memory)
 *   - otherwise Hermes' own `GET /v1/skills` under the bot's `/p/<bot>/` prefix (names + descriptions only)
 *   - the offline demo's fixed data
 * Every call is a GET; nothing here changes Hermes.
 */
import { botOf, serverRootOf, withBot } from '../hermes/bots.ts';
import { createJsonRequest, type JsonRequest } from '../hermes/sessions.ts';
import type { FetchLike } from '../hermes/stream.ts';
import { HermesError } from '../hermes/stream.ts';
import { demoLibrary, type DemoLibraryLang } from './demo.ts';
import { NO_FEATURES, parseFeatures, parseMemory, parseSkillDoc, parseSkillList, type LibraryFeatures, type LibrarySkill, type MemorySnapshot, type SkillDoc } from './model.ts';

export type SkillList = {
  skills: LibrarySkill[];
  /** `plugin`: enabled state + source + SKILL.md are known; `api`: Hermes' plain list */
  via: 'plugin' | 'api' | 'demo';
};

export type LibrarySource = {
  /** cache key: server + key + bot */
  key: string;
  demo: boolean;
  features(): Promise<LibraryFeatures>;
  skills(features: LibraryFeatures): Promise<SkillList>;
  /** null: SKILL.md is not readable for this bot (no plugin) */
  skillDoc(name: string, features: LibraryFeatures): Promise<SkillDoc | null>;
  memory(features: LibraryFeatures): Promise<MemorySnapshot | null>;
};

export type ProfileLike = { id: string; kind: string; baseUrl: string; apiKey: string; bridge?: boolean };

const isDemo = (p: ProfileLike) => p.kind === 'demo' || /^demo:/i.test(p.baseUrl);

/** Can this connection have Skills & memory at all? (Hermes or the demo; other agents have neither.) */
export function libraryApplies(p: ProfileLike | null | undefined): boolean {
  if (!p) return false;
  return isDemo(p) || (p.kind === 'hermes' && !!p.apiKey && /^https?:\/\//i.test(p.baseUrl.trim()));
}

/** the Skills & memory screen of `bot` (app/skills.tsx), optionally on the Memory tab */
export function libraryRoute(bot: string | null | undefined, tab?: 'memory'): string {
  const b = botOf(bot);
  const q = [b ? `bot=${encodeURIComponent(b)}` : '', tab ? `tab=${tab}` : ''].filter(Boolean).join('&');
  return q ? `/skills?${q}` : '/skills';
}

const q = (bot: string | undefined, extra: Record<string, string> = {}) => {
  const parts = Object.entries({ bot: bot ?? 'default', ...extra }).map(([k, v]) => `${k}=${encodeURIComponent(v)}`);
  return `?${parts.join('&')}`;
};

/** `lang`: the demo's memory entries follow the UI language (a real server answers with what it stores) */
export function librarySource(p: ProfileLike | null | undefined, bot: string | null | undefined, fetchImpl: FetchLike, lang: DemoLibraryLang = 'en'): LibrarySource | null {
  if (!p || !libraryApplies(p)) return null;
  const b = botOf(bot);
  if (isDemo(p)) {
    const d = demoLibrary(Date.now(), lang);
    return {
      key: `demo:${p.id}:${b ?? ''}:${lang}`,
      demo: true,
      features: async () => ({ skills: { available: true }, memory: { available: true } }),
      skills: async () => ({ skills: d.skills, via: 'demo' }),
      skillDoc: async (name) => d.doc(name),
      memory: async () => d.memory,
    };
  }
  const conn = { baseUrl: p.baseUrl, apiKey: p.apiKey };
  // bridge routes live at the server root (no /p/<bot>, no /v1); Hermes' own list under the bot's prefix
  const bridgeReq: JsonRequest = createJsonRequest(fetchImpl, { baseUrl: serverRootOf(p.baseUrl), apiKey: p.apiKey }, 12000);
  const botReq: JsonRequest = createJsonRequest(fetchImpl, withBot(conn, b), 15000);
  const plugin = (f: LibraryFeatures, k: 'skills' | 'memory') => !!p.bridge && f[k].available;
  return {
    key: `${serverRootOf(p.baseUrl)}#${p.apiKey.slice(-6)}|${b ?? ''}`,
    demo: false,
    async features() {
      if (!p.bridge) return NO_FEATURES;
      try {
        return parseFeatures(await bridgeReq('GET', `/bridge/library/config${q(b)}`, undefined, 6000));
      } catch (e) {
        // an older bridge without the route: the stock list still works; auth / network errors surface on the list
        if (e instanceof HermesError && (e.status === 404 || e.status === 405)) return { skills: { available: false, reason: 'bridge_too_old' }, memory: { available: false, reason: 'bridge_too_old' } };
        throw e;
      }
    },
    async skills(f) {
      if (plugin(f, 'skills')) return { skills: parseSkillList(await bridgeReq('GET', `/bridge/library/skills${q(b)}`)), via: 'plugin' };
      return { skills: parseSkillList(await botReq('GET', '/v1/skills')), via: 'api' };
    },
    async skillDoc(name, f) {
      if (!plugin(f, 'skills')) return null;
      return parseSkillDoc(await bridgeReq('GET', `/bridge/library/skills/content${q(b, { name })}`));
    },
    async memory(f) {
      if (!plugin(f, 'memory')) return null;
      return parseMemory(await bridgeReq('GET', `/bridge/library/memory${q(b)}`));
    },
  };
}
