// FCM HTTP v1 sender: OAuth2 service-account JWT (RS256, node:crypto) -> access token -> messages:send.
// No Firebase SDK. Canonical copy: push/src (see scripts/sync-push.sh).
//
// Message shape: DATA-ONLY with expo-notifications' Android contract (node_modules/expo-notifications
// .../model/NotificationData.kt + FirebaseNotificationTrigger.kt): data.title, data.message (= visible text),
// data.body (JSON string -> request.content.data in JS), data.channelId, data.tag (replaces a notification with
// the same tag). expo-notifications' FirebaseMessagingService presents it itself, also when the app is killed.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { signJwt } from './jwt.mjs';

export const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';

/** Parse + validate a service-account JSON (object, JSON text or file path). Never logs the key. */
export function loadServiceAccount(src) {
  let sa = src;
  if (typeof src === 'string') sa = JSON.parse(src.trim().startsWith('{') ? src : fs.readFileSync(src, 'utf8'));
  if (!sa || sa.type !== 'service_account' || !sa.client_email || !sa.private_key || !sa.project_id) {
    throw new Error('FCM: not a service-account JSON (needs type, project_id, client_email, private_key)');
  }
  return { projectId: sa.project_id, clientEmail: sa.client_email, privateKey: crypto.createPrivateKey(sa.private_key), tokenUri: sa.token_uri || DEFAULT_TOKEN_URI };
}

/** OAuth2 JWT bearer assertion (RFC 7523) for Google. */
export function serviceAccountAssertion(sa, nowSec = Math.floor(Date.now() / 1000)) {
  return signJwt({ alg: 'RS256', typ: 'JWT' }, { iss: sa.clientEmail, scope: FCM_SCOPE, aud: sa.tokenUri, iat: nowSec, exp: nowSec + 3600 }, sa.privateKey);
}

/** Build the FCM v1 message for one device token. All data values must be strings. */
export function fcmMessage(token, n) {
  const data = {
    title: n.title,
    message: n.body,
    body: JSON.stringify(n.data ?? {}),
    channelId: n.channelId ?? 'agent-messages',
  };
  if (n.collapseKey) data.tag = n.collapseKey;
  return {
    message: {
      token,
      data,
      android: { priority: 'HIGH', ttl: `${n.ttl ?? 86400}s`, ...(n.collapseKey ? { collapse_key: n.collapseKey.slice(0, 64) } : {}) },
    },
  };
}

/**
 * @param {{serviceAccount: any, fetch?: typeof fetch, timeoutMs?: number, endpoint?: string}} cfg
 */
export function createFcmSender(cfg) {
  const sa = loadServiceAccount(cfg.serviceAccount);
  const doFetch = cfg.fetch ?? globalThis.fetch;
  const endpoint = cfg.endpoint ?? `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(sa.projectId)}/messages:send`;
  let cached = null; // {token, exp}
  let inflight = null;

  async function timed(url, init) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs ?? 15000);
    try {
      return await doFetch(url, { ...init, signal: ctrl.signal, redirect: 'manual' }); // 3xx = failure (never follow with a bearer token)
    } finally {
      clearTimeout(timer);
    }
  }

  async function accessToken(force = false) {
    if (!force && cached && cached.exp - 60_000 > Date.now()) return cached.token;
    if (inflight) return inflight;
    inflight = (async () => {
      const body = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: serviceAccountAssertion(sa) });
      const res = await timed(sa.tokenUri, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.access_token) throw new Error(`FCM oauth ${res.status}`);
      cached = { token: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
      return cached.token;
    })().finally(() => {
      inflight = null;
    });
    return inflight;
  }

  return {
    kind: 'fcm',
    projectId: sa.projectId,
    accessToken,
    async send(token, n) {
      try {
        let tok = await accessToken();
        const body = JSON.stringify(fcmMessage(token, n));
        let res = await timed(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body });
        if (res.status === 401) {
          tok = await accessToken(true);
          res = await timed(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body });
        }
        const j = await res.json().catch(() => null);
        if (res.ok) return { ok: true, status: res.status };
        const codes = (j?.error?.details ?? []).map((d) => d?.errorCode).filter(Boolean);
        const status = j?.error?.status;
        // UNREGISTERED (404) = app uninstalled / token rotated; INVALID_ARGUMENT on a token = malformed token
        const gone = codes.includes('UNREGISTERED') || status === 'NOT_FOUND' || (res.status === 400 && /registration token/i.test(j?.error?.message ?? ''));
        const retryAfter = Number(res.headers.get?.('retry-after')) || undefined;
        return { ok: false, status: res.status, gone, retryAfter, error: `fcm ${res.status} ${codes[0] ?? status ?? ''}`.trim() };
      } catch (e) {
        return { ok: false, status: 0, error: `fcm ${e?.name === 'AbortError' ? 'timeout' : String(e?.message ?? e).slice(0, 80)}` };
      }
    },
  };
}
