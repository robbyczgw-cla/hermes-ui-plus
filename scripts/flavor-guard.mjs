#!/usr/bin/env node
// flavor-guard: a FLAVOR=hermes (official) build must not contain anything from the private overlay
// ($HUI_PRIVATE_DIR, default ~/work/hermesiui-private; docs/BUILD.md "Flavors"). Called by the build scripts
// (scripts/lib/flavor.sh) before and after the build; exits non-zero = the build fails.
//
//   flavor-guard.mjs --env                 environment: EXPO_PUBLIC_FLAVOR=hermes, no personal EXPO_PUBLIC_* values
//   flavor-guard.mjs --tree DIR            build input (clean copy of app/): no .env* files, no file whose content
//                                          equals a private-overlay file, no link into the overlay, and the resolved
//                                          Expo config has the official identity and no overlay path
//   flavor-guard.mjs --output DIR          build output (dist/web, unpacked APK/.app …): no overlay file content,
//                                          no overlay path, no denylisted term ($HUI_PRIVATE_DIR/leak-denylist.txt via
//                                          scripts/leak-guard.mjs) and none of leak-guard's generic findings (tailnet
//                                          hosts, CGNAT/private IPs, e-mail addresses; with or without a denylist;
//                                          unscannable files fail). This is an identity check: publishing still
//                                          needs the release gate scripts/scan-artifact.sh (+ gitleaks). Code-signature data
//                                          (_CodeSignature/, *.mobileprovision, the LC_CODE_SIGNATURE blob of Mach-O
//                                          binaries) is allowed: it carries the developer's name/team by design
//                                          (docs/LEAK-GUARD.md "Code signatures"); everything else is scanned.
//   --no-expo-config                       skip the `expo config` check of --tree (faster; for tests)
//
// Without a private dir the overlay comparisons have nothing to compare against and are skipped (a public contributor
// has no private overlay, so nothing private can leak); the env / config / .env checks always run.
// Exit codes: 0 clean, 1 private content found, 2 usage / environment error.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isSignaturePath } from './leak-guard.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_HASH_BYTES = 64 * 1024 * 1024;
/** EXPO_PUBLIC_* that may be set for an official build (they carry no personal data) */
const PUBLIC_OK = new Set([
  'EXPO_PUBLIC_FLAVOR',
  'EXPO_PUBLIC_APP_NAME',
  'EXPO_PUBLIC_APP_SHORT_NAME',
  'EXPO_PUBLIC_THEME_COLOR',
  'EXPO_PUBLIC_THEME_COLOR_DARK',
  'EXPO_PUBLIC_HUI_CRASH_TEST',
  'EXPO_PUBLIC_HUI_PERF', // perf-probe builds (app/src/perf/probe.ts, docs/PERF.md)
  'EXPO_PUBLIC_BG_SERVICE', // store-build switch (app/plugins/withBgService.js, docs/STORE.md)
]);
/** value rules for allowed EXPO_PUBLIC_* switches (anything else would be a channel for arbitrary values) */
const PUBLIC_VALUES = { EXPO_PUBLIC_BG_SERVICE: /^[01]$/, EXPO_PUBLIC_HUI_PERF: /^[012]$/ };
const BRAND = JSON.parse(readFileSync(join(ROOT, 'app', 'brand', 'identity.json'), 'utf8'));
/** official identity (app/brand/identity.json, the single source) */
export const OFFICIAL = { ios: BRAND.iosBundleId, android: BRAND.androidPackage, scheme: BRAND.scheme };

export function privateDir(env = process.env) {
  const d = (env.HUI_PRIVATE_DIR || '').trim() || join(homedir(), 'work', 'hermesiui-private');
  return d.startsWith('~/') ? join(homedir(), d.slice(2)) : resolve(d);
}

/** every non-directory entry below dir. skipVendor: skip node_modules/.git (build input + overlay only; an export
 *  ships its own assets/node_modules/… tree, so output scans must walk everything). */
function walk(dir, out = [], skipVendor = true) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = lstatSync(p);
    if (st.isDirectory()) {
      if (skipVendor && (name === 'node_modules' || name === '.git')) continue;
      walk(p, out, skipVendor);
    } else out.push(p);
  }
  return out;
}

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

