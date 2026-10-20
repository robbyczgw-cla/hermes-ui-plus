// Per-device bridge tokens (security review M5). BRIDGE_TOKEN stays the admin/bootstrap credential; every
// pairing (QR page, --pair, `devices add`, POST /bridge/devices, setup wizard) creates a PENDING device with a
// one-time pair code. Stored as sha256 only in <state-dir>/devices.json (0600), re-read when the file changes
// (checked at most every 2 s), so `hermes-ui-bridge devices revoke <id>` takes effect in a running bridge.
//
// One-time pair codes: a pair link carries `c=<code>` (32 random bytes, base64url), never a token. The app trades
// the code for its device token exactly once (POST /bridge/pair/redeem, src/pair.mjs); the token is generated at
// that moment, so a code that is never redeemed never produced a usable credential. Codes expire after
// PAIR_CODE_TTL_MS; pending devices with an expired code are pruned on the next write.
// Legacy: devices paired with an older bridge (`t=<token>` links) keep working; a legacy token that was never used
// expires after PENDING_TTL_MS like before.
//
// Several processes write this file (the running bridge: last-use updates; the CLI: add / revoke; the setup
// wizard). Every read-modify-write runs under an exclusive lock file (O_EXCL, stale after LOCK_STALE_MS) and
// re-reads the file inside the lock, so a CLI revoke can never be overwritten by the bridge.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { hostname } from 'node:os';
import { writeFileAtomicSync } from './atomic-write.mjs';

export const DEVICES_FILE = 'devices.json';
export const LOCK_SUFFIX = '.lock';
/** legacy `t=` tokens that were never used */
export const PENDING_TTL_MS = 60 * 60_000;
/** one-time pair codes */
export const PAIR_CODE_TTL_MS = 60 * 60_000;
export const LOCK_STALE_MS = 10_000;
export const LOCK_WAIT_MS = 5_000;
const LAST_USED_PERSIST_MS = 10 * 60_000;
const MAX_DEVICES = 200;
const ID_RE = /^d_[a-z0-9]{10}$/;
const HEX64 = /^[0-9a-f]{64}$/;
/** 32 random bytes as base64url = 43 chars; accept a little slack, nothing else */
export const PAIR_CODE_RE = /^[A-Za-z0-9_-]{43,128}$/;

const sha = (s) => createHash('sha256').update(String(s), 'utf8').digest();
const hex = (s) => sha(s).toString('hex');
const cleanLabel = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 60) || 'device';
/** Routines rights (src/routines-rights.mjs): bot names are `default` or a Hermes profile name (profiles.mjs). */
export const ROUTINE_RIGHTS = /** @type {const} */ (['manage', 'read', 'none']);
const BOT_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const MAX_ROUTINE_BOTS = 100;
const plainObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** Per-device routines overrides {"<bot>": "manage"|"read"|"none"}; unknown bots / values dropped. null when empty. */
export function parseDeviceRoutines(v) {
  if (!plainObj(v)) return null;
  /** @type {Record<string, string>} */
  const out = {};
  for (const [bot, right] of Object.entries(v).slice(0, MAX_ROUTINE_BOTS)) {
    if (BOT_RE.test(bot) && ROUTINE_RIGHTS.includes(right)) out[bot] = right;
  }
  return Object.keys(out).length ? out : null;
}

/** Top-level bots policy (src/bots-manage.mjs): {create: true|false} once the owner switched it, else {}. */
export function parseBotsPolicy(doc) {
  return plainObj(doc?.bots) && typeof doc.bots.create === 'boolean' ? { create: doc.bots.create } : {};
}

/** Top-level routines policy {bots: {"<bot>": true|false}}; unknown values dropped. */
export function parseRoutinesPolicy(doc) {
  const bots = plainObj(doc?.routines) && plainObj(doc.routines.bots) ? doc.routines.bots : {};
  /** @type {Record<string, boolean>} */
  const out = {};
  for (const [bot, on] of Object.entries(bots).slice(0, MAX_ROUTINE_BOTS)) {
    if (BOT_RE.test(bot) && typeof on === 'boolean') out[bot] = on;
  }
  return { bots: out };
}

