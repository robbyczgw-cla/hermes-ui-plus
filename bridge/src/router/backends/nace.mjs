// Nace.AI Drex backend: preset over the shared System One client (systemone.mjs). Drex serves the same
// `POST /v1/systemone` API as TypeSafe; base https://console.nace.ai, `Authorization: Bearer <NACE_API_KEY>`,
// models drex-v1.0 / drex-v1.5 / drex-v2.0 (drex-latest = v2.0). Bills input tokens only.
import { createSystemOneBackend } from './systemone.mjs';

/** @param {{apiKey: string, model?: string, baseUrl?: string, timeoutMs?: number, fetchImpl?: typeof fetch}} opts */
export function createNaceBackend(opts) {
  return createSystemOneBackend({ provider: 'nace', ...opts });
}
