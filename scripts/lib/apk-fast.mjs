#!/usr/bin/env node
// JS fast path for Android TEST APKs (scripts/build-apk-fast.sh, docs/BUILD.md "Fast test APKs"): the native part of
// an APK only changes with its native fingerprint, so a JS-only change can reuse a full build's APK ("base") and swap
// in the new Hermes bundle. This file decides whether that is safe and keeps the base cache.
//
//   apk-fast.mjs fingerprint APP_DIR                     print the native fingerprint (JSON: hash + parts)
//   apk-fast.mjs assets DIR                              print the asset manifest of an --assets-dest / res dir (JSON)
//   apk-fast.mjs lookup BASES KEY                        print the base dir for KEY, exit 1 when there is none
//   apk-fast.mjs register BASES KEY APK APP_DIR VARIANT BUILD_NUMBER KEYSTORE
//                                                        store a full build as the base for KEY (atomic), keep the
//                                                        newest HUI_FAST_KEEP (3) bases per flavor/ABI
//   apk-fast.mjs key FLAVOR ABIS FINGERPRINT             print the cache key
//
// Native fingerprint = sha256 over
//   - @expo/fingerprint for android (autolinked native modules incl. app/modules, config plugins, app config,
//     patches, icons/fonts referenced by the config). Unavailable = no fingerprint = always a full build.
//   - files the native build reads that Expo does not hash: package.json, package-lock.json, patches/, app.json,
//     app.config.ts, brand/, plugins/, modules/, assets/ and, for FLAVOR=personal, the private overlay's app/ dir
//   - the build scripts (scripts/build-apk.sh, scripts/lib/{flavor,brand}.sh: they shape the Gradle project)
//   - FLAVOR, ABIS and every EXPO_PUBLIC_* value (EXPO_PUBLIC_BG_SERVICE changes the manifest)
// HUI_BUILD_NUMBER / HUI_BUILD_SOURCE are removed before hashing: they change with every build, and the fast path
// keeps the base's build number (the commit in Settings → About is the new one).
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
/** bump when the fingerprint or the swap changes meaning: every old base becomes a miss */
export const SCHEMA = 1;
/** app files (relative to APP_DIR) the native build depends on, beyond what @expo/fingerprint hashes */
export const APP_INPUTS = ['package.json', 'package-lock.json', 'patches', 'app.json', 'app.config.ts', 'brand', 'plugins', 'modules', 'assets'];
/** repo files (relative to the repo root) that shape the generated Gradle project */
export const SCRIPT_INPUTS = ['scripts/build-apk.sh', 'scripts/lib/flavor.sh', 'scripts/lib/brand.sh'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'build', '.gradle', '.cxx', '.expo']);

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

/** sorted [relPath, sha256] of every file under p (a file or a dir); missing → [] */
export function hashTree(p, base = p) {
  if (!existsSync(p)) return [];
  const rel = relative(base, p).split(sep).join('/') || basename(p);
  const st = statSync(p, { throwIfNoEntry: false });
  if (!st) return [[rel, lstatSync(p).isSymbolicLink() ? 'dangling-link' : 'unreadable']];
  if (st.isFile()) return [[rel, sha256(readFileSync(p))]];
  if (!st.isDirectory()) return [];
  const out = [];
  for (const name of readdirSync(p).sort()) {
    if (SKIP_DIRS.has(name)) continue;
    out.push(...hashTree(join(p, name), base));
  }
  return out;
}

/** EXPO_PUBLIC_* plus the build switches, without the per-build values */
export function envPart(env) {
  return Object.keys(env)
    .filter((k) => k.startsWith('EXPO_PUBLIC_'))
    .sort()
    .map((k) => `${k}=${env[k]}`);
}

