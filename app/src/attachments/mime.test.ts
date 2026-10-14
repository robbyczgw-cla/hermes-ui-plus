/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyFile, extOf, fenceLang, formatBytes, isTextLike, MIME, normalizeMime, typeLabel, withExt } from './mime.ts';

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
