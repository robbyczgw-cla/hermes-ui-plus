/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  advertisesSessions,
  chatOptionsSummary,
  effectiveChatOptions,
  hasFeature,
  modelCapsFor,
  modelOptionsBody,
  parseCapabilities,
  parseModelOptions,
  sanitizeChatOptions,
} from './capabilities.ts';
import { BOOTSTRAP_SYSTEM_MESSAGE } from './bootstrap.ts';
import { buildRequest, FOLLOWUPS_OFF_MESSAGE } from './stream.ts';

// shape of GET /v1/capabilities on hermes-host (2026-10-10), shortened
const CAPS = {
  object: 'hermes.api_server.capabilities',
  platform: 'hermes-agent',
  model: 'hermes-agent',
  auth: { type: 'bearer', required: true },
  features: {
    chat_completions: true,
    tool_progress_events: true,
    approval_events: true,
    session_resources: true,
    model_options: true,
    reasoning_streaming: true,
    audio_api: false,
    session_continuity_header: 'X-Hermes-Session-Id',
    session_key_header: 'X-Hermes-Session-Key',
    cors: true,
    browser_extension_control: { enabled: false },
  },
  endpoints: { sessions: { method: 'GET', path: '/api/sessions' }, model_options: { method: 'GET', path: '/api/model/options' } },
};

test('parseCapabilities: boolean flags, headers, endpoints', () => {
  const c = parseCapabilities(CAPS)!;
  assert.equal(c.model, 'hermes-agent');
  assert.equal(c.flags.reasoning_streaming, true);
  assert.equal(c.flags.audio_api, false);
  assert.equal('browser_extension_control' in c.flags, false);
  assert.equal(c.sessionIdHeader, 'X-Hermes-Session-Id');
  assert.deepEqual(c.endpoints, ['sessions', 'model_options']);
  assert.equal(hasFeature(c, 'approval_events'), true);
  assert.equal(hasFeature(c, 'unknown', true), true);
  assert.equal(hasFeature(null, 'x'), false);
  assert.equal(advertisesSessions(c), true);
  assert.equal(parseCapabilities({ error: 'x' }), null);
  assert.equal(parseCapabilities('nope'), null);
});

const OPTIONS = {
  model: 'kimi-k2',
  provider: 'moonshot',
  providers: [
    { slug: 'openrouter', name: 'OpenRouter', is_current: false, models: ['deepseek/r1'], capabilities: { 'deepseek/r1': { fast: false, reasoning: true, can_disable_reasoning: false } } },
    { slug: 'moonshot', name: 'Moonshot', is_current: true, models: ['kimi-k2', 'kimi-k2-mini'], capabilities: { 'kimi-k2': { fast: true, reasoning: true }, 'kimi-k2-mini': { fast: false, reasoning: false } } },
    { name: 'no slug' },
  ],
};

test('parseModelOptions + modelCapsFor', () => {
  const o = parseModelOptions(OPTIONS)!;
  assert.equal(o.providers.length, 2);
  assert.equal(o.currentModel, 'kimi-k2');
  // server default → current model
  assert.deepEqual(modelCapsFor(o, undefined), { reasoning: true, canDisableReasoning: true, fast: true });
  assert.deepEqual(modelCapsFor(o, 'hermes-agent'), { reasoning: true, canDisableReasoning: true, fast: true });
  assert.equal(modelCapsFor(o, 'kimi-k2-mini').reasoning, false);
  assert.equal(modelCapsFor(o, 'openrouter/deepseek/r1').canDisableReasoning, false);
  assert.deepEqual(modelCapsFor(o, 'unknown'), { reasoning: true, canDisableReasoning: true, fast: false });
  assert.deepEqual(modelCapsFor(null, 'x'), { reasoning: true, canDisableReasoning: true, fast: false });
  assert.equal(parseModelOptions({}), null);
});