/** sha256 → overlay path, for overlay files that are NOT also shipped publicly in the repo (e.g. copied generic icons). */
export function privateHashes(pdir, root = ROOT) {
  const map = new Map();
  if (!existsSync(pdir)) return map;
  for (const p of walk(pdir)) {
    const st = lstatSync(p);
    if (!st.isFile() || st.size === 0 || st.size > MAX_HASH_BYTES) continue;
    map.set(sha(p), relative(pdir, p));
  }
  if (map.size) {
    let tracked = [];
    try {
      tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, maxBuffer: 1 << 28 }).toString().split('\0').filter(Boolean);
    } catch {
      /* not a git checkout: compare against everything */
    }
    for (const f of tracked) {
      const p = join(root, f);
      try {
        const st = lstatSync(p);
        if (st.isFile() && st.size > 0 && st.size <= MAX_HASH_BYTES) map.delete(sha(p));
      } catch {
        /* deleted in the working tree */
      }
    }
  }
  return map;
}

export function checkEnv(env = process.env, pdir = privateDir(env)) {
  const errs = [];
  if ((env.EXPO_PUBLIC_FLAVOR ?? 'hermes') !== 'hermes') errs.push(`EXPO_PUBLIC_FLAVOR=${env.EXPO_PUBLIC_FLAVOR} (expected hermes)`);
  for (const [k, v] of Object.entries(env)) {
    if (!k.startsWith('EXPO_PUBLIC_') || !v) continue;
    if (!PUBLIC_OK.has(k)) errs.push(`${k} is set (personal/dev value; not allowed in a hermes build)`);
    else if (v.includes(pdir)) errs.push(`${k} points into the private dir`);
    else if (PUBLIC_VALUES[k] && !PUBLIC_VALUES[k].test(v.trim())) errs.push(`${k} must match ${PUBLIC_VALUES[k]}`);
  }
  return errs;
}

function scanFiles(dir, pdir, hashes, { output }) {
  const errs = [];
  let realP = null;
  try {
    realP = realpathSync(pdir);
  } catch {
    /* no private dir */
  }
  const pathNeedles = [pdir, realP].filter(Boolean);
  for (const p of walk(dir, [], !output)) {
    const rel = relative(dir, p);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) {
      const target = resolve(dirname(p), readlinkSync(p));
      if (pathNeedles.some((n) => target === n || target.startsWith(n + sep))) errs.push(`${rel}: symlink into the private dir`);
      continue;
    }
    if (!st.isFile()) continue;
    if (output && isSignaturePath(rel)) continue; // signature-only file of a signed app (allowed, see header)
    if (!output && /^\.env(\.|$)/.test(p.split(sep).pop())) errs.push(`${rel}: .env file in the build input`);
    if (st.size === 0 || st.size > MAX_HASH_BYTES) continue;
    const buf = readFileSync(p);
    const h = createHash('sha256').update(buf).digest('hex');
    if (hashes.has(h)) errs.push(`${rel}: same content as private ${hashes.get(h)}`);
    if (output && pathNeedles.length) {
      const s = buf.toString('latin1');
      if (pathNeedles.some((n) => s.includes(n))) errs.push(`${rel}: contains the private dir path`);
    }
  }
  return errs;
}

