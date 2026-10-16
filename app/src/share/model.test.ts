/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_SHARED_TEXT,
  acceptSharedFiles,
  canSendShare,
  composeShareMessage,
  defaultShareProfile,
  firstLink,
  fromNativeShare,
  fromWebShare,
  lastShareChat,
  shareGate,
  shareKind,
  shareProfiles,
  sharedFileName,
} from './model.ts';
import { LIMITS } from '../attachments/types.ts';
import { dismissShare, currentShare, deliverShare, hasShareDelivery, offerShare, resetShareInbox, retryShare, takeShareDelivery } from './inbox.ts';

// ---------------------------------------------------------------- links

test('firstLink: plain, inside text, trailing punctuation, balanced brackets', () => {
  assert.equal(firstLink('https://example.com/a'), 'https://example.com/a');
  assert.equal(firstLink('Look at this: https://example.com/a?b=1&c=2.'), 'https://example.com/a?b=1&c=2');
  assert.equal(firstLink('(see https://example.com/x)'), 'https://example.com/x');
  assert.equal(firstLink('https://en.wikipedia.org/wiki/Foo_(bar)'), 'https://en.wikipedia.org/wiki/Foo_(bar)');
  assert.equal(firstLink('«https://example.com/q»'), 'https://example.com/q');
  assert.equal(firstLink('no link here, ftp://example.com'), undefined);
  assert.equal(firstLink('https://'), undefined);
  assert.equal(firstLink(null), undefined);
});

// ---------------------------------------------------------------- native intake

test('native: a shared link stays text, the url is known, a title inside the text is not repeated', () => {
  const p = fromNativeShare({ text: 'Example Domain https://example.com/', webUrl: 'https://example.com/', meta: { title: 'Example Domain' } });
  assert.ok(p);
  assert.equal(p.text, 'Example Domain https://example.com/');
  assert.equal(p.url, 'https://example.com/');
  assert.equal(p.title, undefined);
  assert.equal(shareKind(p), 'link');
  assert.equal(composeShareMessage(p), 'Example Domain https://example.com/');
});

test('native: a subject the text does not contain is shown as title line', () => {
  const p = fromNativeShare({ text: 'https://example.com/post/1', meta: { title: 'A post about tests' } })!;
  assert.equal(p.title, 'A post about tests');
  assert.equal(composeShareMessage(p, { prompt: 'Summarize this briefly.' }), 'Summarize this briefly.\n\nA post about tests\nhttps://example.com/post/1');
  // a link as "title" is noise
  assert.equal(fromNativeShare({ text: 'https://example.com/x', meta: { title: 'https://example.com/x' } })!.title, undefined);
});

test('native: plain text, CRLF normalized, very long text cut to one Hermes text part', () => {
  const p = fromNativeShare({ text: '  line one\r\nline two  ' })!;
  assert.equal(p.text, 'line one\nline two');
  assert.equal(shareKind(p), 'text');
  assert.equal(p.truncated, undefined);
  const long = fromNativeShare({ text: 'x'.repeat(MAX_SHARED_TEXT + 50) })!;
  assert.equal(long.text.length, MAX_SHARED_TEXT);
  assert.equal(long.truncated, true);
});

test('native: images and a PDF are accepted, mime normalized, names kept or derived', () => {
  const p = fromNativeShare({
    files: [
      { path: 'file:///data/user/0/app/cache/IMG_1.jpg', mimeType: 'image/jpg', fileName: 'IMG_1.jpg', size: 1200, width: 800, height: 600 },
      { path: 'file:///data/user/0/app/cache/report.pdf', mimeType: 'application/pdf', fileName: null, size: 5000 },
      { path: 'content://media/external/images/42', mimeType: 'image/png', fileName: '', size: null },
    ],
  })!;
  assert.equal(p.files.length, 3);
  assert.deepEqual(
    p.files.map((f) => [f.name, f.mimeType]),
    [
      ['IMG_1.jpg', 'image/jpeg'],
      ['report.pdf', 'application/pdf'],
      ['shared-3.png', 'image/png'],
    ],
  );
  assert.equal(p.files[0].width, 800);
  assert.equal(p.files[2].size, undefined);
  assert.equal(shareKind(p), 'mixed');
  assert.equal(p.text, '');
  assert.ok(canSendShare(p));
  assert.equal(composeShareMessage(p), '');
});

