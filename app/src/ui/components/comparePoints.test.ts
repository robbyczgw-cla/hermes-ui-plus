import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareRows } from './comparePoints.ts';

test('legacy items are neutral dots: wording is never interpreted (no cue-word heuristic)', () => {
  const items = [
    'Kein permanentes Einbrennen', // a PRO – used to get the red minus
    'Kein Direktzug. Tagfahrt ca. 11–12 h',
    'Größer und klar teurer',
    'No 5G',
    'Sin ruido',
    '+ Hall-Sticks',
    '− Nicht faltbar',
    'Contra: Kein 5G',
    '5000 mAh, ca. 255 g',
  ];
  const rows = compareRows({ items });
  assert.deepEqual(rows, items.map((text) => ({ kind: 'neutral', text })));
});

test('rows: legacy items keep their order, explicit pros/cons follow as check/minus', () => {
  assert.deepEqual(compareRows({ items: ['50 GB', 'Kein 5G'], pros: ['Günstig'], cons: ['Langsame Updates'] }), [
    { kind: 'neutral', text: '50 GB' },
    { kind: 'neutral', text: 'Kein 5G' },
    { kind: 'pro', text: 'Günstig' },
    { kind: 'con', text: 'Langsame Updates' },
  ]);
  assert.deepEqual(compareRows({}), []);
  assert.deepEqual(compareRows({ items: ['', '  '], pros: [] }), []);
});

test('explicit pros/cons: always check/minus, a repeated marker prefix is stripped, wording is irrelevant', () => {
  assert.deepEqual(compareRows({ pros: ['Kein permanentes Einbrennen', '+ Günstig', 'Vorteil: leise'], cons: ['− Laut', 'Contra: teuer', 'Kein 5G'] }), [
    { kind: 'pro', text: 'Kein permanentes Einbrennen' },
    { kind: 'pro', text: 'Günstig' },
    { kind: 'pro', text: 'leise' },
    { kind: 'con', text: 'Laut' },
    { kind: 'con', text: 'teuer' },
    { kind: 'con', text: 'Kein 5G' },
  ]);
});
