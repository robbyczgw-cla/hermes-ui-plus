import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHAT_MAX_WIDTH,
  DEFAULT_PREFERENCES,
  LARGE_ATTACHMENT_BYTES,
  SECTION_KEYS,
  chatMaxWidth,
  enterAction,
  messageGap,
  migratePreferences,
  needsLargeAttachmentConfirm,
  resetSection,
  sanitizePreferences,
  sectionIsDefault,
  serializePreferences,
  scaledText,
  fontScaleOf,
  type Preferences,
} from './preferences.ts';
import { imagesAllowed, isMeteredConnection } from '../images/policy.ts';

test('defaults: complete, frozen, every key in exactly one section', () => {
  assert.ok(Object.isFrozen(DEFAULT_PREFERENCES));
  const all = Object.values(SECTION_KEYS).flat();
  assert.deepEqual([...all].sort(), Object.keys(DEFAULT_PREFERENCES).sort());
  assert.equal(new Set(all).size, all.length);
  assert.equal(DEFAULT_PREFERENCES.toolDetails, 'verbose');
  assert.equal(DEFAULT_PREFERENCES.themeFamily, 'standard');
});

test('migration: nothing stored → defaults, no write', () => {
  assert.deepEqual(migratePreferences(null), { prefs: { ...DEFAULT_PREFERENCES }, changed: false, from: 0 });
});

test('migration: legacy appearance + tool details keys are carried over and written', () => {
  const r = migratePreferences(null, { appearance: 'dark', toolDetails: 'compact' });
  assert.equal(r.prefs.themeMode, 'dark');
  assert.equal(r.prefs.toolDetails, 'compact');
  assert.equal(r.changed, true);
  assert.equal(r.from, 0);
  const bad = migratePreferences(null, { appearance: 'purple', toolDetails: 'loud' });
  assert.deepEqual(bad.prefs, { ...DEFAULT_PREFERENCES });
  assert.equal(bad.changed, false);
});

test('migration: stored v1 envelope round-trips unchanged; new store wins over legacy keys', () => {
  const p: Preferences = { ...DEFAULT_PREFERENCES, themeFamily: 'nord', accent: '#12ab34', fontSize: 'xl', codeWrap: true };
  const raw = serializePreferences(p);
  const r = migratePreferences(raw, { appearance: 'light' });
  assert.deepEqual(r.prefs, p);
  assert.equal(r.changed, false);
  assert.equal(r.from, 1);
});

test('migration: garbage / partial / invalid values are repaired', () => {
  const g = migratePreferences('{oops', { toolDetails: 'off' });
  assert.equal(g.prefs.toolDetails, 'off');
  assert.equal(g.changed, true);
  const partial = migratePreferences(JSON.stringify({ v: 1, prefs: { themeFamily: 'ocean', density: 'huge', haptics: 'yes', accent: '#ABCDEF', extra: 1 } }));
  assert.equal(partial.prefs.themeFamily, 'ocean');
  assert.equal(partial.prefs.density, 'normal');
  assert.equal(partial.prefs.haptics, true);
  assert.equal(partial.prefs.accent, '#abcdef');
  assert.equal('extra' in partial.prefs, false);
  assert.equal(partial.changed, true);
  // envelope-less object (hand-edited) is accepted too
  assert.equal(migratePreferences(JSON.stringify({ fontSize: 'l' })).prefs.fontSize, 'l');
  assert.deepEqual(sanitizePreferences(null), { ...DEFAULT_PREFERENCES });
  assert.deepEqual(sanitizePreferences([1, 2]), { ...DEFAULT_PREFERENCES });
  assert.equal(sanitizePreferences({ accent: 'teal' }).accent, 'teal');
  assert.equal(sanitizePreferences({ accent: 'chartreuse' }).accent, 'theme');
});

test('start screen suggestions: default on, validated, reset with the chat section', () => {
  assert.equal(DEFAULT_PREFERENCES.showStarters, true);
  assert.ok(SECTION_KEYS.chat.includes('showStarters'));
  assert.equal(sanitizePreferences({ showStarters: false }).showStarters, false);
  assert.equal(sanitizePreferences({ showStarters: 'no' }).showStarters, true);
  const off: Preferences = { ...DEFAULT_PREFERENCES, showStarters: false };
  assert.equal(migratePreferences(serializePreferences(off)).prefs.showStarters, false);
  assert.equal(resetSection(off, 'chat').showStarters, true);
  assert.equal(resetSection(off, 'appearance').showStarters, false);
});

