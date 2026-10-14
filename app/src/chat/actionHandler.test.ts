import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleChatAction, runnerSent, type ChatActionDeps } from './actionHandler.ts';
import type { HuiAction } from '../protocol/types.ts';
import type { TFn } from '../i18n/core.ts';

type Ran = { action: HuiAction; options?: { confirm?: boolean; hint?: string } };

function harness(opts: { built?: string; runResult?: unknown; busy?: boolean } = {}) {
  const sent: string[] = [];
  const ran: Ran[] = [];
  const toasts: string[] = [];
  const deps: ChatActionDeps = {
    send: (t) => (sent.push(t), true),
    isBusy: () => !!opts.busy,
    run: (action, options) => {
      ran.push({ action, options });
      return Promise.resolve(opts.runResult ?? { ok: true, status: 'done' });
    },
    buildAsk: async (a) => opts.built ?? a.text,
  };
  const ui = { toast: (m: string) => void toasts.push(m), tr: ((k: string) => k) as TFn, tapHaptic: () => {} };
  return { deps, ui, sent, ran, toasts };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

test('ask: label = question and no values attached → one tap', async () => {
  const h = harness();
  assert.equal(handleChatAction(h.deps, h.ui, { type: 'ask', text: 'Was kostet das?' }, undefined, { label: 'Was kostet das?' }), true);
  await flush();
  assert.deepEqual(h.sent, ['Was kostet das?']);
  assert.equal(h.ran.length, 0);
});

test('ask: label = question but node values are appended → confirmation sheet with the FULL text', async () => {
  const built = 'Was kostet das?\n\n[calc:c1] {"total":42}';
  const h = harness({ built });
  handleChatAction(h.deps, h.ui, { type: 'ask', text: 'Was kostet das?', include: ['c1'] }, undefined, { label: 'Was kostet das?' });
  await flush();
  assert.deepEqual(h.sent, []);
  assert.equal(h.ran.length, 1);
  assert.deepEqual(h.ran[0].action, { type: 'send', text: built });
  assert.equal(h.ran[0].options?.confirm, true);
  assert.equal(h.ran[0].options?.hint, 'actionRunner.describe.send.askValuesHint');
});

test('ask: include given but nothing found to attach still confirms (include is non-empty)', async () => {
  const h = harness();
  handleChatAction(h.deps, h.ui, { type: 'ask', text: 'Weiter', include: ['missing'] }, undefined, { label: 'Weiter' });
  await flush();
  assert.deepEqual(h.sent, []);
  assert.equal(h.ran[0]?.options?.confirm, true);
});

test('ask: built text differs from the label (e.g. truncated / rewritten) → confirm', async () => {
  const h = harness({ built: 'Weiter…' });
  handleChatAction(h.deps, h.ui, { type: 'ask', text: 'Weiter' }, undefined, { label: 'Weiter' });
  await flush();
  assert.deepEqual(h.sent, []);
  assert.equal(h.ran.length, 1);
});

test('submit with hidden form text: stays editable, then marked sent once the sheet really sent it', async () => {
  const h = harness({ runResult: { ok: true, status: 'done' } });
  let sentCalls = 0;
  const r = handleChatAction(h.deps, h.ui, { type: 'submit' }, { 'Anzahl Personen': 2 }, { formId: 'trip', onSent: () => void sentCalls++ });
  assert.equal(r, false, 'form waits for the sheet');
  assert.equal(sentCalls, 0);
  await flush();
  assert.equal(sentCalls, 1, 'locked after the confirmed send');
});

test('submit with hidden form text: cancelled or refused in the sheet → the form stays editable', async () => {
  for (const runResult of [{ ok: true, status: 'cancelled' }, { ok: false, error: 'busy' }]) {
    const h = harness({ runResult });
    let sentCalls = 0;
    handleChatAction(h.deps, h.ui, { type: 'submit' }, { 'Anzahl Personen': 2 }, { formId: 'trip', onSent: () => void sentCalls++ });
    await flush();
    assert.equal(sentCalls, 0, JSON.stringify(runResult));
  }
});

test('runnerSent only accepts a done result', () => {
  assert.equal(runnerSent({ ok: true, status: 'done' }), true);
  assert.equal(runnerSent({ ok: true, status: 'cancelled' }), false);
  assert.equal(runnerSent({ ok: false, error: 'x' }), false);
  assert.equal(runnerSent(undefined), false);
});
