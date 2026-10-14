import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInline } from './inlineMarkdown.ts';

test('plain', () => assert.deepEqual(parseInline('Hallo Welt'), [{ text: 'Hallo Welt' }]));
test('bold italic code', () => {
  const s = parseInline('Ein **fetter** und *kursiver* Text mit `code`.');
  assert.deepEqual(s.map((x) => [x.text, !!x.bold, !!x.italic, !!x.code]), [
    ['Ein ', false, false, false], ['fetter', true, false, false], [' und ', false, false, false],
    ['kursiver', false, true, false], [' Text mit ', false, false, false], ['code', false, false, true], ['.', false, false, false],
  ]);
});
test('nested bold italic', () => {
  const s = parseInline('**sehr *wichtig***');
  assert.ok(s.some((x) => x.text === 'wichtig' && x.bold && x.italic));
});
test('links', () => {
  const s = parseInline('Siehe [Doku](https://example.com) oder https://hermes.dev/x.');
  assert.equal(s[1].href, 'https://example.com');
  assert.equal(s[1].text, 'Doku');
  assert.equal(s[3].href, 'https://hermes.dev/x');
  assert.equal(s[4].text, '.');
});
test('snake_case not italic, unclosed streaming bold', () => {
  assert.deepEqual(parseInline('my_var_name'), [{ text: 'my_var_name' }]);
  const s = parseInline('Das ist **wich');
  assert.equal(s[1].text, 'wich');
  assert.ok(s[1].bold);
  assert.deepEqual(parseInline('3 * 4 = 12'), [{ text: '3 * 4 = 12' }]);
});

// GPT review #6: every unmatched `[` / marker searched the whole remaining suffix (10 000 brackets ≈ 50 M
// units of indexOf scanning). Count the scanned characters instead of timing (load-independent).
function scannedChars(run: () => void): number {
  const orig = String.prototype.indexOf;
  let total = 0;
  String.prototype.indexOf = function (this: string, needle: string, from?: number) {
    const start = Math.max(0, from ?? 0);
    const r = orig.call(this, needle, from);
    total += (r < 0 ? this.length : r) - start;
    return r;
  } as typeof String.prototype.indexOf;
  try {
    run();
  } finally {
    String.prototype.indexOf = orig;
  }
  return total;
}
test('UI inline tokenizer: unmatched brackets / markers scan linearly (operation count)', () => {
  for (const unit of ['[ ', '[a]( ', '*a ', '_a ', '`', '~~a ', '**a ', '\\* *']) {
    const s = unit.repeat(Math.ceil(10_000 / unit.length));
    const ops = scannedChars(() => parseInline(s));
    assert.ok(ops <= 20 * s.length, `${JSON.stringify(unit)}: ${ops} chars scanned for ${s.length}`);
  }
});
