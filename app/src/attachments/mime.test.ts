/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyFile, extOf, fenceLang, formatBytes, formatSizeOverLimit, isTextLike, MIME, normalizeMime, typeLabel, withExt } from './mime.ts';

test('extOf handles paths, dotfiles, case', () => {
  assert.equal(extOf('Bericht.PDF'), 'pdf');
  assert.equal(extOf('/a/b/c.tar.gz'), 'gz');
  assert.equal(extOf('.env'), '');
  assert.equal(extOf('README'), '');
});

test('normalizeMime fixes unreliable picker types', () => {
  assert.equal(normalizeMime(undefined, 'notes.md'), MIME.md);
  assert.equal(normalizeMime('application/octet-stream', 'data.csv'), MIME.csv);
  assert.equal(normalizeMime('text/plain', 'data.csv'), MIME.csv);
  assert.equal(normalizeMime('text/comma-separated-values', 'x'), MIME.csv);
  assert.equal(normalizeMime('image/jpg', 'x.jpg'), MIME.jpeg);
  assert.equal(normalizeMime('Application/PDF; charset=binary', 'x'), MIME.pdf);
  assert.equal(normalizeMime(null, 'unknown.bin'), 'application/octet-stream');
  assert.equal(normalizeMime('text/plain', 'a.txt'), 'text/plain');
});

test('classifyFile', () => {
  assert.equal(classifyFile(MIME.pdf), 'pdf');
  assert.equal(classifyFile(MIME.json), 'text');
  assert.equal(classifyFile('text/x-python'), 'text');
  assert.equal(classifyFile(MIME.docx), 'office');
  assert.equal(classifyFile(MIME.xlsx), 'office');
  assert.equal(classifyFile('image/heic'), 'image');
  assert.equal(classifyFile('application/zip'), null);
  assert.equal(isTextLike('application/geo+json'), true);
});

test('formatBytes uses German decimal comma', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(830_400), '830 KB');
  assert.equal(formatBytes(1_234_567), '1,2 MB');
  assert.equal(formatBytes(20_000_000), '20 MB');
  assert.equal(formatBytes(-1), '–');
});

test('fenceLang / typeLabel / withExt', () => {
  assert.equal(fenceLang('a.md', MIME.md), 'markdown');
  assert.equal(fenceLang('a.txt', 'text/plain'), '');
  assert.equal(fenceLang('a', MIME.json), 'json');
  const keyT = (k: string) => k; // translation stub: returns the key
  assert.equal(typeLabel('x.docx', MIME.docx, keyT), 'DOCX');
  assert.equal(typeLabel('x', MIME.pdf, keyT), 'PDF');
  assert.equal(typeLabel('x', MIME.jpeg, keyT), 'attachments.type.image');
  assert.equal(typeLabel('x', 'application/zip', keyT), 'attachments.type.file');
  assert.equal(withExt('IMG_0001.HEIC', 'jpg'), 'IMG_0001.jpg');
  assert.equal(withExt('foto', 'jpg'), 'foto.jpg');
});

test('formatSizeOverLimit: size and limit never read the same at the boundary', () => {
  // plain case: rounding keeps them apart -> the normal format
  assert.deepEqual(formatSizeOverLimit(25_000_000, 20_000_000), { size: '25 MB', max: '20 MB' });
  // 20.4 MB vs 20 MB: both round to "20 MB" -> one decimal
  assert.deepEqual(formatSizeOverLimit(20_400_000, 20_000_000), { size: '20,4 MB', max: '20,0 MB' });
  assert.deepEqual(formatSizeOverLimit(20_400_000, 20_000_000, 'en'), { size: '20.4 MB', max: '20.0 MB' });
  // still equal with one decimal -> exact bytes
  assert.deepEqual(formatSizeOverLimit(20_000_001, 20_000_000), { size: '20\u00a0000\u00a0001 B', max: '20\u00a0000\u00a0000 B' });
  assert.deepEqual(formatSizeOverLimit(3_750_400, 3_750_000), { size: '3\u00a0750\u00a0400 B', max: '3\u00a0750\u00a0000 B' });
  assert.deepEqual(formatSizeOverLimit(200_400, 200_000), { size: '200,4 KB', max: '200,0 KB' });
  const p = formatSizeOverLimit(20_000_001, 20_000_000);
  assert.notEqual(p.size, p.max);
});
