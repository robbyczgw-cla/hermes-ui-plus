import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AGENT_PROMPTS, BRIDGE_PACKAGE, agentPrompt, agentPromptText, getAgentPrompts } from './agentPrompts.ts';

const LANGS = ['de', 'en', 'es'] as const;

test('every prompt exists in de/en/es, names the bridge package and has no secrets or real hosts', () => {
  assert.deepEqual(AGENT_PROMPTS.map((p) => p.id), ['hermes', 'cli', 'troubleshoot', 'update']);
  for (const p of AGENT_PROMPTS) {
    for (const l of LANGS) {
      const text = p.prompt[l];
      assert.ok(text.length > 200 && p.title[l] && p.subtitle[l], `${p.id}/${l}`);
      assert.ok(text.includes(BRIDGE_PACKAGE), `${p.id}/${l} names the package`);
      assert.doesNotMatch(text, /\.ts\.net|hbd_|sk-ant-|\b(?!127\.0\.0\.1)\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/, `${p.id}/${l}`);
      assert.doesNotMatch(text, /tailscale funnel(?![`'])/i, 'funnel only appears as a "never" rule'); // in backticks
    }
    // the same commands in every language
    const cmds = (s: string) => (s.match(/`[^`]*hermes-ui-plus-bridge[^`]*`/g) ?? []).filter((c) => !c.includes('<'));
    assert.deepEqual(cmds(p.prompt.de), cmds(p.prompt.en), `${p.id} de commands`);
    assert.deepEqual(cmds(p.prompt.es), cmds(p.prompt.en), `${p.id} es commands`);
  }
  for (const id of ['hermes', 'cli', 'troubleshoot'] as const) {
    for (const l of LANGS) assert.ok(agentPromptText(id, l).includes('`tailscale funnel`'), `${id}/${l} forbids funnel`);
  }
  assert.ok(agentPrompt('hermes').prompt.en.includes('setup --yes --json'));
  assert.throws(() => agentPrompt('nope' as never), /unknown/);
});

test('getAgentPrompts shape for the guided onboarding', () => {
  for (const l of LANGS) {
    const p = getAgentPrompts(l);
    assert.equal(p.hermesSetup, agentPromptText('hermes', l));
    assert.equal(p.coderSetup, agentPromptText('cli', l));
    assert.equal(p.troubleshoot, agentPromptText('troubleshoot', l));
    assert.equal(p.update, agentPromptText('update', l));
  }
});

test('docs/SETUP-WITH-AGENT.md mirrors the English and German prompts verbatim', () => {
  const doc = readFileSync(new URL('../../../docs/SETUP-WITH-AGENT.md', import.meta.url), 'utf8');
  for (const p of AGENT_PROMPTS) {
    for (const l of ['en', 'de'] as const) assert.ok(doc.includes(`\`\`\`text\n${p.prompt[l]}\n\`\`\``), `${p.id}/${l} out of sync with the doc`);
  }
});
