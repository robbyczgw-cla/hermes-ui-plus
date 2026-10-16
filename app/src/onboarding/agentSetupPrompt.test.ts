import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AGENT_SETUP_PROMPT } from './agentSetupPrompt.generated.ts';

const ROOT = new URL('../../../', import.meta.url);

// The app bundles the canonical prompt from docs/SETUP-WITH-AGENT.md (scripts/gen-agent-setup-prompt.mjs).
test('the bundled setup prompt is the block between the markers in docs/SETUP-WITH-AGENT.md', () => {
  const md = readFileSync(new URL('docs/SETUP-WITH-AGENT.md', ROOT), 'utf8');
  const m = /<!-- agent-setup-prompt:begin -->\n```text\n([\s\S]*?)\n```\n<!-- agent-setup-prompt:end -->/.exec(md);
  assert.ok(m, 'agent-setup-prompt block in docs/SETUP-WITH-AGENT.md');
  assert.equal(AGENT_SETUP_PROMPT, m[1], 'stale: run node scripts/gen-agent-setup-prompt.mjs');
});

test('the setup prompt names the app HUI+ and the bridge package, and has no secrets or private hosts', () => {
  const identity = JSON.parse(readFileSync(new URL('app/brand/identity.json', ROOT), 'utf8')) as { displayName: string; bridgePackage: string };
  assert.ok(AGENT_SETUP_PROMPT.includes(`${identity.displayName} app`));
  assert.ok(AGENT_SETUP_PROMPT.includes(identity.bridgePackage));
  assert.ok(AGENT_SETUP_PROMPT.includes('`tailscale funnel`'), 'forbids funnel');
  assert.doesNotMatch(AGENT_SETUP_PROMPT, /\.ts\.net|hbd_|nca_|sk-ant-|\b(?!127\.0\.0\.1)\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
});
