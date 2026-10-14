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
  '[hermes-ui-app] Client: Hermes UI app (renders Markdown plus ```hui and ```hui-html blocks; this overrides any plain-text assumption). On the first turn of a conversation, before answering anything beyond a short chat reply, load skill hermes-ui with skill_view (it decides when a block helps and how to format text); load it again if its content is no longer in your context (pruned). Never answer with a wall of text: the key result first in 1-3 sentences, then short paragraphs, headings, lists or a table. Each ```hui block is ONE JSON node object with "type" at top level (no envelope, no array).\n';
