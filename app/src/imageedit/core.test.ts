/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeT } from '../i18n/core.ts';
import type { Attachment } from '../attachments/types.ts';
import { DEFAULT_OPENAI_CAPS } from '../attachments/openaiCaps.ts';
import { buildEditRequestText, editGate, editSourceOf, findEditPairs, isEditRequestText, markEditAttachment, resultImageUrl } from './core.ts';

const de = makeT('de', 'de-DE');
const en = makeT('en', 'en-US');
const es = makeT('es', 'es-ES');

const img = (id: string, extra: Partial<Attachment> = {}): Attachment => ({
  id,
  kind: 'image',
  name: `${id}.jpg`,
  mimeType: 'image/jpeg',
  size: 1000,
  uri: `file:///docs/attachments/${id}.jpg`,
  status: 'ready',
  ...extra,
});

test('edit request text per language, whitespace collapsed, empty → generic', () => {
  assert.equal(buildEditRequestText('  Hintergrund\n entfernen ', de), 'Bitte bearbeite dieses Bild: Hintergrund entfernen');
  assert.equal(buildEditRequestText('Comic style', en), 'Please edit this image: Comic style');
  assert.equal(buildEditRequestText('Como acuarela', es), 'Por favor, edita esta imagen: Como acuarela');
  assert.equal(buildEditRequestText('   ', de), 'Bitte bearbeite dieses Bild.');
});

test('edit request detection works across UI languages', () => {
  assert.ok(isEditRequestText(buildEditRequestText('heller', de)));
  assert.ok(isEditRequestText(buildEditRequestText('brighter', en)));
  assert.ok(isEditRequestText(buildEditRequestText('más luz', es)));
  assert.ok(isEditRequestText('please edit this image.'));
  assert.ok(!isEditRequestText('Bitte erkläre dieses Bild'));
  assert.ok(!isEditRequestText(''));
});

test('marked attachment wins; text fallback needs an image', () => {
  const marked = markEditAttachment(img('a'));
  assert.equal(marked.purpose, 'edit');
  assert.equal(editSourceOf({ id: 'u', role: 'user', text: 'hi', attachments: [img('x'), marked] })?.id, 'a');
  assert.equal(editSourceOf({ id: 'u', role: 'user', text: 'Please edit this image: x', attachments: [img('b')] })?.id, 'b');
  assert.equal(editSourceOf({ id: 'u', role: 'user', text: 'Please edit this image: x' }), null);
  assert.equal(editSourceOf({ id: 'u', role: 'user', text: 'Was ist das?', attachments: [img('c')] }), null);
  assert.equal(editSourceOf({ id: 'a', role: 'assistant', text: 'Please edit this image: x', attachments: [img('d')] }), null);
});

test('edit pairs: only the answer right after the request', () => {
  const msgs = [
    { id: 'u1', role: 'user', text: buildEditRequestText('comic', de), attachments: [markEditAttachment(img('s1'))] },
    { id: 'a1', role: 'assistant', text: 'Fertig' },
    { id: 'u2', role: 'user', text: 'Danke' },
    { id: 'a2', role: 'assistant', text: 'Gern' },
  ];
  const pairs = findEditPairs(msgs);
  assert.deepEqual([...pairs], [['a1', 'file:///docs/attachments/s1.jpg']]);
});

test('result image: attachment, hui image, gallery, markdown (relative resolved), none', () => {
  assert.equal(resultImageUrl({ text: 'x', attachments: [img('gen')] }, null), 'file:///docs/attachments/gen.jpg');
  const hui = 'Hier:\n```hui\n{"type":"image","url":"file:///docs/generated/img-1.png","alt":"x"}\n```\nok';
  assert.equal(resultImageUrl({ text: hui }, null), 'file:///docs/generated/img-1.png');
  const gallery = '```hui\n{"type":"stack","children":[{"type":"text","text":"a"},{"type":"gallery","items":[{"query":"Paris"},{"url":"https://x.test/b.png"}]}]}\n```';
  assert.equal(resultImageUrl({ text: gallery }, null), 'https://x.test/b.png');
  assert.equal(resultImageUrl({ text: 'Fertig ![neu](/v1/attachments/tok123)' }, 'https://pip.example/v1'), 'https://pip.example/v1/attachments/tok123');
  assert.equal(resultImageUrl({ text: '![neu](/v1/attachments/tok123)' }, null), null);
  assert.equal(resultImageUrl({ text: 'Kein Bild, nur Text.' }, null), null);
  assert.equal(resultImageUrl({ text: '```hui\n{broken\n```' }, null), null);
});

test('capability gating per backend', () => {
  assert.deepEqual(editGate({ kind: 'demo' }, null), { ok: false, reason: 'imageEdit.blocked.demo' });
  assert.deepEqual(editGate({ kind: 'openai' }, null), { ok: false, reason: 'imageEdit.blocked.attachmentsOff' });
  assert.deepEqual(editGate({ kind: 'openai' }, { ...DEFAULT_OPENAI_CAPS, images: false }), { ok: false, reason: 'imageEdit.blocked.noImages' });
  assert.deepEqual(editGate({ kind: 'openai' }, DEFAULT_OPENAI_CAPS), { ok: true, target: { kind: 'openai', caps: DEFAULT_OPENAI_CAPS } });
  assert.deepEqual(editGate({ kind: 'hermes', bridge: true }, null), { ok: true, target: { kind: 'hermes', bridge: true } });
  assert.deepEqual(editGate({ kind: 'hermes' }, null), { ok: true, target: { kind: 'hermes', bridge: false } });
});

test('blocked reasons exist in every language', () => {
  for (const t of [de, en, es]) {
    for (const k of ['imageEdit.blocked.demo', 'imageEdit.blocked.attachmentsOff', 'imageEdit.blocked.noImages'] as const) {
      assert.ok(t(k) && t(k) !== k);
    }
  }
});
