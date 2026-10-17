// Regenerates eval/cases.jsonl, eval/holdout.jsonl and eval/multilingual.jsonl from their .src.mjs files and validates labels.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import cases from './cases.src.mjs';
import holdout from './holdout.src.mjs';
import multilingual from './multilingual.src.mjs';
import { ROUTE_FORMATS } from '../src/router/taxonomy.mjs';

function write(list, name) {
  const ids = new Set();
  for (const k of list) {
    if (ids.has(k.id)) throw new Error(`duplicate id ${k.id}`);
    ids.add(k.id);
    for (const f of [k.expected, ...(k.accept ?? [])]) if (!ROUTE_FORMATS.includes(f)) throw new Error(`${k.id}: bad format ${f}`);
    if (k.messages.at(-1).role !== 'user') throw new Error(`${k.id}: last message must be user`);
  }
  const out = fileURLToPath(new URL(`./${name}`, import.meta.url));
  writeFileSync(out, list.map((k) => JSON.stringify(k)).join('\n') + '\n');
  console.log(`wrote ${list.length} cases to ${out}`);
}
write(cases, 'cases.jsonl');
write(holdout, 'holdout.jsonl');
write(multilingual, 'multilingual.jsonl');
