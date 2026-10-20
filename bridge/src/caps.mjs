// Bridge capabilities for the model: ONE constant line appended to the bootstrap system message the bridge injects
// on app turns, e.g. `[hermes-ui-caps] image_search=off`. The hermes-ui skill reads it (SKILL.md "Images"): with
// image_search=off the app cannot resolve query-only `source:"web"` images (no Serper/Brave key on the bridge), so the
// model uses image URLs its own tools returned instead.
//
// Computed once from the environment at startup (src/config.mjs) and never changed while the process runs, so the
// bootstrap message stays byte-identical on every turn (provider prompt cache, see src/router/hint.mjs). No line at all
// (older bridge, direct connection, client that sent its own bootstrap) means "unknown": the skill treats it like on.
import { imageSearchAvailable } from './images.mjs';

/** First characters of the capability line; a bootstrap file that already carries one is left alone. */
export const CAPS_MARKER = '[hermes-ui-caps]';

/**
 * @param {Record<string, string|undefined>} env
 * @returns {{image_search: 'on'|'off'}}  fixed key order (the line must not change between turns)
 */
export function bridgeCaps(env) {
  return { image_search: imageSearchAvailable(env) ? 'on' : 'off' };
}

/** @param {Record<string, string>} caps  @returns {string} e.g. `[hermes-ui-caps] image_search=off` */
export function capsLine(caps) {
  return `${CAPS_MARKER} ${Object.entries(caps).map(([k, v]) => `${k}=${v}`).join(' ')}`;
}

/** Bootstrap text with the capability line as its last line (unchanged when it already has one, or when empty). */
export function withCaps(bootstrap, caps) {
  if (!bootstrap || bootstrap.includes(CAPS_MARKER)) return bootstrap;
  return `${bootstrap}\n${capsLine(caps)}`;
}
