import { test } from 'node:test';
import assert from 'node:assert/strict';
import { innerShouldFill, splitPressableStyle } from './pressableLayout.ts';

test('content-sized pressables (flex-start buttons, badges) never get flexGrow', () => {
  assert.equal(innerShouldFill({ alignSelf: 'flex-start', minHeight: 36 }), false);
  assert.equal(innerShouldFill({ width: 28, height: 28 }), false);
  assert.equal(innerShouldFill({}), false);
  const [outer, inner] = splitPressableStyle({ alignSelf: 'flex-start', paddingHorizontal: 10, minHeight: 36 });
  assert.deepEqual(outer, { alignSelf: 'flex-start' });
  assert.equal('flexGrow' in inner, false);
});
test('flex / stretch pressables fill', () => {
  assert.equal(innerShouldFill({ flex: 1, minHeight: 56 }), true);
  assert.equal(innerShouldFill({ flexGrow: 1 }), true);
  assert.equal(innerShouldFill({ alignSelf: 'stretch' }), true);
  assert.equal(innerShouldFill({ flex: 0 }), false);
  assert.equal(splitPressableStyle({ flex: 1, minHeight: 56 })[1].flexGrow, 1);
});
