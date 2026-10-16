// Live inbox: authenticated SSE streams per user, used while the app is open. Late / unsolicited agent messages
// go to the user's connected streams; push is only used when the user has no stream connected.
// Strictly per user: a stream only ever receives events published for its own user id (and its filter).
// Canonical copy: push/src (see scripts/sync-push.sh).

function asciiJson(v) {
  return JSON.stringify(v).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/**
 * @param {{keepaliveMs?: number, maxPerUser?: number, maxBufferedBytes?: number, log?: (m: string, f?: object) => void}} [o]
 */
export function createInboxHub(o = {}) {
  const keepaliveMs = o.keepaliveMs ?? 15_000;
  const maxPerUser = o.maxPerUser ?? 5;
  const maxBufferedBytes = o.maxBufferedBytes ?? 256 * 1024;
  const log = o.log ?? (() => {});
  /** @type {Map<string, Set<{res: any, filter: (ev: any) => boolean, timer: any}>>} */
  const clients = new Map();

  function detach(user, c) {
    clearInterval(c.timer);
    const set = clients.get(user);
    set?.delete(c);
    if (set && !set.size) clients.delete(user);
  }

  function send(user, c, frame) {
    if (c.res.writableEnded || c.res.destroyed) return false;
    // SSE has no acknowledgement/retransmission queue here. A stalled reader must reconnect and
    // recover from session sync; continuing to write would grow Node's response queue without limit.
    if (c.res.writableLength + Buffer.byteLength(frame) > maxBufferedBytes) {
      detach(user, c);
      c.res.destroy();
      return false;
    }
    c.res.write(frame);
    return true;
  }
  const write = (user, c, event, data) => send(user, c, `event: ${event}\ndata: ${asciiJson(data)}\n\n`);

  return {
    /**
     * Attach an SSE response for `user`. `filter(ev)` narrows what this stream receives (e.g. one profile's agents).
     * Returns a detach function (also called automatically on close).
     */
    attach(user, req, res, { filter = () => true, headers = {}, ready = {} } = {}) {
      const set = clients.get(user) ?? new Set();
      if (set.size >= maxPerUser) {
        // drop the oldest stream of this user (stale app instance)
        const oldest = set.values().next().value;
        if (oldest) {
          detach(user, oldest);
          oldest.res.destroy();
        }
      }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-store',
        'X-Accel-Buffering': 'no',
        Connection: 'keep-alive',
        ...headers,
      });
      res.flushHeaders?.();
      const c = { res, filter, timer: null };
      c.timer = setInterval(() => send(user, c, ': keepalive\n\n'), keepaliveMs);
      c.timer.unref?.();
      set.add(c);
      clients.set(user, set);
      const onClose = () => detach(user, c);
      req.on('close', onClose);
      res.on('close', onClose);
      write(user, c, 'hui.ready', ready);
      log('inbox attach', { user, streams: set.size });
      return onClose;
    },
    /** Number of streams of `user` that would receive `ev` (0 = nobody listening -> use push). */
    listeners(user, ev) {
      let n = 0;
      for (const c of clients.get(user) ?? []) if (c.filter(ev)) n++;
      return n;
    },
    /** Publish to the user's streams. Returns the number of streams that got it. */
    publish(user, ev, event = 'hui.message') {
      let n = 0;
      for (const c of clients.get(user) ?? []) if (c.filter(ev) && write(user, c, event, ev)) n++;
      return n;
    },
    connected: (user) => (clients.get(user)?.size ?? 0) > 0,
    get size() {
      let n = 0;
      for (const s of clients.values()) n += s.size;
      return n;
    },
    closeAll() {
      for (const set of clients.values()) for (const c of set) {
        clearInterval(c.timer);
        c.res.end();
      }
      clients.clear();
    },
  };
}
