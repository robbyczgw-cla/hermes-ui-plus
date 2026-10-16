import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEvent, createAssistantMessage, finalize } from '../../hermes/chatState.ts';
import type { ChatMessage, HermesEvent } from '../../hermes/types';
import { parseMessage } from '../../protocol/streamParser.ts';
import { evaluateOutputs, sweep } from '../../calc/outputs.ts';
import { makeT } from '../../i18n/core.ts';
import { chatStarters } from '../../chat/starters.ts';
import { REFORMAT_BASE_KINDS, TRANSLATE_LANGS, reformatMessage, type ReformatKind } from '../../chat/reformat.ts';
import { checklistReply, choiceReply, pathsReply, quizReply } from '../../ui/components/modules/a/replies.ts';
import { productReply } from '../../ui/components/modules/d1/d1Model.ts';
import { DEMO_STARTERS } from '../starters.ts';
import { FACTS } from './facts.ts';
import type { DemoLang } from './kit.ts';
import { PROMPTS, PROMPT_SCENARIO, type PromptKey } from './prompts.ts';
import { pickScenario, scenarios } from './scenarios.ts';
import { PATHS_ID, PRODUCTS_ID, QUIZ_ID, SHOPPING_ID, TRAVEL_CHOICE_ID, TRIP_CHOICE_ID } from './scenes-core.ts';
import { INSTANT_TIMING, runDemoTurn, tokenize } from './transport.ts';

const LANGS: DemoLang[] = ['de', 'en', 'es'];
const LOCALE = { de: 'de-DE', en: 'en-US', es: 'es-ES' } as const;
const tr = (lang: DemoLang) => makeT(lang, LOCALE[lang]);

const noSleep = (_ms: number, signal?: AbortSignal) => (signal?.aborted ? Promise.reject(Object.assign(new Error('a'), { name: 'AbortError' })) : Promise.resolve());

async function replay(text: string, o: { lang?: DemoLang; approve?: 'once' | 'deny'; history?: string[] } = {}) {
  const events: HermesEvent[] = [];
  let msg: ChatMessage = createAssistantMessage(0);
  const r = await runDemoTurn({
    text,
    sessionId: 'demo-1',
    turn: 1,
    lang: o.lang ?? 'de',
    history: o.history,
    timing: INSTANT_TIMING,
    sleep: noSleep,
    now: () => new Date(2026, 9, 10, 12, 0),
    onEvent: (ev) => {
      events.push(ev);
      msg = applyEvent(msg, ev, 1);
    },
    waitForApproval: async () => o.approve ?? 'once',
  });
  if (msg.status === 'streaming') msg = finalize(msg, 'done', undefined, 2);
  return { r, events, msg };
}

type HuiNode = { type: string; [k: string]: unknown };
/** all complete hui nodes of an answer */
function nodes(msg: ChatMessage): HuiNode[] {
  const out: HuiNode[] = [];
  for (const seg of parseMessage(msg.text)) {
    if (seg.kind === 'hui') {
      assert.ok(seg.complete && seg.node && !seg.error, `invalid hui block: ${seg.error ?? seg.raw.slice(0, 80)}`);
      out.push(seg.node as unknown as HuiNode);
    }
  }
  return out;
}
const nodeOf = (msg: ChatMessage, type: string) => nodes(msg).find((n) => n.type === type);
const chipsOf = (msg: ChatMessage) => nodes(msg).filter((n) => n.type === 'suggestions').flatMap((n) => n.items as string[]);

// ── routing ─────────────────────────────────────────────────────────────────────────────────────────────────────

test('pickScenario: every sample request reaches its scenario in every language', () => {
  for (const key of Object.keys(PROMPTS) as PromptKey[]) {
    for (const lang of LANGS) assert.equal(pickScenario(PROMPTS[key][lang]).name, PROMPT_SCENARIO[key], `${key} (${lang}): ${PROMPTS[key][lang]}`);
  }
});

test('start screen: demo starters send sample requests, in every language, and the chat starters land in scenarios', () => {
  const byId: Record<string, PromptKey> = { chart: 'chart', approval: 'approval', checklist: 'checklist', products: 'products', recipe: 'recipe', explain: 'explain' };
  assert.deepEqual(DEMO_STARTERS.map((s) => s.id), Object.keys(byId), 'tour order (Chart first: the review notes start there)');
  for (const lang of LANGS) {
    const t = tr(lang);
    for (const s of DEMO_STARTERS) {
      const text = t(s.promptKey!);
      assert.equal(text, PROMPTS[byId[s.id]][lang], `${s.id} (${lang}) i18n text equals the sample request`);
      assert.equal(pickScenario(text).name, PROMPT_SCENARIO[byId[s.id]], `${s.id} (${lang})`);
      assert.ok(t(s.titleKey) && t(s.subtitleKey) && !t(s.titleKey).startsWith('onboarding.'), `${s.id} (${lang}) texts`);
    }
    // the empty-chat tiles of the demo chat
    const byKey = Object.fromEntries(chatStarters(t).map((s) => [s.key, pickScenario(s.prompt).name]));
    assert.deepEqual(byKey, { checklist: 'checklist', agenda: 'trip', compare: 'reiseChoice', chart: 'charts3', recipe: 'recipe', explain: 'explain' }, `chat starters (${lang})`);
  }
});