export function newDeviceToken() {
  return 'hbd_' + randomBytes(32).toString('base64url');
}

/** One-time pair code: 32 random bytes, base64url (43 chars). */
export function newPairCode() {
  return randomBytes(32).toString('base64url');
}

/** Validate a devices document (unknown fields dropped, bad entries skipped). */
export function parseDevices(doc) {
  const list = Array.isArray(doc?.devices) ? doc.devices : [];
  const out = [];
  const seen = new Set();
  for (const d of list) {
    if (!d || typeof d !== 'object' || !ID_RE.test(String(d.id)) || seen.has(d.id)) continue;
    const sha256 = HEX64.test(String(d.sha256)) ? d.sha256 : null;
    const codeSha256 = HEX64.test(String(d.codeSha256)) ? d.codeSha256 : null;
    if (!sha256 && !codeSha256) continue; // neither a token nor a pending code: nothing to authenticate
    seen.add(d.id);
    const routines = parseDeviceRoutines(d.routines);
    out.push({
      id: d.id,
      label: cleanLabel(d.label),
      sha256,
      codeSha256: sha256 ? null : codeSha256,
      codeExpiresAt: sha256 ? null : Number(d.codeExpiresAt) || 0,
      createdAt: Number(d.createdAt) || 0,
      activatedAt: Number(d.activatedAt) || null,
      lastUsedAt: Number(d.lastUsedAt) || null,
      revokedAt: Number(d.revokedAt) || null,
      ...(routines ? { routines } : {}),
      ...(d.botsManage === true ? { botsManage: true } : {}),
    });
  }
  return out;
}

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const lockError = (lockPath, code = 'ELOCKED') => Object.assign(new Error(`${path.basename(lockPath)} ${code === 'ELOCKLOST' ? 'ownership lost' : 'is held by another process'}`), { code });

/**
 * Serialize lock transitions (create, stale takeover, release, and the final data rename). Never steal this
 * very short-lived guard: stealing a guard from a paused process would defeat fencing. A crash inside a
 * transition fails closed; an operator may remove the guard after stopping all writers.
 */
function transition(lockPath, fn, waitMs = 0) {
  const guard = lockPath + '.transition';
  const deadline = Date.now() + waitMs;
  for (;;) {
    try { fs.mkdirSync(guard, { mode: 0o700 }); break; }
    catch (e) {
      if (e?.code !== 'EEXIST') throw e;
      if (waitMs <= 0 || Date.now() >= deadline) throw lockError(lockPath);
      sleepSync(Math.min(20, deadline - Date.now()));
    }
  }
  try { return fn(); } finally { fs.rmdirSync(guard); }
}

function ownerToken(lockPath) {
  try { return JSON.parse(fs.readFileSync(lockPath, 'utf8')).token; }
  catch (e) { if (e?.code === 'ENOENT' || e instanceof SyntaxError) return null; throw e; }
}

/** CLI callers may wait; server callers use waitMs=0 (no Atomics.wait on the event loop). */
export function withFileLock(lockPath, fn, { staleMs = LOCK_STALE_MS, waitMs = LOCK_WAIT_MS } = {}) {
  const deadline = Date.now() + waitMs;
  const owner = { token: randomBytes(24).toString('hex'), pid: process.pid, host: hostname(), time: Date.now() };
  for (;;) {
    try {
      transition(lockPath, () => {
        try {
          if (Date.now() - fs.statSync(lockPath).mtimeMs <= staleMs) throw lockError(lockPath);
          // Only one transition can move the stale owner out of the way. No cleaner can rename a successor.
          const stale = `${lockPath}.${owner.token}.stale`;
          fs.renameSync(lockPath, stale);
          fs.unlinkSync(stale);
        } catch (e) { if (e?.code !== 'ENOENT') throw e; }
        fs.writeFileSync(lockPath, JSON.stringify(owner), { flag: 'wx', mode: 0o600 });
      });
      break;
    } catch (e) {
      if (e?.code !== 'ELOCKED') throw e;
      if (waitMs <= 0 || Date.now() >= deadline) throw e;
      sleepSync(Math.min(20, deadline - Date.now()));
    }
  }
  const owned = () => ownerToken(lockPath) === owner.token;
  const commit = (write) => transition(lockPath, () => {
    if (!owned()) throw lockError(lockPath, 'ELOCKLOST');
    return write();
  }, waitMs);
  try { return fn(commit); }
  finally {
    const release = () => {
      try { transition(lockPath, () => { if (owned()) fs.unlinkSync(lockPath); }, waitMs); }
      catch (e) {
        if (e?.code === 'ELOCKED') setTimeout(release, 50).unref();
        else if (e?.code !== 'ENOENT') throw e;
      }
    };
    release();
  }
}

