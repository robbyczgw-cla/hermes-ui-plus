// The render harness itself (answerView.ts, miniDom.ts, webRender.ts): it must keep running the chat's own text
// pipeline, draw width-dependent parts, run effects and deliver taps. If MessageItem.tsx changes its finished-answer
// pipeline, the first test fails: update answerView.ts `finishedSegments` to match.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadAnswerView } from './answerView.ts';

test('answerView mirrors useAnswerText (chat/MessageItem.tsx) and draws with its SegmentView', () => {
  const mi = readFileSync(new URL('../chat/MessageItem.tsx', import.meta.url), 'utf8');
  const fn = mi.slice(mi.indexOf('function useAnswerText('), mi.indexOf('type LiveAnswerProps'));
  for (const step of ['splitProgressNotes(message)', 'hideToolMarkup(', 'extractMedia(', 'advanceSegments(', 'withCitationSources(dedupeTranslations(', 'withRetrievedSources(']) {
    assert.ok(fn.includes(step), `useAnswerText still runs ${step} (else update testkit/answerView.ts)`);
  }
  // nothing else turns the answer text into segments there
  assert.equal(fn.match(/\b(parseMessage|createStreamParser)\(/g), null);
  assert.match(mi, /export const SegmentView = memo\(/);
  const av = readFileSync(new URL('./answerView.ts', import.meta.url), 'utf8');
  for (const step of ['m.splitProgressNotes(', 'm.hideToolMarkup(', 'm.extractMedia(', 'm.advanceSegments(', 'm.withCitationSources(m.dedupeTranslations(', 'm.withRetrievedSources(']) assert.ok(av.includes(step), step);
});

test('layout, effects and taps run: agenda blocks at phone width, image lookups settle, a tap ticks an item', async () => {
  const av = await loadAnswerView();
  const agenda = await av.viewAnswer({ role: 'assistant', text: '```hui\n{"type":"agenda","blocks":[{"start":"09:00","end":"10:00","title":"Sport"}]}\n```' });
  assert.match(agenda.text, /Sport 09:00–10:00/, agenda.text);
  const gallery = await av.viewAnswer({ role: 'assistant', text: '```hui\n{"type":"gallery","items":[{"query":"Brot","caption":"Brot"}]}\n```' });
  assert.match(gallery.text, /Brot/);
  assert.equal(gallery.segments[0].skeletons, 0, 'the lookup settled');
  const v = await av.mountAnswer({ role: 'assistant', text: '```hui\n{"type":"checklist","id":"l","items":[{"text":"Milch"},{"text":"Brot"}]}\n```' });
  assert.match(v.text(), /0\/2/);
  await v.tap('Milch');
  assert.match(v.text(), /1\/2/);
  await assert.rejects(v.tap('Gibt es nicht'), /nothing shows/);
  await v.unmount();
});

test('streamed snapshots are drawn like the live answer (a half block is a placeholder, never raw JSON)', async () => {
  const av = await loadAnswerView();
  const snaps = await av.streamAnswer({ role: 'assistant', text: 'Liste:\n\n```hui\n{"type":"checklist","items":[{"text":"Milch"},{"text":"Brot"},{"text":"Eier"}]}\n```\n\nFertig.' }, { chunks: 6 });
  assert.equal(snaps.length, 5);
  for (const s of snaps) assert.doesNotMatch(s.text, /"type"|```|\{"/, s.text);
});
