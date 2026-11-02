/**
 * Evidence of an answer: what the chat's tool calls up to and including that answer can back (research item 12,
 * "honest evidence"). Data cards (ProvenanceChip) use it so a model-written `source:"Herstellerangaben"` or
 * `basis:"sourced"` without any web lookup is shown as "Aus Modellwissen, ohne Webquelle" and never as a source.
 *
 *  - `{web: false}`: no tool that could bring outside data ran in this chat so far (none at all, or only tool discovery,
 *    to-dos, skills, reminders, image generation). That is the default Hermes setup without web keys.
 *  - `{web: true, retrieved}`: a web search / page read ran in this chat (this turn or an earlier one: "als Tabelle?"
 *    after a search keeps its source). `retrieved(url)` says whether a source URL is among the parsed hits.
 *  - undefined: unknown, the chip shows what the node says (another data tool ran – terminal, files, memory, MCP, a
 *    delegated task –, the start of the chat is not loaded, or a local/demo answer).
 *
 * Pure TS (node:test, evidence.test.ts).
 */
import type { ChatMessage, ToolEvent } from '../../hermes/types.ts';
import type { EvidenceView } from '../../ui/components/modules/a/misc.ts';
import { domainOf } from '../../ui/components/modules/a/misc.ts';
import { usedWebSearch } from '../answerMenu.ts';
import { hermesToolKind } from '../hermesTools.ts';
import { retrievedSources } from './webSources.ts';

type Msg = Pick<ChatMessage, 'id' | 'role' | 'tools' | 'metrics'>;

/** tool kinds that never bring facts from outside (hermesTools.ts) */
const NO_DATA_KINDS = new Set(['discovery', 'todo', 'skill', 'cron']);
const NO_DATA_TOOLS = new Set(['image_generate', 'video_generate', 'clarify']);

/** What one assistant turn's tools could back: web results, other data (unknown), or nothing. */
export function turnEvidence(m: Pick<ChatMessage, 'tools' | 'metrics'>): 'web' | 'other' | 'none' {
  if (usedWebSearch(m)) return 'web';
  for (const t of m.tools) {
    const name = (t.detail?.tool ?? t.name ?? '').toLowerCase();
    const kind = hermesToolKind(name);
    if ((kind && NO_DATA_KINDS.has(kind)) || NO_DATA_TOOLS.has(name)) continue;
    return 'other';
  }
  return 'none';
}

function sameSite(a: string, b: string): boolean {
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

/**
 * EvidenceView for web tools + a key that changes exactly when the verdict can change. A source URL counts as retrieved
 * when a hit is on the same site (www / subdomains): a table's `source` is usually the site, not the exact hit URL.
 */
function webView(tools: readonly ToolEvent[]): { view: EvidenceView; key: string } {
  const r = retrievedSources(tools);
  if (!r?.complete) return { view: { web: true }, key: 'web' };
  const sites = new Set<string>();
  for (const h of r.hits.values()) {
    const d = domainOf(h.url);
    if (d) sites.add(d);
  }
  const view: EvidenceView = {
    web: true,
    retrieved: (url) => {
      const d = domainOf(url);
      if (!d) return undefined;
      for (const site of sites) if (sameSite(d, site)) return true;
      return false;
    },
  };
  return { view, key: `web:${[...sites].sort().join(' ')}` };
}

/**
 * EvidenceView per assistant message id. `truncated`: the chat's start is not loaded (earlier turns may have searched).
 * Messages from other backends without tool rows count like Hermes turns without tools.
 */
export function conversationEvidence(messages: readonly Msg[], truncated = false): Map<string, EvidenceView | undefined> {
  return createEvidenceDerive()(messages, truncated);
}

const NO_WEB: EvidenceView = Object.freeze({ web: false });

/**
 * Memoizing variant for the message list (one per list, like listDerive.ts): only messages from the first changed one
 * on are recomputed (a streaming tick: the last one). The map keeps its identity while no answer's verdict changed,
 * so the list's renderItem is not rebuilt per tick.
 */
export function createEvidenceDerive(): (messages: readonly Msg[], truncated?: boolean) => Map<string, EvidenceView | undefined> {
  type State = { web: boolean; other: boolean; webTools: readonly ToolEvent[] };
  type Row = { id: string; state: State; view?: EvidenceView; key: string };
  let prev: readonly Msg[] = [];
  let prevTruncated = false;
  let rows: Row[] = [];
  let out = new Map<string, EvidenceView | undefined>();

  return (messages, truncated = false) => {
    let start = 0;
    if (truncated === prevTruncated) {
      const n = Math.min(prev.length, messages.length);
      while (start < n && prev[start] === messages[start]) start++;
      if (start === messages.length && messages.length === prev.length) return out;
    }
    let changed = messages.length !== prev.length;
    const next = rows.slice(0, start);
    let st: State = start > 0 ? next[start - 1].state : { web: false, other: truncated, webTools: [] };
    for (let i = start; i < messages.length; i++) {
      const m = messages[i];
      let view: EvidenceView | undefined;
      let key = 'user';
      if (m.role === 'assistant') {
        const k = turnEvidence(m);
        if (k === 'web') st = { web: true, other: st.other, webTools: [...st.webTools, ...m.tools] };
        else if (k === 'other' && !st.other) st = { ...st, other: true };
        if (st.web) ({ view, key } = webView(st.webTools));
        else if (st.other) key = 'unknown';
        else [view, key] = [NO_WEB, 'none'];
        const old = rows[i];
        // same verdict as before → the old object (memoized rows and the map identity stay)
        if (old && old.id === m.id && old.key === key) view = old.view;
        else changed = true;
      } else if (rows[i]?.id !== m.id) changed = true;
      next.push({ id: m.id, state: st, view, key });
    }
    prev = messages;
    prevTruncated = truncated;
    rows = next;
    if (changed) {
      out = new Map();
      for (let i = 0; i < messages.length; i++) if (messages[i].role === 'assistant') out.set(messages[i].id, next[i].view);
    }
    return out;
  };
}

/** block types whose content are facts that need a lookup (ProvenanceChip `factual`) */
const FACTUAL_TYPES = new Set(['products', 'places', 'weather']);

/** A raw ```hui block (shown as the readable-list fallback) of a fact type: products, places, weather. */
export function factualBlock(raw: string): boolean {
  const m = /"type"\s*:\s*"([a-z_]+)"/.exec(raw);
  return !!m && FACTUAL_TYPES.has(m[1]);
}
