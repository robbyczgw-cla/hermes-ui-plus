import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyHeuristic } from '../src/router/backends/heuristic.mjs';
import { ROUTE_FORMATS, RENDERER, DEFINITIONS, COMPONENTS, normalizeDecision, normalizeComponent } from '../src/router/taxonomy.mjs';
import { ROUTER_SYSTEM_PROMPT, PROMPT_VERSION } from '../src/router/prompt.mjs';
import { buildHint } from '../src/router/hint.mjs';

const u = (content) => ({ role: 'user', content });
const a = (content) => ({ role: 'assistant', content });
const f = (t) => classifyHeuristic([u(t)]);
const NEW = ['places', 'products', 'guide', 'workout', 'studyplan', 'vocab', 'mindmap'];

test('v4 taxonomy: new formats are native hui, defined, in prompt and schema', () => {
  for (const x of [...NEW, 'timer']) {
    assert.ok(ROUTE_FORMATS.includes(x), x);
    assert.equal(RENDERER[x], 'hui', x);
    assert.ok(DEFINITIONS[x], x);
    assert.equal(COMPONENTS[x], null, x);
    assert.ok(ROUTER_SYSTEM_PROMPT.includes(`- ${x}: `), x);
    assert.equal(normalizeDecision({ format: x, confidence: 0.9, reason: 'r' }, { model: 'm', ms: 1 }).format, x);
  }
  assert.equal(PROMPT_VERSION, 'r6');
  assert.ok(ROUTER_SYSTEM_PROMPT.length < 24000, 'prompt stays compact');
  assert.equal(buildHint({ format: 'places', confidence: 0.86 }), 'UI-ROUTER-HINT: format=places confidence=0.9 data=live');
  // diagram:mindmap from an older model/prompt is the native mindmap now
  const d = normalizeDecision({ format: 'diagram', component: 'mindmap', confidence: 0.9, reason: 'x' }, { model: 'm', ms: 1 });
  assert.equal(d.format, 'mindmap');
  assert.equal(d.component, undefined);
  assert.equal(normalizeComponent('diagram', 'mindmap'), undefined);
  assert.equal(normalizeComponent('diagram', 'flowchart'), 'flowchart');
});

test('v4 heuristic: places (de/en/es)', () => {
  for (const t of ['Gibt es ein gutes Café in der Nähe vom Bahnhof Ulm?', 'Welche Restaurants in München haben jetzt noch offen?', 'Öffnungszeiten von der Apotheke am Hauptplatz', 'Find me a good coffee shop near Alexanderplatz', 'Busca una cafetería cerca de mí con wifi', 'Empfiehl mir eine Bäckerei in Salzburg']) assert.equal(f(t).format, 'places', t);
  assert.ok(f('Gibt es ein gutes Café in der Nähe?').confidence >= 0.85, 'fast path (>= 0.85) for clear cues');
  for (const t of ['Wie viele Restaurants gibt es in Berlin ungefähr?', 'Schreib eine nette Bewertung für das Café, in dem ich gestern war.', 'Wann hat der Hornbach in Ulm heute offen?']) assert.equal(f(t).format, 'text', t);
  assert.equal(f('Zeig die Cafés in Ulm auf einer Karte').format, 'map');
});

test('v4 heuristic: products', () => {
  for (const t of ['Welche Kopfhörer unter 200 € soll ich kaufen?', 'Bestes Handy bis 500 Euro?', 'Best laptop under 800 dollars', 'Quiero comprar una aspiradora robot, ¿cuál me recomiendas?', 'Preisvergleich Saugroboter bis 300 €']) assert.equal(f(t).format, 'products', t);
  assert.equal(f('Vergleiche iPhone 17 und Pixel 11').format, 'compare');
  for (const t of ['Wie funktioniert Noise-Cancelling bei Kopfhörern?', 'Ich will ein Haus kaufen. Wie finanziere ich das?', 'Welche Akkus haben die aktuellen E-Bikes von Bosch und Shimano']) assert.notEqual(f(t).format, 'products', t);
});

test('v4 heuristic: guide vs steps', () => {
  for (const t of ['Wie wechsle ich einen Reifen?', 'Anleitung zum Aufbau eines IKEA-Schranks', 'Erkläre mir Schritt für Schritt, wie ich den Wasserhahn abdichte', 'Dame una guía paso a paso para cambiar una rueda']) assert.equal(f(t).format, 'guide', t);
  assert.equal(f('Wie installiere ich Docker auf Ubuntu 24.04?').format, 'steps');
  assert.equal(f('Erkläre mir, wie ein Dieselmotor funktioniert.').format, 'text');
});

