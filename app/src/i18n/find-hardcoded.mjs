#!/usr/bin/env node
// Lists likely hardcoded user-facing German strings in TSX. Usage: node find-hardcoded.mjs [dir=src] [--all]
// Heuristic only: JSX text nodes, and string literals in user-facing props / with umlauts / German stopwords.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const all = args.includes('--all'); // also include .ts files
const root = args.find((a) => !a.startsWith('--')) ?? join(dirname(fileURLToPath(import.meta.url)), '..');
const PROPS = 'title|placeholder|accessibilityLabel|accessibilityHint|label|subtitle|description|message|text|headerTitle|name';
const UMLAUT = /[äöüÄÖÜß]/;
const WORDS = /\b(und|oder|nicht|der|die|das|ein|eine|keine|bitte|fehler|senden|abbrechen|speichern|löschen|laden|wird|werden|ist|mit|für|von|zum|zur|noch|neu|alle|hier|wähle|wählen|verbinden|einstellungen|nachricht)\b/i;

function* walk(dir) {
  for (const f of readdirSync(dir)) {
    if (f === 'node_modules' || f === 'i18n' || f.startsWith('.')) continue;
    const p = join(dir, f);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.tsx$/.test(f) || (all && /\.ts$/.test(f) && !/\.test\.ts$/.test(f))) yield p;
  }
}
const looksGerman = (s) => UMLAUT.test(s) || WORDS.test(s);
let total = 0;
for (const file of walk(root)) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line) || /^\s*import /.test(line)) return;
    const hits = [];
    // JSX text node: >text<  or text alone on a line inside JSX
    for (const m of line.matchAll(/>([^<>{}=]*[A-Za-zÄÖÜäöüß]{2,}[^<>{}]*)</g)) {
      const t = m[1].trim();
      if (t && /[A-Za-zÄÖÜäöüß]{3,}/.test(t)) hits.push(['jsx-text', t]);
    }
    // props: title="..." or title={'...'}
    for (const m of line.matchAll(new RegExp(`\\b(${PROPS})=(?:"([^"]+)"|\\{\\s*'([^']+)'\\s*\\}|\\{\\s*\`([^\`$]+)\`\\s*\\})`, 'g'))) {
      const v = m[2] ?? m[3] ?? m[4];
      if (looksGerman(v) || /\s/.test(v)) hits.push([`prop:${m[1]}`, v]);
    }
    // any string literal with umlaut / German stopword and whitespace
    for (const m of line.matchAll(/(['"`])((?:(?!\1)[^\\\n])*[A-Za-zÄÖÜäöüß]{3,}(?:(?!\1)[^\\\n])*)\1/g)) {
      const v = m[2];
      if (/^[\w./:@#-]+$/.test(v)) continue; // identifiers, paths, urls
      if (looksGerman(v) && !hits.some((h) => h[1] === v)) hits.push(['literal', v]);
    }
    for (const [kind, text] of hits) {
      console.log(`${file}:${i + 1}\t${kind}\t${text.length > 90 ? text.slice(0, 87) + '...' : text}`);
      total++;
    }
  });
}
console.error(`\n${total} candidate string(s)`);