test('"Chats" scope: per device, default all chats (every device), validated, reset with the chat section', () => {
  assert.equal(DEFAULT_PREFERENCES.chatScope, 'all');
  assert.ok(SECTION_KEYS.chat.includes('chatScope'));
  assert.equal(sanitizePreferences({ chatScope: 'device' }).chatScope, 'device');
  assert.equal(sanitizePreferences({ chatScope: 'mine' }).chatScope, 'all');
  const device: Preferences = { ...DEFAULT_PREFERENCES, chatScope: 'device' };
  assert.equal(migratePreferences(serializePreferences(device)).prefs.chatScope, 'device');
  assert.equal(sectionIsDefault(device, 'chat'), false);
  assert.equal(resetSection(device, 'chat').chatScope, 'all');
});

test('reset per section only touches that section', () => {
  const p: Preferences = { ...DEFAULT_PREFERENCES, themeFamily: 'rose', fontSize: 'l', showTimestamps: true, codeWrap: true, haptics: false };
  const a = resetSection(p, 'appearance');
  assert.equal(a.themeFamily, 'standard');
  assert.equal(a.fontSize, 'm');
  assert.equal(a.showTimestamps, true);
  assert.equal(a.codeWrap, true);
  assert.equal(a.haptics, false);
  assert.equal(sectionIsDefault(a, 'appearance'), true);
  assert.equal(sectionIsDefault(a, 'chat'), false);
  assert.equal(sectionIsDefault(resetSection(a, 'controls'), 'controls'), true);
  assert.equal(p.themeFamily, 'rose', 'input not mutated');
});

test('layout math: chat width, density gap, font scale', () => {
  assert.equal(chatMaxWidth({ chatWidth: 'normal' }), 760);
  assert.equal(chatMaxWidth({ chatWidth: 'full' }), undefined);
  assert.ok((CHAT_MAX_WIDTH.narrow as number) < (CHAT_MAX_WIDTH.normal as number));
  assert.ok((CHAT_MAX_WIDTH.normal as number) < (CHAT_MAX_WIDTH.wide as number));
  assert.equal(messageGap(20, 'normal'), 20);
  assert.equal(messageGap(20, 'compact'), 11);
  assert.equal(messageGap(20, 'airy'), 29);
  assert.equal(fontScaleOf({ fontSize: 'm' }), 1);
  assert.deepEqual(scaledText(16, 23, fontScaleOf({ fontSize: 'l' })), { fontSize: 18, lineHeight: 26 });
  assert.deepEqual(scaledText(16, 23, fontScaleOf({ fontSize: 's' })), { fontSize: 14.5, lineHeight: 21 });
});

test('large attachment confirm threshold', () => {
  const on = { confirmLargeAttachments: true };
  assert.equal(needsLargeAttachmentConfirm([], on), false);
  assert.equal(needsLargeAttachmentConfirm([LARGE_ATTACHMENT_BYTES], on), false);
  assert.equal(needsLargeAttachmentConfirm([LARGE_ATTACHMENT_BYTES, 1], on), true);
  assert.equal(needsLargeAttachmentConfirm([LARGE_ATTACHMENT_BYTES * 2], { confirmLargeAttachments: false }), false);
  assert.equal(needsLargeAttachmentConfirm([NaN, -5, 10], on), false);
});

test('enter key: send on Enter setting, Shift = newline, Cmd/Ctrl always sends, IME composing never sends', () => {
  assert.equal(enterAction({}, true), 'send');
  assert.equal(enterAction({}, false), 'newline');
  assert.equal(enterAction({ shift: true }, true), 'newline');
  assert.equal(enterAction({ meta: true }, false), 'send');
  assert.equal(enterAction({ ctrl: true }, false), 'send');
  assert.equal(enterAction({ composing: true, ctrl: true }, true), 'newline');
});