test('v4 heuristic: workout / studyplan / vocab / mindmap', () => {
  for (const t of ['Mach mir einen Trainingsplan für Brust und Schultern', 'Gib mir ein 20-Minuten-HIIT-Workout für zuhause', 'Necesito una rutina de ejercicios para glúteos']) assert.equal(f(t).format, 'workout', t);
  for (const t of ['Wie viel Eiweiß brauche ich nach dem Krafttraining?', 'Warum tun mir nach dem Training die Beine weh?']) assert.equal(f(t).format, 'text', t);
  for (const t of ['Mach mir einen Lernplan für die Matheklausur in 3 Wochen', 'Ich will in 4 Wochen Spanisch lernen', 'I need a study plan for my exam', 'Necesito un plan de estudio para aprender inglés en 3 meses']) assert.equal(f(t).format, 'studyplan', t);
  assert.equal(f('Wie lange braucht man, um Spanisch zu lernen?').format, 'text');
  for (const t of ['Gib mir 15 Vokabeln fürs Restaurant auf Spanisch', 'Teach me French vocabulary for travelling', 'Quiero practicar vocabulario de inglés']) assert.equal(f(t).format, 'vocab', t);
  assert.equal(f('Übersetze "Guten Morgen" ins Japanische').format, 'translation');
  for (const t of ['Mach mir eine Mindmap zur Photosynthese', 'Zeig mir die Zusammenhänge der Französischen Revolution als Übersicht', 'Create a mind map of machine learning', 'Haz un mapa mental del sistema solar']) assert.equal(f(t).format, 'mindmap', t);
  assert.equal(f('Zeichne ein Flussdiagramm für den Bewerbungsprozess').format, 'diagram');
  assert.equal(f('Zeig die Organisationsstruktur als Organigramm').component, 'org');
  // "ask me questions first" stays a form
  assert.equal(f('Hilf mir, einen Trainingsplan zu erstellen – stell mir vorher ein paar Fragen.').format, 'form');
});

test('v4 heuristic: timer cues incl. relative reminders', () => {
  for (const t of ['Timer auf 12 Minuten bitte', 'Erinnere mich in 20 Minuten, den Ofen auszuschalten', 'Remind me in 10 minutes to check the oven', 'Pon un temporizador de 15 minutos', 'Starte eine Stoppuhr', 'Countdown bis zum Anpfiff um 20:45']) assert.equal(f(t).format, 'timer', t);
  for (const t of ['Erinnere mich morgen um 9 Uhr an den Zahnarzt', 'Remind me on Friday to pay the rent', 'Weck mich morgen um 6:30 Uhr', 'Erinnere mich heute Abend um 20 Uhr an Mama']) assert.equal(f(t).format, 'text', t);
});

test('v4 heuristic: widget replies are no-hint text, follow-ups keep the module', () => {
  for (const t of ['[guide:reifen] Fertig', '[guide:reifen] Schritt 2 („Mantel lösen“): Ich hänge fest – klemmt', '[workout:push] 17/19 Sätze · 44 min · Bankdrücken 4×10 @ 22 kg', '[studyplan:es] Woche 1: 5/5 erledigt', '[vocab:es] 8/10 richtig · schwierig: la propina', '[products:anc] Favorit: Sony WH-1000XM5', '[mindmap] Erkläre „Calvin-Zyklus“ genauer']) {
    const d = f(t);
    assert.equal(d.format, 'text', t);
    assert.equal(buildHint(d), null, t);
  }
  const places = '```hui\n{"type":"places","id":"p","places":[{"name":"Café Zeitlos"}]}\n```';
  const d = classifyHeuristic([u('Café in Ulm?'), a(places), u('und in Neu-Ulm?')]);
  assert.equal(d.format, 'places');
});

test('product ranking / best on the market routes to products (user test 2026-10-11)', async () => {
  const { classifyHeuristic } = await import('../src/router/backends/heuristic.mjs');
  for (const q of [
    'Was ist der Komfortabelste retro handheld am Markt tiefe suche eher kleinere Männerhände, Ranking 2d und 3d top 10 bitte pros cons ratings',
    'Top 10 Kopfhörer unter 200 Euro mit Vor- und Nachteilen',
    'Welche Spielkonsole ist die beste am Markt für Kinder?',
  ]) assert.equal(classifyHeuristic([{ role: 'user', content: q }]).format, 'products', q);
  assert.notEqual(classifyHeuristic([{ role: 'user', content: 'Top 10 Filme 2025' }]).format, 'products');
});

test('events / what is on routes to places (user test 2026-10-12)', async () => {
  const { classifyHeuristic } = await import('../src/router/backends/heuristic.mjs');
  for (const q of [
    'Events Graz morgen?',
    'Welche Konzerte gibt es am Wochenende in Wien?',
    'Was ist heute Abend los in Graz?',
    'Veranstaltungen in Linz diese Woche',
    'events in Berlin this weekend',
  ]) {
    const d = classifyHeuristic([{ role: 'user', content: q }]);
    assert.equal(d.format, 'places', q);
    assert.ok(d.confidence >= 0.85, `${q}: ${d.confidence}`);
  }
  for (const q of ['Erklär mir event sourcing', 'Schreib mir einen Text über das Konzert gestern', 'Wie funktionieren DOM events in JavaScript?'])
    assert.notEqual(classifyHeuristic([{ role: 'user', content: q }]).format, 'places', q);
});