/** @param {fs.Stats} st */
const fileSig = (st) => `${st.ino}:${st.size}:${st.mtimeMs}`;

/**
 * @param {{dir: string, now?: () => number, logger?: any, lockWaitMs?: number}} o  dir = state directory (created 0700 on first write)
 */
export function createDeviceStore({ dir, now = Date.now, logger, lockWaitMs = LOCK_WAIT_MS }) {
  const file = path.join(dir, DEVICES_FILE);
  const lockFile = file + LOCK_SUFFIX;
  let devices = [];
  let policy = { bots: {} }; // top-level `routines` of the file (src/routines-rights.mjs), preserved on every write
  let botsPolicy = /** @type {{create?: boolean}} */ ({}); // top-level `bots` (src/bots-manage.mjs), preserved too
  let hashes = new Map(); // id -> Buffer (devices with a token only)
  // file signature of the last read/write: mtime alone misses a second write within the same coarse mtime tick (a CLI
  // revoke right after the bridge's own write); atomic writes rename a new file into place, so the inode changes too
  let sig = '';
  let checkedAt = -Infinity;
  let retryUse;
  let retryMs = 50;
  const dirtyUse = new Map(); // id -> lastUsedAt not yet persisted

  function setDevices(list) {
    devices = list;
    hashes = new Map(list.filter((d) => d.sha256).map((d) => [d.id, Buffer.from(d.sha256, 'hex')]));
  }

  /** Cached view for the hot path (authenticate / isUsable): re-read when the file changed, at most every 2 s. */
  function load(force = false) {
    const t = now();
    if (!force && t - checkedAt < 2000) return devices;
    checkedAt = t;
    let st = null;
    try {
      st = fs.statSync(file);
    } catch {
      if (sig !== 'none') { setDevices([]); policy = { bots: {} }; botsPolicy = {}; }
      sig = 'none';
      return devices;
    }
    if (fileSig(st) !== sig) {
      try {
        const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
        setDevices(parseDevices(doc));
        policy = parseRoutinesPolicy(doc);
        botsPolicy = parseBotsPolicy(doc);
      } catch (e) {
        // a broken file must not lock everybody out with stale data silently: log, keep the last good list
        logger?.warn?.('devices: cannot read devices.json, keeping the previous list', { err: String(e?.message ?? e).slice(0, 120) });
      }
      sig = fileSig(st);
    }
    return devices;
  }

  /** Unconditional read for read-modify-write (inside the lock). A broken file is an error, never overwritten. */
  function readFresh() {
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch (e) {
      if (e?.code === 'ENOENT') return { list: [], routines: { bots: {} }, bots: {} };
      throw e;
    }
    try {
      const doc = JSON.parse(raw);
      return { list: parseDevices(doc), routines: parseRoutinesPolicy(doc), bots: parseBotsPolicy(doc) };
    } catch {
      throw new Error(`${file} is not valid JSON; fix or remove it`);
    }
  }

  function save(list, commit, routines, bots = botsPolicy) {
    // CLI run as root against a service's state dir (systemd DynamicUser): hand the file to the dir's owner,
    // otherwise the running bridge can no longer read it and silently keeps a stale device list.
    const chownToDirOwner = (tmp) => {
      if (typeof process.getuid !== 'function' || process.getuid() !== 0) return;
      try {
        const st = fs.statSync(dir);
        if (st.uid !== 0) fs.chownSync(tmp, st.uid, st.gid);
      } catch {
        /* best effort */
      }
    };
    const doc = { v: 1, ...(Object.keys(routines.bots).length ? { routines } : {}), ...(Object.keys(bots).length ? { bots } : {}), devices: list };
    writeFileAtomicSync(file, `${JSON.stringify(doc, null, 2)}\n`, { mode: 0o600, beforeRename: chownToDirOwner, commit });
    setDevices(list);
    policy = routines;
    botsPolicy = bots;
    try {
      sig = fileSig(fs.statSync(file));
    } catch {
      sig = '';
    }
    checkedAt = now();
  }

  /**
   * Exclusive read-modify-write. `fn(list, t, routines, bots)` returns {list?, routines?, bots?, result}: the parts
   * that are set are written; the rest is written back as read (the routines and bots policies survive every device
   * write and the other way round).
   * @template R
   * @param {(list: ReturnType<typeof parseDevices>, t: number, routines: ReturnType<typeof parseRoutinesPolicy>, bots: ReturnType<typeof parseBotsPolicy>) => {list?: any[]|null, routines?: ReturnType<typeof parseRoutinesPolicy>, bots?: ReturnType<typeof parseBotsPolicy>, result: R}} fn
   * @returns {R}
   */
  function mutate(fn) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    return withFileLock(lockFile, (commit) => {
      const current = readFresh();
      const out = fn(current.list, now(), current.routines, current.bots);
      if (out.list || out.routines || out.bots) save(out.list ?? current.list, commit, out.routines ?? current.routines, out.bots ?? current.bots);
      else { setDevices(current.list); policy = current.routines; botsPolicy = current.bots; }
      return out.result;
    }, { waitMs: lockWaitMs });
  }

  /** Pending entries that can never be used any more: expired pair codes, legacy tokens never used in time. */
  const isDeadPending = (d, t) => !d.revokedAt && !d.activatedAt && !dirtyUse.has(d.id)
    && (d.sha256 ? t - d.createdAt >= PENDING_TTL_MS : t >= d.codeExpiresAt);
  const prune = (list, t) => list.filter((d) => !isDeadPending(d, t));

  /** Merge pending lastUsed/activation updates into a fresh read and write (best effort). */
  function flushUse() {
    clearTimeout(retryUse);
    if (!dirtyUse.size) return;
    const pending = new Map(dirtyUse);
    try {
      mutate((list) => ({
        list: list.map((d) => {
          const u = pending.get(d.id);
          return u && d.sha256 ? { ...d, lastUsedAt: Math.max(u, d.lastUsedAt ?? 0), activatedAt: d.activatedAt ?? u } : d;
        }),
        result: undefined,
      }));
      retryMs = 50;
      for (const [id, u] of pending) if (dirtyUse.get(id) === u) dirtyUse.delete(id);
    } catch (e) {
      logger?.warn?.('devices: cannot persist last use', { err: String(e?.message ?? e).slice(0, 120) });
      if (lockWaitMs === 0) {
        retryUse = setTimeout(flushUse, retryMs);
        retryUse.unref();
        retryMs = Math.min(1000, retryMs * 2);
      }
    }
  }

  const usable = (d, t) => !d.revokedAt && Boolean(d.sha256) && Boolean(d.activatedAt || dirtyUse.has(d.id) || t - d.createdAt < PENDING_TTL_MS);
  const status = (d, t) => {
    if (d.revokedAt) return 'revoked';
    if (d.activatedAt || dirtyUse.has(d.id)) return 'active';
    if (!d.sha256) return t < d.codeExpiresAt ? 'pending' : 'expired';
    return t - d.createdAt < PENDING_TTL_MS ? 'pending' : 'expired';
  };

  return {
    file,
    lockFile,
    /** Constant-time over all devices. Returns the device or null. Activates legacy pending tokens on first use. */
    authenticate(token) {
      if (typeof token !== 'string' || token.length < 16 || token.length > 512) return null;
      const h = sha(token);
      const t = now();
      let found = null;
      for (const d of load()) {
        const stored = hashes.get(d.id);
        if (!stored) continue;
        const ok = timingSafeEqual(h, stored);
        if (ok && !found) found = d;
      }
      if (!found || !usable(found, t)) return null;
      const prev = dirtyUse.get(found.id) ?? found.lastUsedAt ?? 0;
      dirtyUse.set(found.id, t);
      if (!found.activatedAt || t - prev > LAST_USED_PERSIST_MS) flushUse();
      return found;
    },
    /**
     * Create a pending device and its one-time pair code. Returns the plaintext code exactly once; no token
     * exists yet (it is generated by redeem()).
     * @param {string} label
     * @param {{replacePending?: (label: string) => boolean}} [o]
     * @returns {{id: string, code: string, expiresAt: number, replaced: number}}
     */
    issue(label, { replacePending } = {}) {
      return mutate((all, t) => {
        let list = prune(all, t);
        // `replacePending(label)`: drop never-redeemed pair codes it matches (a re-run of setup replaces its own last link)
        const before = list.length;
        if (replacePending) list = list.filter((d) => !(!d.sha256 && d.codeSha256 && !d.revokedAt && !d.activatedAt && replacePending(d.label)));
        const replaced = before - list.length;
        if (list.filter((d) => !d.revokedAt).length >= MAX_DEVICES) throw new Error(`too many devices (max ${MAX_DEVICES}); revoke some first`);
        let id;
        do id = 'd_' + randomBytes(8).toString('hex').slice(0, 10); while (list.some((d) => d.id === id));
        const code = newPairCode();
        const expiresAt = t + PAIR_CODE_TTL_MS;
        const entry = { id, label: cleanLabel(label), sha256: null, codeSha256: hex(code), codeExpiresAt: expiresAt, createdAt: t, activatedAt: null, lastUsedAt: null, revokedAt: null };
        return { list: [...list, entry], result: { id, code, expiresAt, replaced } };
      });
    },
    /**
     * Trade a one-time pair code for a fresh device token (atomic: the code is consumed in the same locked write).
     * Unknown, expired, revoked and already used codes all return null (callers answer with one generic error).
     * @returns {{id: string, token: string, label: string} | null}
     */
    redeem(code) {
      if (typeof code !== 'string' || !PAIR_CODE_RE.test(code)) return null;
      const h = sha(code);
      return mutate((all, t) => {
        let found = null;
        for (const d of all) {
          if (!d.codeSha256) continue;
          const ok = timingSafeEqual(h, Buffer.from(d.codeSha256, 'hex'));
          if (ok && !found) found = d;
        }
        const list = prune(all, t);
        const pruned = list.length !== all.length;
        if (!found || found.revokedAt || !(t < found.codeExpiresAt)) return { list: pruned ? list : null, result: null };
        const token = newDeviceToken();
        const next = list.map((d) => (d.id === found.id ? { ...d, sha256: hex(token), codeSha256: null, codeExpiresAt: null, activatedAt: t, lastUsedAt: t } : d));
        return { list: next, result: { id: found.id, token, label: found.label } };
      });
    },
    /** Device exists, is not revoked and not an expired pending token (push registration binding, H3). */
    isUsable(id) {
      const d = load().find((x) => x.id === id);
      return Boolean(d) && usable(d, now());
    },
    /** Revoke by id (also a pending pair code). Returns false when unknown. */
    revoke(id) {
      return mutate((list, t) => {
        const d = list.find((x) => x.id === id);
        if (!d) return { result: false };
        if (d.revokedAt) return { result: true };
        return { list: list.map((x) => (x.id === id ? { ...x, revokedAt: t } : x)), result: true };
      });
    },
    /** Public view (never hashes, tokens or codes). */
    list() {
      const t = now();
      return load(true).map((d) => ({
        id: d.id,
        label: d.label,
        createdAt: d.createdAt,
        lastUsedAt: dirtyUse.get(d.id) ?? d.lastUsedAt,
        status: status(d, t),
      }));
    },
    /** Routines policy of the file: {bots: {"<bot>": bool}} (cached view, re-read like the device list). */
    routinesPolicy() {
      load();
      return { bots: { ...policy.bots } };
    },
    /** Per-bot routines override of a device ({} = none; absent bot = default right). */
    deviceRoutines(id) {
      return { ...(load().find((x) => x.id === id)?.routines ?? {}) };
    },
    /** Admin view for the routines rights (never hashes, tokens or codes). */
    routinesView() {
      const t = now();
      const list = load(true);
      return {
        bots: { ...policy.bots },
        devices: list.map((d) => ({ id: d.id, label: d.label, status: status(d, t), routines: { ...(d.routines ?? {}) } })),
      };
    },
    /**
     * Change the routines policy in one locked write. bots: {"<bot>": bool}; devices: {"<id>": {"<bot>": right|null}}
     * (null removes the override). Callers validate names and values; an unknown device id throws (code unknown_device)
     * and nothing is written.
     * @param {{bots?: Record<string, boolean>, devices?: Record<string, Record<string, string|null>>}} change
     */
    setRoutines(change) {
      return mutate((list, _t, routines) => {
        for (const id of Object.keys(change.devices ?? {})) {
          if (!list.some((d) => d.id === id)) throw Object.assign(new Error(`unknown device ${id}`), { code: 'unknown_device', id });
        }
        const bots = { ...routines.bots, ...(change.bots ?? {}) };
        const next = list.map((d) => {
          const c = change.devices?.[d.id];
          if (!c) return d;
          const r = { ...(d.routines ?? {}) };
          for (const [bot, right] of Object.entries(c)) {
            if (right === null) delete r[bot];
            else r[bot] = right;
          }
          const clean = parseDeviceRoutines(r);
          const { routines: _old, ...rest } = d;
          return clean ? { ...rest, routines: clean } : rest;
        });
        return { list: next, routines: parseRoutinesPolicy({ routines: { bots } }), result: undefined };
      });
    },
    /** Bots policy of the file: {create?: boolean} (cached view). */
    botsPolicy() {
      load();
      return { ...botsPolicy };
    },
    /** May this device create and edit bots (`bots grant`)? */
    deviceBotsManage(id) {
      return load().find((x) => x.id === id)?.botsManage === true;
    },
    /** Admin view for the bots rights (never hashes, tokens or codes). */
    botsView() {
      const t = now();
      const list = load(true);
      return {
        policy: { ...botsPolicy },
        devices: list.map((d) => ({ id: d.id, label: d.label, status: status(d, t), manage: d.botsManage === true })),
      };
    },
    /**
     * Change the bots policy in one locked write. create: owner switch (null = back to the env default);
     * devices: {"<id>": true|false}. An unknown device id throws (code unknown_device) and nothing is written.
     * @param {{create?: boolean|null, devices?: Record<string, boolean>}} change
     */
    setBots(change) {
      return mutate((list, _t, _routines, bots) => {
        for (const id of Object.keys(change.devices ?? {})) {
          if (!list.some((d) => d.id === id)) throw Object.assign(new Error(`unknown device ${id}`), { code: 'unknown_device', id });
        }
        const next = list.map((d) => {
          const on = change.devices?.[d.id];
          if (on === undefined) return d;
          const { botsManage: _old, ...rest } = d;
          return on ? { ...rest, botsManage: true } : rest;
        });
        const policy = change.create === undefined ? bots : change.create === null ? {} : { create: change.create };
        return { list: next, bots: policy, result: undefined };
      });
    },
    flush: flushUse,
    close() { clearTimeout(retryUse); },
  };
}
