// Web research capability for the caps line (src/caps.mjs): `[hermes-ui-caps] image_search=off web=off`.
//
// The bridge is a pass-through and has no web tools of its own; whether the MODEL can search or read the web is decided
// by the Hermes profile's toolsets. Hermes (v0.22+) lists them at `GET /v1/toolsets` (per profile under `/p/<name>/`):
// `{data: [{name, enabled, configured, tools: [...]}]}`. web=on when an enabled AND configured toolset carries a web
// search / page read tool (built-in `web`, a search plugin's own toolset, `browser`), else web=off. The hermes-ui skill
// reads it (SKILL.md "Evidence"): with web=off it labels facts as model knowledge and never names a source.
//
// Prompt cache: the line must stay byte-identical between turns. Each profile is probed ONCE, before its first app
// turn, and the answer is kept for the process lifetime (a toolset change needs a bridge restart, like the image keys).
// A failed probe (old Hermes without the route, timeout, 401) is "unknown": no `web=` key at all, exactly like an older
// bridge; it is retried at most every RETRY_MS, so a Hermes that comes up later still gets its line.
//
// BRIDGE_WEB_TOOLS=on|off pins the value without a probe (setups where /v1/toolsets does not reflect what the model
// gets, e.g. web search only through an MCP server); `auto` (default) probes.
import { CAPS_MARKER } from './caps.mjs';

const PROBE_TIMEOUT_MS = 3000;
const RETRY_MS = 60_000;
const RESPONSE_MAX = 512 * 1024;

/** Tool names that search or read the web (Hermes built-ins, Web Search Plus, X search, browser automation). */
const WEB_TOOL = /^(web_search|web_extract|web_search_plus|web_extract_plus|x_search|browser|browser_.+)$/;
/** Plugin toolsets whose tools we do not know by name: a name that says web / search / crawl is taken as web. */
const WEB_TOOLSET = /(^|[_-])(web|search|crawl|scrape|browse|browser|fetch)([_-]|$)/;

/** @param {Record<string, string|undefined>} env  @returns {'on'|'off'|'auto'} */
export function webToolsSetting(env) {
  const v = String(env.BRIDGE_WEB_TOOLS ?? 'auto').trim().toLowerCase();
  if (v === '' || v === 'auto') return 'auto';
  if (['on', '1', 'true', 'yes'].includes(v)) return 'on';
  if (['off', '0', 'false', 'no'].includes(v)) return 'off';
  throw new Error('BRIDGE_WEB_TOOLS must be auto|on|off');
}

/**
 * `GET /v1/toolsets` body → 'on' | 'off', or null when the body is not the expected list (= unknown).
 * @param {unknown} body
 * @returns {'on'|'off'|null}
 */
export function webFromToolsets(body) {
  const data = body && typeof body === 'object' ? /** @type {{data?: unknown}} */ (body).data : undefined;
  if (!Array.isArray(data)) return null;
  for (const ts of data) {
    if (!ts || typeof ts !== 'object') continue;
    const { name, enabled, configured, tools } = /** @type {Record<string, unknown>} */ (ts);
    // `configured` false = the toolset's keys are missing: Hermes drops its tools from the model's list
    if (enabled !== true || configured === false) continue;
    const names = Array.isArray(tools) ? tools.filter((t) => typeof t === 'string') : [];
    if (names.some((t) => WEB_TOOL.test(t))) return 'on';
    if (typeof name === 'string' && (name === 'web' || (!names.length && WEB_TOOLSET.test(name)))) return 'on';
  }
  return 'off';
}

/**
 * The caps line of `bootstrap` with ` web=<value>` added (unchanged for an unknown value, without a caps line, or when
 * the line already names web). Pure, so the same input always gives the same bytes.
 * @param {string|null} bootstrap  @param {'on'|'off'|null|undefined} web
 */
export function withWebCap(bootstrap, web) {
  if (!bootstrap || (web !== 'on' && web !== 'off')) return bootstrap;
  const lines = bootstrap.split('\n');
  const i = lines.findIndex((l) => l.startsWith(`${CAPS_MARKER} `));
  if (i === -1 || /(^|\s)web=/.test(lines[i])) return bootstrap;
  lines[i] = `${lines[i]} web=${web}`;
  return lines.join('\n');
}

/**
 * Per-profile web capability, probed once.
 * @param {{baseUrl: string, apiKey?: string, setting?: 'on'|'off'|'auto', fetch?: typeof fetch, now?: () => number,
 *   timeoutMs?: number, log?: {info: Function, warn: Function}}} o
 */
export function createWebCaps(o) {
  const setting = o.setting ?? 'auto';
  const doFetch = o.fetch ?? ((...a) => fetch(...a));
  const now = o.now ?? Date.now;
  const timeoutMs = o.timeoutMs ?? PROBE_TIMEOUT_MS;
  /** @type {Map<string, 'on'|'off'>} */
  const known = new Map();
  /** @type {Map<string, Promise<'on'|'off'|null>>} */
  const inflight = new Map();
  /** @type {Map<string, number>} */
  const failedAt = new Map();

  async function probe(profile) {
    const base = o.baseUrl.replace(/\/+$/, '');
    const url = `${base}${profile ? `/p/${profile}` : ''}/v1/toolsets`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      /** @type {Record<string, string>} */
      const headers = { accept: 'application/json' };
      if (o.apiKey) headers.authorization = `Bearer ${o.apiKey}`;
      const r = await doFetch(url, { headers, signal: ac.signal });
      if (!r.ok) return { web: null, why: `http ${r.status}` };
      const text = await r.text();
      if (text.length > RESPONSE_MAX) return { web: null, why: 'too large' };
      let body;
      try { body = JSON.parse(text); } catch { return { web: null, why: 'not json' }; }
      const web = webFromToolsets(body);
      return { web, why: web ? '' : 'unexpected shape' };
    } catch (err) {
      return { web: null, why: ac.signal.aborted ? 'timeout' : String(err?.code ?? err?.message ?? err).slice(0, 80) };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    setting,
    /**
     * web capability of a profile (null / 'default' = the unprefixed one): 'on' | 'off', or null = unknown.
     * @param {string|null} [profile]
     * @returns {Promise<'on'|'off'|null>}
     */
    async get(profile = null) {
      if (setting !== 'auto') return setting;
      const key = profile && profile !== 'default' ? profile : '';
      const hit = known.get(key);
      if (hit) return hit;
      const last = failedAt.get(key);
      if (last !== undefined && now() - last < RETRY_MS) return null;
      let p = inflight.get(key);
      if (!p) {
        p = probe(key).then(({ web, why }) => {
          inflight.delete(key);
          if (web) {
            known.set(key, web);
            failedAt.delete(key);
            o.log?.info('web_caps', { profile: key || 'default', web });
          } else {
            failedAt.set(key, now());
            o.log?.warn('web_caps_unknown', { profile: key || 'default', why });
          }
          return web;
        });
        inflight.set(key, p);
      }
      return p;
    },
    /** what is known so far, for /bridge/status: {default: 'off', writer: 'on'} */
    snapshot() {
      if (setting !== 'auto') return { '*': setting };
      return Object.fromEntries([...known].map(([k, v]) => [k || 'default', v]));
    },
  };
}