test('pickScenario: the review-notes tap path and the legacy keywords', () => {
  const cases: [string, string][] = [
    ['Make me a shopping list for the weekend', 'checklist'],
    ['Mind map of a heat pump', 'mindmap'],
    ['Mach mir eine Mindmap zur Wärmepumpe', 'mindmap'],
    ['Hazme un mapa mental de la bomba de calor', 'mindmap'],
    ['Clean up the cache, with approval', 'approval'],
    ['Compare noise cancelling headphones', 'products'],
    ['What is the project status?', 'werkzeuge'],
    ['Create a mixed report for this week.', 'mixed'],
    ['Show me a chart of the temperature trend.', 'chart'],
    ['Wähle ein Reiseziel', 'choice'],
    ['Mach mir eine Einkaufsliste', 'checklist'],
    ['Zinsrechner bitte', 'calc'],
    ['Rezept für Pasta', 'recipe'],
    ['Quiz zur Geografie', 'quiz'],
    ['Zeig eine Tabelle', 'table'],
    ['Wide table please', 'wideTable'],
    ['[form:kredit] {"betrag":1}', 'formResult'],
    ['[choice:reiseziel] Wähle ein Ziel → Rom', 'interaction'],
    ['[paths:demo-dateien] Geteilter Ordner', 'interaction'],
    ['Freigabe testen', 'approval'],
    ['Zeig mir Pfade', 'paths'],
    ['Zeig mir die Architektur', 'blocks'],
    ['Show the architecture of my setup', 'blocks'],
    ['Show me a map of Vienna', 'needsNet'],
    ['Bilder von Rom', 'needsNet'],
    ['hallo', 'tour'],
    ['xyzzy', 'plain'],
    ['Fix the bug in my code', 'coding'],
    ['Zeig mir den Diff', 'coding'],
    ['Arregla el bug de mi código', 'coding'],
  ];
  for (const [text, name] of cases) assert.equal(pickScenario(text).name, name, text);
});

test('tokenize keeps text intact; fenced blocks become bigger chunks', () => {
  const s = 'Hallo Welt, ein Wort-Ungetüm!\n\n```hui\n{"type":"text","text":"x"}\n```\nEnde.';
  const toks = tokenize(s);
  assert.equal(toks.map((t) => t.tok).join(''), s);
  assert.ok(toks.filter((t) => !t.block).every((t) => t.tok.length <= 8));
  assert.ok(toks.some((t) => t.block));
});

// ── every scenario, every language ──────────────────────────────────────────────────────────────────────────────

/** a request (or reply) that reaches each scenario; `pre` builds localized replies from the answer of the scenario before */
const REQUEST: Record<string, string> = {
  plain: 'xyzzy', needsNet: 'map', tour: PROMPTS.tour.en, chart: PROMPTS.chart.en, approval: PROMPTS.approval.en, cacheList: PROMPTS.cacheList.en,
  checklist: PROMPTS.checklist.en, choice: PROMPTS.choice.en, trip: PROMPTS.tripLisbon.en, reiseChoice: PROMPTS.travel.en, paths: PROMPTS.paths.en,
  products: PROMPTS.products.en, recipe: PROMPTS.recipe.en, quiz: PROMPTS.quiz.en, flashcards: PROMPTS.flashcards.en, explain: PROMPTS.explain.en,
  charts3: PROMPTS.prices.en, werkzeuge: PROMPTS.status.en, mixed: PROMPTS.mixed.en, compare: PROMPTS.compare.en, loan: PROMPTS.loan.en, connect: PROMPTS.connect.en,
  mindmap: 'mind map', table: 'table', wideTable: 'wide table', gameTable: 'ps2', longWords: 'oled', stats: 'stats', form: 'form', steps: 'steps', timeline: 'timeline',
  buttons: 'buttons', calculator: 'calculator', calc: 'compound interest', kreditCalc: 'schieberegler', places: 'restaurants', weather: 'weather',
  poll: 'poll', translation: 'translate this', agenda: 'plan my saturday', webSuche: 'jet lag', blocks: 'architecture', coding: 'Fix the bug in my code', error: 'error', long: 'long',
  tool: 'what time', tools2: 'parallel',
  formResult: '[form:kredit] {"betrag":20000}', interaction: '[confirm:x] ja',
  checklistReply: checklistReply(SHOPPING_ID, ['Butter'], ['Eggs', 'Basil']), quizResult: quizReply(QUIZ_ID, 2, 3), pathsPick: pathsReply(PATHS_ID, 'Cloud sync'),
  productTake: `[products:${PRODUCTS_ID}] Pick: Fjord Demo Calm 5`, reformat: reformatMessage('shorter', tr('en')), reiseDecision: choiceReply(TRAVEL_CHOICE_ID, 'q', ['Price']),
};

