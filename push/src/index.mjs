// Push + live inbox for the Hermes UI services (UI bridge). Zero dependencies (node:crypto,
// node:http2, global fetch). Design: docs/SELF-HOSTING.md "Push notifications".
// Canonical copy: push/src. scripts/sync-push.sh vendors it into bridge/src/push
// (each service is deployed on its own host as a self-contained directory).
import path from 'node:path';
import { createApnsSender } from './apns.mjs';
import { createFcmSender } from './fcm.mjs';
import { createInboxHub } from './inbox.mjs';
import { createNotifier } from './notifier.mjs';
import { createPushRoutes } from './routes.mjs';
import { createRegistrationStore } from './store.mjs';
import { createWebPushSender, generateVapidKeys } from './webpush.mjs';

export { generateVapidKeys, createInboxHub, createRegistrationStore, createNotifier };
export { previewText, commandPreview, inQuietHours, collapseKeyFor, buildNotification } from './notifier.mjs';
export { PUSH_PREFIX } from './routes.mjs';

/**
 * @param {{
 *   stateDir?: string|null,                 // registrations file lives here (null = memory only)
 *   webpush?: {publicKey: string, privateKey: string, subject: string, extraHosts?: string[]}|null,
 *   fcm?: {serviceAccount: any}|null,       // object, JSON text or file path
 *   apns?: {key: string, keyId: string, teamId: string, topic: string, origins?: object}|null,
 *   log?: (msg: string, fields?: object) => void,
 *   fetch?: typeof fetch,
 *   notifier?: {coalesceMs?: number, perUserPerHour?: number},
 *   senders?: object,                       // tests: inject fake senders
 * }} o
 */
export function createPushService(o = {}) {
  const log = o.log ?? (() => {});
  const senders = { ...(o.senders ?? {}) };
  const problems = [];
  if (!senders.webpush && o.webpush?.publicKey && o.webpush?.privateKey) {
    try {
      senders.webpush = createWebPushSender({ ...o.webpush, subject: o.webpush.subject || 'mailto:admin@localhost', fetch: o.fetch });
    } catch (e) {
      problems.push(`webpush: ${e.message}`);
    }
  }
  if (!senders.fcm && o.fcm?.serviceAccount) {
    try {
      senders.fcm = createFcmSender({ serviceAccount: o.fcm.serviceAccount, fetch: o.fetch });
    } catch (e) {
      problems.push(`fcm: ${e.message}`);
    }
  }
  if (!senders.apns && o.apns?.key) {
    try {
      senders.apns = createApnsSender(o.apns);
    } catch (e) {
      problems.push(`apns: ${e.message}`);
    }
  }
  for (const p of problems) log('push sender disabled', { reason: p });

  const store = createRegistrationStore({ file: o.stateDir ? path.join(o.stateDir, 'push-registrations.json') : null });
  /** (user, credential|null) => boolean; set by the host (GPT security H3). Unset = every registration is valid. */
  let credentialCheck = o.credentialCheck ?? null;
  const notifier = createNotifier({ store, senders, log, ...(o.notifier ?? {}), isValid: (r) => !credentialCheck || credentialCheck(r.user, r.credential ?? null) });
  const inbox = createInboxHub({ log });

  function publicConfig() {
    return {
      platforms: {
        webpush: senders.webpush ? { vapidPublicKey: o.webpush?.publicKey ?? senders.webpush.publicKey ?? null } : null,
        fcm: Boolean(senders.fcm),
        apns: Boolean(senders.apns),
      },
      inbox: true,
    };
  }

  return {
    store,
    notifier,
    inbox,
    senders,
    publicConfig,
    /** any delivery channel configured? (the inbox stream works without) */
    get canPush() {
      return Boolean(senders.webpush || senders.fcm || senders.apns);
    },
    /**
     * Bind delivery to the credential that registered a device: `check(user, credential)` must stay true, else the
     * registration is dropped before the next send. Hosts pass that credential id to `routes().handle(..., cred)`.
     * Registrations stored without a credential get `null` (hosts reject them; the app re-registers on start).
     */
    setCredentialCheck(check) {
      credentialCheck = check;
    },
    routes: (r) => createPushRoutes({ store, notifier, publicConfig, webpushHosts: o.webpush?.extraHosts ?? [], ...r }),
    /**
     * Deliver an agent message: live to the user's inbox streams if any listens, else as push.
     * ev = notifier event + `inbox` (the live payload, with content) + `inboxFilterKey` (passed to stream filters).
     * Returns 'inbox' | 'push' | 'none'.
     */
    async dispatch(ev) {
      const live = ev.inbox ? inbox.publish(ev.user, ev.inbox, ev.inboxEvent) : 0; // inboxEvent: SSE event name (default hui.message)
      if (live > 0) return 'inbox';
      if (!senders.webpush && !senders.fcm && !senders.apns) return 'none';
      const r = await notifier.notify(ev);
      return r.sent || r.skipped === 'coalesced' ? 'push' : 'none';
    },
    stop() {
      notifier.stop();
      inbox.closeAll();
      senders.apns?.close?.();
    },
  };
}
