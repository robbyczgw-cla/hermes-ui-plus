// Connection check → actionable diagnostics (onboarding v2 + Settings "Verbindung prüfen"). Pure; tested in diagnose.test.ts.
// - adviceForError: a failed probe → ONE primary fix (title/text via i18n `onboarding.diag.advice.<id>.*`) + buttons
// - adviceForSuccess: a working connection that still lacks something (skill, Hermes version, bridge)
// - detectedItems: what was found (Hermes version, bridge, router, voice, image search, push, skill, models)
import { isTailnetHost, type ConnError, type Platform } from './errors.ts';
import type { Features } from './features.ts';
import type { ProbeResult } from './probe.ts';
import type { NormalizedUrl } from './url.ts';
import { isPrivateHost } from './url.ts';

/** Hermes Agent version the app is built against (docs/SELF-HOSTING.md: "v0.21 or newer"). */
export const MIN_HERMES_VERSION = '0.21.0';

export type AdviceId =
  | 'tailscale' | 'dns' | 'timeout' | 'network' | 'emulator' | 'apiDisabled' | 'tls' | 'cleartext' | 'mixedContent'
  | 'cors' | 'corsBridge' | 'unauthorized' | 'bridgeToken' | 'keyMissing' | 'forbidden' | 'notFound' | 'rateLimited'
  | 'hermesDown' | 'server' | 'notHermes' | 'unknown'
  // success with gaps
  | 'skillMissing' | 'oldHermes' | 'noBridge';

export type AdviceAction =
  | 'openTailscale' // open the Tailscale app (store page with "Open" when installed)
  | 'copyTroubleshoot' // troubleshoot prompt for Hermes, prefilled with the error
  | 'copySkillPrompt' // "install the hermes-ui skill" prompt
  | 'copyUpdatePrompt' // "update Hermes" prompt
  | 'copyBridgeSetup' // bridge setup prompt
  | 'editKey'
  | 'editUrl'
  | 'useHttp' // switch https → http (private host, TLS failed)
  | 'useHttps' // switch http → https
  | 'retry';

export type Advice = { id: AdviceId; severity: 'error' | 'warning' | 'info'; actions: readonly AdviceAction[] };

export type DiagContext = {
  platform: Platform;
  url: Pick<NormalizedUrl, 'scheme' | 'host' | 'hostKind'>;
  /** bridge header seen (also on an error response) */
  bridge: boolean;
};

/** a failed probe → the one fix to show first */
export function adviceForError(err: ConnError, ctx: DiagContext): Advice {
  const e = (id: AdviceId, actions: AdviceAction[]): Advice => ({ id, severity: 'error', actions });
  const tailnet = isTailnetHost(err.host ?? ctx.url.host);
  const privateHost = isPrivateHost(ctx.url.host, ctx.url.hostKind);
  const native = ctx.platform === 'android' || ctx.platform === 'ios';
  const tailscale = () => e('tailscale', native ? ['openTailscale', 'retry'] : ['retry', 'copyTroubleshoot']);
  switch (err.kind) {
    case 'dns':
      return tailnet ? tailscale() : e('dns', ['editUrl', 'copyTroubleshoot']);
    case 'timeout':
      return tailnet ? tailscale() : e('timeout', ['retry', 'copyTroubleshoot']);
    case 'network':
      if (err.suspect === 'vpn' || tailnet) return tailscale();
      if (err.suspect === 'tls') return e('tls', privateHost ? ['useHttp', 'copyTroubleshoot'] : ['copyTroubleshoot']);
      if (err.suspect === 'emulator') return e('emulator', ['editUrl']);
      return e('network', ['retry', 'copyTroubleshoot']);
    case 'refused':
      return e('apiDisabled', ['copyTroubleshoot', 'retry']);
    case 'tls':
      return e('tls', ctx.url.scheme === 'https' && privateHost ? ['useHttp', 'copyTroubleshoot'] : ['copyTroubleshoot']);
    case 'cleartext':
      return e('cleartext', ['useHttps', 'copyTroubleshoot']);
    case 'mixedContent':
      return e('mixedContent', ['useHttps']);
    case 'cors':
      return e(ctx.bridge ? 'corsBridge' : 'cors', ['copyTroubleshoot']);
    case 'unauthorized':
      return e(ctx.bridge ? 'bridgeToken' : 'unauthorized', ['editKey', 'copyTroubleshoot']);
    case 'keyMissing':
      return e('keyMissing', ['editKey']);
    case 'forbidden':
      return e('forbidden', ['editKey', 'copyTroubleshoot']);
    case 'notFound':
      return e('notFound', ['editUrl', 'copyTroubleshoot']);
    case 'rateLimited':
      return e('rateLimited', ['retry']);
    case 'server':
      // bridge up, Hermes behind it not (bridge answers 502 upstream_unavailable)
      if (ctx.bridge && (err.status === 502 || err.status === 503 || err.status === 504)) return e('hermesDown', ['copyTroubleshoot', 'retry']);
      return e('server', ['copyTroubleshoot', 'retry']);
    case 'notHermes':
      return e('notHermes', ['editUrl']);
    default:
      return e('unknown', ['retry', 'copyTroubleshoot']);
  }
}

