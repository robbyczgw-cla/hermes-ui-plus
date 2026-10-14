/**
 * `{type:'ask', text, include?}` (SPEC-modules-v2): send `text` plus the CURRENT values of the named
 * interactive nodes (calc / choice / checklist / slots / confirm / quiz / …) as one user message,
 * at most 4000 chars. Pure (node:test): the caller passes the parsed hui nodes of the message and the
 * persisted node-state records of the conversation.
 */
import { checklistReplyFor } from '../ui/components/modules/a/checklistModel.ts';
import { readOptions } from '../ui/components/modules/a/misc.ts';
import { buildCalcReply, computeOutputs, normalizeCalc, valueOf, type CalcValue } from '../ui/components/modules/b/calcModel.ts';

export const ASK_MAX_CHARS = 4000;

/** `messageId:nodeId` → stored node state (`NodeRecord.data` + `updatedAt`). */
export type AskRecords = Record<string, { data: unknown; updatedAt?: number } | undefined>;

type Rec = Record<string, unknown>;
const isObj = (x: unknown): x is Rec => !!x && typeof x === 'object' && !Array.isArray(x);
const str = (x: unknown): string => (typeof x === 'string' ? x.trim() : '');

/** Depth-first search for a node with `id` in a (possibly nested) hui tree. */
export function findNode(root: unknown, id: string, depth = 0): Rec | null {
  if (depth > 12 || root == null) return null;
  if (Array.isArray(root)) {
    for (const x of root) {
      const hit = findNode(x, id, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (!isObj(root)) return null;
  if (root.id === id && typeof root.type === 'string') return root;
  for (const k of ['children', 'tabs', 'items']) {
    const v = root[k];
    if (Array.isArray(v)) {
      const hit = findNode(v, id, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

/** Stored state of `nodeId`: the same message first, else the most recently updated one in the conversation. */
export function pickRecord(records: AskRecords, nodeId: string, messageId?: string): unknown {
  if (messageId) {
    const own = records[`${messageId}:${nodeId}`];
    if (own) return own.data;
  }
  let best: { data: unknown; updatedAt?: number } | undefined;
  for (const [key, rec] of Object.entries(records)) {
    if (!rec || !key.endsWith(`:${nodeId}`)) continue;
    if (!best || (rec.updatedAt ?? 0) > (best.updatedAt ?? 0)) best = rec;
  }
  return best?.data;
}

function optionLabels(node: Rec | null, keys: unknown): string[] {
  if (!Array.isArray(keys)) return [];
  const opts = readOptions(node?.options);
  return keys.filter((k): k is string => typeof k === 'string' && k !== '__other__').map((k) => opts.find((o) => o.key === k)?.label ?? k);
}

/** One line describing the current value of one node. */
export function describeNode(nodeId: string, node: Rec | null, state: unknown): string {
  const type = str(node?.type) || (isObj(state) && state.kind === 'checklist' ? 'checklist' : '');
  const s = isObj(state) ? state : {};
  switch (type) {
    case 'calc': {
      const model = normalizeCalc(node);
      const stored = isObj(s.v) ? (s.v as Record<string, CalcValue>) : undefined;
      const values: Record<string, CalcValue> = {};
      for (const i of model.inputs) values[i.name] = valueOf(i, stored);
      const reply = buildCalcReply(model, values, computeOutputs(model, values));
      if (reply) return reply;
      break;
    }
    case 'checklist': {
      const items = Array.isArray(s.items) ? s.items : null;
      if (items) return checklistReplyFor(nodeId, items as never);
      if (node && Array.isArray(node.items)) {
        const open = node.items.map((x) => (isObj(x) ? str(x.text) : str(x))).filter(Boolean);
        return `[checklist:${nodeId}] offen: ${open.join(', ') || '–'}`;
      }
      break;
    }
    case 'choice': {
      const labels = Array.isArray(s.labels) ? s.labels.filter((x): x is string => typeof x === 'string') : optionLabels(node, s.selected);
      const other = str(s.other);
      const all = [...labels, ...(other ? [`Andere: ${other}`] : [])];
      const q = str(node?.question);
      return `[choice:${nodeId}] ${q ? `${q} → ` : ''}${all.length ? all.join(', ') : 'noch keine Auswahl'}`;
    }
    case 'slots':
      return `[slot:${nodeId}] ${str(s.label) || (s.answer ? String(s.answer) : 'noch keine Auswahl')}`;
    case 'confirm':
      return `[confirm:${nodeId}] ${s.answer === 'ja' || s.answer === 'nein' ? s.answer : 'noch offen'}`;
    case 'quiz': {
      const answers = Array.isArray(s.answers) ? s.answers.filter((a) => a != null).length : 0;
      const total = node && Array.isArray(node.questions) ? node.questions.length : 0;
      return `[quiz:${nodeId}] ${answers}/${total || '?'} beantwortet${s.finished ? ' (fertig)' : ''}`;
    }
  }
  if (state === undefined) return `[${type || 'node'}:${nodeId}] (keine Angaben)`;
  let json = '';
  try {
    json = JSON.stringify(state);
  } catch {
    json = '';
  }
  return `[${type || 'node'}:${nodeId}] ${json.length > 1200 ? `${json.slice(0, 1199)}…` : json}`;
}

/**
 * The user message for an `ask` action. `nodes` = hui nodes of the message that holds the button
 * (searched recursively); state comes from `records` (same message first). ≤ `ASK_MAX_CHARS`.
 */
export function buildAskMessage(text: string, include: readonly string[] | undefined, nodes: readonly unknown[], records: AskRecords, messageId?: string): string {
  const head = text.trim();
  const ids = [...new Set((include ?? []).filter((x): x is string => typeof x === 'string' && !!x.trim()))];
  const lines: string[] = [];
  for (const id of ids) {
    const node = findNode(nodes, id);
    const state = pickRecord(records, id, messageId);
    if (!node && state === undefined) continue;
    lines.push(describeNode(id, node, state).replace(/\s*\n\s*/g, ' '));
  }
  let out = lines.length ? `${head}\n\n${lines.join('\n')}` : head;
  if (out.length > ASK_MAX_CHARS) out = `${out.slice(0, ASK_MAX_CHARS - 1)}…`;
  return out;
}
