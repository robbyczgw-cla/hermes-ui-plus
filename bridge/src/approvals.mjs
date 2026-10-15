// Approval watcher (docs/SELF-HOSTING.md "Push notifications"): Hermes blocks an agent turn until the user answers
// (`event: approval.request` on /v1/chat/completions, answer = POST /v1/runs/{run_id}/approval). The bridge already
// drains the upstream SSE of every turn (also after the app went away), so it can tell the user: live inbox event
// `approval` + push, and `approval_resolved` when the question is gone (answer passed through, Hermes' own
// `approval.responded`, the turn moved on / ended, or the estimated timeout). Hermes sends NO deadline: expiresAt is
// request time + approvals.timeout (default 300 s, BRIDGE_APPROVAL_TIMEOUT_S), i.e. an estimate.
import { createSseParser } from './sse.mjs';

export const APPROVAL_REQUEST_EVENT = 'approval.request';
export const APPROVAL_RESPONDED_EVENT = 'approval.responded';
export const COMMAND_MAX = 200;
const SAFE = /^[A-Za-z0-9._:-]{1,256}$/;
const GRACE_MS = 5_000; // after the estimated deadline Hermes may still honour a choice that lands in the race window
const SEEN_MAX = 2000;

/** Answer path of Hermes' run API; returns the run id or null. */
export function approvalAnswerRun(method, path) {
  if (method !== 'POST') return null;
  const m = /^\/v1\/runs\/([^/]+)\/approval$/.exec(path);
  return m && SAFE.test(m[1]) ? m[1] : null;
}

const str = (v, max = 256) => (typeof v === 'string' && v ? v.slice(0, max) : undefined);

/**
 * @param {{
 *   onRequest: (ev: object) => void,        // new pending approval: inbox event `approval` + push
 *   onResolved: (ev: object) => void,       // inbox event `approval_resolved`
 *   now?: () => number, timeoutMs?: number, graceMs?: number, log?: {info?: Function, warn?: Function},
 * }} o
 */
