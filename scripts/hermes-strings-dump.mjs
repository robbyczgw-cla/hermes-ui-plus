#!/usr/bin/env node
// Copy a directory tree for gitleaks, replacing every Hermes bytecode file by its decoded string table, one string per
// line (escaped: \ \n \r). gitleaks scanning raw bytecode sees the packed string storage, where unrelated neighbours
// run together into fake "tokens"; one string per line keeps their real boundaries (docs/LEAK-GUARD.md).
//   hermes-strings-dump.mjs <src-dir> <out-dir>
// Media containers (mp4/png/jpeg/webp/webm/mp3) are copied with their compressed payload zeroed (scripts/lib/media-metadata.mjs).
// Exit 0 ok, 2 on error (a file with the Hermes magic whose layout does not validate is an error, never skipped).
import { copyFileSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hermesStrings, isHermesBytecode } from './leak-guard.mjs';
import { maskMediaPayload } from './lib/media-metadata.mjs';

export const escapeLine = (s) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r');

export function dumpTree(src, out) {
  let dumped = 0;
  const walk = (s, o) => {
    mkdirSync(o, { recursive: true });
    for (const name of readdirSync(s)) {
      const sp = join(s, name);
      const op = join(o, name);
      const st = lstatSync(sp);
      if (st.isDirectory()) walk(sp, op);
      else if (st.isSymbolicLink()) symlinkSync(readlinkSync(sp), op);
      else if (st.isFile()) {
        const buf = readFileSync(sp);
        if (isHermesBytecode(buf)) {
          const { strings } = hermesStrings(buf);
          writeFileSync(`${op}.hermes-strings.txt`, strings.map((x) => escapeLine(x.text)).join('\n') + '\n');
          dumped++;
        } else {
          // media containers: gitleaks gets the metadata/text parts, not the compressed stream (same policy as leak-guard)
          const media = maskMediaPayload(sp, buf);
          if (media) writeFileSync(op, Buffer.concat([media.buf, ...media.extra]));
          else copyFileSync(sp, op);
        }
      }
    }
  };
  walk(src, out);
  return dumped;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const [src, out] = process.argv.slice(2);
  if (!src || !out) { console.error('usage: hermes-strings-dump.mjs <src-dir> <out-dir>'); process.exit(2); }
  try {
    const n = dumpTree(src, out);
    console.error(`hermes-strings-dump: ${n} Hermes bytecode file(s) replaced by their decoded strings`);
  } catch (e) {
    console.error(`hermes-strings-dump: ${e.message}`);
    process.exit(2);
  }
}
