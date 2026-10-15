#!/usr/bin/env node
// verify-flavor-artifact: does a built artifact really carry the JS of the flavor it was built for?
// app/src/flavor.ts FLAVOR_MARK puts exactly one sentinel string into every bundle (Metro inlines
// EXPO_PUBLIC_FLAVOR and constant-folds the comparison). The build scripts call this before an artifact is copied,
// published or packaged (docs/BUILD.md "Flavor mark"); a stale Metro cache once shipped hermes JS in a personal APK.
//
//   verify-flavor-artifact.mjs <artifact|dir> <hermes|personal>   exit 0 only if the mark of that flavor is present
//                                                                  and no other mark is
//   verify-flavor-artifact.mjs --list <artifact|dir>               print the marks per scanned file (no verdict)
//
// Artifacts (detected by content, not by name): zip (.apk / .aab / .ipa / zipped .app: the Hermes bytecode bundle
// index.android.bundle or main.jsbundle must exist and carry the mark), tar / tar.gz (package-web.sh archive), a
// directory (web export: every .js/.hbc/.bundle/.jsbundle file and their precompressed .gz/.br siblings) or a single
// bundle file. Source maps are not scanned (their sourcesContent holds flavor.ts with both strings).
// Fails when the expected mark is missing, another flavor's mark is present, one file holds both marks (the
// comparison was not folded) or an unknown hui-flavor: string shows up.
// Exit codes: 0 ok, 1 wrong / missing / ambiguous mark, 2 usage or unreadable artifact.
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliDecompressSync, gunzipSync, inflateRawSync } from 'node:zlib';

export const MARK_PREFIX = 'hui-flavor:';
/** the mark each flavor's bundle must carry (app/src/flavor.ts FLAVOR_MARK) */
export const MARKS = {
  hermes: 'hui-flavor:hermes',
  personal: 'hui-flavor:hermes', // the public flavor.ts has the hermes mark only
};
const KNOWN = [...new Set(Object.values(MARKS))];
const BUNDLE_RE = /\.(?:js|mjs|cjs|hbc|bundle|jsbundle)$/i;
/** the one Hermes bytecode bundle of an Android (APK / AAB) or iOS (.ipa / .app) build */
const PRIMARY = new Set(['index.android.bundle', 'main.jsbundle']);

/** `name` → how to read it as a bundle ('plain' | 'gz' | 'br'), or null when it is no bundle */
export function bundleKind(name) {
  if (BUNDLE_RE.test(name)) return 'plain';
  const m = /^(.*)\.(gz|br)$/i.exec(name);
  return m && BUNDLE_RE.test(m[1]) ? m[2].toLowerCase() : null;
}

function decode(kind, buf) {
  if (kind === 'gz') return gunzipSync(buf);
  if (kind === 'br') return brotliDecompressSync(buf);
  return buf;
}

/**
 * Marks in a buffer: { known: Map<mark, count>, unknown: string[] }. Byte search, so it works on minified JS and on
 * the Hermes bytecode string table alike (packed without separators: only the known prefix length is compared).
 */
export function findMarks(buf) {
  const known = new Map();
  const unknown = [];
  const prefix = Buffer.from(MARK_PREFIX);
  for (let i = buf.indexOf(prefix); i >= 0; i = buf.indexOf(prefix, i + prefix.length)) {
    const mark = KNOWN.find((k) => buf.subarray(i, i + k.length).toString('latin1') === k);
    if (mark) known.set(mark, (known.get(mark) ?? 0) + 1);
    else unknown.push(buf.subarray(i, i + prefix.length + 16).toString('latin1').replace(/[^\x20-\x7e]/g, '?'));
  }
  return { known, unknown };
}

// ── containers ────────────────────────────────────────────────────────────────────────────────────────────────

/** zip central directory → [{ name, read() }] (stored / deflate, zip64 aware) */
export function zipEntries(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip archive (no end of central directory)');
  let count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  if ((count === 0xffff || off === 0xffffffff) && eocd >= 20 && buf.readUInt32LE(eocd - 20) === 0x07064b50) {
    const z = Number(buf.readBigUInt64LE(eocd - 20 + 8));
    if (buf.readUInt32LE(z) !== 0x06064b50) throw new Error('broken zip64 end of central directory');
    count = Number(buf.readBigUInt64LE(z + 32));
    off = Number(buf.readBigUInt64LE(z + 48));
  }
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('broken zip central directory');
    const method = buf.readUInt16LE(off + 10);
    let csize = buf.readUInt32LE(off + 20);
    let size = buf.readUInt32LE(off + 24);
    const nlen = buf.readUInt16LE(off + 28);
    const elen = buf.readUInt16LE(off + 30);
    const clen = buf.readUInt16LE(off + 32);
    let local = buf.readUInt32LE(off + 42);
    const name = buf.subarray(off + 46, off + 46 + nlen).toString('utf8');
    // zip64 extra field: the 0xffffffff fields follow in the order size, compressed size, local header offset
    for (let e = off + 46 + nlen; e + 4 <= off + 46 + nlen + elen; ) {
      const id = buf.readUInt16LE(e);
      const len = buf.readUInt16LE(e + 2);
      if (id === 0x0001) {
        let p = e + 4;
        if (size === 0xffffffff) (size = Number(buf.readBigUInt64LE(p))), (p += 8);
        if (csize === 0xffffffff) (csize = Number(buf.readBigUInt64LE(p))), (p += 8);
        if (local === 0xffffffff) local = Number(buf.readBigUInt64LE(p));
      }
      e += 4 + len;
    }
    entries.push({
      name,
      read() {
        if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error(`broken zip local header: ${name}`);
        const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
        const data = buf.subarray(start, start + csize);
        if (method === 0) return data;
        if (method === 8) return inflateRawSync(data);
        throw new Error(`${name}: unsupported zip compression method ${method}`);
      },
    });
    off += 46 + nlen + elen + clen;
  }
  return entries;
}