export function createApprovalWatcher(o) {
  const now = o.now ?? Date.now;
  const timeoutMs = o.timeoutMs ?? 300_000;
  /** requestId -> pending request (insertion order = oldest first, like Hermes' FIFO without request_id) */
  const pending = new Map();
  const seen = new Set(); // requestIds already announced (dedupe, also across reconnects / replays)

  function resolve(requestId, reason, extra = {}) {
    const p = pending.get(requestId);
    if (!p) return false;
    pending.delete(requestId);
    clearTimeout(p.timer);
    o.onResolved({
      kind: 'approval_resolved',
      id: `ar_${requestId}`,
      sessionId: p.sessionId,
      ...(p.profile ? { hermesProfile: p.profile } : {}),
      runId: p.runId,
      completionId: p.runId,
      requestId,
      reason,
      ...extra,
      source: 'api_server',
      timestamp: now(),
    });
    return true;
  }

  /** @returns {boolean} true when this requestId was new */
  function request(r) {
    if (!r.requestId || !SAFE.test(r.requestId) || seen.has(r.requestId)) return false;
    seen.add(r.requestId);
    if (seen.size > SEEN_MAX) seen.delete(seen.values().next().value);
    const at = now();
    const expiresAt = at + timeoutMs;
    const timer = setTimeout(() => resolve(r.requestId, 'timeout'), timeoutMs + (o.graceMs ?? GRACE_MS));
    timer.unref?.();
    const profile = typeof r.profile === 'string' && r.profile ? r.profile : null;
    pending.set(r.requestId, { runId: r.runId, sessionId: r.sessionId ?? null, profile, timer });
    const command = String(r.command ?? '').replace(/\s+/g, ' ').trim();
    o.onRequest({
      kind: 'approval',
      id: `a_${r.requestId}`,
      sessionId: r.sessionId ?? null,
      // Hermes profile ("bot") of the session; absent = default profile. The app answers under /p/<profile>/
      ...(profile ? { hermesProfile: profile } : {}),
      runId: r.runId,
      completionId: r.runId,
      requestId: r.requestId,
      command: command.length > COMMAND_MAX ? `${command.slice(0, COMMAND_MAX - 1)}…` : command,
      ...(r.description ? { description: r.description } : {}),
      ...(r.smartDenied ? { risk: 'high' } : {}), // Hermes sends no risk level; a guardian denial is the only server-side signal
      ...(r.choices ? { choices: r.choices } : {}),
      expiresAt,
      source: 'api_server',
      timestamp: at,
    });
    return true;
  }

  /** The answer POST passed through the bridge (under `/p/<profile>/` for a non-default profile) and Hermes accepted it. */
  function answered(runId, body, profile = null) {
    const choice = str(body?.choice, 16);
    const extra = choice ? { choice } : {};
    const rid = str(body?.request_id);
    if (rid) return resolve(rid, 'answered', extra);
    const mine = [...pending].filter(([, p]) => p.runId === runId && (p.profile ?? null) === (profile ?? null)).map(([id]) => id);
    const targets = body?.all === true || body?.resolve_all === true ? mine : mine.slice(0, 1); // no request_id: Hermes resolves the oldest
    return targets.map((id) => resolve(id, 'answered', extra)).some(Boolean);
  }

  const settleRun = (runId, reason) => {
    for (const [id, p] of [...pending]) if (p.runId === runId) resolve(id, reason);
  };

  /**
   * Side-channel for one upstream chat SSE (bytes are forwarded elsewhere, untouched). `ctx.sessionId` is read when
   * a request arrives (response header or the client's X-Hermes-Session-Id); `ctx.profile` = Hermes profile of the
   * turn (`/p/<profile>/v1/chat/completions`, null = default).
   */
  function observe(ctx) {
    const runs = new Set();
    const parser = createSseParser(({ event, data }) => {
      if (event === APPROVAL_REQUEST_EVENT) {
        let j;
        try { j = JSON.parse(data); } catch { return; }
        const runId = str(j?.run_id);
        const requestId = str(j?.request_id);
        if (!runId || !requestId) return;
        runs.add(runId);
        request({
          runId, requestId, sessionId: str(ctx.sessionId() ?? j?.session_id, 128), profile: ctx.profile ?? null, command: j.command, description: str(j.description, 200),
          smartDenied: j.smart_denied === true, choices: Array.isArray(j.choices) ? j.choices.filter((c) => typeof c === 'string').slice(0, 5) : undefined,
        });
      } else if (event === APPROVAL_RESPONDED_EVENT) {
        let j;
        try { j = JSON.parse(data); } catch { return; }
        const rid = str(j?.request_id);
        if (rid) resolve(rid, 'answered', j?.choice ? { choice: str(j.choice, 16) } : {});
      } else if (event === 'message' && runs.size && data !== '[DONE]') {
        // the blocked agent thread produced new assistant text: the question is over (answered elsewhere / timed out)
        try {
          if (JSON.parse(data)?.choices?.[0]?.delta?.content) for (const r of runs) settleRun(r, 'continued');
        } catch { /* not JSON */ }
      }
    }, { onOversize: (m) => o.log?.warn?.('sse_frame_dropped', { where: 'approvals', ...m }) });
    let ended = false;
    return {
      push: (chunk) => { if (!ended) parser.push(chunk); },
      /** the upstream stream is over (finished, failed or stopped): nothing can be pending any more */
      end() {
        if (ended) return;
        ended = true;
        try { parser.end(); } catch { /* ignore */ }
        for (const r of runs) settleRun(r, 'ended');
      },
    };
  }

  return { observe, request, answered, pending: () => pending.size, stop() { for (const p of pending.values()) clearTimeout(p.timer); pending.clear(); } };
}
