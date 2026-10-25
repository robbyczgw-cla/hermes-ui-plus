// Admin endpoints for per-device tokens (review M5). Only BRIDGE_TOKEN (admin) may use them; device tokens get 403.
//   GET    /bridge/devices            -> {devices: [{id, label, createdAt, lastUsedAt, status}]}   (never hashes/tokens)
//   POST   /bridge/devices {label}    -> 201 {id, pairUri, webPairUri, expiresAt}   (one-time pair code in the link,
//                                         1 hour; the app redeems it for its token: POST /bridge/pair/redeem)
//   DELETE /bridge/devices/<id>       -> 204   (takes effect immediately; open inbox streams end within ~30 s)
// CLI equivalent (works on the state directory, picked up by a running bridge): `hermes-ui-bridge devices …`.
import { applyCors } from './cors.mjs';

export const DEVICES_PATH = '/bridge/devices';
const ITEM_RE = /^\/bridge\/devices\/(d_[a-z0-9]{10})$/;

/**
 * @param {{auth: ReturnType<typeof import('./auth.mjs').createAuth>, devices: any, issue: (label: string) => {id: string|null, uri: string, webUri?: string, expiresAt: number|null}, corsOrigins?: string[]}} o
 */
export function createDeviceAdmin({ auth, devices, issue, corsOrigins = [] }) {
  const json = (res, status, body) => {
    const buf = Buffer.from(JSON.stringify(body));
    res.writeHead(status, { 'content-type': 'application/json', 'content-length': buf.length, 'cache-control': 'no-store', 'x-hermes-ui-bridge': '1' });
    res.end(buf);
  };
  const err = (res, status, message, code) => json(res, status, { error: { message, type: 'invalid_request_error', code } });
  const pathOf = (req) => (req.url ?? '').split('?')[0];
  return {
    matches: (req) => req.method !== 'OPTIONS' && (pathOf(req) === DEVICES_PATH || pathOf(req).startsWith(`${DEVICES_PATH}/`)),
    async handle(req, res) {
      const p = pathOf(req);
      applyCors(corsOrigins, req, res);
      const who = auth.check(req);
      if (!who) {
        req.resume();
        return err(res, 401, 'Invalid bridge token', 'invalid_api_key');
      }
      if (who.kind === 'device') {
        req.resume();
        return err(res, 403, 'Device tokens cannot manage devices (use BRIDGE_TOKEN)', 'admin_required');
      }
      if (!devices) {
        req.resume();
        return err(res, 404, 'Per-device tokens are off (set BRIDGE_STATE_DIR)', 'devices_off');
      }
      if (p === DEVICES_PATH && req.method === 'GET') return json(res, 200, { devices: devices.list() });
      if (p === DEVICES_PATH && req.method === 'POST') {
        const chunks = [];
        let size = 0;
        for await (const c of req) {
          const chunk = Buffer.from(c);
          size += chunk.length;
          if (size > 4096) return err(res, 413, 'Request body too large', 'payload_too_large');
          chunks.push(chunk);
        }
        const raw = Buffer.concat(chunks).toString('utf8');
        let label = 'device';
        try {
          if (raw.trim()) label = String(JSON.parse(raw)?.label ?? label);
        } catch {
          return err(res, 400, 'Body must be JSON {"label": "…"}', 'invalid_json');
        }
        const d = issue(label); // same path as the QR page: pending until the app redeems the code
        return json(res, 201, { id: d.id, pairUri: d.uri, webPairUri: d.webUri || undefined, expiresAt: d.expiresAt });
      }
      const m = ITEM_RE.exec(p);
      if (m && req.method === 'DELETE') {
        req.resume();
        return devices.revoke(m[1]) ? (res.writeHead(204, { 'cache-control': 'no-store' }), res.end()) : err(res, 404, 'Unknown device', 'not_found');
      }
      req.resume();
      return err(res, p === DEVICES_PATH || m ? 405 : 404, p === DEVICES_PATH || m ? 'Method not allowed' : 'Not found', p === DEVICES_PATH || m ? 'method_not_allowed' : 'not_found');
    },
  };
}
