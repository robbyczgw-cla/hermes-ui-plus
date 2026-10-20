import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diffStates, type LiveCardState } from './model.ts';
import { dayBlocks, freshPerDay, initialDay, nextOpenBlock, parseTimeInput, tripChangeDetail, tripDays, tripShifts } from './trip.ts';

const DAYS = [{ id: 'fr13', label: 'Fr 13.' }, { id: 'sa14', label: 'Sa 14.', date: '2026-11-14' }, { id: 'so15', label: 'So 15.' }];
const V1: LiveCardState = {
  title: 'Rom',
  days: DAYS,
  items: [
    { id: 'kolosseum', text: 'Kolosseum', day: 'sa14', start: '09:00', end: '10:30' },
    { id: 'forum', text: 'Forum Romanum', day: 'sa14', start: '11:00', end: '12:30' },
    { id: 'prati', text: 'Mittag in Prati', day: 'sa14', start: '13:30', end: '14:30' },
    { id: 'vatikan', text: 'Vatikanische Museen', day: 'sa14', start: '15:00', end: '17:00' },
    { id: 'pantheon', text: 'Pantheon', day: 'so15', start: '10:00', end: '11:00' },
    { id: 'anreise', text: 'Anreise', day: 'fr13', start: '18:00' },
  ],
};
const set = (s: LiveCardState, id: string, patch: object): LiveCardState => ({ ...s, items: s.items.map((it) => (it.id === id ? { ...it, ...patch } : it)) });

test('days in order, blocks of a day by start time, no-day blocks on the first day', () => {
  assert.deepEqual(tripDays(V1).map((d) => d.id), ['fr13', 'sa14', 'so15']);
  const moved = set(V1, 'vatikan', { start: '08:00' });
  assert.deepEqual(dayBlocks(moved, 'sa14').map((b) => b.id), ['vatikan', 'kolosseum', 'forum', 'prati']);
  const noDays: LiveCardState = { items: [{ id: 'a', text: 'A', start: '10:00' }, { id: 'b', text: 'B', day: 'x' }] };
  assert.deepEqual(tripDays(noDays).map((d) => d.id), ['d1', 'x']);
  assert.deepEqual(dayBlocks(noDays, 'd1').map((b) => b.id), ['a']);
});

test('shifts: the block that took the slot is earlier, the one that made room is swapped (mockup 05)', () => {
  const v2 = set(set(V1, 'vatikan', { start: '11:00', end: '13:00' }), 'forum', { start: '15:30', end: '17:00' });
  const s = tripShifts(V1, v2);
  assert.deepEqual(s.get('vatikan'), { kind: 'earlier', from: '15:00' });
  assert.deepEqual(s.get('forum'), { kind: 'swapped', from: '11:00' });
  assert.equal(s.has('kolosseum'), false);
});

test('shifts: an exact swap marks both, a lone move is earlier / later, another day wins, `ids` filters', () => {
  const swap = set(set(V1, 'kolosseum', { start: '11:00' }), 'forum', { start: '09:00' });
  const s = tripShifts(V1, swap);
  assert.equal(s.get('kolosseum')?.kind, 'swapped');
  assert.equal(s.get('forum')?.kind, 'swapped');
  assert.equal(tripShifts(V1, set(V1, 'prati', { start: '14:00' })).get('prati')?.kind, 'later');
  const day = tripShifts(V1, set(V1, 'pantheon', { day: 'sa14', start: '18:00' }));
  assert.deepEqual(day.get('pantheon'), { kind: 'day', from: '10:00', fromDay: 'so15' });
  assert.equal(tripShifts(V1, swap, new Set(['forum'])).has('kolosseum'), false);
});

test('fresh blocks per day (open ones only) pick the first day to show', () => {
  const ticked = set(V1, 'pantheon', { checked: true });
  const per = freshPerDay(ticked, new Set(['vatikan', 'forum', 'pantheon']));
  assert.deepEqual([...per], [['sa14', 2]]);
  assert.equal(initialDay(V1, new Set(['pantheon'])), 'so15');
  assert.equal(initialDay(V1, new Set(), '2026-11-14'), 'sa14');
  assert.equal(initialDay(V1, new Set()), 'fr13');
});

test('next open block in day and time order', () => {
  assert.equal(nextOpenBlock(V1)?.id, 'anreise');
  const done = set(set(V1, 'anreise', { checked: true }), 'kolosseum', { checked: true });
  assert.equal(nextOpenBlock(done)?.id, 'forum');
  assert.equal(nextOpenBlock({ items: [] }), undefined);
});

test('time input: tolerant, normalised, junk rejected', () => {
  assert.equal(parseTimeInput('9'), '09:00');
  assert.equal(parseTimeInput('9:05'), '09:05');
  assert.equal(parseTimeInput('9.30 Uhr'), '09:30');
  assert.equal(parseTimeInput('1930'), '19:30');
  assert.equal(parseTimeInput('25:00'), undefined);
  assert.equal(parseTimeInput('abends'), undefined);
});

test('receipt detail: time moves, day moves, added blocks with day and time', () => {
  const clock = (s: string) => s;
  const v2 = set(set(V1, 'vatikan', { start: '11:00' }), 'forum', { day: 'so15' });
  const v3 = { ...v2, items: [...v2.items, { id: 'u-1', text: 'Trevi', day: 'so15', start: '12:00' }] };
  const changes = diffStates(V1, v3);
  const by = (id: string) => changes.find((c) => c.id === id)!;
  assert.deepEqual(tripChangeDetail(by('vatikan'), DAYS, clock), { before: '15:00', after: '11:00', shift: 'earlier' });
  assert.deepEqual(tripChangeDetail(by('forum'), DAYS, clock), { before: 'Sa 14. 11:00', after: 'So 15. 11:00', shift: 'day' });
  assert.deepEqual(tripChangeDetail(by('u-1'), DAYS, clock), { after: 'So 15. 12:00' });
  const note = diffStates(V1, set(V1, 'prati', { userNote: 'Tisch für 2' }))[0];
  assert.deepEqual(tripChangeDetail(note, DAYS, clock), { before: '', after: 'Tisch für 2' });
});
