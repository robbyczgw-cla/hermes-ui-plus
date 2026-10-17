// TypeSafe System One ("Jev") backend: preset over the shared System One client (systemone.mjs).
import { SYSTEMONE_CHOICES, SYSTEMONE_PROVIDERS, createSystemOneBackend, systemOneUrl } from './systemone.mjs';

export const JEV_URL = systemOneUrl(SYSTEMONE_PROVIDERS.jev.base);
export const JEV_CHOICES = SYSTEMONE_CHOICES;

/** @param {{apiKey: string, model?: string, url?: string, timeoutMs?: number, fetchImpl?: typeof fetch}} opts */
export function createJevBackend(opts) {
  return createSystemOneBackend({ provider: 'jev', apiKey: opts.apiKey, model: opts.model, baseUrl: opts.url, timeoutMs: opts.timeoutMs, fetchImpl: opts.fetchImpl });
}
