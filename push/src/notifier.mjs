// Notification dispatch: event -> matching registrations -> per-device payload -> sender.
// Handles preview on/off (privacy), quiet hours (delivered silently), dedupe, per-thread collapse/coalescing,
// per-user rate limit and dead-token cleanup. Nothing here logs or stores message text.
// Canonical copy: push/src (see scripts/sync-push.sh).
import crypto from 'node:crypto';

export const CHANNEL_DEFAULT = 'agent-messages';
export const CHANNEL_QUIET = 'agent-messages-quiet';
export const PREVIEW_MAX = 140;

const STRINGS = {
  de: { generic: 'Neue Nachricht', more: '(+{n} weitere)', test: 'Test-Benachrichtigung: Push funktioniert.', approvalTitle: 'Hermes wartet auf deine Freigabe', approvalGeneric: 'Ein Befehl wartet auf deine Entscheidung.' },
  en: { generic: 'New message', more: '(+{n} more)', test: 'Test notification: push works.', approvalTitle: 'Hermes is waiting for your approval', approvalGeneric: 'A command is waiting for your decision.' },
  es: { generic: 'Nuevo mensaje', more: '(+{n} más)', test: 'Notificación de prueba: el push funciona.', approvalTitle: 'Hermes espera tu aprobación', approvalGeneric: 'Un comando espera tu decisión.' },
};
export const strings = (locale) => STRINGS[locale] ?? STRINGS.de;

