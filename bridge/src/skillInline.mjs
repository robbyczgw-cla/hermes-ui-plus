// Skill core inline (ADR 0001, addendum to decision 5): the bridge sends the text of hermes-ui/SKILL.md as ONE extra
// system message right after the bootstrap message on every app turn. Some models (seen with Claude Sonnet on Hermes
// v0.22) skip the skill_view call the bootstrap asks for and then ignore the router hint; with the core inline they
// have the protocol without a tool call. References stay on demand (skill_view("hermes-ui", file_path=...)).
//
// The message is built once at startup and is byte-identical on every turn, so Hermes / the provider keep it in the
// prompt cache (Hermes appends request system messages to the end of its cached system prompt, never persisted).
// Only app turns get it (= requests that carry the bootstrap message), only while the bootstrap is active.
//   BRIDGE_SKILL_INLINE=off   switch off (the bootstrap alone then asks the model to load the skill)
//   BRIDGE_SKILL_FILE=<path>  use this SKILL.md instead of the one next to the bootstrap message / repo / bundle
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** First characters of the inline message; also used to avoid adding it twice. */
export const SKILL_INLINE_MARKER = '[hermes-ui-skill]';

const SKILL_INLINE_HEADER = `${SKILL_INLINE_MARKER} Core of skill hermes-ui, inlined by the UI bridge for this app chat. `
  + 'It is already loaded: do not skill_view SKILL.md. Load a component reference with '
  + 'skill_view("hermes-ui", file_path="references/<ref>.md") when the table below names one.';

/** Remove a leading YAML front matter block (`---` ... `---`); normalises line endings, trims. */
export function stripFrontMatter(text) {
  const t = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const m = /^---[ \t]*\n[\s\S]*?\n---[ \t]*(?:\n|$)/.exec(t);
  return (m ? t.slice(m[0].length) : t).trim();
}

/** @returns {string|null} the system message for a SKILL.md text (null when the body is empty) */
export function buildSkillMessage(skillText) {
  const body = stripFrontMatter(skillText);
  return body ? `${SKILL_INLINE_HEADER}\n\n${body}` : null;
}

/**
 * Resolve and read the skill once (startup). Missing file: no injection, `skillInlineMissing` names the path
 * (the server logs a warning); chat keeps working with the bootstrap alone.
 * @param {Record<string, string|undefined>} env
 * @param {{bootstrap: string|null, bootstrapFile?: string, candidates?: string[]}} o
 *   candidates: default SKILL.md locations in order (the first existing one wins)
 * @returns {{skillInline: string|null, skillInlineFile: string, skillInlineMissing: string}}
 */
export function loadSkillInline(env, o) {
  const none = { skillInline: null, skillInlineFile: '', skillInlineMissing: '' };
  if (!o.bootstrap || /^(0|off|false|no)$/i.test(env.BRIDGE_SKILL_INLINE ?? '')) return none;
  const candidates = env.BRIDGE_SKILL_FILE
    ? [env.BRIDGE_SKILL_FILE]
    : [...(o.bootstrapFile ? [resolve(dirname(o.bootstrapFile), 'hermes-ui', 'SKILL.md')] : []), ...(o.candidates ?? [])];
  const file = candidates.find((f) => existsSync(f));
  if (!file) return { ...none, skillInlineMissing: candidates[0] ?? 'SKILL.md' };
  let message = null;
  try { message = buildSkillMessage(readFileSync(file, 'utf8')); } catch { /* unreadable: reported as missing */ }
  return message ? { skillInline: message, skillInlineFile: file, skillInlineMissing: '' } : { ...none, skillInlineMissing: file };
}
