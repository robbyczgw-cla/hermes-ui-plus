/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHermesContent, fenceFor, splitForParts, utf8Length } from './encodeHermes.ts';
import type { HermesContentPart } from './encodeHermes.ts';
import { isAttachmentError, LIMITS } from './types.ts';
import { MIME } from './mime.ts';
import { att, memReader } from './fixtures.test.ts';

const ref = { id: 'up1', path: '/var/lib/hermes-ui-bridge/uploads/2026-10-10/ab12-bericht.pdf', name: 'bericht.pdf', size: 1_234_567, mimeType: MIME.pdf };

test('no attachments → plain string (unchanged wire shape)', async () => {
  assert.equal(await buildHermesContent('Hallo', [], { reader: memReader({}), bridge: false }), 'Hallo');
});

test('image → data URL image_url part after the text', async () => {
  const img = att({ id: 'i1', name: 'foto.jpg', mimeType: MIME.jpeg, size: 3 });
  const parts = (await buildHermesContent('Was ist das?', [img], { reader: memReader({ i1: 'abc' }), bridge: false })) as HermesContentPart[];
  assert.deepEqual(parts, [
    { type: 'text', text: 'Was ist das?' },
    { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${Buffer.from('abc').toString('base64')}` } },
  ]);
});

test('bridge: file → path reference text, no file read', async () => {
  const pdf = att({ id: 'f1', name: 'bericht.pdf', mimeType: MIME.pdf, size: 1_234_567, remoteRef: ref });
  const reader = memReader({});
  const parts = (await buildHermesContent('Fass zusammen', [pdf], { reader, bridge: true })) as HermesContentPart[];
  assert.equal(reader.reads, 0);
  assert.deepEqual(parts[1], {
    type: 'text',
    text: '[Datei angehängt: bericht.pdf (application/pdf, 1,2 MB) – Pfad auf dem Server: /var/lib/hermes-ui-bridge/uploads/2026-10-10/ab12-bericht.pdf]',
  });
});

test('bridge: file without remoteRef → error', async () => {
  const pdf = att({ id: 'f1', name: 'bericht.pdf', mimeType: MIME.pdf });
  await assert.rejects(buildHermesContent('x', [pdf], { reader: memReader({}), bridge: true }), (e: unknown) => isAttachmentError(e) && e.msg.key === 'attachments.encode.notUploaded');
});

test('no bridge: small text file inlined as fenced block; files first, images last', async () => {
  const csv = att({ id: 'c', name: 'daten.csv', mimeType: MIME.csv, size: 12 });
  const img = att({ id: 'i', name: 'a.png', mimeType: MIME.png, size: 3 });
  const parts = (await buildHermesContent('', [img, csv], { reader: memReader({ c: 'a,b\n1,2', i: 'png' }), bridge: false })) as HermesContentPart[];
  assert.equal(parts.length, 2, 'empty user text is omitted');
  assert.equal(parts[0].type, 'text');
  assert.equal((parts[0] as { text: string }).text, '[Datei angehängt: daten.csv (text/csv, 12 B) – Inhalt:]\n```csv\na,b\n1,2\n```');
  assert.equal(parts[1].type, 'image_url');
});

test('no bridge: PDF → "Dateien brauchen die UI-Bridge"', async () => {
  const pdf = att({ id: 'f', name: 'a.pdf', mimeType: MIME.pdf });
  await assert.rejects(buildHermesContent('x', [pdf], { reader: memReader({ f: '%PDF' }), bridge: false }), (e: unknown) => isAttachmentError(e) && e.msg.key === 'attachments.validate.needsBridge');
});

test('fence is longer than any backtick run in the content', () => {
  assert.equal(fenceFor('no ticks'), '```');
  assert.equal(fenceFor('has ``` inside'), '````');
  assert.equal(fenceFor('x `````` y'), '```````');
});

test('long inline text is split under the Hermes 64k part cap and re-joins losslessly', async () => {
  const line = 'x'.repeat(99) + '\n';
  const content = line.repeat(1500); // 150 KB
  const t = att({ id: 't', name: 'log.txt', mimeType: 'text/plain', size: content.length });
  const parts = (await buildHermesContent('lies', [t], { reader: memReader({ t: content }), bridge: false })) as { type: string; text: string }[];
  const fileParts = parts.slice(1);
  assert.ok(fileParts.length >= 3);
  for (const p of fileParts) assert.ok(p.text.length <= LIMITS.hermesTextPartChars);
  // Hermes joins all-text arrays with "\n"
  const joined = fileParts.map((p) => p.text).join('\n');
  assert.ok(joined.includes(content));
  assert.ok(joined.endsWith('```'));
});

test('splitForParts hard-cuts a single huge line', () => {
  const parts = splitForParts('a'.repeat(25), 10);
  assert.deepEqual(parts.map((p) => p.length), [10, 10, 5]);
});

test('exact body check catches oversize after encoding', async () => {
  // validation estimate passes per image, but real base64 is checked too (skipValidation path)
  const big = att({ id: 'b', name: 'b.jpg', mimeType: MIME.jpeg, size: 1 });
  const data = 'y'.repeat(7_000_000);
  await assert.rejects(
    buildHermesContent('x', [big], { reader: memReader({ b: data }), bridge: true, skipValidation: true }),
    (e: unknown) => isAttachmentError(e) && e.msg.key === 'attachments.encode.messageTooLarge'
  );
});

test('unreadable file → German read error', async () => {
  const img = att({ id: 'gone', name: 'weg.jpg', mimeType: MIME.jpeg });
  await assert.rejects(buildHermesContent('x', [img], { reader: memReader({}), bridge: true }), (e: unknown) => isAttachmentError(e) && e.msg.key === 'attachments.encode.readFailed');
});

test('utf8Length', () => {
  assert.equal(utf8Length('abc'), 3);
  assert.equal(utf8Length('äö'), 4);
  assert.equal(utf8Length('€'), 3);
  assert.equal(utf8Length('😀'), 4);
});