test('native: unsupported types, oversized files and too many files are refused with a message, never sent', () => {
  const p = fromNativeShare({
    files: [
      { path: 'file:///c/movie.mp4', mimeType: 'video/mp4', fileName: 'movie.mp4', size: 10 },
      { path: 'file:///c/huge.pdf', mimeType: 'application/pdf', fileName: 'huge.pdf', size: LIMITS.maxUploadBytes + 1 },
      { path: 'file:///c/ok.png', mimeType: 'image/png', fileName: 'ok.png', size: 10 },
    ],
  })!;
  assert.deepEqual(p.files.map((f) => f.name), ['ok.png']);
  assert.deepEqual(p.refused.map((r) => r.key), ['attachments.picker.unsupportedType', 'attachments.validate.tooLarge']);
  assert.equal(p.refused[0].vars?.name, 'movie.mp4');
  assert.equal(shareKind(p), 'image');

  const many = acceptSharedFiles(Array.from({ length: LIMITS.maxAttachments + 2 }, (_, i) => ({ uri: `file:///c/${i}.png`, name: `${i}.png`, mimeType: 'image/png' })));
  assert.equal(many.files.length, LIMITS.maxAttachments);
  assert.deepEqual(many.refused, [{ key: 'attachments.picker.onlyRemaining', vars: { remaining: LIMITS.maxAttachments } }]);
});

test('native: only refused files → still a payload (the sheet explains); nothing at all → null', () => {
  const p = fromNativeShare({ files: [{ path: 'file:///c/a.zip', mimeType: 'application/zip', fileName: 'a.zip' }] })!;
  assert.equal(p.files.length, 0);
  assert.equal(p.refused.length, 1);
  assert.equal(shareKind(p), 'empty');
  assert.equal(canSendShare(p), false);
  assert.equal(canSendShare(p, 'but a note'), true);
  assert.equal(fromNativeShare({ text: '   ', files: [] }), null);
  assert.equal(fromNativeShare({ files: [{ path: '' }] }), null);
  assert.equal(fromNativeShare(null), null);
});

test('native: a file without name and type (no read access to its uri) is refused as unreadable, not as a wrong type', () => {
  const p = fromNativeShare({ files: [{ path: 'content://media/external/images/media/1000000040', mimeType: 'application/octet-stream', fileName: null }] })!;
  assert.equal(p.files.length, 0);
  assert.deepEqual(p.refused, [{ key: 'share.sheet.unreadable', vars: { name: 'shared-1.bin' } }]);
  // a provider that only lacks the name still works when it reports the type
  const ok = fromNativeShare({ files: [{ path: 'content://x/9', mimeType: 'application/pdf', fileName: null }] })!;
  assert.deepEqual(ok.files.map((f) => f.name), ['shared-1.pdf']);
});

test('sharedFileName: path traversal and odd characters never reach the name', () => {
  assert.equal(sharedFileName('../../etc/passwd', '', 'text/plain', 0), 'passwd');
  assert.equal(sharedFileName(null, 'file:///c/My%20Report.pdf', 'application/pdf', 0), 'My Report.pdf');
  assert.equal(sharedFileName(null, 'content://x/42', 'image/jpeg', 1), 'shared-2.jpg');
  assert.equal(sharedFileName(null, 'content://x/42', 'application/x-unknown', 0), 'shared-1.bin');
  assert.equal(sharedFileName('a:b*c?.txt', '', 'text/plain', 0), 'a_b_c_.txt');
});

// ---------------------------------------------------------------- web intake

test('web share target: title / text / url fields, url not doubled, files with their File object', () => {
  const p = fromWebShare({ title: 'Page', text: 'Worth reading', url: 'https://example.com/p' })!;
  assert.equal(p.text, 'Worth reading\nhttps://example.com/p');
  assert.equal(p.url, 'https://example.com/p');
  assert.equal(p.title, 'Page');
  const same = fromWebShare({ text: 'see https://example.com/p', url: 'https://example.com/p' })!;
  assert.equal(same.text, 'see https://example.com/p');
  const f = new File(['%PDF-1.4'], 'doc.pdf', { type: 'application/pdf' });
  const withFile = fromWebShare({}, [f])!;
  assert.equal(withFile.files[0].webFile, f);
  assert.equal(withFile.files[0].mimeType, 'application/pdf');
  assert.equal(fromWebShare({ title: '', text: '', url: '' }), null);
});

// ---------------------------------------------------------------- message

test('composeShareMessage: intent prompt and note on top, then the content', () => {
  const p = fromNativeShare({ text: 'Bonjour tout le monde' })!;
  assert.equal(composeShareMessage(p, { prompt: 'Translate this into English.' }), 'Translate this into English.\n\nBonjour tout le monde');
  assert.equal(composeShareMessage(p, { prompt: 'Translate this into English.', note: ' formal please ' }), 'Translate this into English.\nformal please\n\nBonjour tout le monde');
  assert.equal(composeShareMessage(p, { note: '' }), 'Bonjour tout le monde');
});

