#!/usr/bin/env node
// Copies ../hermes-skill/hermes-ui and the bootstrap system message into ./skill so the npm package contains them
// (`npm pack` / `npm publish` run this as `prepack`). `hermes-ui-plus-bridge setup` installs the skill from there,
// and src/config.mjs reads the bootstrap message from there. ./skill is generated: do not edit, not tracked.
// Also copies the repository's ../LICENSE to ./LICENSE (MIT requires the notice in every copy; generated, not tracked).
import { cpSync, existsSync, mkdirSync, rmSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const bridge = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(bridge, '../hermes-skill');
const out = join(bridge, 'skill');
const license = resolve(bridge, '../LICENSE');
if (!existsSync(join(src, 'hermes-ui', 'SKILL.md'))) {
  if (existsSync(join(out, 'hermes-ui', 'SKILL.md')) && existsSync(join(bridge, 'LICENSE'))) process.exit(0); // already bundled (e.g. packing from a tarball)
  console.error(`bundle-skill: ${src}/hermes-ui not found`);
  process.exit(1);
}
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(src, 'hermes-ui'), join(out, 'hermes-ui'), { recursive: true });
copyFileSync(join(src, 'bootstrap-system-message.txt'), join(out, 'bootstrap-system-message.txt'));
if (!existsSync(license)) {
  console.error(`bundle-skill: ${license} not found (the package must ship the license)`);
  process.exit(1);
}
copyFileSync(license, join(bridge, 'LICENSE'));
console.log(`bundle-skill: copied hermes-ui skill + bootstrap message to ${out}, LICENSE to ${bridge}`);
