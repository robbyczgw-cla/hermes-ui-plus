import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeNode } from '../../../../protocol/validate.ts';
import { makeT } from '../../../../i18n/core.ts';
import { parseReplyMessage } from '../../../../chat/replyMessage.ts';
import { pathsReply } from '../a/replies.ts';
import { badgeColorKeys, chainText, chainUnits, pathsSelectReply, readPaths, rowA11yLabel } from './pathsModel.ts';
import { PATHS_BACKUP_SELECT_DE, PATHS_FILES_DE, PATHS_PARTIAL, PATHS_REQUEST_EN, PATHS_RUNTIME_EN, PATHS_SAMPLES } from './samples.ts';

test('readPaths: raw and alias input through the protocol validator, garbage → no rows', () => {
  const m = readPaths(PATHS_BACKUP_SELECT_DE);
  assert.equal(m.select, true);
  assert.equal(m.title, 'Welcher Backup-Weg passt?');
  assert.deepEqual(m.items.map((r) => r.key), ['tm', 'nas', 'cloud']);
  assert.deepEqual(m.items[0].badge, { text: 'Ausgangsbasis', tone: 'neutral' });
  assert.deepEqual(m.items[2].badge, { text: 'Mit Vorsicht', tone: 'warn' });
  assert.equal(chainText(m.items[2].path), 'Mac → restic → Cloud-Speicher');
  for (const junk of [null, undefined, 'x', 3, [], { type: 'paths', items: [{}] }]) {
    const r = readPaths(junk);
    assert.deepEqual(r.items, []);
    assert.equal(r.select, false);
  }
  assert.equal(readPaths(PATHS_RUNTIME_EN).basis, 'estimate');
});

test('chainUnits: the arrow travels with the node after it (a wrapped line starts with "→ Node")', () => {
  const units = chainUnits([{ label: 'A' }, { label: 'B' }, { label: 'C' }]);
  assert.deepEqual(units.map((u) => [u.step.label, u.arrow]), [['A', false], ['B', true], ['C', true]]);
  assert.deepEqual(chainUnits([]), []);
  // n nodes → n units → exactly n-1 arrows, none at the end
  const six = chainUnits(readPaths(PATHS_RUNTIME_EN).items[2].path);
  assert.equal(six.length, 6);
  assert.equal(six.filter((u) => u.arrow).length, 5);
  assert.equal(six[0].arrow, false);
});

test('accessibility label: title, badge, "macOS → APFS" chain and the note in one sentence', () => {
  const [row] = readPaths(PATHS_FILES_DE).items;
  assert.equal(rowA11yLabel(row), 'Nativ in macOS, Ausgangsbasis: macOS → APFS → interne SSD. Schnellster Zugriff, Time Machine sichert alles mit.');
  assert.equal(rowA11yLabel({ key: 'k', title: 'Nur Titel', path: [] }), 'Nur Titel.');
  assert.equal(rowA11yLabel({ key: 'k', title: 'T', path: [{ label: 'a' }, { label: 'b' }] }), 'T: a → b.');
});

test('badge tones map to theme color keys', () => {
  assert.deepEqual(badgeColorKeys('neutral'), { bg: 'surfacePressed', fg: 'text' });
  assert.deepEqual(badgeColorKeys('good'), { bg: 'successSoft', fg: 'success' });
  assert.deepEqual(badgeColorKeys('warn'), { bg: 'warningSoft', fg: 'warning' });
  assert.deepEqual(badgeColorKeys('bad'), { bg: 'dangerSoft', fg: 'danger' });
  assert.deepEqual(badgeColorKeys(undefined), { bg: 'surfacePressed', fg: 'text' });
});

test('select reply: `[paths:<id>] <title>`, one line; shown as the title chip', () => {
  const m = readPaths(PATHS_BACKUP_SELECT_DE);
  assert.equal(pathsSelectReply('backup-weg', m, 'nas'), '[paths:backup-weg] Time Machine aufs NAS');
  assert.equal(pathsSelectReply('backup-weg', m, 'nope'), null);
  assert.equal(pathsReply('x', ' Zwei\nZeilen '), '[paths:x] Zwei Zeilen');
  for (const [l, loc] of [['de', 'de-DE'], ['en', 'en-US'], ['es', 'es-ES']] as const) {
    const p = parseReplyMessage('[paths:backup-weg] Time Machine aufs NAS', makeT(l, loc));
    assert.deepEqual(p, { head: '', replies: [{ kind: 'paths', id: 'backup-weg', display: 'Time Machine aufs NAS' }] });
  }
});

test('gallery: paths section is mounted and its samples (de + en, select, long chain, streaming) are valid', () => {
  const gallery = readFileSync(new URL('../../../Gallery.tsx', import.meta.url), 'utf8');
  assert.match(gallery, /<GallerySectionE1 onAction=\{onAction\} \/>/);
  const section = readFileSync(new URL('./GallerySectionE1.tsx', import.meta.url), 'utf8');
  assert.match(section, /samples=\{PATHS_SAMPLES\}/);
  for (const s of [PATHS_FILES_DE, PATHS_REQUEST_EN, PATHS_BACKUP_SELECT_DE, PATHS_RUNTIME_EN, PATHS_PARTIAL]) assert.ok(PATHS_SAMPLES.some((x) => x.node === s));
  assert.ok(PATHS_SAMPLES.some((x) => x.streaming));
  for (const s of [PATHS_FILES_DE, PATHS_REQUEST_EN, PATHS_BACKUP_SELECT_DE, PATHS_RUNTIME_EN]) {
    const out = normalizeNode(s) as unknown as { type: string; items: { title: string; badge?: unknown; path: unknown[] }[] };
    assert.equal(out.type, 'paths');
    assert.ok(out.items.length >= 2 && out.items.length <= 6, s.id);
    for (const it of out.items) {
      assert.ok(it.badge, `${s.id}/${it.title}: badge`);
      assert.ok(it.path.length >= 1 && it.path.length <= 6, `${s.id}/${it.title}: path`);
    }
  }
  // the German macOS example uses every badge tone
  assert.deepEqual(readPaths(PATHS_FILES_DE).items.map((r) => r.badge?.tone), ['neutral', 'bad', 'good', 'warn']);
});

test('the renderer is registered and only uses theme tokens (no raw colors)', () => {
  const reg = readFileSync(new URL('../registryE1.ts', import.meta.url), 'utf8');
  assert.match(reg, /paths: Paths/);
  const view = readFileSync(new URL('../../../HuiView.tsx', import.meta.url), 'utf8');
  assert.match(view, /\.\.\.registryE1/);
  for (const f of ['./Paths.tsx', './icons.tsx']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /#[0-9a-fA-F]{3,8}\b|rgba?\(/, `${f}: raw color`);
  }
});
