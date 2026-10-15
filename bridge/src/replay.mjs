// Idempotent chat turns + resumable SSE (docs/BRIDGE.md, "Idempotent send and resume"; docs/adr/0002).
//
// Hermes ignores `Idempotency-Key` on STREAMING chat completions (only the non-streaming path and /v1/runs dedupe), so the
// bridge does it for the turns it proxies: a chat request with an `Idempotency-Key` gets a record (per credential + key)
// that taps every byte the bridge sends to the client (route frame + upstream SSE). The original response is unchanged.
//
//  - The same key again (a retry after a connection that dropped before the app saw any answer) never starts a second
//    Hermes turn: it re-attaches to the recorded one (bytes from the start, then live).
//  - `X-Hermes-UI-Resume-Offset: <n>` (the app lost the stream after n bytes) re-attaches from byte n; the app keeps its
//    SSE parser state, so every frame arrives exactly once. A resume request never starts a turn (409 if unknown).
//  - Only `200 text/event-stream` turns are recorded; any other upstream answer drops the record (a retry runs anew).
//  - A turn whose upstream stream broke (`aborted`: Hermes restart, timeout, reset) gave no answer: the same key WITHOUT
//    a resume offset runs it anew (bridge.mjs); a resume request for it gets 409 `resume_unavailable`.
//  - A turn that ran (live or ended) but is not recorded (over `maxTurnBytes`, or evicted for the total budget) answers
//    409 `turn_unrecorded`: it must not run twice, its answer is in the Hermes session (the app recovers it from there).
//
// Memory bounds: at most `maxTurnBytes` per turn (a bigger turn stays live but is no longer resumable) and
// `maxTotalBytes` over all records (finished records lose their bytes oldest first, a byte-less entry stays so the key
// still never starts a second turn); finished records live `retainMs`.
// Re-attached responses never buffer without limit: a reader catches up from the recording only as fast as it drains
// (backpressure), a live reader that falls behind drops back to the recording (or, once the turn is no longer
// recorded, is disconnected when `maxSubscriberBytes` are queued; it resumes from its offset). A slow reader never
// pauses the shared turn. At most 4 re-attached streams per turn and `maxSubscribersTotal` over all turns.
// No content is ever logged.

export const RESUME_OFFSET_HEADER = 'x-hermes-ui-resume-offset';
/** response header: this turn can be resumed with the same Idempotency-Key + RESUME_OFFSET_HEADER */
export const RESUMABLE_HEADER = 'x-hermes-ui-resume';
const KEY_RE = /^[\x21-\x7e]{1,255}$/;
const MAX_SUBSCRIBERS = 4;
const TOO_MANY = { status: 429, code: 'rate_limit_exceeded' };
/** refusal code: the turn ran upstream but its stream is not recorded (never run it again, read the session) */
export const UNRECORDED_CODE = 'turn_unrecorded';

/** the request's Idempotency-Key when it is valid (1-255 visible ASCII, like Hermes' /v1/runs), else null */
export function idempotencyKey(headers) {
  const raw = headers['idempotency-key'];
  const k = typeof raw === 'string' ? raw.trim() : '';
  return KEY_RE.test(k) ? k : null;
}

/** parsed resume offset: undefined = no resume header, null = invalid, else a byte offset ≥ 0 */
export function resumeOffset(headers) {
  const raw = headers[RESUME_OFFSET_HEADER];
  if (raw === undefined) return undefined;
  const s = String(raw).trim();
  if (!/^\d{1,15}$/.test(s)) return null;
  return Number(s);
}

/**
 * @param {{maxTurnBytes?: number, maxTotalBytes?: number, retainMs?: number, maxSubscriberBytes?: number,
 *   maxSubscribersTotal?: number, now?: () => number}} [o]
 */