// ---------------------------------------------------------------- gate + target

test('shareGate: storage first, then the app lock, onboarding on screen waits, unpaired → pair', () => {
  const base = { ready: true, locked: false, onboarding: false, paired: true };
  assert.equal(shareGate({ ...base, ready: false, locked: true }), 'wait');
  assert.equal(shareGate({ ...base, locked: true }), 'locked');
  assert.equal(shareGate({ ...base, onboarding: true }), 'wait');
  assert.equal(shareGate({ ...base, paired: false }), 'pair');
  assert.equal(shareGate(base), 'ready');
});

const PROFILES = [
  { id: 'preset-demo', kind: 'demo', name: 'Demo' },
  { id: 'h1', kind: 'hermes', name: 'Home' },
  { id: 'h2', kind: 'hermes', name: 'Work' },
];

test('targets: the demo is never a share target; the active real connection is preselected', () => {
  assert.deepEqual(shareProfiles(PROFILES).map((p) => p.id), ['h1', 'h2']);
  assert.equal(defaultShareProfile(PROFILES, 'h2')?.id, 'h2');
  assert.equal(defaultShareProfile(PROFILES, 'preset-demo')?.id, 'h1');
  assert.equal(defaultShareProfile([PROFILES[0]], 'preset-demo'), undefined);
});

test('lastShareChat: newest chat with messages whose connection still exists, never archived / demo / drafts', () => {
  const chats = [
    { id: 'a', title: 'A', profileId: 'h1', profileKind: 'hermes', updatedAt: 10, messageCount: 2 },
    { id: 'b', title: 'B', profileId: 'h2', profileKind: 'hermes', updatedAt: 30, messageCount: 2, archived: true },
    { id: 'c', title: 'C', profileId: 'preset-demo', profileKind: 'demo', updatedAt: 40, messageCount: 4 },
    { id: 'd', title: 'D', profileId: 'gone', profileKind: 'hermes', updatedAt: 50, messageCount: 4 },
    { id: 'e', title: '', profileId: 'h1', profileKind: 'hermes', updatedAt: 60, messageCount: 0 },
    { id: 'f', title: 'F', profileId: 'h2', profileKind: 'hermes', updatedAt: 20, messageCount: 1 },
  ];
  assert.equal(lastShareChat(chats, PROFILES)?.id, 'f');
  assert.equal(lastShareChat([], PROFILES), undefined);
});

// ---------------------------------------------------------------- inbox

test('inbox: newest share wins and frees the older one; dismiss frees unless the files moved on', () => {
  resetShareInbox();
  const freed: string[] = [];
  const p = fromNativeShare({ text: 'one' })!;
  const a = offerShare(p, () => freed.push('a'));
  const b = offerShare(fromNativeShare({ text: 'two' })!, () => freed.push('b'));
  assert.notEqual(a.id, b.id);
  assert.deepEqual(freed, ['a']);
  dismissShare(a.id); // stale id: no-op
  assert.equal(currentShare()?.id, b.id);
  dismissShare(b.id, { keepStorage: true });
  assert.equal(currentShare(), null);
  assert.deepEqual(freed, ['a']);
});

test('inbox: a delivery waits for its chat and is taken exactly once', () => {
  resetShareInbox();
  deliverShare('c1', { text: 'hello', files: [] });
  assert.equal(hasShareDelivery('c1'), true);
  assert.equal(takeShareDelivery('c2'), null);
  assert.equal(takeShareDelivery('c1')?.text, 'hello');
  assert.equal(takeShareDelivery('c1'), null);
  assert.equal(hasShareDelivery(undefined), false);
});

test('a failed import keeps the original share for retry and waits behind a newer offer', () => {
  resetShareInbox();
  let released = 0;
  const files = [{ uri: 'file:///test-report.pdf', name: 'test-report.pdf', mimeType: 'application/pdf' }];
  const failed = { text: 'original share', files, release: () => { released++; } };
  const newer = offerShare({ text: 'newer share', files: [], refused: [] });
  retryShare(failed);
  assert.equal(currentShare()?.id, newer.id);
  assert.equal(released, 0, 'a failed import does not free its source');
  dismissShare(newer.id);
  assert.equal(currentShare()?.text, failed.text);
  assert.equal(currentShare()?.files, files);
  dismissShare();
  assert.equal(released, 1);
  assert.equal(currentShare(), null);

  retryShare(failed);
  assert.equal(currentShare()?.text, failed.text, 'without a newer arrival retry is offered immediately');
  dismissShare();
  assert.equal(released, 2);
});
