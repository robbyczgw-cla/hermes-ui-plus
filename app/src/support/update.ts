/**
 * Update notice: semver compare, the once-a-day throttle, the GitHub release payload and the platform's download
 * target. Pure (update.test.ts); the fetch + storage side lives in updateStore.ts.
 *
 * The only request is an unauthenticated GET to api.github.com for the public repository's releases (PRIVACY.md).
 * Installed prereleases (`0.1.0-alpha.1`) ask for the release list, because `/releases/latest` never returns a
 * prerelease; stable installs ask for `/releases/latest` only.
 */

export type Semver = { major: number; minor: number; patch: number; pre: (string | number)[] };

const SEMVER = /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/;

/** `1.2.3`, `v1.2.3-alpha.1`, `1.2.3+42` → parts; anything else → null. Build metadata is ignored (semver §10). */
export function parseSemver(raw: string | null | undefined): Semver | null {
  const m = SEMVER.exec((raw ?? '').trim());
  if (!m) return null;
  const pre = m[4] ? m[4].split('.').map((id) => (/^\d+$/.test(id) ? Number(id) : id)) : [];
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre };
}

const sign = (n: number): -1 | 0 | 1 => (n < 0 ? -1 : n > 0 ? 1 : 0);

/** Semver precedence (§11): a prerelease sorts before its release; numeric ids < alphanumeric ids; longer list wins. */
export function compareSemver(a: Semver, b: Semver): -1 | 0 | 1 {
  for (const k of ['major', 'minor', 'patch'] as const) if (a[k] !== b[k]) return sign(a[k] - b[k]);
  if (!a.pre.length || !b.pre.length) return sign(b.pre.length - a.pre.length);
  for (let i = 0; i < Math.min(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i];
    const y = b.pre[i];
    if (x === y) continue;
    if (typeof x === 'number' && typeof y === 'number') return sign(x - y);
    if (typeof x === 'number') return -1;
    if (typeof y === 'number') return 1;
    return x < y ? -1 : 1;
  }
  return sign(a.pre.length - b.pre.length);
}

/** Is `latest` newer than `installed`? Unparsable versions never count as an update. */
export function isNewer(latest: string | null | undefined, installed: string | null | undefined): boolean {
  const l = parseSemver(latest);
  const i = parseSemver(installed);
  return !!l && !!i && compareSemver(l, i) > 0;
}

// ---------------------------------------------------------------- throttle + persisted state

export const CHECK_INTERVAL_MS = 24 * 60 * 60_000;

export type ReleaseInfo = { version: string; pageUrl: string; apkUrl: string | null };

export type UpdateState = {
  /** "Check for updates" (default on) */
  enabled: boolean;
  /** last attempt (success or failure), ms since epoch; 0 = never */
  lastCheckAt: number;
  /** newest release seen by the last successful check */
  latest: ReleaseInfo | null;
  /** version whose chat toast was shown (one toast per version) */
  toastShownFor: string | null;
};

export const DEFAULT_UPDATE_STATE: Readonly<UpdateState> = Object.freeze({ enabled: true, lastCheckAt: 0, latest: null, toastShownFor: null });

/**
 * May the app ask GitHub now? Only when the setting is on, the device does not report being offline, and the last
 * attempt is at least a day old. A last attempt in the future (clock set back) does not block for longer than a day.
 */
export function shouldCheck(s: Pick<UpdateState, 'enabled' | 'lastCheckAt'>, now: number, o: { online?: boolean } = {}): boolean {
  if (!s.enabled || o.online === false) return false;
  if (!s.lastCheckAt) return true;
  const age = now - s.lastCheckAt;
  return age >= CHECK_INTERVAL_MS || age < -CHECK_INTERVAL_MS;
}

const isStr = (v: unknown): v is string => typeof v === 'string';