test('model_options body (verified request shape)', () => {
  assert.equal(modelOptionsBody(undefined), undefined);
  assert.equal(modelOptionsBody({ reasoning: 'default' }), undefined);
  assert.deepEqual(modelOptionsBody({ reasoning: 'off' }), { reasoning: { enabled: false } });
  assert.deepEqual(modelOptionsBody({ reasoning: 'high', fast: true }), { reasoning: { enabled: true, effort: 'high' }, fast: true });
});

test('sanitize / effective options / summary', () => {
  assert.deepEqual(sanitizeChatOptions({ reasoning: 'high', fast: true, x: 1 }), { reasoning: 'high', fast: true });
  assert.equal(sanitizeChatOptions({ reasoning: 'ultra-bogus' }), undefined);
  assert.equal(sanitizeChatOptions('x'), undefined);
  const noFast = { reasoning: true, canDisableReasoning: false, fast: false };
  assert.deepEqual(effectiveChatOptions({ reasoning: 'off', fast: true }, noFast), undefined);
  assert.deepEqual(effectiveChatOptions({ reasoning: 'low', fast: true }, noFast), { reasoning: 'low' });
  assert.deepEqual(effectiveChatOptions({ reasoning: 'off' }, { reasoning: false, canDisableReasoning: false, fast: false }), { reasoning: 'off' });
  assert.equal(chatOptionsSummary({ reasoning: 'xhigh', fast: true }), 'Denken: Sehr hoch · Schnell');
  assert.equal(chatOptionsSummary({ reasoning: 'off' }), 'Denken aus');
  assert.equal(chatOptionsSummary(undefined), '');
});

test('buildRequest adds model_options only when set', () => {
  const conn = { baseUrl: 'http://h/v1', apiKey: 'k' };
  assert.equal('model_options' in JSON.parse(buildRequest(conn, 'hi', 's').body), false);
  const body = JSON.parse(buildRequest(conn, 'hi', 's', { reasoning: 'medium', fast: true }).body);
  assert.deepEqual(body.model_options, { reasoning: { enabled: true, effort: 'medium' }, fast: true });
  assert.equal(body.messages.at(-1).content, 'hi');
});

test('buildRequest: follow-ups on (default) adds nothing, off adds ONE system message before the user message', () => {
  const direct = { baseUrl: 'http://h/v1', apiKey: 'k' };
  const bridge = { ...direct, bootstrap: false };
  const user = { role: 'user', content: 'hi' };
  const boot = { role: 'system', content: BOOTSTRAP_SYSTEM_MESSAGE };
  const off = { role: 'system', content: '[hermes-ui-app] Follow-up suggestions are switched off in the app: do not add a suggestions block.' };
  assert.equal(FOLLOWUPS_OFF_MESSAGE, off.content);
  const msgs = (conn: typeof direct, followups?: boolean) => JSON.parse(buildRequest(conn, 'hi', 's', undefined, followups).body).messages;
  // on: byte-identical to before (prompt caching)
  assert.deepEqual(msgs(direct), [boot, user]);
  assert.deepEqual(msgs(direct, true), [boot, user]);
  assert.deepEqual(msgs(bridge), [user]);
  assert.deepEqual(msgs(bridge, true), [user]);
  // off: direct = bootstrap + notice + user; bridge = notice + user (the bridge injects the bootstrap)
  assert.deepEqual(msgs(direct, false), [boot, off, user]);
  assert.deepEqual(msgs(bridge, false), [off, user]);
});

import { catalogSummary } from './capabilities.ts';
test('catalogSummary counts distinct models over usable providers only', () => {
  const cat = parseModelOptions({
    providers: [
      { slug: 'a', name: 'A', models: ['m', 'm', 'n'], authenticated: true },
      { slug: 'b', name: 'B', models: ['m'], authenticated: true },
      { slug: 'c', name: 'C', models: ['x', 'y'], authenticated: false },
      { slug: 'd', name: 'D', models: [] },
    ],
  });
  assert.deepEqual(catalogSummary(cat), { models: 3, providers: 2 });
  assert.equal(catalogSummary(null), null);
});