function checkExpoConfig(dir, pdir) {
  const env = { ...process.env, EXPO_PUBLIC_FLAVOR: 'hermes', EXPO_NO_TELEMETRY: '1', CI: '1' };
  let json;
  try {
    json = execFileSync('npx', ['expo', 'config', '--json', '--type', 'public'], { cwd: dir, env, maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  } catch (e) {
    return [`expo config failed: ${String(e.stderr || e.message).slice(0, 400)}`];
  }
  const errs = [];
  const c = JSON.parse(json);
  if (c.ios?.bundleIdentifier !== OFFICIAL.ios) errs.push(`ios.bundleIdentifier=${c.ios?.bundleIdentifier} (expected ${OFFICIAL.ios})`);
  if (c.android?.package !== OFFICIAL.android) errs.push(`android.package=${c.android?.package} (expected ${OFFICIAL.android})`);
  if (c.scheme !== OFFICIAL.scheme) errs.push(`scheme=${c.scheme} (expected ${OFFICIAL.scheme})`);
  if (json.includes(pdir)) errs.push('resolved Expo config references the private dir');
  return errs;
}

/**
 * Output content scan with scripts/leak-guard.mjs: the private term list when there is one, and ALWAYS the generic
 * patterns (tailnet hosts, CGNAT/private addresses, e-mail addresses) with the repo / private allow files. A file
 * that cannot be scanned (scan-error) is a failure, never a pass. Inline `leak-guard:allow` markers do not count in
 * build output. Code-signature data is skipped (see header).
 */
async function artifactScan(dir, pdir, env = process.env) {
  const file = join(pdir, 'leak-denylist.txt');
  const { parseDenylist, makeScanner, loadAllowList, fileEntries } = await import('./leak-guard.mjs');
  const hasList = existsSync(file);
  const denylist = hasList ? parseDenylist(readFileSync(file, 'utf8')) : [];
  const allow = loadAllowList(ROOT, { ...env, HUI_PRIVATE_DIR: pdir });
  // signature: skip _CodeSignature/ + *.mobileprovision and mask the Mach-O LC_CODE_SIGNATURE blobs
  const scanner = makeScanner({ denylist, allow, signature: true, inlineAllow: false });
  const errs = [];
  for (const p of walk(dir, [], false)) {
    if (!lstatSync(p).isFile()) continue;
    // .gz/.br/.zip: scan the decompressed content (compressed bytes can form a short term by chance), as leak-guard --path
    for (const e of fileEntries(p, relative(dir, p))) {
      for (const f of scanner.scanContent(e.path, e.read())) {
        if (f.error) {
          errs.push(`${f.path}: ${f.rule}: ${f.text}`);
          continue;
        }
        const at = f.line ? `:${f.line}` : f.offset != null ? `@${f.offset}` : '';
        errs.push(`${f.path}${at}: ${f.rule} ${f.text.length <= 3 ? '***' : f.text.slice(0, 2) + '***'}`);
      }
    }
  }
  return { errs, note: hasList ? '' : `no ${file}: private term scan skipped (generic patterns still checked)` };
}

export async function main(argv, env = process.env) {
  const pdir = privateDir(env);
  const mode = argv[0];
  const dir = argv[1] && !argv[1].startsWith('--') ? resolve(argv[1]) : null;
  const noExpo = argv.includes('--no-expo-config');
  if (!['--env', '--tree', '--output'].includes(mode) || (mode !== '--env' && (!dir || !existsSync(dir)))) {
    console.error('usage: flavor-guard.mjs --env | --tree DIR [--no-expo-config] | --output DIR');
    return 2;
  }
  let errs = [];
  const notes = [];
  if (mode === '--env') errs = checkEnv(env, pdir);
  else {
    const hashes = privateHashes(pdir);
    if (!existsSync(pdir)) notes.push(`no private dir (${pdir}): content comparison skipped`);
    errs = scanFiles(dir, pdir, hashes, { output: mode === '--output' });
    if (mode === '--tree' && !noExpo) errs.push(...checkExpoConfig(dir, pdir));
    if (mode === '--output') {
      const d = await artifactScan(dir, pdir, env);
      errs.push(...d.errs);
      if (d.note) notes.push(d.note);
    }
  }
  for (const n of notes) console.log(`flavor-guard: ${n}`);
  if (errs.length) {
    console.error(`flavor-guard ${mode}: FLAVOR=hermes build would include private content (${errs.length}):`);
    for (const e of errs.slice(0, 50)) console.error(`  ${e}`);
    if (errs.length > 50) console.error(`  … ${errs.length - 50} more`);
    return 1;
  }
  console.log(`flavor-guard ${mode}: clean${dir ? ` (${dir})` : ''}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(`flavor-guard: ${e.stack || e}`);
      process.exit(2);
    },
  );
}
