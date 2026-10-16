import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shareSendDecision, type ConfirmedShare } from './send.ts';

const confirmed: ConfirmedShare = { text: 'shared test text', fileIds: ['file-test-1'] };
const ready = { text: confirmed.text, attachments: [{ id: 'file-test-1' }], picking: false, uploading: false, error: null, canSend: true, disabled: false, streaming: false };

test('a confirmed share sends only its complete, unchanged text and attachment set', () => {
  assert.equal(shareSendDecision(confirmed, ready), 'send');
  assert.equal(shareSendDecision(confirmed, { ...ready, attachments: [] }), 'keep');
  assert.equal(shareSendDecision(confirmed, { ...ready, attachments: [{ id: 'own-test-file' }] }), 'keep');
  assert.equal(shareSendDecision(confirmed, { ...ready, attachments: [...ready.attachments, { id: 'own-test-file' }] }), 'keep');
  assert.equal(shareSendDecision(confirmed, { ...ready, error: 'file could not be read' }), 'keep');
});

test('text typed during a delayed file import is kept for explicit Send', async () => {
  let finish!: () => void;
  const importDone = new Promise<void>((resolve) => { finish = resolve; });
  let text = '';
  const prepare = async () => {
    await importDone;
    text = `${text}\n\n${confirmed.text}`;
    return shareSendDecision(confirmed, { ...ready, text });
  };
  const pending = prepare();
  text = 'my unsent test note';
  finish();
  assert.equal(await pending, 'keep');
  assert.equal(text, `my unsent test note\n\n${confirmed.text}`);
});

test('new text while an upload is pending revokes the share auto-send', () => {
  assert.equal(shareSendDecision(confirmed, { ...ready, uploading: true, canSend: false }), 'wait');
  assert.equal(shareSendDecision(confirmed, { ...ready, text: 'another test draft', uploading: true, canSend: false }), 'keep');
  assert.equal(shareSendDecision(confirmed, { ...ready, uploading: true }), 'send', 'a chat that queues uploads can accept the unchanged share');
  assert.equal(shareSendDecision(confirmed, { ...ready, streaming: true, canSend: false }), 'keep');
});