/** "0.21.4", "v0.22", "0.21.0-rc1" → [0,21,4]; null if there is no leading number */
export function parseVersion(v: string | undefined | null): number[] | null {
  const m = /^\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(v ?? '');
  return m ? [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)] : null;
}

/** <0 / 0 / >0; null when one side has no version number */
export function compareVersions(a: string | undefined | null, b: string | undefined | null): number | null {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

export function isOldHermes(probe: Pick<ProbeResult, 'version' | 'hermes'>, f?: Pick<Features, 'capabilities'> | null): boolean {
  const cmp = probe.hermes ? compareVersions(probe.version, MIN_HERMES_VERSION) : null;
  if (cmp !== null) return cmp < 0;
  return probe.hermes && f?.capabilities === false;
}

/** a working connection: what is still missing (most important first) */
export function adviceForSuccess(probe: ProbeResult, f: Features | null): Advice[] {
  const out: Advice[] = [];
  if (f?.skill === false) out.push({ id: 'skillMissing', severity: 'warning', actions: ['copySkillPrompt'] });
  if (isOldHermes(probe, f)) out.push({ id: 'oldHermes', severity: 'warning', actions: ['copyUpdatePrompt'] });
  if (!probe.bridge) out.push({ id: 'noBridge', severity: 'info', actions: ['copyBridgeSetup'] });
  return out;
}

export type DetectedId = 'hermes' | 'bridge' | 'router' | 'voice' | 'images' | 'push' | 'skill' | 'models';
export type DetectedItem = { id: DetectedId; state: 'ok' | 'off' | 'unknown'; value?: string | number };

const tri = (v: boolean | null | undefined): DetectedItem['state'] => (v === true ? 'ok' : v === false ? 'off' : 'unknown');

export function detectedItems(probe: ProbeResult, f: Features | null): DetectedItem[] {
  const items: DetectedItem[] = [];
  items.push({ id: 'hermes', state: probe.hermes ? (isOldHermes(probe, f) ? 'off' : 'ok') : 'unknown', value: probe.version });
  items.push({ id: 'bridge', state: probe.bridge ? 'ok' : 'off' });
  if (probe.bridge) {
    items.push({ id: 'router', state: tri(f?.router) });
    items.push({ id: 'voice', state: tri(f?.voice) });
    items.push({ id: 'images', state: tri(f?.images) });
    items.push({ id: 'push', state: tri(f?.push) });
  }
  items.push({ id: 'skill', state: tri(f?.skill) });
  const count = probe.catalog?.models ?? probe.models.length;
  items.push({ id: 'models', state: count > 0 ? 'ok' : 'unknown', value: count });
  return items;
}

export type Diagnosis = { status: 'ok' | 'warning' | 'error'; advice: Advice[]; detected: DetectedItem[] };

export function diagnose(probe: ProbeResult, f: Features | null, ctx: Omit<DiagContext, 'bridge'>): Diagnosis {
  if (!probe.ok) {
    const err = probe.error ?? { kind: 'unknown' as const };
    return { status: 'error', advice: [adviceForError(err, { ...ctx, bridge: probe.bridge })], detected: [] };
  }
  const advice = adviceForSuccess(probe, f);
  return { status: advice.some((a) => a.severity === 'warning') ? 'warning' : 'ok', advice, detected: detectedItems(probe, f) };
}