async function expoFingerprint(appDir, env) {
  let mod;
  try {
    const req = createRequire(join(appDir, 'package.json'));
    mod = req(req.resolve('@expo/fingerprint'));
  } catch {
    return null;
  }
  const saved = {};
  for (const k of ['HUI_BUILD_NUMBER', 'HUI_BUILD_SOURCE']) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  // the app config reads EXPO_PUBLIC_FLAVOR / HUI_PRIVATE_DIR from process.env
  for (const k of Object.keys(env)) if (k.startsWith('EXPO_PUBLIC_') || k === 'HUI_PRIVATE_DIR') process.env[k] = env[k];
  try {
    const fp = await mod.createFingerprintAsync(appDir, { platforms: ['android'], silent: true });
    return fp?.hash ?? null;
  } catch (e) {
    process.stderr.write(`apk-fast: @expo/fingerprint failed: ${e?.message ?? e}\n`);
    return null;
  } finally {
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
}

/**
 * Native fingerprint of APP_DIR for env (FLAVOR, ABIS, EXPO_PUBLIC_*, HUI_PRIVATE_DIR). `expo` may be injected (tests);
 * it returns the @expo/fingerprint hash or null. Result: { hash | null, parts } (hash null = unknown → full build).
 */
export async function fingerprint(appDir, env = process.env, { expo = expoFingerprint, root = ROOT } = {}) {
  const flavor = env.FLAVOR || env.EXPO_PUBLIC_FLAVOR || 'hermes';
  const abis = env.ABIS || 'arm64-v8a';
  const expoHash = await expo(appDir, env);
  const files = [];
  for (const p of APP_INPUTS) files.push(...hashTree(join(appDir, p), appDir));
  for (const p of SCRIPT_INPUTS) files.push(...hashTree(join(root, p), root).map(([f, h]) => [`repo:${f}`, h]));
  if (flavor === 'personal') {
    const priv = (env.HUI_PRIVATE_DIR || join(homedir(), 'work', 'hermesiui-private')).replace(/^~\//, `${homedir()}/`);
    files.push(...hashTree(join(priv, 'app'), priv).map(([f, h]) => [`private:${f}`, h]));
  }
  const parts = { schema: SCHEMA, flavor, abis, expo: expoHash, env: envPart(env), files: sha256(files.map((f) => f.join(' ')).join('\n')), fileCount: files.length };
  const hash = expoHash ? sha256(JSON.stringify(parts)).slice(0, 32) : null;
  return { hash, parts };
}

/** asset manifest of an `export:embed --assets-dest` dir (= Gradle's generated/res/react/<variant>): sorted path → sha256 */
export function assetManifest(dir) {
  return Object.fromEntries(hashTree(dir, dir));
}

export function cacheKey(flavor, abis, fp) {
  if (!/^(hermes|personal)$/.test(flavor)) throw new Error(`bad flavor ${flavor}`);
  if (!/^[0-9a-f]{32}$/.test(fp)) throw new Error(`bad fingerprint ${fp}`);
  return `${flavor}-${abis.replace(/[^a-z0-9_-]+/gi, '+')}-${fp}`;
}

/** base dir for key if it is complete, else null */
export function lookup(bases, key) {
  const dir = join(bases, key);
  try {
    const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
    if (meta.schema !== SCHEMA || meta.key !== key) return null;
    for (const f of ['base.apk', 'debug.keystore', 'assets.json']) if (!existsSync(join(dir, f))) return null;
    return dir;
  } catch {
    return null;
  }
}

/** stores a full build as base: written to a temp dir, then renamed (readers never see a half-written base) */
export function register(bases, key, { apk, appDir, variant, buildNumber, keystore, bundleSha }) {
  const resDir = join(appDir, 'android', 'app', 'build', 'generated', 'res', 'react', variant);
  const bundle = join(appDir, 'android', 'app', 'build', 'generated', 'assets', 'react', variant, 'index.android.bundle');
  if (!existsSync(resDir) || !existsSync(bundle)) throw new Error(`no generated JS output in ${appDir} (${variant})`);
  const gradleSha = sha256(readFileSync(bundle));
  if (bundleSha && bundleSha !== gradleSha) throw new Error('the APK bundle differs from the Gradle bundle: not registered');
  mkdirSync(bases, { recursive: true });
  const tmp = join(bases, `.tmp-${key}-${process.pid}`);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp);
  copyFileSync(apk, join(tmp, 'base.apk'));
  copyFileSync(keystore, join(tmp, 'debug.keystore'));
  writeFileSync(join(tmp, 'assets.json'), `${JSON.stringify(assetManifest(resDir), null, 1)}\n`);
  const [flavor] = key.split('-');
  writeFileSync(join(tmp, 'meta.json'), `${JSON.stringify({ schema: SCHEMA, key, flavor, variant, buildNumber: Number(buildNumber), bundleSha: gradleSha, apk: basename(apk), created: new Date().toISOString() }, null, 1)}\n`);
  const dir = join(bases, key);
  const old = join(bases, `.old-${key}-${process.pid}`);
  if (existsSync(dir)) renameSync(dir, old);
  renameSync(tmp, dir);
  rmSync(old, { recursive: true, force: true });
  prune(bases, key);
  return dir;
}

/** keeps the newest `keep` bases of the same flavor/ABI as key */
export function prune(bases, key, keep = Number(process.env.HUI_FAST_KEEP || 3)) {
  const prefix = key.slice(0, key.lastIndexOf('-') + 1);
  const dirs = readdirSync(bases)
    .filter((n) => n.startsWith(prefix) && n !== key && lookup(bases, n))
    .map((n) => ({ n, t: statSync(join(bases, n, 'meta.json')).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  for (const { n } of dirs.slice(Math.max(0, keep - 1))) rmSync(join(bases, n), { recursive: true, force: true });
}

async function main(argv) {
  const [cmd, ...a] = argv;
  switch (cmd) {
    case 'fingerprint': {
      const r = await fingerprint(resolve(a[0] ?? '.'));
      process.stdout.write(`${JSON.stringify(r)}\n`);
      return r.hash ? 0 : 1;
    }
    case 'assets':
      process.stdout.write(`${JSON.stringify(assetManifest(resolve(a[0])), null, 1)}\n`);
      return 0;
    case 'key':
      process.stdout.write(`${cacheKey(a[0], a[1], a[2])}\n`);
      return 0;
    case 'lookup': {
      const dir = lookup(a[0], a[1]);
      if (dir) process.stdout.write(`${dir}\n`);
      return dir ? 0 : 1;
    }
    case 'register': {
      const [bases, key, apk, appDir, variant, buildNumber, keystore, bundleSha] = a;
      process.stdout.write(`${register(bases, key, { apk, appDir, variant, buildNumber, keystore, bundleSha })}\n`);
      return 0;
    }
    default:
      process.stderr.write('usage: apk-fast.mjs fingerprint APP_DIR | assets DIR | key FLAVOR ABIS FP | lookup BASES KEY | register BASES KEY APK APP_DIR VARIANT BUILD_NUMBER KEYSTORE [BUNDLE_SHA]\n');
      return 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (c) => process.exit(c),
    (e) => {
      process.stderr.write(`apk-fast: ${e?.message ?? e}\n`);
      process.exit(1);
    },
  );
}
