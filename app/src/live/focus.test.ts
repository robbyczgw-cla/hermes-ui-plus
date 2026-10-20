import assert from 'node:assert/strict';
import { test } from 'node:test';
import { editTarget, editTypes, liveHeader } from './focus.ts';

// the bridge router decides `card=<id>` with the same phrase list (bridge/src/router/live.mjs): both must agree
const CASES = [
  'Pack noch Grillkohle dazu.',
  'Die Tomaten brauch ich nicht mehr',
  'Verschieb das Forum auf Sonntag',
  'Kannst du die Preise prüfen?',
  'Setz Spülmittel auf die Liste',
  'Streich den Käse',
  'add milk to my list',
  'move the museum to the morning',
  'check prices',
  'añade pan',
  'quita los tomates',
  'Mach mir eine neue Liste für Sonntag',
  'Plane mir einen Tag in Rom',
  'Welche Kopfhörer soll ich kaufen?',
  'Danke!',
  'Was hältst du dazu?',
];

test('edit phrases: same answer as the bridge router for every case', async () => {
  const bridge = (await import(['..', '..', '..', 'bridge', 'src', 'router', 'live.mjs'].join('/'))) as { editTypes(t: string): Set<string> };
  for (const c of CASES) assert.deepEqual([...editTypes(c)].sort(), [...bridge.editTypes(c)].sort(), c);
});

test('edit target: exactly one fitting open card; a new-list request or two candidates never', () => {
  const list = { id: 'einkauf', type: 'checklist' as const };
  const watch = { id: 'kopfhoerer', type: 'products' as const };
  assert.equal(editTarget('Pack noch Grillkohle dazu.', [list]), 'einkauf');
  assert.equal(editTarget('Pack noch Grillkohle dazu.', [list, { id: 'pack', type: 'checklist' }]), undefined);
  assert.equal(editTarget('Kannst du die Preise prüfen?', [list, watch]), 'kopfhoerer');
  assert.equal(editTarget('Mach mir eine neue Liste und füg Milch hinzu', [list]), undefined);
  assert.equal(editTarget('Wie spät ist es?', [list]), undefined);
  assert.equal(editTarget('Pack noch Grillkohle dazu.', []), undefined);
});

test('X-HUI-Live: id:type, f for the focused card, p<N> patches, at most 8', () => {
  assert.equal(liveHeader([{ id: 'einkauf', type: 'checklist', patches: 0 }, { id: 'rom', type: 'trip', patches: 12 }], 'rom'), 'einkauf:checklist,rom:trip:f:p12');
  assert.equal(liveHeader(Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, type: 'checklist' as const, patches: 0 })), null).split(',').length, 8);
  assert.equal(liveHeader([], null), '');
});
