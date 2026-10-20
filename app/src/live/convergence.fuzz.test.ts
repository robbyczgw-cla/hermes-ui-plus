/**
 * Convergence property test (design §17): 2-4 simulated devices edit one live list, send their edits with messages at
 * random times, Hermes writes full versions (sometimes forgetting `checked`, renaming nothing, adding and removing
 * items). After every step: every device folds the shared transcript to the same head; at the end, every tick that
 * reached the transcript is still there unless a later untick or delete of that item exists.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HuiChecklist } from '../protocol/types.ts';
import { foldLive, headOf, opTarget, type LiveEvent, type LiveItem, type LiveOp } from './model.ts';
import { fullFromNode } from './nodes.ts';
import { addPendingOp, afterAccepted, pruneInflight, rebasePending, type PendingCard } from './pending.ts';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0;
    s = Math.imul(s ^ (s >>> 13), s | 1) >>> 0;
    return ((s ^ (s >>> 16)) >>> 0) / 4294967296;
  };
}

const WORDS = ['Milch', 'Brot', 'Eier', 'Käse', 'Tomaten', 'Senf', 'Reis', 'Äpfel', 'Kaffee', 'Butter', 'Honig', 'Nudeln'];

test('devices converge and ticks survive (200 random runs)', () => {
  for (let run = 0; run < 200; run++) {
    const r = rng(run + 1);
    const pick = <T,>(a: readonly T[]): T => a[Math.floor(r() * a.length)];
    const transcript: LiveEvent[] = [];
    let key = 0;
    let at = 0;
    const first: LiveItem[] = WORDS.slice(0, 4).map((w) => ({ id: w.toLowerCase(), text: w }));
    transcript.push({ kind: 'hermes', key: `ha-${key++}`, at: at++, full: fullFromNode({ type: 'checklist', id: 'liste', live: true, items: first } as HuiChecklist)! });
    const devices: (PendingCard | undefined)[] = Array.from({ length: 2 + Math.floor(r() * 3) }, () => undefined);
    // the transcript head as each device last synced it (devices can lag behind)
    const synced: number[] = devices.map(() => transcript.length);
    let bidN = 0;
    for (let step = 0; step < 40; step++) {
      const what = r();
      const d = Math.floor(r() * devices.length);
      const view = foldLive(transcript.slice(0, synced[d])).cards.get('liste')!;
      const head = headOf(view);
      if (what < 0.5) {
        // a local edit on device d
        const state = rebasePending(view, devices[d]).state;
        const it = state.items.length ? pick(state.items) : undefined;
        const k = r();
        let op: LiveOp;
        if (!it || k < 0.2) op = { add: { id: `u-${d}-${step}`, text: pick(WORDS) } };
        else if (k < 0.6) op = it.checked ? { uncheck: it.id } : { check: it.id };
        else if (k < 0.8) op = { set: it.id, qty: 1 + Math.floor(r() * 5) };
        else op = { del: it.id };
        devices[d] = addPendingOp(devices[d], op, head.n, () => `b-${bidN++}`);
      } else if (what < 0.75) {
        // device d syncs, then sends a message with its pending edits
        synced[d] = transcript.length;
        const card = foldLive(transcript).cards.get('liste')!;
        const p = devices[d];
        const out = rebasePending(card, p);
        if (p && out.outgoing.length) {
          transcript.push({ kind: 'user', key: `hu-${key++}`, at: at++, card: 'liste', batch: { v: p.base, ops: out.outgoing, bid: p.bid } });
          const fold = foldLive(transcript);
          devices[d] = pruneInflight(afterAccepted(p, { bid: p.bid, count: p.ops.length }, headOf(fold.cards.get('liste')!).n), fold.bids);
        } else devices[d] = undefined;
        synced[d] = transcript.length;
      } else {
        // Hermes answers with a full version built from what it can see, sometimes forgetting `checked`
        const card = foldLive(transcript).cards.get('liste')!;
        let items = headOf(card).state.items.map((it) => (r() < 0.3 ? { ...it, checked: undefined } : { ...it }));
        if (items.length && r() < 0.3) items = items.filter((x) => x !== pick(items));
        if (r() < 0.4) items.push({ id: `h-${step}`, text: `${pick(WORDS)} ${step}` });
        if (items.length && r() < 0.3) {
          const i = Math.floor(r() * items.length);
          items[i] = { ...items[i], note: `n${step}` };
        }
        transcript.push({ kind: 'hermes', key: `ha-${key++}`, at: at++, full: fullFromNode({ type: 'checklist', id: 'liste', live: true, items } as HuiChecklist)! });
      }
      // convergence: any two folds of the same transcript are identical
      const a = JSON.stringify(headOf(foldLive(transcript).cards.get('liste')!).state);
      const b = JSON.stringify(headOf(foldLive(transcript.map((e) => ({ ...e }))).cards.get('liste')!).state);
      assert.equal(a, b);
    }
    // ticks survive: for each check that applied, the item is checked at the end unless a later uncheck/del exists
    const fold = foldLive(transcript).cards.get('liste')!;
    const final = new Map(headOf(fold).state.items.map((it) => [it.id, it]));
    fold.versions.forEach((v, vi) => {
      for (const op of v.ops) {
        if (!('check' in op)) continue;
        const id = op.check;
        const undone = fold.versions.slice(vi + 1).some((w) => w.ops.some((o) => opTarget(o) === id && ('uncheck' in o || 'del' in o)));
        if (!undone) assert.equal(final.get(id)?.checked, true, `run ${run}: tick on ${id} lost`);
      }
    });
  }
});
