/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeT } from '../i18n/core.ts';
import { inlineToSpeech, summarizeHuiNode, toSpeechText } from './speechText.ts';

const de = makeT('de', 'de-DE');

test('inline markdown is removed', () => {
  assert.equal(inlineToSpeech('Das ist **wichtig** und *kursiv* und ~~alt~~.'), 'Das ist wichtig und kursiv und alt.');
  assert.equal(inlineToSpeech('Siehe [die Doku](https://docs.expo.dev/a_(b)) für `npm i`.'), 'Siehe die Doku für npm i.');
  assert.equal(inlineToSpeech('Quelle: https://www.tagesschau.de/inland/123.html.'), 'Quelle: tagesschau.de.');
  assert.equal(inlineToSpeech('Mail <mailto:a@b.de> oder <https://x.org/y>'), 'Mail a@b.de oder x.org');
  assert.equal(inlineToSpeech('Super 🎉 gemacht 👍🏽!'), 'Super gemacht !');
  assert.equal(inlineToSpeech('snake_case_name bleibt'), 'snake_case_name bleibt');
  assert.equal(inlineToSpeech('A -> B'), 'A – B');
  assert.equal(inlineToSpeech('<b>fett</b>&nbsp;und Fußnote[^1]'), 'fett und Fußnote');
  assert.equal(inlineToSpeech('![Logo](a.png) Text'), 'Logo Text');
});

test('headings, lists and quotes become sentences', () => {
  const md = '# Überblick\n\nKurz gesagt:\n\n- erster Punkt\n- zweiter Punkt!\n1. Nummer eins\n- [x] erledigt\n\n> Zitat hier\n\n---\n\nEnde';
  assert.equal(
    toSpeechText(md, de),
    'Überblick.\n\nKurz gesagt:\n\nerster Punkt.\n\nzweiter Punkt!\n\nNummer eins.\n\nerledigt.\n\nZitat hier\n\nEnde'
  );
});

test('paragraph lines are joined, blank lines split paragraphs', () => {
  assert.equal(toSpeechText('Zeile eins\nZeile zwei\n\nNeuer Absatz', de), 'Zeile eins Zeile zwei\n\nNeuer Absatz');
});

test('hui blocks are summarised, hui-html and code get a hint', () => {
  const table = JSON.stringify({ type: 'table', columns: ['A', 'B'], rows: [[1, 2], [3, 4], [5, 6], [7, 8], [9, 10], [1, 1], [2, 2], [3, 3]] });
  const md = `Hier die Zahlen:\n\n\`\`\`hui\n${table}\n\`\`\`\n\nUnd ein Rechner:\n\n\`\`\`hui-html\n<div>x</div><script>1</script>\n\`\`\`\n\n\`\`\`ts\nconst a = 1;\n\`\`\`\nFertig.`;
  assert.equal(
    toSpeechText(md, de),
    'Hier die Zahlen:\n\nHier ist eine Tabelle mit 8 Zeilen.\n\nUnd ein Rechner:\n\nHier ist eine interaktive Ansicht.\n\nHier ist ein Codeblock.\n\nFertig.'
  );
  assert.equal(toSpeechText(md, de, { summarizeBlocks: false }), 'Hier die Zahlen:\n\nUnd ein Rechner:\n\nFertig.');
});

test('unclosed / invalid hui (streaming) is skipped, no JSON is read aloud', () => {
  assert.equal(toSpeechText('Moment:\n\n```hui\n{"type":"chart","series":[{"na', de), 'Moment:');
  assert.equal(toSpeechText('```hui\nnot json\n```\nok', de), 'ok');
});

test('markdown pipe tables are summarised', () => {
  const md = 'Vergleich:\n\n| Modell | Preis |\n|---|---:|\n| A | 1 |\n| B | 2 |\n\nDanach.';
  assert.equal(toSpeechText(md, de), 'Vergleich:\n\nHier ist eine Tabelle mit 2 Zeilen.\n\nDanach.');
});

test('hui node summaries (German, singular/plural)', () => {
  assert.equal(summarizeHuiNode({ type: 'table', columns: ['a'], rows: [[1]] }, de), 'Hier ist eine Tabelle mit 1 Zeile.');
  assert.equal(summarizeHuiNode({ type: 'chart', kind: 'bar', title: 'Umsatz **2025**', series: [] }, de), 'Hier ist ein Diagramm: Umsatz 2025.');
  assert.equal(
    summarizeHuiNode({ type: 'stats', items: [{ label: 'Umsatz', value: '1,2 Mio €' }, { label: 'Kunden', value: 830 }] }, de),
    'Umsatz: 1,2 Mio €, Kunden: 830.'
  );
  assert.equal(summarizeHuiNode({ type: 'list', items: [{ title: 'a' }, { title: 'b' }] }, de), 'Hier ist eine Liste mit 2 Einträgen.');
  assert.equal(summarizeHuiNode({ type: 'steps', items: [{ title: 'a' }] }, de), 'Hier ist 1 Schritt.');
  assert.equal(summarizeHuiNode({ type: 'callout', tone: 'warning', title: 'Achtung', text: 'Frist endet *morgen*' }, de), 'Achtung. Frist endet morgen.');
  assert.equal(
    summarizeHuiNode({ type: 'card', title: 'Wetter', children: [{ type: 'text', text: 'Sonnig, 21 Grad' }, { type: 'suggestions', items: ['x'] }] }, de),
    'Wetter. Sonnig, 21 Grad.'
  );
  assert.equal(summarizeHuiNode({ type: 'progress', label: 'Upload', value: 40 }, de), 'Upload: 40 Prozent.');
  assert.equal(summarizeHuiNode({ type: 'buttons', items: [] }, de), '');
  assert.equal(summarizeHuiNode({ type: 'mystery' }, de), '');
  assert.equal(summarizeHuiNode(null, de), '');
});

test('empty / only-ui message yields empty or summary text', () => {
  assert.equal(toSpeechText('', de), '');
  assert.equal(toSpeechText('```hui\n{"type":"suggestions","items":["a"]}\n```', de), '');
});

test('spoken summaries follow the active language', () => {
  const en = makeT('en', 'en-US');
  assert.equal(summarizeHuiNode({ type: 'table', columns: ['a'], rows: [[1], [2]] }, en), 'Here is a table with 2 rows.');
  assert.equal(summarizeHuiNode({ type: 'steps', items: [{ title: 'a' }] }, en), 'Here is 1 step.');
  assert.equal(summarizeHuiNode({ type: 'progress', label: 'Upload', value: 40 }, en), 'Upload: 40 percent.');
  assert.equal(toSpeechText('```hui-html\n<p>x</p>\n```', en), 'Here is an interactive view.');
});
