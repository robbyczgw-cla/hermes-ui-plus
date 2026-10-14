/// <reference types="node" />
import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { APPROVAL_REQUEST_TIMEOUT_MS, fetchRunStatusCore, isHermesError, respondApprovalCore, type FetchLike } from './stream.ts';

const conn = { baseUrl: 'https://example.com/v1', apiKey: 'dummy-test-token' };

for (const stall of ['approval headers', 'approval error body', 'run status body'] as const) {
  test(`${stall} timeout releases the approval flow without replaying the decision`, async () => {
    let signal: AbortSignal | undefined;
    let calls = 0;
    const fetchImpl: FetchLike = async (_url, init) => {
      calls++;
      signal = init.signal;
      if (stall === 'approval headers') return new Promise(() => {});
      return {
        ok: stall === 'run status body', status: stall === 'run status body' ? 200 : 409,
        headers: new Headers(), body: null, text: () => new Promise(() => {}),
      };
    };
    const request = stall === 'run status body'
      ? fetchRunStatusCore(fetchImpl, conn, 'test-run', 20)
      : respondApprovalCore(fetchImpl, conn, { runId: 'test-run', requestId: 'test-request' }, 'once', 20);
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    try {
      const outcome = await Promise.race([
        request.then(() => 'success', (e: unknown) => isHermesError(e) ? e.kind : 'unexpected error'),
        new Promise<string>((resolve) => { watchdog = setTimeout(() => resolve('still waiting'), 200); }),
      ]);
      assert.equal(outcome, 'timeout');
      assert.equal(signal?.aborted, true);
      assert.equal(calls, 1);
    } finally {
      clearTimeout(watchdog);
    }
  });
}

test('approval answer and run status wait 30 s by default (aligned, not 10 s)', async () => {
  assert.equal(APPROVAL_REQUEST_TIMEOUT_MS, 30_000);
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    for (const which of ['approval', 'status'] as const) {
      const fetchImpl: FetchLike = () => new Promise(() => {});
      let settled: string | undefined;
      const req = which === 'approval' ? respondApprovalCore(fetchImpl, conn, { runId: 'test-run', requestId: 'test-request' }, 'once') : fetchRunStatusCore(fetchImpl, conn, 'test-run');
      const done = req.then(() => 'ok', (e: unknown) => (isHermesError(e) ? e.kind : 'unexpected')).then((v) => void (settled = v));
      mock.timers.tick(10_001);
      await new Promise((r) => setImmediate(r));
      assert.equal(settled, undefined, `${which}: still waiting after 10 s`);
      mock.timers.tick(20_000);
      await done;
      assert.equal(settled, 'timeout', which);
    }
  } finally {
    mock.timers.reset();
  }
});