/** Stored JSON → valid state (defaults for anything missing or broken). */
export function sanitizeUpdateState(raw: unknown): UpdateState {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const latest = src.latest && typeof src.latest === 'object' ? (src.latest as Record<string, unknown>) : null;
  return {
    enabled: typeof src.enabled === 'boolean' ? src.enabled : DEFAULT_UPDATE_STATE.enabled,
    lastCheckAt: typeof src.lastCheckAt === 'number' && Number.isFinite(src.lastCheckAt) && src.lastCheckAt > 0 ? src.lastCheckAt : 0,
    latest:
      latest && isStr(latest.version) && parseSemver(latest.version) && isStr(latest.pageUrl) && /^https:\/\//.test(latest.pageUrl)
        ? { version: latest.version, pageUrl: latest.pageUrl, apkUrl: isStr(latest.apkUrl) && /^https:\/\//.test(latest.apkUrl) ? latest.apkUrl : null }
        : null,
    toastShownFor: isStr(src.toastShownFor) ? src.toastShownFor : null,
  };
}

// ---------------------------------------------------------------- GitHub releases

/** `https://github.com/<owner>/<repo>` → owner/repo, or null */
function repoPath(repoUrl: string | null | undefined): string | null {
  const m = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)\/?$/.exec(repoUrl ?? '');
  return m ? `${m[1]}/${m[2]}` : null;
}

/** API URL to ask: the release list for prerelease installs (latest skips prereleases), `/releases/latest` otherwise. */
export function releasesApiUrl(repoUrl: string | null | undefined, installed: string | null | undefined): string | null {
  const p = repoPath(repoUrl);
  if (!p) return null;
  return parseSemver(installed)?.pre.length ? `https://api.github.com/repos/${p}/releases?per_page=10` : `https://api.github.com/repos/${p}/releases/latest`;
}

function parseOne(json: unknown, repoUrl: string, allowPre: boolean): ReleaseInfo | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const r = json as Record<string, unknown>;
  if (r.draft === true || (r.prerelease === true && !allowPre)) return null;
  const tag = isStr(r.tag_name) ? r.tag_name.trim() : '';
  const semver = parseSemver(tag);
  if (!semver || (semver.pre.length && !allowPre)) return null;
  const base = `${repoUrl.replace(/\/$/, '')}/releases/`;
  // links only into the project's own releases (a tampered payload cannot send the user elsewhere)
  const pageUrl = isStr(r.html_url) && r.html_url.startsWith(base) ? r.html_url : `${base}tag/${encodeURIComponent(tag)}`;
  let apkUrl: string | null = null;
  if (Array.isArray(r.assets)) {
    for (const a of r.assets as unknown[]) {
      const asset = a && typeof a === 'object' ? (a as Record<string, unknown>) : {};
      const name = isStr(asset.name) ? asset.name : '';
      const url = isStr(asset.browser_download_url) ? asset.browser_download_url : '';
      if (/\.apk$/i.test(name) && !/debug|x86/i.test(name) && url.startsWith(`${base}download/`)) {
        apkUrl = url;
        break;
      }
    }
  }
  return { version: tag.replace(/^v/, ''), pageUrl, apkUrl };
}

/**
 * GitHub payload (one release from `/releases/latest`, or the list) → the newest usable release. Drafts are skipped;
 * prereleases only count for prerelease installs (`allowPre`).
 */
export function parseRelease(json: unknown, repoUrl: string, allowPre = false): ReleaseInfo | null {
  const list = Array.isArray(json) ? json : [json];
  let best: ReleaseInfo | null = null;
  for (const item of list) {
    const r = parseOne(item, repoUrl, allowPre);
    if (r && (!best || isNewer(r.version, best.version))) best = r;
  }
  return best;
}

// ---------------------------------------------------------------- where to update

/** apk: release APK (+ Obtainium hint) · release: release page · web: update the bridge's web bundle · none: no notice */
export type UpdateTarget = 'apk' | 'release' | 'web' | 'none';

export type UpdateEnv = {
  os: string;
  /** Tauri desktop app */
  desktop: boolean;
  /** store build (Google Play: EXPO_PUBLIC_BG_SERVICE=0); the store updates the app itself */
  storeBuild: boolean;
  flavor: string;
};

export function updateTarget(e: UpdateEnv): UpdateTarget {
  if (e.os === 'ios') return 'none'; // App Store / TestFlight update on their own
  if (e.os === 'android') {
    if (e.storeBuild) return 'none';
    // self-built personal builds have their own app id: the public APK would install a second app
    return e.flavor === 'hermes' ? 'apk' : 'release';
  }
  if (e.os === 'web') return e.desktop ? 'release' : 'web';
  return 'none';
}

/** What the notice should show: the newer release for this install, or null. */
export function pendingUpdate(s: Pick<UpdateState, 'enabled' | 'latest'>, installed: string | null | undefined, target: UpdateTarget): ReleaseInfo | null {
  if (!s.enabled || target === 'none' || !s.latest) return null;
  return isNewer(s.latest.version, installed) ? s.latest : null;
}
