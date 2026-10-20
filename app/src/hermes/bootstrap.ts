/**
 * Bootstrap system message, sent as the FIRST message (role: system) of every
 * POST /v1/chat/completions when talking directly to Hermes (also when continuing a session with
 * X-Hermes-Session-Id: Hermes turns system messages into an ephemeral system prompt and does not
 * persist them). Keep byte-identical across requests (prompt caching).
 *
 * Verbatim copy of hermes-skill/bootstrap-system-message.txt (owned by the skill workstream);
 * bootstrap.test.ts fails if the two drift apart. Disable with `conn.bootstrap = false`
 * when the connection points to the UI bridge (it injects the message itself).
 */
export const BOOTSTRAP_SYSTEM_MESSAGE =
  '[hermes-ui-app] Client: Hermes UI app (renders Markdown plus ```hui and ```hui-html blocks; this overrides any plain-text assumption). The core of skill hermes-ui usually follows inline as the next system message. When a [hermes-ui-skill] system message is present, do NOT call skill_view for SKILL.md (already loaded): follow it, and use skill_view only for references/<ref>.md, as skill_view("hermes-ui", file_path="references/<ref>.md") when it names one. If it is missing, load skill hermes-ui with skill_view on the first turn of a conversation, before answering anything beyond a short chat reply, and again if its content is no longer in your context (pruned). Follow a UI-ROUTER-HINT line. Never answer with a wall of text: the key result first in 1-3 sentences, then short paragraphs, headings, lists or a table. Each ```hui block is ONE JSON node object with "type" at top level (no envelope, no array).\n';

/**
 * Capability line of this app, sent as its own constant system message right after the bootstrap on Hermes chats with
 * the session API (live cards need Hermes' session history as the shared source of truth). A separate message, not a
 * clause in the bootstrap: the UI bridge injects the old bootstrap text for clients without the marker, and an old app
 * never sends this line, so Hermes only writes live cards (`"live":true`, references/live.md) for apps that render them.
 * Byte-identical on every turn (prompt cache).
 */
export const HERMES_FEATURES_MESSAGE = '[hermes-ui-app] Features: live-cards. Live cards: only with this line, see references/live.md.';
