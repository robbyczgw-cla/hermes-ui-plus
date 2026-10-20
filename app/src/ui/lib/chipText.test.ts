import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PROMPTS } from '../../onboarding/demo/prompts.ts';
import { chipMinWidth, chipTextShrinks, SHORT_CHIP_CHARS } from './chipText.ts';

test('chip text: the tour chip and other short phrases never shrink (de / en / es)', () => {
  for (const lang of ['en', 'de', 'es'] as const) assert.equal(chipTextShrinks(PROMPTS.tour[lang]), false, PROMPTS.tour[lang]);
  assert.equal(chipTextShrinks('What can you do?'), false);
  assert.equal(chipTextShrinks('¿Qué sabes hacer? ¡Sí!'), false);
});

test('chip text: long phrases shrink and wrap; the limit counts characters, not UTF-16 units', () => {
  assert.equal(chipTextShrinks('Show me a chart of the temperature trend.'), true);
  assert.equal(chipTextShrinks('é'.repeat(SHORT_CHIP_CHARS)), false);
  assert.equal(chipTextShrinks('😀'.repeat(SHORT_CHIP_CHARS)), false);
  assert.equal(chipTextShrinks('x'.repeat(SHORT_CHIP_CHARS + 1)), true);
});

test('chip min width: a short chip broken into two lines asks for its one-line width + 1 dp; one line or long chips: nothing', () => {
  assert.equal(chipMinWidth('What can you do?', [{ width: 87.1 }, { width: 22 }]), 111);
  assert.equal(chipMinWidth('What can you do?', [{ width: 109.1 }]), null);
  assert.equal(chipMinWidth('Show me a chart of the temperature trend.', [{ width: 200 }, { width: 80 }]), null);
});