/** tar (ustar / GNU long names) → [{ name, read() }], regular files only */
export function tarEntries(buf) {
  const entries = [];
  let longName = null;
  for (let off = 0; off + 512 <= buf.length; ) {
    const h = buf.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    const str = (a, b) => h.subarray(a, b).toString('utf8').replace(/\0.*$/s, '');
    const size = parseInt(str(124, 136).trim() || '0', 8);
    if (!Number.isFinite(size)) throw new Error('broken tar header');
    const type = String.fromCharCode(h[156] || 0x30);
    const prefix = h.subarray(257, 262).toString('latin1') === 'ustar' ? str(345, 500) : '';
    const data = buf.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
    if (type === 'L') {
      longName = data.toString('utf8').replace(/\0.*$/s, '');
      continue;
    }
    const name = longName ?? (prefix ? `${prefix}/${str(0, 100)}` : str(0, 100));
    longName = null;
    if (type === '0' || type === '\0') entries.push({ name, read: () => data });
  }
  return entries;
}

function walk(dir, root = dir, out = []) {
  for (const d of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = join(dir, d.name);
    if (d.isDirectory()) walk(p, root, out);
    else if (d.isFile()) out.push({ name: relative(root, p).split(sep).join('/'), read: () => readFileSync(p) });
  }
  return out;
}

/**
 * Scan an artifact → { type: 'dir'|'zip'|'tar'|'file', files: [{ name, primary, known, unknown }] } with one entry per
 * scanned bundle file (also those without any mark).
 */
export function scanArtifact(path) {
  const st = lstatSync(path);
  let type;
  let entries;
  if (st.isDirectory()) {
    type = 'dir';
    entries = walk(path);
  } else {
    let buf = readFileSync(path);
    if (buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50) {
      type = 'zip';
      entries = zipEntries(buf);
    } else {
      if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf);
      if (buf.length >= 262 && buf.subarray(257, 262).toString('latin1') === 'ustar') {
        type = 'tar';
        entries = tarEntries(buf);
      } else {
        type = 'file';
        entries = [{ name: basename(path), read: () => buf, forced: true }];
      }
    }
  }
  const files = [];
  for (const e of entries) {
    const kind = e.forced ? 'plain' : bundleKind(e.name);
    if (!kind) continue;
    const { known, unknown } = findMarks(decode(kind, e.read()));
    files.push({ name: e.name, primary: PRIMARY.has(e.name.split('/').pop()), known, unknown });
  }
  return { type, files };
}

/** → { ok, errors: string[], found: string[] } for `flavor`'s mark */
export function verifyScan(scan, flavor) {
  const want = MARKS[flavor];
  if (!want) throw new Error(`unknown flavor '${flavor}' (hermes | personal)`);
  const errors = [];
  const found = [];
  if (scan.files.length === 0) errors.push('no JS bundle in the artifact (.js / .hbc / index.android.bundle / main.jsbundle)');
  if (scan.type === 'zip' && !scan.files.some((f) => f.primary)) {
    errors.push('no index.android.bundle / main.jsbundle in the archive');
  }
  for (const f of scan.files) {
    const marks = [...f.known.keys()];
    if (marks.length > 1) errors.push(`${f.name}: holds several flavor marks (${marks.join(', ')}): EXPO_PUBLIC_FLAVOR was not folded at build time`);
    for (const m of marks) if (m !== want) errors.push(`${f.name}: ${m}, but this is a FLAVOR=${flavor} build (stale Metro cache or wrong EXPO_PUBLIC_FLAVOR?)`);
    for (const u of f.unknown) errors.push(`${f.name}: unknown flavor mark "${u}"`);
    if (f.known.has(want)) found.push(f.name);
    else if (f.primary) errors.push(`${f.name}: no ${want}`);
  }
  if (scan.files.length > 0 && found.length === 0) errors.push(`no ${want} in any bundle (built before the flavor mark existed, or a stripped bundle)`);
  return { ok: errors.length === 0, errors, found };
}

export function verifyArtifact(path, flavor) {
  return verifyScan(scanArtifact(path), flavor);
}

function main(argv) {
  if (argv[0] === '--list' && argv.length === 2) {
    const scan = scanArtifact(argv[1]);
    console.log(`${argv[1]} (${scan.type}, ${scan.files.length} bundle files)`);
    for (const f of scan.files) {
      const marks = [...f.known].map(([m, n]) => (n > 1 ? `${m} x${n}` : m)).concat(f.unknown.map((u) => `unknown "${u}"`));
      if (marks.length || f.primary) console.log(`  ${f.name}: ${marks.join(', ') || 'no mark'}`);
    }
    return 0;
  }
  if (argv.length !== 2 || argv[0].startsWith('-')) {
    console.error('usage: verify-flavor-artifact.mjs <artifact|dir> <hermes|personal>  |  --list <artifact|dir>');
    return 2;
  }
  const [path, flavor] = argv;
  if (!MARKS[flavor]) {
    console.error(`verify-flavor-artifact: unknown flavor '${flavor}' (hermes | personal)`);
    return 2;
  }
  const r = verifyArtifact(resolve(path), flavor);
  if (!r.ok) {
    console.error(`verify-flavor-artifact: REJECTED ${path} (FLAVOR=${flavor}):`);
    for (const e of r.errors) console.error(`  - ${e}`);
    return 1;
  }
  console.log(`verify-flavor-artifact: ${MARKS[flavor]} OK (${path}: ${r.found.join(', ')})`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (e) {
    console.error(`verify-flavor-artifact: ${e.message || e}`);
    process.exit(2);
  }
}
