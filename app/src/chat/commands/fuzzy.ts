/**
 * Fuzzy ranking for the slash palette (pure). Matches the canonical name, Hermes aliases and the localized
 * search aliases; the description (in the UI language) is a weak last resort ("/tokens" → /usage).
 */
import { commandKeys, foldKey, type CommandDef } from './registry.ts';

export type RankedCommand = {
  def: CommandDef;
  score: number;
  /** the alias that matched when it is not the name itself (shown as "neu → /new") */
  via?: string;
};

const KIND_BONUS = { name: 0, hermes: -40, alias: -80 } as const;

/** subsequence match ("mdl" in "model"): higher for tighter, earlier matches; 0 = no match */
function subsequenceScore(q: string, key: string): number {
  let ki = 0;
  let first = -1;
  let gaps = 0;
  for (const ch of q) {
    const at = key.indexOf(ch, ki);
    if (at < 0) return 0;
    if (first < 0) first = at;
    else gaps += at - ki;
    ki = at + 1;
  }
  return Math.max(1, 200 - gaps * 15 - first * 10);
}

function keyScore(q: string, key: string): number {
  if (key === q) return 1000;
  if (key.startsWith(q)) return 800 - Math.min(100, (key.length - q.length) * 5);
  const at = key.indexOf(q);
  if (at >= 0) return 450 - Math.min(100, at * 10);
  return q.length >= 2 ? subsequenceScore(q, key) : 0;
}

/**
 * Commands matching `query` (the token after "/"), best first. Empty query → all, in table order.
 * `describe` returns the localized description for the weak description match (optional).
 */
export function rankCommands(query: string, commands: readonly CommandDef[], describe?: (c: CommandDef) => string): RankedCommand[] {
  const q = foldKey(query.trim());
  if (!q) return commands.map((def) => ({ def, score: 0 }));
  const out: (RankedCommand & { order: number })[] = [];
  commands.forEach((def, order) => {
    let best = 0;
    let via: string | undefined;
    for (const k of commandKeys(def)) {
      const s = keyScore(q, k.key);
      if (s <= 0) continue;
      const total = s + KIND_BONUS[k.kind];
      if (total > best) {
        best = total;
        via = k.kind === 'name' ? undefined : k.key;
      }
    }
    if (best <= 0 && describe && q.length >= 3 && foldKey(describe(def)).includes(q)) best = 50;
    if (best > 0) out.push({ def, score: best, via, order });
  });
  out.sort((a, b) => b.score - a.score || a.order - b.order);
  return out.map(({ def, score, via }) => (via ? { def, score, via } : { def, score }));
}
