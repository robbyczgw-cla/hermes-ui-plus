// One-time pair codes are redeemed only when the user taps "Verbinden" on the connection screen (review: a code
// spent on scan / deep-link mount was lost on Back or an app kill before saving). Scanning a QR code or opening a
// deep link only shows the target (host + bridge name from the link); nothing is POSTed before that tap.
// Pure (fetch injected) → tested in pairConnect.test.ts.
import type { TKey } from '../i18n/core.ts';
import type { ConnectionProfile } from '../settings/profiles.ts';
import type { PairData, PairResult } from './pairLink.ts';
import { redeemPairCode, type RedeemErrorCode, type RedeemOptions } from './pairRedeem.ts';
import { samePairTarget } from './pairRecovery.ts';

/** where a parsed pair link goes: valid (with or without a one-time code) → the confirmation form; else the scanner */
export function deepLinkRoute(r: PairResult): 'form' | 'scan' {
  return r.ok ? 'form' : 'scan';
}

/** the pair still carries an unredeemed one-time code: the form shows the target and waits for "Verbinden" */
export function pairPending(pair: PairData | null | undefined): boolean {
  return !!pair?.code;
}

export type ConnectRedeemResult =
  | { ok: true; pair: PairData }
  /** `final`: the link is used up (expired / already used) – only a new link helps */
  | { ok: false; error: RedeemErrorCode; messageKey: TKey; final: boolean };

/** Tap on "Verbinden": trade the one-time code for the device token (a pair without a code passes unchanged). */
export async function redeemOnConnect(pair: PairData, opts: RedeemOptions = {}): Promise<ConnectRedeemResult> {
  const r = await redeemPairCode(pair, opts);
  if (r.ok) return r;
  return { ok: false, error: r.error, messageKey: `onboarding.redeem.${r.error}`, final: r.error === 'expired' };
}

export type PairConnectOutcome =
  /** saved: the flow moves on (consent / skill / finish) */
  | { phase: 'saved'; pair: PairData }
  | { phase: 'redeem-failed'; error: RedeemErrorCode; messageKey: TKey; final: boolean }
  /** the code is spent, the device token is in `pair` (no code): retry with connectPairCode(pair, …) – it only saves */
  | { phase: 'save-failed'; pair: PairData; error: unknown };

const sameBase = (a: string, b: string) => a.replace(/\/+$/, '').toLowerCase() === b.replace(/\/+$/, '').toLowerCase();

/**
 * The connection a one-time code already led to on this device: the code was redeemed here (`spent`, see
 * storage.markPairCodeSpent) AND a saved profile for the same backend + base URL (+ model for model-bound kinds) has a
 * key → the pair with that key instead of the code, else null (the normal redeem runs). E2E round 5, N1: a connect
 * screen shown again for an already redeemed code continued with "Kopplungslink abgelaufen" although the app was
 * connected. Nothing saved, but the device token of that redeem is still kept as pending recovery (`pending`, a
 * save failed, pairRecovery.ts) → continue with that token.
 */
export async function resumeSpentPair(
  pair: PairData,
  deps: {
    spent: (code: string) => Promise<boolean>;
    profiles: readonly ConnectionProfile[];
    pending?: () => Promise<PairData | null> | PairData | null;
  },
): Promise<PairData | null> {
  if (!pair.code) return null;
  if (!(await deps.spent(pair.code).catch(() => false))) return null;
  const saved = deps.profiles.find(
    (p) => p.kind === pair.kind && !!p.apiKey && sameBase(p.baseUrl, pair.url.baseUrl) && (p.kind === 'hermes' || (p.model ?? '') === pair.model),
  );
  if (saved) return { ...pair, code: '', token: saved.apiKey };
  const pending = deps.pending;
  const kept = pending ? await Promise.resolve().then(() => pending()).catch(() => null) : null;
  return kept?.token && samePairTarget(kept, pair) ? { ...pair, code: '', token: kept.token } : null;
}

export type PairConnectDeps = {
  /** persist the connection (the flow's onConnected); may reject */
  save(pair: PairData): Promise<void> | void;
  /**
   * the code was redeemed: keep the device token durably as pending recovery (storage.keepPairRecovery) – awaited
   * BEFORE the code is marked used and before the save, errors ignored; a failed save + Back can not lose it
   */
  keep?(pair: PairData): Promise<void> | void;
  /** the code was redeemed: remember it as used, so the same link is never offered again (awaited, errors ignored) */
  spent?(code: string): Promise<void> | void;
  /** the device token arrived (the screen shows it / its busy state); called before the save */
  redeemed?(pair: PairData): void;
  /** the code was already redeemed on this device and its connection saved: that pair (token, no code) or null (resumeSpentPair) */
  resume?(pair: PairData): Promise<PairData | null> | PairData | null;
  /** navigation lock held for the whole run (connectLock.ts); gets the code being redeemed (links carrying it are dropped) */
  hold?: (code?: string) => () => void;
  redeemOptions?: RedeemOptions;
};

/**
 * Tap on "Verbinden": redeem → mark the code used → save, as ONE run that does not depend on the screen staying
 * mounted (E2E round 4, B1/B2: the code is burned on the bridge as soon as the redeem went through – from then on the
 * device token is the only way in, so it is always saved, whatever happens to the UI meanwhile). The device token
 * comes from the bridge itself, so no extra connection test gates the save (it only made the window longer).
 */
export async function connectPairCode(pair: PairData, deps: PairConnectDeps): Promise<PairConnectOutcome> {
  const release = deps.hold?.(pair.code || undefined);
  try {
    // spent here before and saved: continue with the saved connection, never send the used code again
    const resumed = pair.code && deps.resume ? await Promise.resolve(deps.resume(pair)).catch(() => null) : null;
    const r = resumed ? ({ ok: true, pair: resumed } as const) : await redeemOnConnect(pair, deps.redeemOptions);
    if (!r.ok) return { phase: 'redeem-failed', error: r.error, messageKey: r.messageKey, final: r.final };
    if (pair.code && !resumed) {
      await Promise.resolve()
        .then(() => deps.keep?.(r.pair))
        .catch(() => {});
      await Promise.resolve(deps.spent?.(pair.code)).catch(() => {});
    }
    try {
      deps.redeemed?.(r.pair);
    } catch {
      // a UI callback must never stop the save
    }
    try {
      await deps.save(r.pair);
      return { phase: 'saved', pair: r.pair };
    } catch (error) {
      return { phase: 'save-failed', pair: r.pair, error };
    }
  } finally {
    release?.();
  }
}
