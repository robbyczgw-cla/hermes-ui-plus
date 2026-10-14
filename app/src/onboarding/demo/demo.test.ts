import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEvent, createAssistantMessage, finalize } from '../../hermes/chatState.ts';
import type { ChatMessage, HermesEvent } from '../../hermes/types';
import { parseMessage } from '../../protocol/streamParser.ts';
import { evaluateOutputs, sweep } from '../../calc/outputs.ts';
import { makeT } from '../../i18n/core.ts';
import { DEMO_STARTERS } from '../starters.ts';
import { pickScenario, scenarios } from './scenarios.ts';
import { INSTANT_TIMING, runDemoTurn, tokenize } from './transport.ts';

const noSleep = (_ms: number, signal?: AbortSignal) => (signal?.aborted ? Promise.reject(Object.assign(new Error('a'), { name: 'AbortError' })) : Promise.resolve());

async function replay(text: string, approve: 'once' | 'deny' = 'once') {
  const events: HermesEvent[] = [];
  let msg: ChatMessage = createAssistantMessage(0);
  const r = await runDemoTurn({
    text,
    sessionId: 'demo-1',
    turn: 1,
    timing: INSTANT_TIMING,
    sleep: noSleep,
    now: () => new Date(2026, 9, 10, 12, 0),
    onEvent: (ev) => {
      events.push(ev);
      msg = applyEvent(msg, ev, 1);
    },
    waitForApproval: async () => approve,
  });
  if (msg.status === 'streaming') msg = finalize(msg, 'done', undefined, 2);
  return { r, events, msg };
}

