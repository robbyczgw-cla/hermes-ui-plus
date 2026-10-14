// Pending recovery of a redeemed pair code (review: redeemed token lost after a save failure). The one-time code is
// spent on the bridge as soon as the redeem went through; from then on the device token is the only way in. If the
// profile save then fails and the user leaves the connect screen (Back / close / app kill), the token must not be
// lost while the link is already marked used. connectPairCode keeps it (storage.keepPairRecovery: the secure store,
// like the profile keys) BEFORE the code is marked used and before the save; the onboarding host offers it again (app
// start, flow opened again, the same link reopened) and a successful save of that token clears it.
// Stored as a token pair link: reopening it is the normal, fully validated connect path. Pure → pairRecovery.test.ts.
import { buildPairLink, parsePairLink, type PairData, type PairParseOptions } from './pairLink.ts';

const VERSION = 1;

export type PairRecovery = { link: string; pair: PairData };

/** the stored value for a redeemed pair (token, no code); null when there is nothing to keep */
export function serializePairRecovery(pair: PairData): string | null {
  if (!pair.token || pair.code) return null;
  const link = buildPairLink({
    url: pair.baseUrl,
    token: pair.token,
    name: pair.nameFromLink ? pair.name : undefined,
    kind: pair.kind,
    model: pair.model || undefined,
  });
  return JSON.stringify({ v: VERSION, link });
}

/** the kept connection, or null (nothing stored, unreadable, foreign, a link that is not a plain token link) */
export function parsePairRecovery(raw: string | null | undefined, opts: PairParseOptions = {}): PairRecovery | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== 'object') return null;
    const { v: version, link } = v as { v?: unknown; link?: unknown };
    if (version !== VERSION || typeof link !== 'string') return null;
    const r = parsePairLink(link, opts);
    if (!r.ok || !r.pair.token || r.pair.code) return null;
    return { link, pair: r.pair };
  } catch {
    return null;
  }
}

const sameBase = (a: string, b: string) => a.replace(/\/+$/, '').toLowerCase() === b.replace(/\/+$/, '').toLowerCase();

/** same backend + base URL (+ model for model-bound kinds): a connection for `b` may continue with `a`'s token */
export function samePairTarget(a: Pick<PairData, 'kind' | 'baseUrl' | 'model'>, b: Pick<PairData, 'kind' | 'baseUrl' | 'model'>): boolean {
  return a.kind === b.kind && sameBase(a.baseUrl, b.baseUrl) && (a.kind === 'hermes' || (a.model ?? '') === (b.model ?? ''));
}