test('every scenario has a request, and every request routes to it', () => {
  assert.deepEqual(Object.keys(REQUEST).sort(), Object.keys(scenarios).sort());
  for (const [name, text] of Object.entries(REQUEST)) assert.equal(pickScenario(text).name, name, text);
});

test('every scenario replays through the real SSE parser and renders valid hui nodes in de, en and es', async () => {
  const seen = new Set<string>();
  for (const lang of LANGS) {
    for (const [name, text] of Object.entries(REQUEST)) {
      const { r, events, msg } = await replay(text, { lang, history: [PROMPTS.explain[lang]] });
      assert.equal(r.aborted, false, `${name} ${lang}`);
      assert.ok(events.some((e) => e.type === 'route'), `${name} ${lang}: route event`);
      assert.ok(events.some((e) => e.type === 'done'), `${name} ${lang}: [DONE]`);
      if (name === 'error') {
        assert.equal(msg.status, 'error');
        continue;
      }
      assert.equal(msg.status, 'done', `${name} ${lang}`);
      assert.ok(msg.text.trim().length > 20, `${name} ${lang}: has an answer`);
      for (const n of nodes(msg)) seen.add(n.type);
      for (const seg of parseMessage(msg.text)) if (seg.kind === 'html') assert.ok(seg.complete, `${name} ${lang}: html complete`);
    }
  }
  // the showcase: every block type of the story is on screen somewhere
  for (const t of ['choice', 'checklist', 'calc', 'recipe', 'quiz', 'flashcards', 'chart', 'table', 'decision', 'poll', 'translation', 'agenda', 'sources', 'weather', 'places', 'products', 'paths', 'blocks', 'diff', 'terminal', 'changes', 'timeline', 'steps', 'stats', 'compare', 'form', 'buttons', 'suggestions', 'progress', 'mindmap']) assert.ok(seen.has(t), `showcases ${t}`);
});

