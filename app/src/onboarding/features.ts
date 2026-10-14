// What a reachable server offers beyond chat (shown in the connection check, onboarding v2 + Settings).
// Runs after a successful probeConnection(): small authenticated GETs in parallel, every one fail-soft
// (null = unknown: endpoint missing, blocked by CORS, timeout). Never logs or returns the key.
// Pure core with an injectable fetch → tested in features.test.ts.
import type { FetchLike } from './probe.ts';
import type { NormalizedUrl } from './url.ts';

export type Features = {
  /** bridge `/bridge/status` → router active */
  router: boolean | null;
  /** bridge `/bridge/voice/config` → speech-to-text or text-to-speech has a key */
  voice: boolean | null;
  /** bridge `/bridge/images/config` → an image search provider is configured */
  images: boolean | null;
  /** bridge `/bridge/push/config` → at least one push platform */
  push: boolean | null;
  /** `hermes-ui` skill installed (bridge status `skill`, else Hermes `GET /v1/skills`) */
  skill: boolean | null;
  /** Hermes `GET /v1/capabilities` answered (false = 404 → Hermes too old for the full feature set) */
  capabilities: boolean | null;
};

export const NO_FEATURES: Features = { router: null, voice: null, images: null, push: null, skill: null, capabilities: null };

export const UI_SKILL_NAME = 'hermes-ui';

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** `/bridge/status` body → router + (newer bridges) skill state. */
export function parseBridgeStatus(body: unknown): { router: boolean | null; skill: boolean | null } {
  if (!isObj(body)) return { router: null, skill: null };
  const router = 'router' in body ? !!body.router : null;
  let skill: boolean | null = null;
  const s = body.skill;
  if (typeof s === 'boolean') skill = s;
  else if (isObj(s) && typeof s.installed === 'boolean') skill = s.installed;
  return { router, skill };
}

/** `/bridge/voice/config` → true if STT or TTS is usable. Older bridges have no `available` flags → provider set = on. */
export function parseVoiceAvailable(body: unknown): boolean | null {
  if (!isObj(body)) return null;
  const part = (p: unknown): boolean => {
    if (!isObj(p)) return false;
    if (typeof p.available === 'boolean') return p.available;
    return typeof p.provider === 'string' && !!p.provider;
  };
  return part(body.stt) || part(body.tts);
}

export function parseImagesAvailable(body: unknown): boolean | null {
  if (!isObj(body)) return null;
  if (typeof body.available === 'boolean') return body.available;
  return Array.isArray(body.providers) ? body.providers.length > 0 : null;
}

export function parsePushAvailable(body: unknown): boolean | null {
  if (!isObj(body) || !isObj(body.platforms)) return null;
  const p = body.platforms;
  return !!(p.fcm === true || p.apns === true || (isObj(p.webpush) && typeof p.webpush.vapidPublicKey === 'string'));
}

/** `GET /v1/skills` (`{data:[{name}]}` or a bare array) → is the `hermes-ui` skill there? null = unknown shape. */
export function hasUiSkill(body: unknown): boolean | null {
  const list = isObj(body) && Array.isArray(body.data) ? body.data : Array.isArray(body) ? body : isObj(body) && Array.isArray(body.skills) ? body.skills : null;
  if (!list) return null;
  return list.some((s) => (typeof s === 'string' ? s : isObj(s) ? s.name ?? s.id : null) === UI_SKILL_NAME);
}

export async function probeFeatures(
  conn: { url: NormalizedUrl; apiKey: string },
  opts: { bridge: boolean; fetchImpl?: FetchLike; timeoutMs?: number; signal?: AbortSignal },
): Promise<Features> {
  const doFetch: FetchLike = opts.fetchImpl ?? ((u, i) => fetch(u, i));
  const timeoutMs = opts.timeoutMs ?? 5000;
  const key = conn.apiKey.trim();

  /** body (parsed JSON) on 2xx, 'missing' on 404/405, null otherwise */
  async function get(url: string): Promise<unknown> {
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    opts.signal?.addEventListener('abort', onAbort);
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (key) headers.Authorization = `Bearer ${key}`;
      const res = await doFetch(url, { method: 'GET', headers, signal: ctrl.signal });
      if (res.status === 404 || res.status === 405) return 'missing';
      if (!res.ok) return null;
      const text = await res.text().catch(() => '');
      if (text.length > 1024 * 1024) return null;
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
    }
  }

  const root = conn.url.root;
  const b = opts.bridge;
  const none = Promise.resolve(null);
  const [status, voice, images, push, skills, caps] = await Promise.all([
    b ? get(`${root}/bridge/status`) : none,
    b ? get(`${root}/bridge/voice/config`) : none,
    b ? get(`${root}/bridge/images/config`) : none,
    b ? get(`${root}/bridge/push/config`) : none,
    get(`${conn.url.baseUrl}/skills`),
    get(`${conn.url.baseUrl}/capabilities`),
  ]);
  const real = (v: unknown) => (v === 'missing' ? null : v);
  const st = parseBridgeStatus(real(status));
  const listed = hasUiSkill(real(skills));
  return {
    router: st.router,
    voice: voice === 'missing' ? false : parseVoiceAvailable(voice),
    images: images === 'missing' ? false : parseImagesAvailable(images),
    push: push === 'missing' ? false : parsePushAvailable(push),
    skill: st.skill ?? listed,
    capabilities: caps === 'missing' ? false : caps === null ? null : true,
  };
}