/** Markdown/hui-ish text -> one short plain line for a notification body. */
export function previewText(text, max = PREVIEW_MAX) {
  let s = String(text ?? '');
  s = s.replace(/```[\s\S]*?(```|$)/g, ' '); // code + hui blocks
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1'); // images -> alt text
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'); // links -> label
  s = s.replace(/<[^>]{1,200}>/g, ' '); // html-ish tags
  s = s.replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, ''); // headings, quotes, list markers
  s = s.replace(/(\*\*|__|~~|`|\*|_)/g, '');
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length > max) s = s.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
  return s;
}

/** A shell command as one short plain line (no markdown stripping: `_`, `*` and backticks are part of commands). */
export function commandPreview(text, max = PREVIEW_MAX) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/** Local minutes of `nowMs` in `tz`. */
function localMinutes(nowMs, tz) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz || 'UTC', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(nowMs));
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return h * 60 + m;
}

/** True when `nowMs` falls into the quiet window {from, to} ("22:00"-"07:00" wraps midnight). */
export function inQuietHours(quiet, tz, nowMs = Date.now()) {
  if (!quiet) return false;
  const toMin = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  const from = toMin(quiet.from);
  const to = toMin(quiet.to);
  const cur = localMinutes(nowMs, tz);
  return from < to ? cur >= from && cur < to : cur >= from || cur < to;
}

/** Short opaque collapse key (same thread -> same key; reveals nothing about the ids). */
export const collapseKeyFor = (threadKey) => 'hui' + crypto.createHash('sha256').update(String(threadKey)).digest('base64url').slice(0, 20);

/**
 * Per-device notification (platform neutral; senders map it).
 * @param {any} reg registration
 * @param {{title: string, text?: string, data: object, previewDefault?: boolean, count?: number, threadKey: string}} ev
 */
export function buildNotification(reg, ev, nowMs = Date.now()) {
  const L = strings(reg.locale);
  const previewOn = reg.preview === 'on' || (reg.preview !== 'off' && ev.previewDefault !== false);
  // kind 'approval' (Hermes waits for a decision): fixed localized title, command only when previews are on
  const approval = ev.kind === 'approval';
  let body = previewOn ? (approval ? commandPreview(ev.text) : previewText(ev.text)) : '';
  if (!body) body = approval ? L.approvalGeneric : L.generic;
  if (!approval && ev.count && ev.count > 1) body = `${body} ${L.more.replace('{n}', String(ev.count - 1))}`;
  const quiet = inQuietHours(reg.quiet, reg.tz, nowMs);
  const collapseKey = collapseKeyFor(ev.threadKey);
  const data = { v: 1, kind: approval ? 'approval' : 'message', profileId: reg.profileId, ...stringify(ev.data) };
  return {
    title: approval ? L.approvalTitle : String(ev.title || 'Hermes').slice(0, 80),
    body,
    data,
    quiet,
    collapseKey,
    threadId: collapseKey,
    channelId: quiet ? CHANNEL_QUIET : CHANNEL_DEFAULT,
    ttl: ev.ttl ?? 86400,
  };
}

function stringify(o) {
  const out = {};
  for (const [k, v] of Object.entries(o ?? {})) if (v !== undefined && v !== null) out[k] = String(v);
  return out;
}

/**
 * @param {{store: ReturnType<typeof import('./store.mjs').createRegistrationStore>,
 *   senders: {webpush?: any, fcm?: any, apns?: any}, log?: (msg: string, f?: object) => void,
 *   now?: () => number, coalesceMs?: number, perUserPerHour?: number, dedupeTtlMs?: number, testsPerHour?: number,
 *   isValid?: (reg: any) => boolean}} o  isValid: the registering credential is still valid (GPT security H3)
 */
export function createNotifier(o) {
  const { store, senders } = o;
  const log = o.log ?? (() => {});
  const now = o.now ?? Date.now;
  const coalesceMs = o.coalesceMs ?? 15_000;
  const perUserPerHour = o.perUserPerHour ?? 60;
  const dedupeTtlMs = o.dedupeTtlMs ?? 24 * 3600_000;
  const testsPerHour = o.testsPerHour ?? 10; // GPT security M5: test sends have their own small budget
  const testBuckets = new Map(); // user -> [timestamps]
  const seen = new Map(); // dedupe key -> ts
  const threads = new Map(); // threadKey -> {lastSentAt, pending, count, timer}
  const buckets = new Map(); // user -> [timestamps]

  function seenBefore(key) {
    const t = now();
    if (seen.size > 5000) for (const [k, ts] of seen) if (t - ts > dedupeTtlMs || seen.size > 4000) seen.delete(k);
    if (seen.has(key) && t - seen.get(key) < dedupeTtlMs) return true;
    seen.set(key, t);
    return false;
  }

  function allow(user, map = buckets, max = perUserPerHour) {
    const t = now();
    const arr = (map.get(user) ?? []).filter((x) => t - x < 3600_000);
    if (arr.length >= max) {
      map.set(user, arr);
      return false;
    }
    arr.push(t);
    map.set(user, arr);
    return true;
  }

  /** Registrations of `user` whose credential is still valid; the others are removed (revoked device/token). */
  function validFor(user) {
    const out = [];
    for (const r of store.forUser(user)) {
      if (!o.isValid || o.isValid(r)) out.push(r);
      else {
        store.remove({ user, id: r.id });
        log('push registration dropped (credential no longer valid)', { platform: r.platform });
      }
    }
    return out;
  }

  async function sendTo(reg, n) {
    let r;
    if (reg.platform === 'fcm' && senders.fcm) r = await senders.fcm.send(reg.token, n);
    else if (reg.platform === 'apns' && senders.apns) r = await senders.apns.send(reg.token, n, reg.apnsEnv);
    else if (reg.platform === 'webpush' && senders.webpush) {
      r = await senders.webpush.send(reg.subscription, { title: n.title, body: n.body, tag: n.collapseKey, silent: n.quiet, data: n.data }, { ttl: n.ttl, urgency: n.quiet ? 'low' : 'high', topic: n.collapseKey });
    } else r = { ok: false, error: `${reg.platform} not configured` };
    if (r.gone) {
      const dropped = store.dropDevice(reg.platform, reg.platform === 'webpush' ? reg.subscription.endpoint : reg.token);
      log('push device gone', { platform: reg.platform, dropped, status: r.status });
    } else store.mark(reg.id, r);
    return r;
  }

  /** Deliver now to every matching registration of the event's user. */
  async function deliver(ev) {
    const regs = validFor(ev.user).filter((r) => r.enabled !== false && (!ev.match || ev.match(r)));
    if (!regs.length) return { sent: 0, failed: 0, skipped: 'no registrations' };
    if (!allow(ev.user)) {
      log('push rate limited', { user: ev.user });
      return { sent: 0, failed: 0, skipped: 'rate limited' };
    }
    let sent = 0;
    let failed = 0;
    await Promise.all(
      regs.map(async (reg) => {
        const r = await sendTo(reg, buildNotification(reg, ev, now()));
        if (r.ok) sent++;
        else failed++;
      }),
    );
    log('push sent', { user: ev.user, src: ev.data?.src, sent, failed });
    return { sent, failed };
  }

  return {
    buildNotification,
    /**
     * Notify about one event. ev = {user, key (dedupe), threadKey (collapse), title, text, data, previewDefault, match(reg)}.
     * The first event of a thread goes out immediately; further events within `coalesceMs` are merged into one
     * follow-up notification (same collapse key, so it replaces the previous one) with the latest text + count.
     */
    async notify(ev) {
      if (ev.key && seenBefore(`${ev.user}|${ev.key}`)) return { sent: 0, failed: 0, skipped: 'duplicate' };
      const t = now();
      const st = threads.get(ev.threadKey) ?? { lastSentAt: -Infinity, pending: null, count: 0, timer: null };
      threads.set(ev.threadKey, st);
      if (t - st.lastSentAt >= coalesceMs && !st.timer) {
        st.lastSentAt = t;
        return deliver(ev);
      }
      st.pending = ev;
      st.count += 1;
      if (!st.timer) {
        st.timer = setTimeout(() => {
          const pending = st.pending;
          const count = st.count;
          st.pending = null;
          st.count = 0;
          st.timer = null;
          st.lastSentAt = now();
          if (pending) void deliver({ ...pending, count: count + 1 }).catch(() => {});
        }, Math.max(0, coalesceMs - (t - st.lastSentAt)));
        st.timer.unref?.();
      }
      return { sent: 0, failed: 0, skipped: 'coalesced' };
    },
    /** Test notification to the caller's registrations (or one of them). */
    async test(user, id) {
      const regs = validFor(user).filter((r) => !id || r.id === id);
      const results = [];
      for (const reg of regs) {
        if (!allow(user, testBuckets, testsPerHour)) {
          results.push({ id: reg.id, platform: reg.platform, ok: false, error: 'rate limited' });
          continue;
        }
        const L = strings(reg.locale);
        const n = buildNotification({ ...reg, preview: 'on', quiet: null }, { title: 'Hermes', text: L.test, data: { src: 'test' }, threadKey: `test|${reg.id}` }, now());
        const r = await sendTo(reg, n);
        results.push({ id: reg.id, platform: reg.platform, ok: r.ok, error: r.ok ? undefined : r.error });
      }
      return results;
    },
    /** flush timers (tests / shutdown) */
    stop() {
      for (const st of threads.values()) if (st.timer) clearTimeout(st.timer);
      threads.clear();
    },
  };
}
