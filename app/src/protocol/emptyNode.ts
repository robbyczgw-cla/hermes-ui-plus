/**
 * Does a complete (normalised) node carry anything its component can show? Models sometimes send a node without its
 * data (`{"type":"table"}`, `{"type":"stack","children":[]}`, a `poll` without options); most components then render
 * nothing or an empty box, which reads as a gap in the answer. HuiView shows a quiet "component without data" line
 * for such nodes instead (render sweep: ui/renderFixtures.ts, scripts/ux-check/render-sweep.mjs).
 *
 * Per type: the fields (or `a.b` paths) that make up its visible content; one non-empty field is enough. Types not listed always
 * render something on their own (a bare `chart`, `checklist`, `products` … has its own empty state). Pure.
 */

const CONTENT_FIELDS: Readonly<Record<string, readonly string[]>> = {
  card: ['title', 'subtitle', 'children'],
  stack: ['children'],
  text: ['text'],
  callout: ['title', 'text'],
  stats: ['items'],
  table: ['columns', 'rows'],
  list: ['items'],
  steps: ['items'],
  timeline: ['items'],
  compare: ['columns'],
  gallery: ['items'],
  code: ['code'],
  buttons: ['items'],
  suggestions: ['items'],
  form: ['title', 'fields'],
  choice: ['options'],
  calc: ['inputs', 'outputs'],
  recipe: ['title', 'ingredients', 'steps'],
  tabs: ['tabs'],
  accordion: ['items'],
  sources: ['items'],
  // `source.lang` defaults to 'und': only the text counts
  translation: ['source.text', 'targets'],
  poll: ['options'],
  agenda: ['title', 'blocks'],
  weather: ['current', 'hourly', 'daily'],
  decision: ['options'],
  rank: ['items'],
  summary: ['text', 'points', 'verdict'],
  guide: ['steps'],
  workout: ['exercises'],
  mindmap: ['root'],
  paths: ['items'],
  blocks: ['columns'],
  diff: ['patch', 'files'],
  terminal: ['command', 'output'],
  changes: ['summary', 'files', 'patch'],
};

function filled(v: unknown, depth = 0): boolean {
  if (typeof v === 'string') return v.trim() !== '';
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return v.length > 0;
  // generated ids (`root: {id: 'm', label: ''}`) are not content
  if (v && typeof v === 'object' && depth < 3) return Object.entries(v).some(([k, x]) => k !== 'id' && filled(x, depth + 1));
  return false;
}

export function isEmptyNode(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  const n = node as Record<string, unknown>;
  const fields = typeof n.type === 'string' ? CONTENT_FIELDS[n.type] : undefined;
  return !!fields && !fields.some((f) => filled(f.split('.').reduce<unknown>((v, k) => (v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined), n)));
}

/** A short visible label for an empty node (its title / question / location), if the model gave one. */
export function emptyNodeLabel(node: unknown): string | undefined {
  if (!node || typeof node !== 'object') return undefined;
  const n = node as Record<string, unknown>;
  for (const k of ['title', 'question', 'prompt', 'location', 'caption']) {
    const v = n[k];
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 120);
  }
  return undefined;
}
