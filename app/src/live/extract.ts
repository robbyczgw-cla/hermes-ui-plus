/**
 * Transcript → live events (live/model.ts `foldLive`). Hermes versions are top-level live nodes of finished answers
 * (`checklist`, `tabs`/`agenda` trip, `products`; a streaming answer joins the fold once it is complete) and patches
 * (a `callout` carrying `livePatch`); user batches come from the `live` field of user messages (the trailer, cut
 * when the message was stored or loaded).
 */
import type { ChatMessage } from '../hermes/types';
import type { HuiCallout, Segment } from '../protocol/types';
import type { LiveCard, LiveEvent, LiveFull, LiveOp, LiveTurn } from './model.ts';
import { fullFromNode, fullFromPlainNode, mayCarryLiveNode, mayCarryPlainNode, type LiveNodeShape } from './nodes.ts';

export { mayCarryLiveNode, mayCarryPlainNode } from './nodes.ts';

export type ParseSegments = (message: ChatMessage) => Segment[];

export type LiveBlock =
  | { kind: 'full'; full: LiveFull }
  | { kind: 'patch'; card: string; ops: LiveOp[] }
  /** a live-capable node without `"live":true` (model.ts `continuationOf` decides), `node` = its id or '' */
  | { kind: 'plain'; node: string; full: LiveFull };

/** Live blocks of one parsed answer (full versions, patches and, with `plain`, live-capable plain nodes), in order. */
export function liveBlocksOf(segments: readonly Segment[], opts: { plain?: boolean } = {}): LiveBlock[] {
  const out: LiveBlock[] = [];
  for (const s of segments) {
    if (s.kind !== 'hui' || !s.complete) continue;
    const n = s.node as (Partial<HuiCallout> & { livePatch?: { card: string; ops: LiveOp[] } }) | undefined;
    if (n?.type === 'callout') {
      if (n.livePatch?.card && n.livePatch.ops?.length) out.push({ kind: 'patch', card: n.livePatch.card, ops: n.livePatch.ops });
      continue;
    }
    const full = fullFromNode(s.node as Partial<LiveNodeShape>);
    if (full) out.push({ kind: 'full', full });
    else if (opts.plain) {
      const plain = fullFromPlainNode(s.node as Partial<LiveNodeShape>);
      if (plain) out.push({ kind: 'plain', node: plain.id, full: plain });
    }
  }
  return out;
}

/** First sentence of the answer's text before its first block ("Grillsachen sind drauf."), for the history. */
export function excerptOf(text: string, max = 80): string | undefined {
  const head = text.split(/```/)[0].replace(/[#*_>`]/g, '').replace(/\s+/g, ' ').trim();
  if (!head) return undefined;
  const m = /^(.+?[.!?])(\s|$)/.exec(head);
  const s = (m ? m[1] : head).trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/**
 * The fold's events of a transcript. Once the chat has a card (a live node or a user batch so far), answers also
 * yield their plain live-capable nodes (`plain`) and, without any card block, a `quiet` event, each with the turn's
 * user message (what it was about): the fold decides whether they continue / leave a card (model.ts).
 */
export function liveEventsOf(messages: readonly ChatMessage[], parse: ParseSegments): LiveEvent[] {
  const out: LiveEvent[] = [];
  let anyCard = false;
  let turn: LiveTurn = { cards: [], text: '' };
  for (const m of messages) {
    if (m.role === 'user') {
      const batches = Object.entries(m.live ?? {});
      const focus = batches.filter(([, b]) => b.focus).map(([c]) => c);
      turn = { cards: batches.map(([c]) => c), ...(focus.length ? { focus } : {}), text: m.text };
      for (const [card, batch] of batches) {
        out.push({ kind: 'user', key: m.id, at: m.createdAt, card, batch });
        anyCard = true;
      }
      continue;
    }
    if (m.status === 'streaming') continue;
    const live = mayCarryLiveNode(m.text);
    const plain = anyCard && mayCarryPlainNode(m.text);
    const blocks = live || plain ? liveBlocksOf(parse(m), { plain: anyCard }) : [];
    if (!blocks.length) {
      if (anyCard && m.status === 'done') out.push({ kind: 'quiet', key: m.id, at: m.createdAt, turn });
      continue;
    }
    const excerpt = excerptOf(m.text);
    const ex = excerpt ? { excerpt } : {};
    for (const b of blocks) {
      if (b.kind === 'full') {
        out.push({ kind: 'hermes', key: m.id, at: m.createdAt, full: b.full, ...(turn.text ? { turn } : {}), ...ex });
        anyCard = true;
      } else if (b.kind === 'patch') out.push({ kind: 'patch', key: m.id, at: m.createdAt, card: b.card, ops: b.ops, ...ex });
      else out.push({ kind: 'plain', key: m.id, at: m.createdAt, node: b.node, full: b.full, turn, ...ex });
    }
  }
  return out;
}

/**
 * Index of the message that carries the last Hermes FULL version of `card`, or -1. With the messages after it this
 * tells how much of the card Hermes may have lost from its context (design §9.3).
 */
export function lastFullIndex(messages: readonly ChatMessage[], keys: ReadonlySet<string>): number {
  for (let i = messages.length - 1; i >= 0; i--) if (keys.has(messages[i].id)) return i;
  return -1;
}

/** More messages than this after the card's last full state in Hermes' view: send it again (design §9.3). */
export const SNAPSHOT_AFTER_MESSAGES = 20;

/**
 * Hermes may no longer see the card in its context: its last full state (a Hermes full version or a user snapshot) is
 * more than SNAPSHOT_AFTER_MESSAGES messages back, or Hermes compacted its context after it (`contextCut`).
 */
export function hermesMayHaveLost(messages: readonly ChatMessage[], card: LiveCard): boolean {
  const keys = new Set(card.versions.filter((v) => (v.author === 'hermes' && !v.patch) || v.snapshot).map((v) => v.key));
  const i = lastFullIndex(messages, keys);
  if (i < 0) return true;
  let n = 0;
  for (let j = i + 1; j < messages.length; j++) {
    if (messages[j].contextCut) return true;
    n++;
  }
  return n > SNAPSHOT_AFTER_MESSAGES;
}

/**
 * Batch ids the transcript itself carries (user messages with a trailer). Not the fold's `bids`: those also hold the
 * ids of cards made on this device that only exist as a local first version so far.
 */
export function transcriptBids(messages: readonly ChatMessage[]): Set<string> {
  const out = new Set<string>();
  for (const m of messages) if (m.role === 'user' && m.live) for (const b of Object.values(m.live)) if (b.bid) out.add(b.bid);
  return out;
}