export function createReplayStore(o = {}) {
  const maxTurnBytes = o.maxTurnBytes ?? 2 * 1024 * 1024;
  const maxTotalBytes = o.maxTotalBytes ?? 32 * 1024 * 1024;
  const retainMs = o.retainMs ?? 10 * 60_000;
  const maxSubscriberBytes = o.maxSubscriberBytes ?? 256 * 1024;
  const maxSubscribersTotal = o.maxSubscribersTotal ?? 64;
  const now = o.now ?? Date.now;
  /** @type {Map<string, Turn>} insertion order = age */
  const turns = new Map();
  let total = 0;
  let subscribers = 0; // re-attached responses over all turns

  class Turn {
    /** @param {string} scope @param {string} sessionId */
    constructor(scope, sessionId) {
      this.scope = scope;
      this.sessionId = sessionId;
      /** @type {'pending'|'live'|'ended'|'aborted'} */
      this.state = 'pending';
      /** @type {{status: number, headers: Record<string, any>}|null} */
      this.head = null;
      /** @type {Buffer[]} */
      this.chunks = [];
      this.size = 0; // bytes recorded (while resumable)
      this.length = 0; // bytes the turn produced in total
      this.resumable = false;
      this.endedAt = 0;
      /**
       * re-attached responses: `live` = gets appended bytes directly, else it catches up from the recording at chunk
       * `i` (+ `skip` bytes) as fast as it drains
       * @type {Map<import('node:http').ServerResponse, {live: boolean, i: number, skip: number}>}
       */
      this.subs = new Map();
    }

    /** upstream answered 200 SSE: the head every re-attached client gets */
    start(head) {
      if (this.state !== 'pending') return;
      this.state = 'live';
      this.head = head;
      this.resumable = true;
    }

    /** @param {Buffer} chunk bytes the original client got (or would have got) */
    append(chunk) {
      if (this.state !== 'live') return;
      this.length += chunk.length;
      if (this.resumable) {
        if (this.size + chunk.length > maxTurnBytes || !reserve(chunk.length, this)) this.unresumable();
        else {
          this.chunks.push(chunk);
          this.size += chunk.length;
        }
      }
      for (const [res, sub] of this.subs) {
        if (!sub.live) continue; // catching up: the pump takes this chunk from the recording
        if (!this.resumable && res.writableLength + chunk.length > maxSubscriberBytes) {
          // too far behind and nothing to catch up from: cut it (the app resumes from the bytes it got, or reads the session)
          this.unsub(res);
          res.destroy();
          continue;
        }
        if (res.write(chunk) || !this.resumable) continue;
        // backpressure: drop back to the recording (this chunk is its last one) until the reader drained
        sub.live = false;
        sub.i = this.chunks.length;
        sub.skip = 0;
        res.once('drain', () => this.pump(res, sub));
      }
    }

    /** the upstream response is over: `aborted` = cut (error / stop), re-attached clients see a broken stream */
    end(aborted = false) {
      if (this.state === 'ended' || this.state === 'aborted') return;
      if (this.state === 'pending') return void drop(this);
      this.state = aborted ? 'aborted' : 'ended';
      this.endedAt = now();
      for (const [res, sub] of this.subs) {
        if (!aborted && !sub.live) continue; // still catching up: the pump ends it after the last recorded byte
        this.unsub(res);
        if (aborted) res.destroy();
        else res.end();
      }
    }

    unresumable() {
      if (!this.resumable) return;
      this.resumable = false;
      total -= this.size;
      this.chunks = [];
      this.size = 0;
      // a reader still catching up has nothing left to catch up from
      for (const [res, sub] of this.subs) {
        if (sub.live) continue;
        this.unsub(res);
        res.destroy();
      }
    }

    /** @param {import('node:http').ServerResponse} res */
    unsub(res) {
      if (this.subs.delete(res)) subscribers--;
    }

    /**
     * Write the recording from the reader's position until its buffer is full (then again on 'drain'); caught up →
     * live (or the end of a finished turn).
     * @param {import('node:http').ServerResponse} res @param {{live: boolean, i: number, skip: number}} sub
     */
    pump(res, sub) {
      while (this.subs.get(res) === sub && !sub.live) {
        if (sub.i >= this.chunks.length) {
          if (this.state === 'ended') {
            this.unsub(res);
            res.end();
          } else sub.live = true;
          return;
        }
        const c = this.chunks[sub.i++];
        if (sub.skip >= c.length) { sub.skip -= c.length; continue; }
        const piece = sub.skip ? c.subarray(sub.skip) : c;
        sub.skip = 0;
        if (!res.write(piece)) return void res.once('drain', () => this.pump(res, sub));
      }
    }

    /**
     * Re-attach a client from byte `offset`. Returns null when done, else the refusal `{status, code, message}`.
     * @param {import('node:http').ServerResponse} res
     */
    attach(res, offset) {
      if (this.state === 'pending') return { status: 409, code: 'idempotency_in_progress', message: 'The turn with this Idempotency-Key is still starting' };
      if (this.state === 'aborted' || !this.head) return { status: 409, code: 'resume_unavailable', message: 'This turn can no longer be resumed' };
      if (!this.resumable) return { status: 409, code: UNRECORDED_CODE, message: 'This turn ran without a resumable recording; its answer is in the session' };
      if (offset > this.size) return { status: 409, code: 'resume_unavailable', message: 'Resume offset is beyond the recorded stream' };
      if (this.subs.size >= MAX_SUBSCRIBERS) return { ...TOO_MANY, message: 'Too many resumed streams for this turn' };
      if (subscribers >= maxSubscribersTotal) return { ...TOO_MANY, message: 'Too many resumed streams on this bridge' };
      res.writeHead(this.head.status, { ...this.head.headers, 'x-hermes-ui-resumed': String(offset) });
      res.flushHeaders?.();
      if (res.destroyed) return null;
      const sub = { live: false, i: 0, skip: offset };
      this.subs.set(res, sub);
      subscribers++;
      res.on('close', () => this.unsub(res));
      this.pump(res, sub);
      return null;
    }
  }

  function drop(turn) {
    if (turns.get(turn.scope) === turn) turns.delete(turn.scope);
    if (turn.resumable) total -= turn.size;
    turn.resumable = false;
    turn.chunks = [];
    turn.size = 0;
    for (const res of [...turn.subs.keys()]) {
      turn.unsub(res);
      res.destroy();
    }
  }

  /**
   * room for `bytes` more: evict finished records (oldest first); false when live turns alone fill the budget.
   * An ended turn keeps a byte-less entry (`turn_unrecorded` until `retainMs`): its key must not start a second turn.
   */
  function reserve(bytes, self) {
    if (total + bytes <= maxTotalBytes) {
      total += bytes;
      return true;
    }
    for (const t of turns.values()) {
      if (total + bytes <= maxTotalBytes) break;
      if (t === self) continue;
      if (t.state === 'ended') t.unresumable();
      else if (t.state === 'aborted') drop(t);
    }
    if (total + bytes > maxTotalBytes) return false;
    total += bytes;
    return true;
  }

  function sweep() {
    const cutoff = now() - retainMs;
    for (const t of turns.values()) {
      if ((t.state === 'ended' || t.state === 'aborted') && t.endedAt <= cutoff) drop(t);
    }
  }

  return {
    /** @param {string} scope credential + key */
    get(scope) {
      sweep();
      return turns.get(scope);
    },
    /** the upstream stream of this record broke: a plain retry (no resume offset) runs the turn anew */
    rerunnable: (turn) => turn.state === 'aborted',
    /** a new turn for `scope` (replaces an old record of the same scope) */
    begin(scope, sessionId) {
      sweep();
      const old = turns.get(scope);
      if (old) drop(old);
      const t = new Turn(scope, sessionId);
      turns.set(scope, t);
      return t;
    },
    /** forget a record (no upstream turn after all, or a non-SSE answer) */
    drop,
    stats: () => ({ turns: turns.size, bytes: total, subscribers }),
    clear() { for (const t of [...turns.values()]) drop(t); },
  };
}
