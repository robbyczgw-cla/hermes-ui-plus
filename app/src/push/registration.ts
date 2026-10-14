/**
 * Register / unregister this device for one profile (settings toggle, app start refresh).
 */
import type { TFn } from '../i18n/core';
import { fetchPushConfig, PushApiError, registerDevice, unregisterDevice, type PushServerConfig } from './api';
import { acquireDevice, devicePlatform, pushFetch } from './device';
import { pushServerKind, registrationBody, type PushPlatform, type PushProfile, type PushProfileSettings } from './model';
import { getPushSettings, setPushSettings } from './settingsStore';
import { completeRegistration, isCurrentRegistrationGen, nextRegistrationGen } from './registrationGuard';

export type PushStatus =
  | { kind: 'unsupported' } // profile/server cannot push
  | { kind: 'liveOnly'; platform: PushPlatform | null } // server reachable, but no credentials for this platform (inbox only)
  | { kind: 'denied' }
  | { kind: 'webUnsupported' }
  | { kind: 'registered'; platform: PushPlatform }
  | { kind: 'off' }
  | { kind: 'error'; error: string };

const configCache = new Map<string, { at: number; cfg: PushServerConfig | null }>();

/** Server push config (cached 5 min per server + key). null = no push/inbox support. */
export async function serverConfig(p: PushProfile, force = false): Promise<PushServerConfig | null> {
  if (!pushServerKind(p)) return null;
  const key = `${p.baseUrl}|${p.apiKey.slice(-6)}`;
  const hit = configCache.get(key);
  if (!force && hit && Date.now() - hit.at < 5 * 60_000) return hit.cfg;
  const cfg = await fetchPushConfig(pushFetch, p);
  configCache.set(key, { at: Date.now(), cfg });
  return cfg;
}

function tz(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

/** Register with the current settings (idempotent server-side). Updates the stored registration. */
export async function syncRegistration(p: PushProfile, t: TFn, locale: string): Promise<PushStatus> {
  if (!getPushSettings(p.id).enabled) return { kind: 'off' };
  const gen = nextRegistrationGen(p.id);
  let cfg: PushServerConfig | null;
  try {
    cfg = await serverConfig(p, true);
  } catch (e) {
    return { kind: 'error', error: String((e as Error)?.message ?? e) };
  }
  if (!cfg) return { kind: 'unsupported' };
  const platform = devicePlatform();
  if (!platform) return { kind: 'webUnsupported' };
  const available = platform === 'webpush' ? Boolean(cfg.platforms.webpush) : cfg.platforms[platform];
  if (!available) return { kind: 'liveOnly', platform };
  const dev = await acquireDevice(t, cfg.platforms.webpush?.vapidPublicKey);
  if (!dev.ok) return dev.reason === 'denied' ? { kind: 'denied' } : dev.reason === 'unsupported' ? { kind: 'webUnsupported' } : { kind: 'error', error: dev.error ?? 'device' };
  // current settings (switched off / changed while the config / device token were fetched)
  const s = getPushSettings(p.id);
  if (!s.enabled || !isCurrentRegistrationGen(p.id, gen)) return s.enabled ? { kind: 'registered', platform } : { kind: 'off' };
  try {
    const r = await registerDevice(pushFetch, p, dev.device, registrationBody(p, s, { locale, tz: tz() }));
    const outcome = await completeRegistration({
      profileId: p.id,
      gen,
      enabled: () => getPushSettings(p.id).enabled,
      store: () => setPushSettings(p.id, { registrationId: r.id, platform: r.platform, deviceKey: dev.deviceKey }),
      revoke: () => unregisterDevice(pushFetch, p, { id: r.id }).then(() => {}),
    });
    if (outcome === 'revoked') return { kind: 'off' };
    return { kind: 'registered', platform: r.platform };
  } catch (e) {
    if (e instanceof PushApiError && e.code === 'platform_not_configured') return { kind: 'liveOnly', platform };
    return { kind: 'error', error: String((e as Error)?.message ?? e) };
  }
}

/** Turn notifications off for a profile (server unregister is best effort). */
export async function disablePush(p: PushProfile): Promise<void> {
  const s: PushProfileSettings = getPushSettings(p.id);
  nextRegistrationGen(p.id); // a registration still in flight revokes itself (registrationGuard.ts)
  setPushSettings(p.id, { enabled: false, registrationId: undefined });
  if (!s.registrationId || !pushServerKind(p)) return;
  try {
    await unregisterDevice(pushFetch, p, { id: s.registrationId });
  } catch {
    /* server unreachable: the token stays registered until it fails or the app re-registers */
  }
}
