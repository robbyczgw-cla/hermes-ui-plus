/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Guard: the shared app-only controls draw nothing inside a share-as-image frame (ui/lib/capture.tsx). Each is exported
 * as a thin wrapper `useCaptureMode() ? null : <XInner …/>`; a refactor that exports the control directly would put
 * "Send", "Compare", "Next", copy buttons … back into shared images.
 */
const UI = fileURLToPath(new URL('../', import.meta.url));
const GATED: [file: string, names: string[]][] = [
  ['primitives/Button.tsx', ['Button']],
  ['components/modules/b/controls.tsx', ['Btn', 'RoundBtn']],
  ['components/modules/a/shared.tsx', ['IconButton']],
  ['components/modules/d1/parts.tsx', ['HeaderPill', 'ActionTile']],
  ['components/modules/e2/parts.tsx', ['CopyButton']],
  ['components/modules/e2/review.tsx', ['ReviewBar']],
];

test('app-only controls are hidden in capture mode', () => {
  for (const [file, names] of GATED) {
    const src = readFileSync(UI + file, 'utf8');
    for (const n of names) {
      assert.match(src, new RegExp(`export function ${n}\\(props: Parameters<typeof ${n}Inner>\\[0\\]\\) \\{\\n  return useCaptureMode\\(\\) \\? null : <${n}Inner \\{\\.\\.\\.props\\} />;`), `${file}: ${n}`);
      assert.doesNotMatch(src, new RegExp(`export function ${n}Inner\\b`), `${file}: ${n}Inner must stay private`);
    }
  }
});
