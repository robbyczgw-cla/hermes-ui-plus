/// <reference types="node" />
// "Über <Name>" (bots/BotInfoSheet.tsx) lists every routine of the bot: with a few routines, a small phone or large text
// it is taller than the screen. Without a cap the bottom sheet grew past the top edge (name, model unreachable).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = readFileSync(fileURLToPath(new URL('./BotInfoSheet.tsx', import.meta.url)), 'utf8');

test('"Über <Name>" is capped like the other long sheets and its content scrolls inside', () => {
  assert.match(src, /<SheetModal[^>]*maxHeight="88%"/);
  assert.match(src, /<ScrollView style=\{styles\.scroll\}/);
  assert.match(src, /scroll: \{ flexGrow: 0, flexShrink: 1 \}/);
});
