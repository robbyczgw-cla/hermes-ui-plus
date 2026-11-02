/// <reference types="node" />
// Replays recorded QA conversations (fixtures/*.json, personal/*.json) through the real render path and checks what
// the user sees (userChecks.ts). Used by the transcripts-*.test.ts files, one per QA round so node --test runs them
// in parallel. docs/CHAT-REGRESSION.md explains the fixture format and how to add a case.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadAnswerView } from '../testkit/answerView.ts';
import { checkClaims, checkDrawn, checkPromises, missingContent, type Finding } from './userChecks.ts';
import { EXPECTED } from './expected.ts';

export type Turn = { user: string | null; answer?: string; tools?: { id?: string; name?: string; status?: string; textAt?: number }[]; status?: string };
export type Conversation = { id: string; source: string; setup: string; uiLang: 'de' | 'en' | 'es'; findings: string[]; turns: Turn[] };

export function loadFixture(url: URL): Conversation[] {
  return (JSON.parse(readFileSync(url, 'utf8')) as { conversations: Conversation[] }).conversations;
}

/** `<conversation id>#<turn index>` → the finding codes that answer is expected to produce (expected.ts) */
export const turnKey = (c: Conversation, i: number) => `${c.id}#${i}`;

/** Everything the checks say about one recorded answer, as sorted codes plus the details for a failure message. */
export async function judge(av: Awaited<ReturnType<typeof loadAnswerView>>, c: Conversation, t: Turn, lang = c.uiLang) {
  const status = t.status ?? 'done';
  const view = await av.viewAnswer({ role: 'assistant', text: t.answer ?? '', tools: t.tools ?? [], status }, { lang, explore: true });
  // prepared demo answers act inside the demo (its routines, its watch) and are not model claims
  const scripted = /^scripted/.test(c.setup);
  const findings: Finding[] = [...checkDrawn(view, { status }), ...(scripted ? [] : [...checkClaims(t.answer ?? '', t.tools ?? []), ...checkPromises(t.answer ?? '', view)])];
  view.segments.forEach((s, i) => {
    if (s.kind !== 'hui') return;
    for (const m of missingContent(s.raw, s.type, view.explored[i])) findings.push({ code: `dropped:${s.type}.${m.key}`, level: 'fail', segment: i, detail: `"${m.value.slice(0, 80)}" is not on screen` });
  });
  return { view, findings, codes: [...new Set(findings.map((f) => f.code))].sort() };
}

/**
 * One node:test per conversation: every answer must produce exactly the findings expected.ts lists for it (none for
 * almost all). A new finding fails with what the user saw; a listed finding that no longer occurs fails too, so the
 * list only ever shrinks deliberately.
 */
export function replayTranscripts(name: string, convs: Conversation[], o: { streamOnePerType?: boolean } = {}) {
  let av: Awaited<ReturnType<typeof loadAnswerView>> | null = null;
  const streamedTypes = new Set<string>();
  for (const c of convs) {
    test(`${name}: ${c.id} (${c.source}; ${c.findings.length ? c.findings.join(', ') : 'no finding'})`, async () => {
      av ??= await loadAnswerView();
      for (const [i, t] of c.turns.entries()) {
        if (!t.answer || t.status === 'error') continue; // an error turn draws the error row, not the answer pipeline
        const { view, findings, codes } = await judge(av, c, t);
        const want = [...(EXPECTED[turnKey(c, i)]?.codes ?? [])].sort();
        assert.deepEqual(
          codes,
          want,
          `${turnKey(c, i)} after "${(t.user ?? '').slice(0, 80)}":\n${findings.map((f) => `  ${f.code}: ${f.detail}`).join('\n') || '  (no finding)'}\n  user sees: ${view.text.slice(0, 600)}`,
        );
        // streamed: the first answer of each component type in this file, cut into pieces (also inside JSON): no
        // snapshot may show raw markup or crash, the stream ends where the finished answer is
        const types = view.segments.map((s) => s.type ?? s.kind).filter((x) => !streamedTypes.has(x));
        if (o.streamOnePerType !== false && types.length) {
          for (const x of types) streamedTypes.add(x);
          const snaps = await av.streamAnswer({ role: 'assistant', text: t.answer, tools: t.tools ?? [] }, { lang: c.uiLang, chunks: 5 });
          for (const [k, s] of snaps.entries()) {
            const bad = checkDrawn({ text: s.text, segments: s.segments, announcement: '' }, { status: 'streaming' }).filter((f) => f.code === 'raw-markup' || f.code === 'render-crash');
            assert.deepEqual(bad, [], `${turnKey(c, i)} streamed, snapshot ${k + 1}/5 shows: ${s.text.slice(0, 400)}`);
          }
        }
      }
    });
  }
}
