import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractSetupPrompt, renderModule } from './gen-agent-setup-prompt.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('app/src/onboarding/agentSetupPrompt.generated.ts is up to date with docs/SETUP-WITH-AGENT.md', () => {
  const want = renderModule(extractSetupPrompt(readFileSync(join(ROOT, 'docs/SETUP-WITH-AGENT.md'), 'utf8')));
  assert.equal(readFileSync(join(ROOT, 'app/src/onboarding/agentSetupPrompt.generated.ts'), 'utf8'), want, 'run node scripts/gen-agent-setup-prompt.mjs');
});

test('extractSetupPrompt: needs both markers around a text block', () => {
  assert.equal(extractSetupPrompt('x\n<!-- agent-setup-prompt:begin -->\n```text\nhello\n`a`\n```\n<!-- agent-setup-prompt:end -->\n'), 'hello\n`a`');
  assert.throws(() => extractSetupPrompt('no block'), /not found/);
});
