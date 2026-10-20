import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRequest } from './stream.ts';
import { liveAppendResult } from '../live/registry.ts';

const conn = { baseUrl: 'https://example.com/v1', apiKey: 'nca_test_token_000', model: 'hermes-agent' };

test('X-HUI-Live goes to the UI bridge only (a direct Hermes would refuse the header in CORS)', () => {
  const viaBridge = buildRequest({ ...conn, bridge: true, bootstrap: false }, 'hi', 'hui-1', undefined, true, undefined, true, 'einkauf:checklist');
  assert.equal(viaBridge.headers['X-HUI-Live'], 'einkauf:checklist');
  const direct = buildRequest(conn, 'hi', 'hui-1', undefined, true, undefined, true, 'einkauf:checklist');
  assert.equal(direct.headers['X-HUI-Live'], undefined);
  assert.equal(buildRequest({ ...conn, bridge: true }, 'hi', 'hui-1', undefined, true, undefined, true, '').headers['X-HUI-Live'], undefined);
});

test('add_to_list on a live list: a ticked item opened again counts as reopened, not as added', () => {
  const r = liveAppendResult(['Milch', 'Brot', 'Eier'], { cardId: 'einkauf', added: ['Brot'], reopened: ['Milch'] });
  assert.equal(r.status, 'appended');
  if (r.status !== 'appended') return;
  assert.deepEqual([r.added, r.reopened, r.skipped], [['Brot'], ['Milch'], ['Eier']]);
});
