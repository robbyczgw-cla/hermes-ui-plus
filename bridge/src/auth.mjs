// One Bearer check for every bridge route (bridge, uploads, voice, meta, images, push).
// BRIDGE_TOKEN = admin/bootstrap credential (full access + /bridge/devices); device tokens (src/devices.mjs) =
// normal API access, revocable one by one. Constant-time compares only.
import { createHash, timingSafeEqual } from 'node:crypto';

const sha = (s) => createHash('sha256').update(s).digest();

export function bearer(req) {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(String(req.headers?.authorization ?? ''));
  return m ? m[1] : null;
}

/**
 * @param {{token?: string, allowNoAuth?: boolean}} config
 * @param {ReturnType<typeof import('./devices.mjs').createDeviceStore>|null} [devices]
 */
export function createAuth(config, devices = null) {
  const adminHash = config.token ? sha(config.token) : null;
  /** @returns {null | {kind: 'admin'} | {kind: 'device', id: string} | {kind: 'open'}} */
  function check(req) {
    if (!adminHash) return config.allowNoAuth ? { kind: 'open' } : null;
    const tok = bearer(req);
    if (!tok) return null;
    const isAdmin = timingSafeEqual(sha(tok), adminHash);
    const dev = devices ? devices.authenticate(tok) : null; // always evaluated: no timing difference between kinds
    if (isAdmin) return { kind: 'admin' };
    return dev ? { kind: 'device', id: dev.id } : null;
  }
  // Opaque, non-secret credential ids (push registrations are bound to them; GPT security H3). Rotating
  // BRIDGE_TOKEN changes the admin id, revoking a device invalidates `dev_<id>`.
  const adminCred = adminHash ? 'admin_' + adminHash.toString('hex').slice(0, 16) : null;
  return {
    check,
    authorized: (req) => check(req) !== null,
    /** @returns {string|null} credential id of the request's (valid) Bearer token */
    credentialOf(req) {
      const c = check(req);
      if (!c) return null;
      return c.kind === 'admin' ? adminCred : c.kind === 'device' ? `dev_${c.id}` : 'open';
    },
    /** Is a stored credential id (credentialOf) still valid? Unbound (null) registrations are not. */
    credentialValid(cred) {
      if (typeof cred !== 'string') return false;
      if (cred === 'open') return !adminHash && config.allowNoAuth === true;
      if (cred.startsWith('admin_')) return cred === adminCred;
      if (cred.startsWith('dev_')) return Boolean(devices?.isUsable(cred.slice(4)));
      return false;
    },
    isAdmin: (req) => {
      const c = check(req);
      return c?.kind === 'admin' || c?.kind === 'open';
    },
    devices,
  };
}

/**
 * The `authorized(req)` predicate for a module: the server-wide auth (config.auth, set in server.mjs) when present,
 * else BRIDGE_TOKEN only (modules constructed directly, e.g. in tests).
 */
export function makeAuthorizer(config) {
  if (config.auth && typeof config.auth.authorized === 'function') return config.auth.authorized;
  return createAuth(config).authorized;
}

/** credentialOf / credentialValid of the server-wide auth (or BRIDGE_TOKEN only, like makeAuthorizer). */
export function makeCredentials(config) {
  const a = config.auth && typeof config.auth.credentialOf === 'function' ? config.auth : createAuth(config);
  return { of: (req) => a.credentialOf(req), valid: (cred) => a.credentialValid(cred) };
}