test('the demo answers in the chat language (no German leaking into en/es, no English into de)', async () => {
  const GERMAN = /\b(und|nicht|ist|für|mit|der|die|ein|eine|dein|deine|wird|oder)\b|[äöüß]/i;
  const ENGLISH_ONLY = /\b(the|and|with|your|you|this|that|for|are)\b/i;
  const fixtures = new Set(['gameTable', 'longWords']); // German-only layout fixtures, documented
  for (const [name, text] of Object.entries(REQUEST)) {
    if (fixtures.has(name) || name === 'error') continue;
    for (const lang of ['en', 'es'] as const) {
      const { msg } = await replay(text, { lang, history: [PROMPTS.explain[lang]] });
      // prose outside code/hui blocks only: the fenced content is checked as part of the same text on purpose
      assert.doesNotMatch(msg.text.replace(/```hui-html[\s\S]*?```/g, '').replace(/"category": "[^"]*"/g, ''), GERMAN, `${name} ${lang} contains German: ${msg.text.match(GERMAN)?.[0]}`);
    }
    const { msg } = await replay(text, { lang: 'de', history: [PROMPTS.explain.de] });
    const de = msg.text.replace(/```hui-html[\s\S]*?```/g, '').replace(/https?:\/\/\S+/g, '').replace(/`[^`]*`/g, '');
    assert.doesNotMatch(de, ENGLISH_ONLY, `${name} de contains English: ${de.match(ENGLISH_ONLY)?.[0]}`);
  }
});

test('offline and fictional: no photos, maps or web lookups, only example hosts, no real brands or private data', async () => {
  const BRANDS = /orbstack|parallels|vmpal|time machine|final fantasy|\bgta\b|snapdragon|retroid|nous research|tailscale|ts\.net|wikimedia|wikipedia|openstreetmap|unpkg/i;
  const PRIVATE = /\b\d{1,3}(?:\.\d{1,3}){3}\b|[\w.+-]+@[\w-]+\.\w+|\b100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./;
  const OFFLINE = /"imageQuery"|"type": "(?:map|image|gallery)"|fetch\(|XMLHttpRequest|WebSocket/;
  const outputs: string[] = [];
  for (const lang of LANGS) {
    for (const text of Object.values(REQUEST)) {
      for (const approve of ['once', 'deny'] as const) outputs.push((await replay(text, { lang, approve, history: [PROMPTS.explain[lang]] })).msg.text);
    }
    for (const kind of [...REFORMAT_BASE_KINDS, ...TRANSLATE_LANGS.map((l) => `translate:${l}` as const)] as ReformatKind[]) {
      for (const prev of ['explain', 'status', 'connect'] as const) outputs.push((await replay(reformatMessage(kind, tr(lang)), { lang, history: [PROMPTS[prev][lang]] })).msg.text);
    }
  }
  for (const out of outputs) {
    assert.doesNotMatch(out, BRANDS, `brand/private name in: ${out.match(BRANDS)?.[0]}`);
    assert.doesNotMatch(out, PRIVATE, `address in: ${out.match(PRIVATE)?.[0]}`);
    assert.doesNotMatch(out, OFFLINE, `online resource in: ${out.match(OFFLINE)?.[0]}`);
    for (const url of out.match(/https?:\/\/[^\s"'<>)\]]+/g) ?? []) assert.match(new URL(url).hostname, /^(www\.)?example\.(com|org|net)$/, `only example hosts, got ${url}`);
  }
});

// ── the story: every tap has a follow-up ────────────────────────────────────────────────────────────────────────

test('every suggestion chip and send button is a sample request that routes to a scenario', async () => {
  const known = (lang: DemoLang) => new Map<string, PromptKey>((Object.keys(PROMPTS) as PromptKey[]).map((k) => [PROMPTS[k][lang] as string, k]));
  let total = 0;
  for (const lang of LANGS) {
    const prompts = known(lang);
    for (const text of Object.values(REQUEST)) {
      for (const approve of ['once', 'deny'] as const) {
        const { msg } = await replay(text, { lang, approve, history: [PROMPTS.explain[lang]] });
        const sends = nodes(msg).filter((n) => n.type === 'buttons').flatMap((n) => (n.items as { action: { type: string; text?: string } }[]).filter((i) => i.action.type === 'send').map((i) => i.action.text!));
        for (const chip of [...chipsOf(msg), ...sends]) {
          total++;
          const key = prompts.get(chip);
          assert.ok(key, `${lang}: chip "${chip}" is not a sample request`);
          assert.notEqual(pickScenario(chip).name, 'plain', `${lang}: chip "${chip}" falls through`);
          assert.equal(pickScenario(chip).name, PROMPT_SCENARIO[key], `${lang}: chip "${chip}"`);
        }
      }
    }
  }
  assert.ok(total > 150, `checked ${total} chips`);
});

/** what a user can tap on an answer: its blocks' replies and the transform chips (as the app builds them) */
function tapsOf(msg: ChatMessage, lang: DemoLang, name: string): string[] {
  const t = tr(lang);
  const out: string[] = [];
  for (const n of nodes(msg)) {
    const o = n as unknown as { id: string; question?: string; items?: { title?: string; text?: string }[]; options?: { label: string }[]; products?: unknown[] };
    if (n.type === 'choice') for (const opt of o.options!) out.push(choiceReply(o.id, o.question, [opt.label]));
    if (n.type === 'checklist') out.push(checklistReply(o.id, o.items!.map((i) => i.text!), []));
    if (n.type === 'quiz') out.push(quizReply(o.id, 3, 3), quizReply(o.id, 1, 3));
    if (n.type === 'paths') for (const i of o.items!) out.push(pathsReply(o.id, i.title!));
    if (n.type === 'products') for (const p of o.products!) out.push(productReply(o.id, p as never, t));
  }
  if (['explain', 'werkzeuge', 'connect'].includes(name)) out.push(...REFORMAT_BASE_KINDS.map((k) => reformatMessage(k, t)), ...TRANSLATE_LANGS.map((l) => reformatMessage(`translate:${l}`, t)));
  return out;
}

test('start screen, tour and empty-chat tiles reach every part of the story: chips and taps never dead-end', async () => {
  for (const lang of LANGS) {
    const reach = new Set<string>();
    const seen = new Set<string>();
    // the entries: the tour, the start screen of the demo and the tiles of an empty chat
    const queue = [PROMPTS.tour[lang], ...DEMO_STARTERS.map((st) => tr(lang)(st.promptKey!)), ...chatStarters(tr(lang)).map((st) => st.prompt)];
    // walk the whole story: follow chips (both approval branches) and tap every block
    while (queue.length) {
      const text = queue.shift()!;
      if (seen.has(text)) continue;
      seen.add(text);
      const name = pickScenario(text).name;
      reach.add(name);
      for (const approve of ['once', 'deny'] as const) {
        const { msg } = await replay(text, { lang, approve, history: [PROMPTS.explain[lang]] });
        assert.ok(msg.text.trim().length > 40, `${name}: answer`);
        const next = [...chipsOf(msg), ...tapsOf(msg, lang, name)];
        if (!['explain', 'werkzeuge', 'connect', 'reformat', 'tour', 'plain', 'chart', 'charts3', 'mixed', 'loan', 'compare', 'recipe', 'flashcards', 'cacheList'].includes(name) || chipsOf(msg).length) assert.ok(next.length > 0 || name.startsWith('choice'), `${lang}: ${name} leads somewhere`);
        for (const n of next) assert.notEqual(pickScenario(n).name, 'plain', `${lang}: "${n}" is not a dead end`);
        queue.push(...next);
      }
    }
    for (const must of ['approval', 'cacheList', 'checklist', 'checklistReply', 'choice', 'trip', 'reiseChoice', 'reiseDecision', 'paths', 'pathsPick', 'products', 'productTake', 'recipe', 'quiz', 'quizResult', 'flashcards', 'explain', 'reformat', 'connect', 'werkzeuge', 'charts3', 'chart', 'mixed', 'loan']) assert.ok(reach.has(must), `${lang}: the story reaches ${must}`);
    const fallback = await replay('something the demo has no script for', { lang });
    assert.equal(pickScenario('something the demo has no script for').name, 'plain');
    assert.ok(chipsOf(fallback.msg).length >= 8, `${lang}: fallback offers the sample requests`);
  }
});

test('approval: Allow once and Deny both continue the answer, in every language', async () => {
  for (const lang of LANGS) {
    const ok = await replay(PROMPTS.approval[lang], { lang, approve: 'once' });
    const ev = ok.events.find((e) => e.type === 'approval');
    assert.ok(ev && ev.type === 'approval' && ev.approval.command.startsWith('rm -rf'), `${lang}: approval request`);
    assert.deepEqual(ev.approval.choices ?? ['once', 'deny'], ['once', 'deny'], `${lang}: only Allow once / Deny`);
    assert.ok(ok.msg.tools.some((t) => t.label?.startsWith('rm -rf') && t.status === 'done'), `${lang}: the command ran after approval`);
    assert.ok(nodeOf(ok.msg, 'stats'), `${lang}: result card after approval`);
    assert.ok(chipsOf(ok.msg).length >= 3);

    const no = await replay(PROMPTS.approval[lang], { lang, approve: 'deny' });
    assert.ok(!no.msg.tools.some((t) => t.label?.startsWith('rm -rf')), `${lang}: nothing ran after Deny`);
    assert.ok(no.msg.text.length > 200, `${lang}: the answer continues after Deny`);
    assert.ok(chipsOf(no.msg).includes(PROMPTS.cacheList[lang]), `${lang}: Deny offers to list the cache instead`);
    assert.notEqual(ok.msg.text, no.msg.text);
  }
  // both branches also work through the app's own timeline (running tool steps before the request)
  const { msg } = await replay(PROMPTS.approval.en);
  assert.ok(msg.tools.length >= 3 && msg.tools.every((t) => t.status === 'done'));
});

test('checklist: ticking items and sending them continues into the next step', async () => {
  for (const lang of LANGS) {
    const first = await replay(PROMPTS.checklist[lang], { lang });
    const list = nodeOf(first.msg, 'checklist') as unknown as { id: string; items: { text: string; checked?: boolean }[] };
    assert.equal(list.id, SHOPPING_ID);
    assert.ok(list.items.length >= 8 && list.items.some((i) => i.checked));
    const done = list.items.slice(0, 3).map((i) => i.text);
    const open = list.items.slice(3).map((i) => i.text);
    const reply = await replay(checklistReply(list.id, done, open), { lang });
    assert.match(reply.msg.text, new RegExp(`${3} (of|von|de) ${list.items.length}`), lang);
    assert.ok(nodeOf(reply.msg, 'progress'));
    assert.ok(chipsOf(reply.msg).includes(PROMPTS.recipe[lang]));
    const all = await replay(checklistReply(list.id, done.concat(open), []), { lang });
    assert.ok(chipsOf(all.msg).includes(PROMPTS.recipe[lang]));
  }
});

test('choose a destination: every option, and "Other", leads to a plan or to the four prepared plans', async () => {
  for (const lang of LANGS) {
    const first = await replay(PROMPTS.choice[lang], { lang });
    const choice = nodeOf(first.msg, 'choice') as unknown as { id: string; question: string; options: { label: string }[] };
    assert.equal(choice.id, TRIP_CHOICE_ID);
    assert.equal(choice.options.length, 4);
    const seen = new Set<string>();
    for (const o of choice.options) {
      const text = choiceReply(choice.id, choice.question, [o.label]);
      assert.equal(pickScenario(text).name, 'trip');
      const r = await replay(text, { lang });
      const tl = nodeOf(r.msg, 'timeline') as unknown as { items: { time: string; title: string }[] };
      assert.equal(tl.items.length, 6, `${o.label}: plan`);
      seen.add(tl.items[0].title);
      assert.ok(r.msg.text.includes(o.label) || r.msg.text.length > 200);
    }
    assert.equal(seen.size, 4, 'four different plans');
    const other = await replay(choiceReply(choice.id, choice.question, [], 'Prague'), { lang });
    assert.ok(!nodeOf(other.msg, 'timeline'));
    assert.match(other.msg.text, /Prague/);
    assert.equal(chipsOf(other.msg).length, 4);
  }
});

test('train or plane: the priorities become weights and the answer names the winner', async () => {
  for (const lang of LANGS) {
    const first = await replay(PROMPTS.travel[lang], { lang });
    const choice = nodeOf(first.msg, 'choice') as unknown as { id: string; question: string; multiple: boolean; options: { label: string }[] };
    assert.equal(choice.id, TRAVEL_CHOICE_ID);
    assert.ok(choice.multiple);
    const pickLabels = [choice.options[2].label, choice.options[3].label]; // climate + working on the way
    const r = await replay(choiceReply(choice.id, choice.question, pickLabels), { lang });
    const dec = nodeOf(r.msg, 'decision') as unknown as { criteria: { id: string; weight: number }[]; options: { id: string; label: string }[] };
    const w = Object.fromEntries(dec.criteria.map((c) => [c.id, c.weight]));
    assert.ok(w.climate > w.price && w.work > w.price && w.climate > w.time, `${lang}: chosen priorities weigh more`);
    const price = await replay(choiceReply(choice.id, choice.question, [choice.options[0].label]), { lang });
    const dec2 = nodeOf(price.msg, 'decision') as unknown as { criteria: { id: string; weight: number }[] };
    assert.ok(dec2.criteria.find((c) => c.id === 'price')!.weight > dec2.criteria.find((c) => c.id === 'climate')!.weight);
    assert.equal(chipsOf(r.msg).length, 3);
  }
});

test('choose a path: each route has its own plan', async () => {
  for (const lang of LANGS) {
    const first = await replay(PROMPTS.paths[lang], { lang });
    const p = nodeOf(first.msg, 'paths') as unknown as { id: string; select: boolean; items: { title: string }[] };
    assert.equal(p.id, PATHS_ID);
    assert.equal(p.select, true, 'rows are selectable');
    const intros = new Set<string>();
    for (const item of p.items) {
      const text = pathsReply(p.id, item.title);
      assert.equal(pickScenario(text).name, 'pathsPick');
      const r = await replay(text, { lang });
      const steps = nodeOf(r.msg, 'steps') as unknown as { items: unknown[] };
      assert.equal(steps.items.length, 3, item.title);
      intros.add(r.msg.text.split('\n')[0]);
    }
    assert.equal(intros.size, 3, 'three different follow-ups');
  }
});

test('product compare: "I\'ll take this" confirms the pick, never buys, and moves on', async () => {
  for (const lang of LANGS) {
    const t = tr(lang);
    const first = await replay(PROMPTS.products[lang], { lang });
    const node = nodeOf(first.msg, 'products') as unknown as { id: string; compare: boolean; products: { id: string; name: string; brand: string; price: number }[] };
    assert.equal(node.id, PRODUCTS_ID);
    assert.ok(node.compare && node.products.length === 3);
    assert.ok(first.msg.tools.length >= 1, 'a search step comes first');
    for (const p of node.products) {
      const reply = productReply(node.id, p as never, t);
      assert.equal(pickScenario(reply).name, 'productTake');
      const r = await replay(reply, { lang });
      assert.ok(r.msg.text.includes(p.name), `${lang}: names ${p.name}`);
      const buttons = nodeOf(r.msg, 'buttons') as unknown as { items: { action: { type: string; url?: string } }[] };
      assert.ok(buttons.items.some((b) => b.action.type === 'open_url' && b.action.url?.startsWith('https://example.com/')));
      assert.ok(chipsOf(r.msg).length >= 3);
    }
  }
});

test('recipe with timers, quiz and flashcards', async () => {
  for (const lang of LANGS) {
    const recipe = nodeOf((await replay(PROMPTS.recipe[lang], { lang })).msg, 'recipe') as unknown as { steps: { timerSeconds?: number }[] };
    assert.ok(recipe.steps.filter((s) => s.timerSeconds).length >= 2, `${lang}: timers on the steps`);
    const quiz = nodeOf((await replay(PROMPTS.quiz[lang], { lang })).msg, 'quiz') as unknown as { id: string; questions: { options: string[]; answer: number | number[] }[] };
    assert.equal(quiz.id, QUIZ_ID);
    assert.equal(quiz.questions.length, 3);
    const perfect = await replay(quizReply(quiz.id, 3, 3), { lang });
    const weak = await replay(quizReply(quiz.id, 1, 3), { lang });
    assert.match(perfect.msg.text, /3/);
    assert.notEqual(perfect.msg.text, weak.msg.text);
    assert.ok(chipsOf(perfect.msg).includes(PROMPTS.flashcards[lang]) && chipsOf(weak.msg).includes(PROMPTS.flashcards[lang]));
    const cards = nodeOf((await replay(PROMPTS.flashcards[lang], { lang })).msg, 'flashcards') as unknown as { cards: { front: string; back: string }[] };
    assert.ok(cards.cards.length >= 6 && cards.cards.every((c) => c.front && c.back));
    assert.ok(cards.cards.every((c) => (lang === 'de' ? c.back !== c.front : true)));
  }
});

test('transform chips (Shorter / As a list / As a table / …) reshape the last answer; Translate covers all five languages', async () => {
  for (const lang of LANGS) {
    const t = tr(lang);
    for (const prev of ['explain', 'status', 'connect'] as const) {
      const f = FACTS[prev];
      const history = [PROMPTS[prev][lang]];
      const outputs = new Set<string>();
      for (const kind of [...REFORMAT_BASE_KINDS, ...TRANSLATE_LANGS.map((l) => `translate:${l}` as const)] as ReformatKind[]) {
        const text = reformatMessage(kind, t);
        assert.equal(pickScenario(text).name, 'reformat', `${kind} (${lang})`);
        const r = await replay(text, { lang, history });
        assert.ok(r.msg.text.length > 60, `${prev} ${kind} ${lang}`);
        outputs.add(r.msg.text);
        if (kind === 'table') {
          const table = nodeOf(r.msg, 'table') as unknown as { columns: string[]; rows: unknown[][] };
          assert.equal(table.rows.length, f.points[lang].length);
          assert.equal(table.columns.length, 3);
        }
        if (kind === 'shorter') assert.ok(r.msg.text.length < (await replay(PROMPTS[prev][lang], { lang })).msg.text.length);
        if (kind.startsWith('translate:')) assert.ok(r.msg.text.includes(f.translated[kind.slice(10) as keyof typeof f.translated]));
      }
      assert.equal(outputs.size, REFORMAT_BASE_KINDS.length + TRANSLATE_LANGS.length, `${prev} ${lang}: every chip gives a different version`);
      // chips can be chained: the next chip still reshapes the original answer, not the reshaped one
      const chained = await replay(reformatMessage('table', t), { lang, history: [reformatMessage('shorter', t), PROMPTS[prev][lang]] });
      assert.ok(nodeOf(chained.msg, 'table'));
    }
    // no prose answer to reshape: offer the ones that can be
    const none = await replay(reformatMessage('shorter', t), { lang, history: [PROMPTS.chart[lang]] });
    assert.ok(chipsOf(none.msg).includes(PROMPTS.explain[lang]));
  }
});

test('every other block reply is acknowledged with a next step', async () => {
  const replies = ['[confirm:x] ja', '[poll:p] Pizza', '[slot:s] 10:00', '[rank:r] 1. A · 2. B', '[scale:c] 4', '[agenda:a] 08:30 Run', '[vocab:v] 5/6', '[decision:d] A', '[mindmap] Explain “x”', '[choice:other] Q → A', '[paths:other] B'];
  for (const lang of LANGS) {
    for (const text of replies) {
      assert.equal(pickScenario(text).name, 'interaction', text);
      const r = await replay(text, { lang });
      assert.ok(r.msg.text.length > 80 && chipsOf(r.msg).length >= 3, `${text} ${lang}`);
    }
  }
});

test('Stop: a long answer takes a while to stream and can be cut off', async () => {
  for (const lang of LANGS) {
    const full = await replay(PROMPTS.connect[lang], { lang });
    assert.ok(full.events.filter((e) => e.type === 'text').length > 150, 'enough tokens to hit Stop');
    assert.ok(full.msg.tools.length >= 2 && (full.msg.reasoning ?? '').length > 100);
    assert.match(full.msg.text, /Connect Hermes|Hermes verbinden|Conectar Hermes/, `${lang}: points to the way out`);
    const ctrl = new AbortController();
    let n = 0;
    const r = await runDemoTurn({
      text: PROMPTS.connect[lang], lang, sessionId: 's', turn: 1, signal: ctrl.signal, timing: INSTANT_TIMING, sleep: noSleep,
      onEvent: (ev) => { if (ev.type === 'text' && ++n === 40) ctrl.abort(); },
      waitForApproval: async () => 'once',
    });
    assert.equal(r.aborted, true);
    assert.equal(n, 40);
  }
});

test('abort stops the replay (also while waiting for an approval)', async () => {
  const ctrl = new AbortController();
  const r = await runDemoTurn({
    text: PROMPTS.approval.en, lang: 'en', sessionId: 's', turn: 1, signal: ctrl.signal, timing: INSTANT_TIMING, sleep: noSleep,
    onEvent: (ev) => { if (ev.type === 'approval') ctrl.abort(); },
    waitForApproval: () => new Promise(() => {}),
  });
  assert.equal(r.aborted, true);
});

test('tools, reasoning and status arrive as Hermes events', async () => {
  for (const lang of LANGS) {
    const { msg } = await replay(PROMPTS.status[lang], { lang });
    assert.ok(msg.tools.length >= 4);
    assert.ok(msg.tools.every((t) => t.status === 'done'));
    assert.ok((msg.reasoning ?? '').length > 10);
    assert.equal(msg.route?.format, 'text');
  }
});

test('calc scenario expressions evaluate', () => {
  const step = scenarios.calc.steps({ userText: '', turn: 1, sessionId: 's', now: new Date() }).find((s) => 'text' in s && s.text.includes('"calc"'));
  assert.ok(step && 'text' in step);
  const json = JSON.parse(step.text.replace(/^```hui\n/, '').replace(/\n```\n$/, ''));
  const inputs = Object.fromEntries(json.inputs.map((i: { name: string; default: number }) => [i.name, i.default]));
  const out = evaluateOutputs(inputs, json.outputs);
  assert.ok(out.every((o) => o.value !== null && !o.error), JSON.stringify(out));
  const end = out.find((o) => o.name === 'end')!.value!;
  assert.ok(end > 5000 + 200 * 180 && end < 100000, String(end));
  const sw = sweep(json.chart, inputs, json.outputs);
  assert.ok(sw.ok && sw.points.length === 40);
});

test('the fallback and the demo chrome follow the UI language; the official build does not advertise other providers', () => {
  for (const [lang, marker, german] of [['en', /offline demo/, /Offline-Demo/], ['es', /demo sin conexión/, /Offline-Demo/]] as const) {
    const text = scenarios.plain.steps({ userText: 'hola', turn: 1, sessionId: 's', now: new Date(), lang }).map((s) => ('text' in s ? s.text : '')).join('');
    assert.match(text, marker, lang);
    assert.doesNotMatch(text, german, lang);
    assert.doesNotMatch(text, /another provider|otro proveedor|anderen Anbieter/i, `${lang}: official build (flavor hermes) must not mention other providers`);
  }
  const personal = scenarios.plain.steps({ userText: 'x', turn: 1, sessionId: 's', now: new Date(), lang: 'en', flavor: 'personal' });
  assert.match(personal.map((s) => ('text' in s ? s.text : '')).join(''), /another provider/);
  for (const lang of LANGS) {
    const t = tr(lang);
    assert.ok(t('chat.header.demo.text') !== 'chat.header.demo.text' && t('chat.header.demo.connect') !== 'chat.header.demo.connect');
    // the demo says it plainly: no server, and the way out is named like the answers name it
    assert.match(t('chat.header.demo.text'), /Server|server|servidor/);
    const connect = t('chat.header.demo.connect');
    assert.match(scenarios.connect.steps({ userText: '', turn: 1, sessionId: 's', now: new Date(), lang }).map((s) => ('text' in s ? s.text : '')).join(''), new RegExp(connect.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('facts: every reshaped answer is complete in every language', () => {
  for (const [id, f] of Object.entries(FACTS)) {
    for (const lang of LANGS) {
      for (const k of ['intro', 'outro', 'short', 'simple', 'expert', 'more'] as const) assert.ok(f[k][lang].length > 30, `${id}.${k}.${lang}`);
      assert.equal(f.points[lang].length, 4, `${id} points ${lang}`);
      assert.ok(f.points[lang].every((p) => p.every((x) => x.length > 1)));
      assert.equal(f.head[lang].length, 3);
    }
    assert.deepEqual(Object.keys(f.translated).sort(), ['de', 'en', 'es', 'fr', 'it']);
  }
});

test('coding scenario: a ```diff fence, a ```terminal fence with its exit line and a changes node with per-file diffs', async () => {
  const { msg } = await replay('Fix the bug in my code');
  const nodes = parseMessage(msg.text)
    .filter((s) => s.kind === 'hui')
    .map((s) => (s as unknown as { node: Record<string, unknown> }).node);
  assert.deepEqual(nodes.map((n) => n.type), ['diff', 'terminal', 'changes']);
  assert.match(String(nodes[0].patch), /^--- a\/src\/cart\/total\.ts/);
  assert.deepEqual([nodes[1].command, nodes[1].exitCode, nodes[1].durationMs], ['npm test', 0, 3900]);
  assert.equal((nodes[2].files as unknown[]).length, 3);
});
