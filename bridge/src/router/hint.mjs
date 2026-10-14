// Ephemeral presentation hint appended as a system message for ONE turn.
// Format agreed with the hermes-ui skill (hermes-skill/hermes-ui/SKILL.md):
//   UI-ROUTER-HINT: format=<f> [component=<c>] confidence=<0-1> [data=live] [- <reason>]
// Hermes appends all request system messages to the END of its cached system prompt
// (ephemeral_system_prompt, never persisted). Any change of these bytes between turns
// invalidates the provider prompt cache for the conversation history that follows, so the
// line is kept deterministic: confidence is bucketed and the reason is omitted by default.

/** Formats whose content must come from tools (current prices, places, weather): the hint says so explicitly. */
export const LIVE_DATA_FORMATS = new Set(['products', 'places', 'weather']);

/** Bucket confidence so the hint text only changes when the decision materially changes. */
export function bucketConfidence(c) {
  return c >= 0.8 ? '0.9' : c >= 0.5 ? '0.6' : '0.3';
}

/**
 * @param {{format: string, component?: string, confidence: number, reason?: string}} d
 * @param {{minConfidence?: number, textMinConfidence?: number, includeReason?: boolean}} [o]
 * @returns {string|null} null => do not inject anything for this decision.
 */
export function buildHint(d, o = {}) {
  const min = o.minConfidence ?? 0.5;
  const textMin = o.textMinConfidence ?? 0.75;
  if (d.format === 'text' ? d.confidence < textMin : d.confidence < min) return null;
  let line = `UI-ROUTER-HINT: format=${d.format}`;
  if (d.component) line += ` component=${d.component}`;
  line += ` confidence=${bucketConfidence(d.confidence)}`;
  // deterministic per format (prompt cache): models otherwise answer product/place questions from memory
  if (LIVE_DATA_FORMATS.has(d.format)) line += ' data=live';
  if (o.includeReason && d.reason) line += ` - ${d.reason.replace(/[\r\n]+/g, ' ').slice(0, 120)}`;
  return line;
}

/**
 * Prepend the constant bootstrap system message (unless the client already sent the marker)
 * and append the hint after the leading system messages. Returns a new array; no mutation.
 * Hermes concatenates all system messages in order into the ephemeral system prompt.
 * @param {any[]} messages
 * @param {{bootstrap?: string|null, bootstrapMarker?: string, hint?: string|null}} o
 */
export function applySystemMessages(messages, o) {
  let out = [...messages];
  if (o.bootstrap) {
    const marker = o.bootstrapMarker ?? '[hermes-ui-app] Client:';
    const has = out.some((m) => m?.role === 'system' && typeof m.content === 'string' && m.content.includes(marker));
    if (!has) out = [{ role: 'system', content: o.bootstrap }, ...out];
  }
  if (o.hint) {
    let i = 0;
    while (i < out.length && out[i]?.role === 'system') i++;
    out = [...out.slice(0, i), { role: 'system', content: o.hint }, ...out.slice(i)];
  }
  return out;
}
