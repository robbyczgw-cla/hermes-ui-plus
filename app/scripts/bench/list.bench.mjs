// Per-tick work on the whole message list while the last answer streams (500-message chat).
// Run from app/: scripts/bench/run.sh list
import { createListDerive, createReversedList } from '../../src/chat/listDerive.ts';
import { appendCapped } from '../../src/hermes/chatState.ts';
import { firstUserText, messagesFileJson, messagesSignature, prepareForStorage, previewOf, searchTextOf } from '../../src/conversations/messages.ts';
import { header, perStep, report } from './lib.mjs';
import { chatMessage, longAnswer, longChat } from './fixtures.mjs';

const TICK = 16;

for (const n of [100, 500]) {
  header(`streaming ticks in a ${n}-message chat`);
  const history = longChat(n);
  const answer = longAnswer(2);
  // the throttled React state: one new list per tick, only the last message replaced (useHermesChat updateLast)
  const lists = [];
  let msg = chatMessage(n, '', 'assistant');
  let list = [...history, msg];
  for (let i = 0; i < answer.length; i += TICK) {
    msg = { ...msg, text: appendCapped(msg.text, answer.slice(i, i + TICK), 1_000_000).text, status: 'streaming' };
    list = list.slice();
    list[list.length - 1] = msg;
    lists.push(list);
  }
  report(
    'MessageList derive: reverse + listDerive per tick',
    perStep(() => {
      const rev = createReversedList();
      const derive = createListDerive();
      return (l) => {
        rev(l);
        derive(l);
      };
    }, lists),
  );
  report(
    'firstAssistantId scan + lastId per tick',
    perStep(() => (l) => {
      l.find((m) => m.role === 'assistant');
      return l[l.length - 1]?.id;
    }, lists),
  );
  // per SSE delta (not throttled): updateLast copies the list for every token
  const tokens = [];
  for (let i = 0; i < answer.length; i += 4) tokens.push(answer.slice(i, i + 4));
  report(
    'updateLast per SSE delta (list copy + message spread)',
    perStep(() => {
      let cur = [...history, chatMessage(n, '', 'assistant')];
      return (d) => {
        const next = cur.slice();
        const last = next[next.length - 1];
        next[next.length - 1] = { ...last, text: appendCapped(last.text, d, 1_000_000).text };
        cur = next;
      };
    }, tokens),
  );
}

// ---------------------------------------------------------------- partial save while streaming (every ~2.5 s)

header('partial save of a streaming 500-message chat (usePersistOnNewMessage → controller.save)');
{
  const history = longChat(500);
  const answer = longAnswer(4);
  // one save per step: the streaming answer grew by ~2.5 s of text (300 chars)
  const lists = [];
  for (let i = 300; i < answer.length; i += 300) lists.push([...history, { ...chatMessage(500, answer.slice(0, i), 'assistant'), status: 'streaming' }]);
  report(
    'controller.save work per partial save (signature, strip + cap, search text, preview)',
    perStep(() => {
      messagesSignature(history); // the stored chat before the turn (hashes cached per message object)
      // controller.save → repo.saveMessages (prepareForStorage, remember → searchTextOf) + index preview
      return (l) => {
        messagesSignature(l);
        const stored = prepareForStorage(l);
        searchTextOf(stored);
        previewOf(stored);
        firstUserText(l);
      };
    }, lists),
  );
  // a long answer: 55 K chars, saved every ~2.5 s
  const long = longAnswer(16);
  const longLists = [];
  for (let i = 4000; i < long.length; i += 4000) longLists.push([...history, { ...chatMessage(500, long.slice(0, i), 'assistant'), status: 'streaming' }]);
  report(
    '… while a 55K answer streams (one save per 4K chars)',
    perStep(() => {
      messagesSignature(history);
      return (l) => {
        messagesSignature(l);
        const stored = prepareForStorage(l);
        searchTextOf(stored);
        previewOf(stored);
        firstUserText(l);
      };
    }, longLists),
  );
  const stored = prepareForStorage(lists[lists.length - 1]);
  report('repo flush: JSON.stringify of the stored transcript', perStep(() => (l) => JSON.stringify({ v: 1, messages: l }), [stored]));
  // what the repo writes since the per-message JSON cache: one flush per partial save of the streaming answer
  const storedLists = longLists.map((l) => prepareForStorage(l));
  report('repo flush per partial save: JSON.stringify of the file', perStep(() => (l) => JSON.stringify({ v: 1, messages: l }), storedLists));
  report('repo flush per partial save: messagesFileJson (unchanged messages reused)', perStep(() => (l) => messagesFileJson(1, l), storedLists));
}