test('image loading policy', () => {
  assert.equal(imagesAllowed('always', true), true);
  assert.equal(imagesAllowed('never', false), false);
  assert.equal(imagesAllowed('wifi', false), true);
  assert.equal(imagesAllowed('wifi', true), false);
  assert.equal(isMeteredConnection({ connection: { type: 'cellular' } }), true);
  assert.equal(isMeteredConnection({ connection: { saveData: true } }), true);
  assert.equal(isMeteredConnection({ connection: { type: 'wifi' } }), false);
  assert.equal(isMeteredConnection({}), false);
});

test('unknown images: default "via bridge", the old "ask" (which auto-loaded proxied images) maps to it', () => {
  assert.equal(DEFAULT_PREFERENCES.unknownImages, 'bridge');
  assert.equal(sanitizePreferences({ unknownImages: 'ask' }).unknownImages, 'bridge');
  assert.equal(sanitizePreferences({ unknownImages: 'tap' }).unknownImages, 'tap');
  assert.equal(sanitizePreferences({ unknownImages: 'always' }).unknownImages, 'always');
  assert.equal(sanitizePreferences({ unknownImages: 'nope' }).unknownImages, 'bridge');
  const stored = JSON.stringify({ v: 1, prefs: { ...DEFAULT_PREFERENCES, unknownImages: 'ask' } });
  const m = migratePreferences(stored);
  assert.equal(m.prefs.unknownImages, 'bridge');
  assert.equal(m.changed, true, 'written back once');
});

test('image search: defaults, validation, legacy webImages=false -> wikipedia', () => {
  assert.equal(DEFAULT_PREFERENCES.imageSearch, 'bridge');
  assert.equal(DEFAULT_PREFERENCES.imageProvider, 'serper');
  assert.equal(sanitizePreferences({ imageSearch: 'own', imageProvider: 'brave' }).imageSearch, 'own');
  assert.equal(sanitizePreferences({ imageSearch: 'x', imageProvider: 'bing' }).imageProvider, 'serper');
  assert.equal(sanitizePreferences({ webImages: false }).imageSearch, 'wikipedia');
  assert.equal(sanitizePreferences({ webImages: false, imageSearch: 'own' }).imageSearch, 'own');
  assert.equal(sanitizePreferences({ webImages: true }).imageSearch, 'bridge');
});

test('answers.* prefs: all default ON, own section, migrated from older stores, validated', () => {
  const keys = ['answers.transformBar', 'answers.summary', 'answers.collapseLong', 'answers.footnotes', 'answers.entities', 'answers.motion', 'answers.shareImage'] as const;
  for (const k of keys) {
    assert.equal(DEFAULT_PREFERENCES[k], true, k);
    assert.ok(SECTION_KEYS.answers.includes(k), k);
  }
  // UX1 interim notes in the answer body: default OFF, same section
  assert.equal(DEFAULT_PREFERENCES['answers.progressNotes'], false);
  assert.ok(SECTION_KEYS.answers.includes('answers.progressNotes'));
  assert.equal(SECTION_KEYS.answers.length, keys.length + 1);
  // a store written before v4 has no answers.* keys → defaults filled in, written back once
  const old = { ...DEFAULT_PREFERENCES } as Record<string, unknown>;
  for (const k of keys) delete old[k];
  old.codeWrap = true;
  const r = migratePreferences(JSON.stringify({ v: 1, prefs: old }));
  assert.equal(r.prefs.codeWrap, true);
  for (const k of keys) assert.equal(r.prefs[k], true, k);
  assert.equal(r.changed, true);
  // off survives a round trip, garbage falls back to ON
  const off: Preferences = { ...DEFAULT_PREFERENCES, 'answers.footnotes': false, 'answers.transformBar': false };
  assert.deepEqual(migratePreferences(serializePreferences(off)).prefs, off);
  assert.equal(sanitizePreferences({ 'answers.motion': 'no' })['answers.motion'], true);
  assert.equal(sectionIsDefault(off, 'answers'), false);
  assert.equal(sectionIsDefault(off, 'chat'), true);
  assert.deepEqual(resetSection(off, 'answers'), { ...DEFAULT_PREFERENCES });
});