test('pickScenario: onboarding demo starters (every UI language) and v2 keywords', () => {
  for (const [l, loc] of [['de', 'de-DE'], ['en', 'en-US'], ['es', 'es-ES']] as const) {
    const t = makeT(l, loc);
    const names = DEMO_STARTERS.map((s) => pickScenario(s.promptKey ? t(s.promptKey) : '').name);
    assert.deepEqual(names, ['chart', 'compare', 'loan', 'mixed'], `starters in ${l}`);
  }
  const cases: [string, string][] = [
    ['Wähle ein Reiseziel', 'choice'],
    ['Mach mir eine Einkaufsliste', 'checklist'],
    ['Zinsrechner bitte', 'calc'],
    ['Rezept für Pasta', 'recipe'],
    ['Karte von Wien', 'map'],
    ['Quiz zur Geografie', 'quiz'],
    ['Bilder von Rom', 'images'],
    ['Zeig eine Tabelle', 'table'],
    ['[form:kredit] {"betrag":1}', 'formResult'],
    ['[choice:reiseziel] Wähle ein Ziel → Rom', 'interaction'],
    ['Freigabe testen', 'approval'],
    ['Wo liegen die Dateien meiner VM?', 'paths'],
    ['Zeig mir Pfade', 'paths'],
    ['[paths:demo-dateien] Geteilter Ordner', 'interaction'],
    ['Zeig mir die Architektur', 'blocks'],
    ['blocks', 'blocks'],
    ['Show the architecture of my setup', 'blocks'],
    ['hallo', 'plain'],
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

test('every scenario replays through the real SSE parser and renders valid hui nodes', async () => {
  const v2 = new Set<string>();
  for (const name of Object.keys(scenarios)) {
    const prompt = name === 'formResult' ? '[form:kredit] {"betrag":20000}' : name === 'interaction' ? '[quiz:geo-quiz] 3/3 richtig' : `demo ${name}`;
    const { r, events, msg } = await replayScenario(name, prompt);
    assert.equal(r.aborted, false, name);
    assert.ok(events.some((e) => e.type === 'route'), `${name}: route event`);
    assert.ok(events.some((e) => e.type === 'done'), `${name}: [DONE]`);
    if (name === 'error') {
      assert.equal(msg.status, 'error');
      continue;
    }
    assert.equal(msg.status, 'done', name);
    for (const seg of parseMessage(msg.text)) {
      if (seg.kind === 'hui') {
        assert.ok(seg.complete && seg.node && !seg.error, `${name}: ${seg.error ?? seg.raw.slice(0, 80)}`);
        v2.add(seg.node.type);
      }
      if (seg.kind === 'html') assert.ok(seg.complete, `${name}: html complete`);
    }
  }
  for (const t of ['choice', 'checklist', 'calc', 'recipe', 'map', 'quiz', 'chart', 'table', 'image', 'gallery', 'decision', 'poll', 'translation', 'agenda', 'sources', 'weather', 'places', 'products', 'paths', 'blocks']) assert.ok(v2.has(t), `showcases ${t}`);
});

// replay a named scenario by temporarily routing its keyword
async function replayScenario(name: string, prompt: string) {
  const keyword: Record<string, string> = {
    plain: 'hallo', tool: 'uhrzeit', tools2: 'parallel', werkzeuge: 'werkzeuge', chart: 'diagramm', table: 'tabelle', stats: 'kennzahlen',
    compare: 'vergleich', form: 'formular', steps: 'anleitung', timeline: 'timeline', buttons: 'buttons', calculator: 'rechner',
    loan: 'kredit', mixed: 'bericht', choice: 'reiseziel', checklist: 'einkaufsliste', calc: 'zinsrechner', recipe: 'rezept', map: 'karte',
    quiz: 'quiz', images: 'bilder', error: 'fehler', approval: 'freigabe', long: 'lang',
    carbonara: 'Rezept für Carbonara', romTrip: 'Wochenende in Rom', reiseChoice: 'Flugzeug oder Bahn?', reiseDecision: '[choice:reise-prio] Was zählt? → Preis, Klima',
    poll: 'Familien-Abstimmung', translation: 'Übersetz das ins Spanische', charts3: 'Strompreise als Diagramm', agenda: 'Tagesplan Samstag', webSuche: 'Tipps gegen Jetlag', kreditCalc: 'Kreditrechner mit Schiebereglern',
    wideTable: 'Breite Tabelle bitte', gameTable: 'Tabelle: PS2 Spiele und was ruckelt', longWords: 'OLED oder LCD?', weather: 'Wetter morgen', places: 'Restaurants in der Nähe', products: 'Kopfhörer unter 350 Euro',
  };
  const text = keyword[name] ?? prompt;
  assert.equal(pickScenario(text).name, name, `keyword for ${name}`);
  return replay(text);
}

test('tools, reasoning and status arrive as Hermes events', async () => {
  const { msg } = await replay('werkzeuge');
  assert.ok(msg.tools.length >= 4);
  assert.ok(msg.tools.every((t) => t.status === 'done'));
  assert.ok((msg.reasoning ?? '').length > 10);
  assert.equal(msg.route?.format, 'text');
});

test('approval: once → runs the tool, deny → leaves things alone', async () => {
  const ok = await replay('freigabe', 'once');
  assert.ok(ok.events.some((e) => e.type === 'approval' && e.approval.command.startsWith('rm -rf')));
  assert.match(ok.msg.text, /Erledigt \(Freigabe: `once`\)/);
  const no = await replay('freigabe', 'deny');
  assert.match(no.msg.text, /abgelehnt/);
});

test('abort stops the replay', async () => {
  const ctrl = new AbortController();
  let n = 0;
  const r = await runDemoTurn({
    text: 'lang',
    sessionId: 's',
    turn: 1,
    signal: ctrl.signal,
    timing: INSTANT_TIMING,
    sleep: noSleep,
    onEvent: (ev) => {
      if (ev.type === 'text' && ++n === 5) ctrl.abort();
    },
    waitForApproval: async () => 'once',
  });
  assert.equal(r.aborted, true);
  assert.equal(n, 5);
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

test('demo answers follow the UI language (starters, fallback, approval chrome) and the official build does not advertise other providers', async () => {
  const textOf = (m: ChatMessage) => JSON.stringify(m);
  for (const [lang, marker, german] of [['en', /demo mode/, /Demo-Modus/], ['es', /modo demo/, /Demo-Modus/]] as const) {
    const plain = scenarios.plain.steps({ userText: 'hola', turn: 1, sessionId: 's', now: new Date(), lang });
    const text = plain.map((s) => ('text' in s ? s.text : '')).join('');
    assert.match(text, marker, lang);
    assert.doesNotMatch(text, german, lang);
    assert.doesNotMatch(text, /another provider|otro proveedor|anderen Anbieter/i, `${lang}: official build (flavor hermes) must not mention other providers`);
  }
  const personal = scenarios.plain.steps({ userText: 'x', turn: 1, sessionId: 's', now: new Date(), lang: 'en', flavor: 'personal' });
  assert.match(personal.map((s) => ('text' in s ? s.text : '')).join(''), /another provider/);

  // starters: scripted chart answer in the chat language
  const events: HermesEvent[] = [];
  let msg: ChatMessage = createAssistantMessage(0);
  await runDemoTurn({ text: 'Show me a chart of the temperature trend.', lang: 'en', sessionId: 's', turn: 1, timing: INSTANT_TIMING, sleep: noSleep, onEvent: (ev) => { events.push(ev); msg = applyEvent(msg, ev, 1); }, waitForApproval: async () => 'once' });
  assert.match(textOf(msg), /Here is the course of temperatures/);
  assert.doesNotMatch(textOf(msg), /Hier der Verlauf/);
  // approval follow-up
  const a = await replayLang('Freigabe testen', 'es', 'deny');
  assert.match(a, /denegado/);
});

async function replayLang(text: string, lang: 'de' | 'en' | 'es', approve: 'once' | 'deny'): Promise<string> {
  let msg: ChatMessage = createAssistantMessage(0);
  await runDemoTurn({ text, lang, sessionId: 's', turn: 1, timing: INSTANT_TIMING, sleep: noSleep, onEvent: (ev) => { msg = applyEvent(msg, ev, 1); }, waitForApproval: async () => approve });
  return JSON.stringify(msg);
}
