// Reformat override (docs/SPEC-modules-v4.md A1): the app's "Umformen" chips send
//   [reformat:<kind>] <readable instruction>
// kind ∈ shorter | longer | list | table | simpler | expert | translate:<lang>.
// The tag forces the presentation format (fast path, no model call, confidence 0.95, reason "reformat").

export const REFORMAT_CONFIDENCE = 0.95;
export const REFORMAT_REASON = 'reformat';

const TAG = /^\[reformat:([a-z]+)(?::([a-z]{2,3}(?:-[a-z0-9]+)?))?\]/i;
const HUI_CHECKLIST = /```hui\s*\n\s*\{\s*"type"\s*:\s*"checklist"/;
const TODO_WORDS = /(?<![\p{L}\p{N}])(to-?dos?|aufgaben|erledig\p{L}*|checkliste|checklist|tasks?|tareas|pendientes|lista de tareas)(?![\p{L}\p{N}])/iu;
const LIST_LINE = /^\s*(?:[-*•]|\d+[.)]|- \[[ xX]\])\s+\S/gm;
/** "short" source answer for `translate` → native translation cards (longer texts stay markdown) */
export const TRANSLATION_MAX_CHARS = 300;

/** @param {string} text @returns {{kind: string, lang?: string} | null} */
export function parseReformatTag(text) {
  const m = TAG.exec(String(text ?? '').trimStart());
  if (!m) return null;
  return m[2] ? { kind: m[1].toLowerCase(), lang: m[2].toLowerCase() } : { kind: m[1].toLowerCase() };
}

/** Plain-text length of an answer (```hui / ```hui-html blocks and markdown markers ignored). */
function plainLength(text) {
  return text.replace(/```[\s\S]*?(```|$)/g, ' ').replace(/[#*_>`|]/g, '').replace(/\s+/g, ' ').trim().length;
}

/** The previous answer was a list of to-dos (→ native checklist rather than a markdown list). */
function isTodoList(answer) {
  if (HUI_CHECKLIST.test(answer)) return true;
  return TODO_WORDS.test(answer) && (answer.match(LIST_LINE) ?? []).length >= 2;
}

/**
 * Forced decision for a reformat request, or null when the latest user turn carries no reformat tag
 * (or an unknown kind).
 * @param {{role: string, content: string}[]} turns
 * @returns {{format: string, component?: string, confidence: number, reason: string} | null}
 */
export function reformatDecision(turns) {
  const latest = [...turns].reverse().find((t) => t.role === 'user');
  if (!latest) return null;
  const tag = parseReformatTag(latest.content);
  if (!tag) return null;
  const idx = turns.lastIndexOf(latest);
  const source = [...turns.slice(0, idx)].reverse().find((t) => t.role === 'assistant')?.content ?? '';
  const d = (format, component) => (component ? { format, component, confidence: REFORMAT_CONFIDENCE, reason: REFORMAT_REASON } : { format, confidence: REFORMAT_CONFIDENCE, reason: REFORMAT_REASON });
  switch (tag.kind) {
    case 'table':
      return d('table');
    case 'list':
      return isTodoList(source) ? d('checklist', 'todo') : d('text');
    case 'shorter':
    case 'longer':
    case 'simpler':
    case 'expert':
      return d('text');
    case 'translate':
      return source && plainLength(source) <= TRANSLATION_MAX_CHARS ? d('translation') : d('text');
    default:
      return null;
  }
}
