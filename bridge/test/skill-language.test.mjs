// The hermes-ui skill must not pull cards into German (fresh-user test 0.1.1, item #2: English chats got "Technik",
// "Zug/Flugzeug", "Carbonara für 4" because the skill's examples were German). Guards: the language rule and the
// default-card rule stay in SKILL.md, every example node in the references keeps English visible text, and the
// eval scorer (bridge/eval/skill-language) flags mixed-language cards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { extractBlocks, judgeString, scoreAnswer, visibleStrings } from '../eval/skill-language/score.mjs';
import { CASES } from '../eval/skill-language/cases.mjs';

const SKILL_DIR = new URL('../../hermes-skill/hermes-ui/', import.meta.url);
const skill = readFileSync(new URL('SKILL.md', SKILL_DIR), 'utf8');

test('SKILL.md: explicit language rule for all visible card text, no German default', () => {
  assert.match(skill, /\*\*Language:\*\* ALL visible text/);
  for (const w of ['titles', 'labels', 'items', 'notes', 'buttons']) assert.ok(skill.includes(w), `language rule names ${w}`);
  assert.match(skill, /language of the user's latest own message/);
  assert.match(skill, /tagged `\[type:id\]` replies don't switch it/);
  assert.doesNotMatch(skill, /\(German\)|German aisles|Default language/);
  // the rule sits before the principles, not buried at the end
  assert.ok(skill.indexOf('**Language:**') < skill.indexOf('## Principles'));
});

test('SKILL.md: missing details get a default card, not a question in prose', () => {
  assert.match(skill, /Details missing[^\n]*sensible defaults[^\n]*offer to adjust; no questions in prose/);
});

// skill 0.8.0: rules the 11000-char budget had blocked (chat-reading quotes, 0.2.1 QA R4-06, personal QA one-shot P2)
test('SKILL.md: reply quotes, weekdays from the calendar, one-shot reminders without schedule claims', () => {
  assert.match(skill, /`\[hui:quote … from=assistant\|user\]`[^\n]*answer about exactly that part, never repeat the tags/);
  assert.match(skill, /Weekday next to a date only if the calendar agrees[^\n]*Unsure: date alone\./);
  const rule = skill.split('\n').find((l) => l.startsWith('- Reminders'));
  assert.match(rule, /One-shot `prompt` \(its run has no chat context\): `Reply with only this line: ⏰ <the reminder in the user's language>`/);
  assert.match(rule, /`\[Cronjob "…" output …\]` turn: relay the reminder only, no claims about its schedule \(never "still scheduled"\/"may fire again"\)/);
  assert.ok(skill.length <= 10500, `SKILL.md ${skill.length} chars: keep headroom under the 11000 budget`);
});

test('reference examples: every example node shows English text only', () => {
  const bad = [];
  let nodes = 0;
  for (const f of readdirSync(new URL('references/', SKILL_DIR)).filter((n) => n.endsWith('.md') && n !== 'NOTICE.md')) {
    const text = readFileSync(new URL(`references/${f}`, SKILL_DIR), 'utf8');
    for (const raw of text.split('\n')) {
      const line = raw.trim().replace(/^`|`$/g, '');
      if (!line.startsWith('{"type":"')) continue;
      let node;
      try { node = JSON.parse(line); } catch { continue; } // shape is checked by hermes-skill/examples/validate.mjs
      nodes++;
      for (const s of visibleStrings(node)) {
        const j = judgeString(s.text, 'en');
        if (j.verdict === 'foreign') bad.push(`${f} ${s.path}: "${s.text}" (${j.foreignWords.join(', ')})`);
      }
    }
  }
  assert.ok(nodes > 40, `found ${nodes} example nodes`);
  assert.deepEqual(bad, []);
});

test('scorer: the fresh-user failures are flagged, clean cards pass', () => {
  const en = scoreAnswer('Here you go.\n\n```hui\n{"type":"checklist","id":"p","title":"City trip","items":[{"text":"Charger","category":"Technik"},{"text":"Carbonara für 4"},{"text":"Salt","qty":1,"unit":"Packung"},{"text":"Passport","category":"Documents"}]}\n```', 'en');
  assert.equal(en.langOk, false);
  assert.deepEqual(en.foreign.map((f) => f.text), ['Technik', 'Carbonara für 4', 'Packung']);
  assert.equal(en.proseLang, 'en');
  assert.equal(en.shape, 'content-card');

  const es = scoreAnswer('Aquí tienes la lista.\n\n```hui\n{"type":"checklist","id":"c","title":"Paella para 6","items":[{"text":"Arroz bomba","qty":600,"unit":"g","category":"Despensa"},{"text":"Gambas","category":"Pescadería"}]}\n```', 'es');
  assert.equal(es.langOk, true);

  // loanwords and dish names are neutral; ids, image queries and enums are not visible text
  assert.equal(judgeString('Butter', 'de').verdict, 'neutral');
  assert.equal(judgeString('Crème fraîche', 'en').verdict, 'neutral');
  assert.deepEqual(visibleStrings({ type: 'recipe', id: 'kaesespaetzle', imageQuery: 'Käsespätzle', title: 'Cheese noodles' }).map((s) => s.text), ['Cheese noodles']);
});

test('scorer: answer shapes for the default-card rule', () => {
  assert.equal(scoreAnswer('What are you cooking tonight? Tell me the dish.', 'en').shape, 'prose-question');
  assert.equal(scoreAnswer('Pick one:\n```hui\n{"type":"choice","id":"d","options":[{"label":"Pasta"},{"label":"Curry"}]}\n```', 'en').shape, 'input-card');
  assert.equal(scoreAnswer('```hui\n{"type":"checklist","id":"s","items":[{"text":"Eggs"}]}\n```\n```hui\n{"type":"suggestions","items":["Make it vegetarian"]}\n```', 'en').shape, 'content-card');
  assert.equal(extractBlocks('```hui\n{broken\n```').bad.length, 1);
});

test('eval cases: about 30 prompts over en/es/fr/de, unique ids, several underspecified ones', () => {
  assert.ok(CASES.length >= 28 && CASES.length <= 40);
  assert.equal(new Set(CASES.map((c) => c.id)).size, CASES.length);
  for (const l of ['en', 'es', 'fr', 'de']) assert.ok(CASES.filter((c) => c.lang === l).length >= 6, l);
  assert.ok(CASES.filter((c) => c.under).length >= 6);
});
