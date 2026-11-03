/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { centeredTitleBox } from './centeredTitle.ts';

test('a centered Gloock title takes the full width (Android cut "Alles bereit" to "Alles")', () => {
  assert.deepEqual(centeredTitleBox('hero', 'center'), { alignSelf: 'stretch' });
  assert.deepEqual(centeredTitleBox('heroCompact', 'center'), { alignSelf: 'stretch' });
  assert.equal(centeredTitleBox('hero', undefined), null);
  assert.equal(centeredTitleBox('body', 'center'), null);
  // HText applies it, so every centered title (onboarding done, guided done, empty chat list) gets it
  const basics = readFileSync(new URL('../primitives/basics.tsx', import.meta.url), 'utf8');
  assert.match(basics, /centeredTitleBox\(variant, align\)/);
});
