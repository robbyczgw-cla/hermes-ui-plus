#!/usr/bin/env node
// leak-guard: keep private content (real hostnames, names, IPs, e-mail addresses ...) out of the public repo.
// No dependencies. Complements gitleaks (secrets); see docs/LEAK-GUARD.md.
//
//   leak-guard.mjs --staged                 files staged in the index (pre-commit)
//   leak-guard.mjs --tree [--ref REV]       every tracked file (working tree, or the tree of commit REV)
//   leak-guard.mjs --path DIR [--path ...]  any directory: dist/web, unzipped APK, .app bundle (binary-safe)
//
// Options: --show (print matched text; default is masked, safe for logs)  --json  --generic-only
//          --denylist FILE  --require-denylist (missing/empty denylist = error)  --quiet
//          --expect-hermes (artifact scans: index.android.bundle / main.jsbundle must exist and be decoded as Hermes
//          bytecode, else error; scan-artifact.sh sets it for APK/AAB/IPA)
//
// Two checks:
//   1. Denylist: private terms from $HUI_PRIVATE_DIR/leak-denylist.txt (NOT in the repo). Missing file = warning,
//      generic checks still run.
//   2. Generic patterns that are safe to publish: *.ts.net hosts (except example.ts.net / <placeholder>),
//      CGNAT 100.64.0.0/10 and Tailscale fd7a:115c:a1e0:: addresses, RFC1918 IPs in non-test code,  // leak-guard:allow (pattern docs)
//      e-mail addresses (except example.com|org|net, noreply, git@github.com).
//
// Denylist syntax (one entry per line, '#' comments):
//   term        case-insensitive literal; alphanumeric edges get a word boundary (letters/digits, so "acme" does
//               not match "acmes" but does match "acme_url" and "acme.example")
//   cs:Term     same but case-sensitive
//   re:REGEX    raw JS regex (flags: i)
// Suppress a single line with the marker  leak-guard:allow  ; suppress matches globally with regex lines in
// .leak-guard-allow (repo root) or $HUI_PRIVATE_DIR/leak-allow.txt (regex matched against the matched text).
//
// Exit codes: 0 clean, 1 findings, 2 usage / environment error (never "pass" when something could not be checked).

import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { maskMediaPayload } from './lib/media-metadata.mjs';

const ALLOW_MARKER = 'leak-guard:allow';
const MAX_FILE_BYTES = 256 * 1024 * 1024;
const MAX_UTF16_BYTES = 32 * 1024 * 1024;

// ---------------------------------------------------------------------------------------------------------
// Denylist
// ---------------------------------------------------------------------------------------------------------

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isAlnum = (c) => /[A-Za-z0-9]/.test(c);

/** @returns {{id:string, label:string, re:RegExp}[]} */
export function parseDenylist(text) {
  const rules = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const hint = line.replace(/^(cs:|re:)/, '');
    const id = `denylist#${i + 1}(${hint.length <= 3 ? '***' : `${hint.slice(0, 2)}***`})`;
    let source;
    let flags = 'gi';
    if (line.startsWith('re:')) {
      source = line.slice(3);
    } else {
      let term = line;
      if (term.startsWith('cs:')) {
        term = term.slice(3);
        flags = 'g';
      }
      if (!term) return;
      source = (isAlnum(term[0]) ? '(?<![A-Za-z0-9])' : '') + escapeRe(term) + (isAlnum(term[term.length - 1]) ? '(?![A-Za-z0-9])' : '');
    }
    try {
      rules.push({ id, label: 'denylist', re: new RegExp(source, flags) });
    } catch (e) {
      throw new Error(`denylist line ${i + 1}: invalid pattern (${e.message})`);
    }
  });
  return rules;
}

// ---------------------------------------------------------------------------------------------------------
// Generic rules
// ---------------------------------------------------------------------------------------------------------

const TEST_PATH = /(^|\/)(tests?|__tests__|__fixtures__|fixtures)\/|\.(test|spec)\.[cm]?[jt]sx?$/i;
export const isTestPath = (p) => TEST_PATH.test(p.split(sep).join('/'));
const LOCKFILE = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Podfile\.lock|Gemfile\.lock|gradle\.lockfile)$/;

const IPV4 = /(?<![\w.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?!\d)(?!\.\d)(?!\/\d)/g;
const octets = (m) => [m[1], m[2], m[3], m[4]].map(Number);
const validIp = (o) => o.every((n) => n >= 0 && n <= 255);
const FILE_EXT_TLD = /^(png|jpe?g|gif|webp|svg|ico|icns|avif|heic|js|mjs|cjs|jsx|ts|tsx|json|css|html?|md|txt|ttf|otf|woff2?|mp[34]|wav|m4a|webm|dex|xml|plist|yml|yaml|toml|lock|map|gz|aab|apk)$/i;
const MEDIA = /\.(png|jpe?g|gif|webp|avif|heic|mp4|mov|webm|m4a|mp3|wav|ogg|icns|ico|ttf|otf|woff2?|pdf)$/i;

/**
 * Generic checks. Each gets (line, ctx) and yields {rule, text, index}.
 * ctx = { path, binary }
 */
export const GENERIC_RULES = [
  {
    id: 'generic:tailnet-host',
    find(line) {
      const out = [];
      for (const m of line.matchAll(/((?:[A-Za-z0-9_<>${}-]+\.)*[A-Za-z0-9_<>${}-]+)\.ts\.net(?![A-Za-z0-9-])/gi)) {
        const host = m[1].toLowerCase();
        if (/[<>${}]/.test(host)) continue; // <placeholder> / ${VAR}
        if (host === 'example' || host.endsWith('.example')) continue;
        out.push({ text: m[0], index: m.index });
      }
      return out;
    },
  },
  {
    id: 'generic:cgnat-ip',
    find(line) {
      const out = [];
      for (const m of line.matchAll(IPV4)) {
        const o = octets(m);
        if (!validIp(o)) continue;
        if (o[0] === 100 && o[1] >= 64 && o[1] <= 127 && m[0] !== '100.100.100.100') out.push({ text: m[0], index: m.index });
      }
      for (const m of line.matchAll(/\bfd7a:115c:a1e0:[0-9a-f:]*/gi)) out.push({ text: m[0], index: m.index });
      return out;
    },
  },
  {
    id: 'generic:private-ip',
    nonTestOnly: true,
    textOnly: true,
    find(line) {
      const out = [];
      for (const m of line.matchAll(IPV4)) {
        const o = octets(m);
        if (!validIp(o)) continue;
        const priv = o[0] === 10 || (o[0] === 172 && o[1] >= 16 && o[1] <= 31) || (o[0] === 192 && o[1] === 168);
        if (priv && m[0] !== '10.0.2.2') out.push({ text: m[0], index: m.index }); // 10.0.2.2 = Android emulator host alias
      }
      return out;
    },
  },
  {
    id: 'generic:email',
    find(line) {
      const out = [];
      for (const m of line.matchAll(/(?<![A-Za-z0-9._%+-])([A-Za-z0-9._%+-]*[A-Za-z0-9])@((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})(?![A-Za-z0-9-])/g)) {
        const local = m[1].toLowerCase();
        const domain = m[2].toLowerCase();
        if (/^(example\.(com|org|net)|.+\.example\.(com|org|net))$/.test(domain)) continue;
        if (/^(no-?reply|noreply)/.test(local) || domain.endsWith('noreply.github.com')) continue;
        if (local === 'git' && /^(github|gitlab|bitbucket)\.(com|org)$/.test(domain)) continue;
        if (/^\d+x\./.test(domain) || FILE_EXT_TLD.test(domain.slice(domain.lastIndexOf('.') + 1))) continue; // icon@2x.png, foo@bar.mjs
        out.push({ text: m[0], index: m.index });
      }
      return out;
    },
  },
];

// ---------------------------------------------------------------------------------------------------------
// Code signatures (artifact scans only, opts.signature): a signed iOS/macOS app or disk image inevitably carries the developer
// name, team id and certificate ids in its code signature and provisioning profile. Those are allowed; the app
// content (JS bundle, assets, plists, the rest of every binary) is still scanned strictly. docs/LEAK-GUARD.md
// ---------------------------------------------------------------------------------------------------------

/** Signature-only files inside an .app/.framework/.appex bundle: skipped completely. */
export const isSignaturePath = (p) => /(^|\/)_CodeSignature\/|\.mobileprovision$/i.test(p.split(sep).join('/'));

const LC_CODE_SIGNATURE = 0x1d;
const CSMAGIC_EMBEDDED_SIGNATURE = 0xfade0cc0; // SuperBlob magic, big-endian, at the start of the blob

/** [start, end) of the LC_CODE_SIGNATURE blob of one thin Mach-O slice at `base` (size `len`), or null. */
function thinSignatureRange(buf, base, len) {
  if (len < 28 || base + len > buf.length) return null;
  const m = buf.readUInt32LE(base);
  let le;
  if (m === 0xfeedface || m === 0xfeedfacf) le = true;
  else if (m === 0xcefaedfe || m === 0xcffaedfe) le = false;
  else return null;
  const is64 = m === 0xfeedfacf || m === 0xcffaedfe;
  const u32 = (o) => (le ? buf.readUInt32LE(base + o) : buf.readUInt32BE(base + o));
  const ncmds = u32(16);
  const sizeofcmds = u32(20);
  let off = is64 ? 32 : 28;
  const end = off + sizeofcmds;
  if (end > len || ncmds > 0x10000) return null;
  for (let i = 0; i < ncmds; i++) {
    if (off + 8 > end) return null;
    const cmd = u32(off);
    const size = u32(off + 4);
    if (size < 8 || off + size > end) return null;
    if (cmd === LC_CODE_SIGNATURE) {
      if (size < 16) return null;
      const dataoff = u32(off + 8);
      const datasize = u32(off + 12);
      if (datasize < 12 || dataoff + datasize > len) return null;
      // only a real embedded-signature SuperBlob is excluded, never arbitrary bytes a load command points at
      if (buf.readUInt32BE(base + dataoff) !== CSMAGIC_EMBEDDED_SIGNATURE) return null;
      return [base + dataoff, base + dataoff + datasize];
    }
    off += size;
  }
  return null;
}

/**
 * Byte ranges [start, end) of the embedded code signatures (LC_CODE_SIGNATURE) of a Mach-O file, thin or fat
 * (FAT_MAGIC / FAT_MAGIC_64). Anything that is not a well-formed Mach-O gives [] (= nothing excluded).
 */
export function machoSignatureRanges(buf) {
  if (buf.length < 8) return [];
  const magic = buf.readUInt32BE(0);
  if (magic === 0xcafebabe || magic === 0xcafebabf) {
    const is64 = magic === 0xcafebabf;
    const n = buf.readUInt32BE(4);
    const entry = is64 ? 32 : 20;
    if (n === 0 || n > 32 || 8 + n * entry > buf.length) return []; // also rules out Java .class (same magic)
    const ranges = [];
    for (let i = 0; i < n; i++) {
      const e = 8 + i * entry;
      const off = is64 ? Number(buf.readBigUInt64BE(e + 8)) : buf.readUInt32BE(e + 8);
      const size = is64 ? Number(buf.readBigUInt64BE(e + 16)) : buf.readUInt32BE(e + 12);
      if (off + size > buf.length) return [];
      const r = thinSignatureRange(buf, off, size);
      if (r) ranges.push(r);
    }
    return ranges;
  }
  const r = thinSignatureRange(buf, 0, buf.length);
  return r ? [r] : [];
}

/**
 * [start, end) of the code signature of a signed disk image (.dmg, UDIF): `codesign` stores an embedded-signature
 * SuperBlob in front of the 512-byte "koly" trailer. Only a well-formed SuperBlob (magic, length, index entries
 * inside the blob, at least one CMS wrapper 0xfade0b01) is excluded; anything else gives null. The signature
 * names the developer and team (shown by macOS itself); the disk image content is still scanned.
 */
export function dmgSignatureRange(buf) {
  const n = buf.length;
  if (n < 512 + 12 || buf.toString('latin1', n - 512, n - 508) !== 'koly') return null;
  const limit = n - 512;
  const from = Math.max(0, limit - 4 * 1024 * 1024);
  for (let p = buf.lastIndexOf(Buffer.from([0xfa, 0xde, 0x0c, 0xc0]), limit - 12); p >= from; p = p > 0 ? buf.lastIndexOf(Buffer.from([0xfa, 0xde, 0x0c, 0xc0]), p - 1) : -1) {
    const len = buf.readUInt32BE(p + 4);
    const count = buf.readUInt32BE(p + 8);
    if (len < 12 || p + len > limit || count === 0 || count > 64 || 12 + count * 8 > len) continue;
    let cms = false;
    let ok = true;
    for (let i = 0; i < count; i++) {
      const off = buf.readUInt32BE(p + 12 + i * 8 + 4);
      if (off < 12 + count * 8 || off + 8 > len) { ok = false; break; }
      if (buf.readUInt32BE(p + off) === 0xfade0b01) cms = true;
    }
    if (ok && cms) return [p, p + len];
  }
  return null;
}

/** Copy of buf with the code-signature ranges zeroed (string runs inside them disappear). */
export function maskSignatures(buf) {
  const ranges = machoSignatureRanges(buf);
  const dmg = ranges.length ? null : dmgSignatureRange(buf);
  if (dmg) ranges.push(dmg);
  if (!ranges.length) return { buf, ranges };
  const out = Buffer.from(buf);
  for (const [s, e] of ranges) out.fill(0, s, e);
  return { buf: out, ranges };
}

// ---------------------------------------------------------------------------------------------------------
// Hermes bytecode (index.android.bundle in APK/AAB, main.jsbundle in IPA). The compiler packs all strings of the
// bundle into one storage blob without separators (and lets strings share bytes), and stores non-ASCII strings as
// UTF-16. A `strings`-style scan therefore misses names glued to a neighbour ("Alice" in "Aliceglobal" fails the
// word boundary) and every non-ASCII name. Decoding the string table gives each string with its real boundaries.
// ---------------------------------------------------------------------------------------------------------

const HBC_MAGIC = Buffer.from([0xc6, 0x1f, 0xbc, 0x03, 0xc1, 0x03, 0x19, 0x1f]); // 0x1F1903C103BC1FC6, little-endian
const HBC_HEADER_BYTES = 128;
// Function header size: 12 bytes in bytecode v98 (Hermes 1.0), 16 bytes in older versions. Both are tried; only a
// layout whose string-kind counts add up to exactly stringCount / identifierCount and whose every entry lies inside
// the string storage is accepted, so a wrong guess cannot pass.
const HBC_FUNC_HEADER_BYTES = [12, 16];
export const isHermesBytecode = (buf) => buf.length >= 8 && buf.subarray(0, 8).equals(HBC_MAGIC);

/** The string table at one candidate layout, or null when the structure does not validate. */
function hermesStringTable(buf, funcHeaderBytes) {
  const u32 = (o) => buf.readUInt32LE(o);
  const fileLength = u32(32);
  const [functionCount, kindCount, identifierCount, stringCount, overflowCount, storageSize] = [40, 44, 48, 52, 56, 60].map(u32);
  const align = (n) => n + ((4 - (n % 4)) % 4);
  // sections in file order, each 4-byte aligned: function headers, string kinds, identifier hashes, small string
  // table (4 bytes each), overflow string table (8 bytes each), string storage
  const kinds = HBC_HEADER_BYTES + align(functionCount * funcHeaderBytes);
  const small = kinds + align(kindCount * 4) + align(identifierCount * 4);
  const overflow = small + stringCount * 4;
  const storage = align(overflow + overflowCount * 8);
  if (storage + storageSize > fileLength) return null;
  let total = 0;
  let identifiers = 0;
  for (let i = 0; i < kindCount; i++) {
    const e = u32(kinds + i * 4);
    total += e & 0x7fffffff;
    if (e >>> 31) identifiers += e & 0x7fffffff;
  }
  if (total !== stringCount || identifiers !== identifierCount) return null;
  const strings = [];
  for (let i = 0; i < stringCount; i++) {
    const e = u32(small + i * 4); // bit 0 isUTF16, bits 1-23 offset, bits 24-31 length (0xff = overflow index)
    const utf16 = (e & 1) === 1;
    let offset = (e >>> 1) & 0x7fffff;
    let length = e >>> 24;
    if (length === 0xff) {
      if (offset >= overflowCount) return null;
      length = u32(overflow + offset * 8 + 4);
      offset = u32(overflow + offset * 8);
    }
    const bytes = utf16 ? length * 2 : length;
    if (offset + bytes > storageSize) return null;
    const start = storage + offset;
    strings.push({ offset: start, text: buf.toString(utf16 ? 'utf16le' : 'latin1', start, start + bytes) });
  }
  return strings;
}

/**
 * Every string of a Hermes bytecode file's string table (identifiers and string literals, small and overflow
 * entries, 8-bit and UTF-16), each with its byte offset. Throws when the file has the Hermes magic but its layout
 * is not recognized: the caller reports that as a scan error, never as clean.
 * @returns {{version:number, strings:{offset:number,text:string}[]}}
 */
export function hermesStrings(buf) {
  if (!isHermesBytecode(buf)) throw new Error('not Hermes bytecode');
  if (buf.length < HBC_HEADER_BYTES) throw new Error('Hermes bytecode: truncated header');
  const version = buf.readUInt32LE(8);
  if (buf.readUInt32LE(32) > buf.length) throw new Error(`Hermes bytecode v${version}: truncated (fileLength > size)`);
  for (const size of HBC_FUNC_HEADER_BYTES) {
    const strings = hermesStringTable(buf, size);
    if (strings) return { version, strings };
  }
  throw new Error(`Hermes bytecode v${version}: unrecognized string table layout`);
}

// ---------------------------------------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------------------------------------

const BINARY_EMAIL_RE = /^[a-z0-9._%+-]{2,}@[a-z0-9-]{2,}(?:\.[a-z0-9-]{2,})*\.[a-z]{2,24}$/;
const NON_ASCII = /[^\x00-\x7f]/;
export const isBinary = (buf) => {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
};

/**
 * Build the (path, text) scanning function. opts: { denylist: rule[], allow: RegExp[], signature: bool }
 * signature (artifact scans): skip signature-only files (isSignaturePath) and the LC_CODE_SIGNATURE blob of
 * Mach-O binaries; the rest of every binary is scanned as usual.
 */
export function makeScanner({ denylist = [], allow = [], signature = false, inlineAllow = !signature } = {}) {
  const textAllow = allow.filter((re) => !re.span);
  const spanAllow = allow.filter((re) => re.span);
  const allowed = (text) => textAllow.some((re) => re.test(text));

  /** [start, end) ranges of `span:` allow matches in a line: findings fully inside one are allowed */
  function allowSpans(line) {
    const spans = [];
    for (const re of spanAllow) for (const m of line.matchAll(re)) if (m[0]) spans.push([m.index, m.index + m[0].length]);
    return spans;
  }
  const inSpan = (spans, index, text) => spans.some(([a, b]) => index >= a && index + text.length <= b);
  /** hermes: Hermes bytecode files whose string table was decoded ({path, version, strings}) */
  const stats = { hermes: [] };

  function scanLine(line, ctx, push) {
    // inline marker: source files only. In artifacts (inlineAllow false) a minified one-line bundle or a binary string
    // run can contain the marker as ordinary data, which would hide every finding on that line/run.
    if (inlineAllow && line.includes(ALLOW_MARKER)) return;
    const spans = spanAllow.length ? allowSpans(line) : [];
    const ok = (text, index) => allowed(text) || (spans.length > 0 && inSpan(spans, index, text));
    for (const r of denylist) {
      r.re.lastIndex = 0;
      for (const m of line.matchAll(r.re)) if (m[0] && !ok(m[0], m.index)) push(r.id, m[0], m.index);
    }
    for (const g of GENERIC_RULES) {
      if (g.nonTestOnly && ctx.test) continue;
      if (g.textOnly && ctx.binary) continue;
      if (g.id === 'generic:email' && ctx.media) continue; // random compressed data produces e-mail lookalikes
      if (ctx.lockfile && g.id !== 'generic:email') continue;
      for (const f of g.find(line)) {
        // binary string runs (dex/so/arsc) produce e-mail lookalikes such as T@J.TAK.TBL: in binaries only real-looking,  // leak-guard:allow (example)
        // lower-case addresses count (private addresses are on the denylist, which still applies everywhere)
        if (g.id === 'generic:email' && ctx.binary && !BINARY_EMAIL_RE.test(f.text)) continue;
        if (!ok(f.text, f.index)) push(g.id, f.text, f.index);
      }
    }
  }

  /** @returns {{path:string,line:number|null,col:number|null,offset?:number,rule:string,text:string,count?:number}[]} */
  function scanContent(path, buf) {
    const findings = [];
    if (signature && isSignaturePath(path)) return findings;
    if (signature) buf = maskSignatures(buf).buf;
    // media containers: only metadata/text parts are content (docs/LEAK-GUARD.md); the compressed payload is random bytes
    const media = maskMediaPayload(path, buf);
    if (media) buf = media.buf;
    const ctx = { test: isTestPath(path), lockfile: LOCKFILE.test(path.split(sep).join('/')), media: MEDIA.test(path), binary: false };
    // path name itself
    scanLine(path.split(sep).join('/'), { ...ctx, test: false, binary: false, media: false }, (rule, text) =>
      findings.push({ path, line: null, col: null, rule, text, where: 'path' }),
    );
    // text stored compressed inside the container (PNG zTXt/iTXt), decoded
    for (const text of media?.extra ?? []) {
      text.toString('utf8').split(/\r?\n|\0/).forEach((line, i) =>
        scanLine(line, { ...ctx, binary: false, media: false }, (rule, found, idx) => findings.push({ path, line: i + 1, col: idx + 1, rule, text: found, where: 'media-text' })),
      );
    }
    if (buf.length > MAX_FILE_BYTES) {
      findings.push({ path, line: null, col: null, rule: 'scan-error', text: `file too large to scan (${buf.length} bytes)`, error: true });
      return findings;
    }
    if (!isBinary(buf)) {
      const lines = buf.toString('utf8').split('\n');
      lines.forEach((line, i) =>
        scanLine(line, ctx, (rule, text, idx) => findings.push({ path, line: i + 1, col: idx + 1, rule, text })),
      );
      return findings;
    }
    // Binary: scan printable ASCII/UTF-8 string runs (like `strings`), plus UTF-16LE runs.
    ctx.binary = true;
    const seen = new Map();
    const push = (variant) => (rule, text, idx) => {
      const key = `${rule}\u0000${text.toLowerCase()}`;
      const prev = seen.get(key);
      if (prev) prev.count++;
      else {
        const f = { path, line: null, col: null, offset: idx, rule, text, count: 1, variant };
        seen.set(key, f);
        findings.push(f);
      }
    };
    if (isHermesBytecode(buf)) {
      let decoded;
      try {
        decoded = hermesStrings(buf);
      } catch (e) {
        findings.push({ path, line: null, col: null, rule: 'scan-error', text: e.message, error: true });
        return findings;
      }
      stats.hermes.push({ path, version: decoded.version, strings: decoded.strings.length });
      // exact JS strings, no binary noise: the text rules apply as in a plain JS bundle
      const strCtx = { ...ctx, binary: false };
      for (const s of decoded.strings) scanLine(s.text, strCtx, (rule, text, idx) => push('hermes')(rule, text, s.offset + idx));
    }
    const latin1 = buf.toString('latin1');
    for (const m of latin1.matchAll(/[\x20-\x7e]{4,}/g)) {
      scanLine(m[0], ctx, (rule, text, idx) => push('latin1')(rule, text, m.index + idx));
    }
    // UTF-16LE strings (resources.arsc, compiled XML): ASCII char + NUL pairs, either alignment.
    if (buf.length <= MAX_UTF16_BYTES) for (const m of latin1.matchAll(/(?:[\x20-\x7e]\x00){4,}/g)) {
      scanLine(m[0].replace(/\x00/g, ''), ctx, (rule, text, idx) => push('utf16le')(rule, text, m.index + idx * 2));
    }
    // Non-ASCII names: UTF-8 runs (invalid bytes decode to U+FFFD and end a run) and UTF-16LE runs at both
    // alignments (letters limited to Latin, Greek and Cyrillic, so random bytes rarely form a run). Only matches that
    // contain a non-ASCII character count here; every ASCII match is the ASCII passes' business (incl. media noise).
    if (buf.length <= MAX_UTF16_BYTES) {
      const unicode = (run, variant, offset) => {
        if (!NON_ASCII.test(run)) return;
        scanLine(run, ctx, (rule, text, idx) => { if (NON_ASCII.test(text)) push(variant)(rule, text, offset(idx)); });
      };
      const utf8 = buf.toString('utf8');
      for (const m of utf8.matchAll(/[\x20-\x7e\u00a0-\ud7ff\ue000-\ufffc]{4,}/g)) {
        // a run re-encodes to exactly its source bytes (U+FFFD never inside a run): locate it only for a finding
        unicode(m[0], 'utf8', (idx) => buf.indexOf(Buffer.from(m[0])) + Buffer.byteLength(m[0].slice(0, idx)));
      }
      for (const align of [0, 1]) {
        const utf16 = buf.toString('utf16le', align, buf.length - ((buf.length - align) % 2));
        for (const m of utf16.matchAll(/[\x20-\x7e\u00a0-\u024f\u0370-\u04ff]{4,}/g)) unicode(m[0], 'utf16le', (idx) => align + (m.index + idx) * 2);
      }
    }
    return findings;
  }

  return { scanContent, stats };
}

export const mask = (s) => (s.length <= 3 ? '***' : `${s.slice(0, 2)}***[${s.length}]`);

// ---------------------------------------------------------------------------------------------------------
// CLI helpers
// ---------------------------------------------------------------------------------------------------------

const git = (args, cwd, opts = {}) => execFileSync('git', args, { cwd, maxBuffer: 1024 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], ...opts });

function privateDir(env = process.env) {
  if (env.HUI_PRIVATE_DIR) return env.HUI_PRIVATE_DIR;
  const guess = join(homedir(), 'work', 'hermesiui-private');
  return existsSync(guess) ? guess : '';
}

function loadList(file) {
  return readFileSync(file, 'utf8');
}

/**
 * Global allow regexes (matched against the found text): <root>/.leak-guard-allow + $HUI_PRIVATE_DIR/leak-allow.txt.
 * `span:REGEX` lines are searched in the whole line instead: any finding that lies completely inside such a match is
 * allowed (e.g. a deliberately published address whose parts are on the denylist), nothing outside it.
 * Throws on an unreadable file or an invalid regex (callers must not treat that as "nothing allowed = clean").
 */
export function loadAllowList(root, env = process.env) {
  const files = [join(root, '.leak-guard-allow')];
  const dir = privateDir(env);
  if (dir) files.push(join(dir, 'leak-allow.txt'));
  const out = [];
  for (const f of files) {
    if (!existsSync(f)) continue;
    try {
      for (const l of loadList(f).split(/\r?\n/)) {
        const t = l.trim();
        if (!t || t.startsWith('#')) continue;
        if (t.startsWith('span:')) out.push(Object.assign(new RegExp(t.slice(5), 'gi'), { span: true }));
        else out.push(new RegExp(t, 'i'));
      }
    } catch (e) {
      throw new Error(`bad allow file ${f}: ${e.message}`);
    }
  }
  return out;
}

function parseArgs(argv) {
  const a = { paths: [], mode: null };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    const need = () => {
      if (i + 1 >= argv.length) throw new Error(`${t} needs a value`);
      return argv[++i];
    };
    if (t === '--staged') a.mode = 'staged';
    else if (t === '--tree') a.mode = 'tree';
    else if (t === '--path') {
      a.mode = 'path';
      a.paths.push(need());
    } else if (t === '--ref') a.ref = need();
    else if (t === '--denylist') a.denylistFile = need();
    else if (t === '--show') a.show = true;
    else if (t === '--json') a.json = true;
    else if (t === '--quiet') a.quiet = true;
    else if (t === '--generic-only') a.genericOnly = true;
    else if (t === '--require-denylist') a.requireDenylist = true;
    else if (t === '--expect-hermes') a.expectHermes = true;
    else if (t === '-h' || t === '--help') a.help = true;
    else throw new Error(`unknown argument: ${t}`);
  }
  return a;
}

const USAGE = `usage: leak-guard.mjs (--staged | --tree [--ref REV] | --path DIR [--path DIR...])
       [--show] [--json] [--quiet] [--generic-only] [--require-denylist] [--denylist FILE] [--expect-hermes]
Private terms come from $HUI_PRIVATE_DIR/leak-denylist.txt (not in the repo). See docs/LEAK-GUARD.md.`;

// Compressed files (--path mode): the compressed bytes are noise in which a short denylist term can appear by chance,
// and they hide what really ships. Scan what they contain instead: .gz / .br decompressed, .zip entry by entry. A file
// that does not decompress is scanned raw, so nothing is skipped.
const MAX_INFLATE = 512 * 1024 * 1024;
const zipGlob = (name) => name.replace(/[\\[\]*?]/g, (c) => `\\${c}`); // unzip treats member names as patterns
export function fileEntries(full, rel) {
  const raw = { path: rel, read: () => readFileSync(full) };
  const inflate = (fn, tag) => ({
    path: `${rel}!${tag}`,
    read: () => { const buf = readFileSync(full); try { return fn(buf, { maxOutputLength: MAX_INFLATE }); } catch { return buf; } },
  });
  if (/\.gz$/i.test(full)) return [inflate(gunzipSync, 'gunzip')];
  if (/\.br$/i.test(full)) return [inflate(brotliDecompressSync, 'brotli')];
  if (/\.zip$/i.test(full)) {
    let names;
    try { names = execFileSync('unzip', ['-Z1', full], { maxBuffer: 64 * 1024 * 1024 }).toString('utf8').split('\n').filter((n) => n && !n.endsWith('/')); }
    catch { return [raw]; }
    return names.map((n) => ({ path: `${rel}!${n}`, read: () => execFileSync('unzip', ['-p', full, zipGlob(n)], { maxBuffer: MAX_INFLATE }) }));
  }
  return [raw];
}

/** Collect {path, read()} entries for the selected mode. Throws on environment errors. */
function collect(args) {
  const entries = [];
  const errors = [];
  if (args.mode === 'path') {
    const walk = (dir, root) => {
      for (const d of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, d.name);
        if (d.isSymbolicLink()) continue;
        if (d.isDirectory()) walk(full, root);
        else if (d.isFile()) entries.push(...fileEntries(full, relative(root, full) || d.name));
      }
    };
    for (const p of args.paths) {
      const root = resolve(p);
      if (!existsSync(root)) throw new Error(`--path ${p}: does not exist`);
      if (lstatSync(root).isDirectory()) walk(root, root);
      else entries.push(...fileEntries(root, p));
    }
    return { entries, errors, root: process.cwd() };
  }
  const top = git(['rev-parse', '--show-toplevel'], process.cwd()).toString().trim();
  if (args.mode === 'staged') {
    const raw = git(['diff', '--cached', '--raw', '-z', '--no-renames', '--diff-filter=ACMR'], top).toString('utf8').split('\0');
    for (let i = 0; i + 1 < raw.length; i += 2) {
      const meta = raw[i].split(' '); // :oldmode newmode oldsha newsha status
      const path = raw[i + 1];
      if (!meta[0]?.startsWith(':') || !path) continue;
      if (meta[1] === '160000') continue;
      const sha = meta[3];
      entries.push({ path, read: () => git(['cat-file', 'blob', sha], top) });
    }
  } else if (args.ref) {
    const raw = git(['ls-tree', '-r', '-z', args.ref], top).toString('utf8').split('\0').filter(Boolean);
    for (const rec of raw) {
      const tab = rec.indexOf('\t');
      const [mode, type, sha] = rec.slice(0, tab).split(' ');
      if (type !== 'blob' || mode === '160000') continue;
      entries.push({ path: rec.slice(tab + 1), read: () => git(['cat-file', 'blob', sha], top) });
    }
  } else {
    const names = git(['ls-files', '-z'], top).toString('utf8').split('\0').filter(Boolean);
    for (const name of names) {
      const full = join(top, name);
      let st;
      try {
        st = lstatSync(full);
      } catch {
        continue; // tracked but deleted in the working tree: nothing to leak
      }
      if (!st.isFile()) continue;
      // a file deleted since ls-files ran is not a leak: skip (null), but any other read error is reported
      entries.push({ path: name, read: () => { try { return readFileSync(full); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } } });
    }
  }
  return { entries, errors, root: top };
}

export async function main(argv, env = process.env) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    console.error(`leak-guard: ${e.message}\n${USAGE}`);
    return 2;
  }
  if (args.help || !args.mode) {
    console.error(USAGE);
    return args.help ? 0 : 2;
  }
  const warnings = [];

  // denylist
  let denylist = [];
  let denylistSource = null;
  if (!args.genericOnly) {
    const dir = privateDir(env);
    const file = args.denylistFile || (dir ? join(dir, 'leak-denylist.txt') : '');
    if (file && existsSync(file)) {
      try {
        denylist = parseDenylist(loadList(file));
        denylistSource = file;
      } catch (e) {
        console.error(`leak-guard: ${e.message}`);
        return 2;
      }
      if (!denylist.length) warnings.push(`denylist ${file} has no entries`);
    } else {
      warnings.push(`no denylist (${file || 'HUI_PRIVATE_DIR is not set'}): only the generic patterns are checked`);
    }
    if (args.requireDenylist && !denylist.length) {
      console.error(`leak-guard: ERROR: --require-denylist but ${warnings.at(-1)}`);
      return 2;
    }
  }

  // allow list (regexes against matched text)
  const allow = [];
  let collected;
  try {
    collected = collect(args);
  } catch (e) {
    console.error(`leak-guard: cannot list files: ${(e.stderr?.toString() || e.message).trim()}`);
    return 2;
  }
  try {
    allow.push(...loadAllowList(collected.root, env));
  } catch (e) {
    console.error(`leak-guard: ${e.message}`);
    return 2;
  }

  // --path = artifact scan (unpacked .ipa/.app/APK, dist/web): code-signature data is allowed (docs/LEAK-GUARD.md)
  const signature = args.mode === 'path';
  // artifact scans ignore inline `leak-guard:allow` markers (only allow files count there)
  const scanner = makeScanner({ denylist, allow, signature, inlineAllow: !signature });
  const sigFiles = signature ? collected.entries.filter((e) => isSignaturePath(e.path)).length : 0;
  const findings = [];
  const errors = [];
  for (const e of collected.entries) {
    let buf;
    try {
      buf = e.read();
    } catch (err) {
      errors.push(`${e.path}: cannot read (${(err.stderr?.toString() || err.message).trim()})`);
      continue;
    }
    if (buf === null) continue;
    findings.push(...scanner.scanContent(e.path, buf));
  }
  for (const f of findings) if (f.error) errors.push(`${f.path}: ${f.text}`);
  const hermes = scanner.stats.hermes;
  if (args.expectHermes) {
    // the JS bundle of a release build must have gone through the string-table decoder, not only the `strings` scan
    const bundles = collected.entries.filter((e) => /(^|\/)(index\.android\.bundle|main\.jsbundle)$/.test(e.path.split(sep).join('/')));
    if (!bundles.length) errors.push('--expect-hermes: no index.android.bundle / main.jsbundle found');
    for (const b of bundles) {
      if (!hermes.some((h) => h.path === b.path) && !findings.some((f) => f.error && f.path === b.path)) errors.push(`${b.path}: --expect-hermes: not Hermes bytecode`);
    }
  }
  const real = findings.filter((f) => !f.error);

  const label = args.mode === 'path' ? `--path ${args.paths.join(' ')}` : args.ref ? `--tree --ref ${args.ref}` : `--${args.mode}`;
  const files = new Set(real.map((f) => f.path));
  const byRule = {};
  for (const f of real) byRule[f.rule] = (byRule[f.rule] || 0) + 1;
  const shown = (f) => (args.show ? f.text : mask(f.text));

  if (args.json) {
    console.log(
      JSON.stringify(
        { mode: label, scanned: collected.entries.length, signatureFilesSkipped: sigFiles, hermes, denylist: denylistSource ? denylist.length : 0, warnings, errors, byRule, findings: real.map((f) => ({ ...f, text: shown(f) })) },
        null,
        2,
      ),
    );
  } else {
    for (const w of warnings) console.error(`leak-guard: WARNING: ${w}`);
    if (!args.quiet || real.length || errors.length) {
      console.error(`leak-guard ${label}: scanned ${collected.entries.length} file(s), ${denylist.length} denylist term(s)${args.genericOnly ? ' (generic only)' : ''}${sigFiles ? `, ${sigFiles} code-signature file(s) skipped` : ''}${hermes.length ? `, ${hermes.length} Hermes bytecode file(s) decoded (${hermes.reduce((n, h) => n + h.strings, 0)} strings)` : ''}`);
    }
    if (real.length) {
      console.error(`\nFOUND ${real.length} finding(s) in ${files.size} file(s)${args.show ? '' : ' (matches masked; use --show to reveal, or look at file:line)'}:`);
      const sorted = [...real].sort((a, b) => a.path.localeCompare(b.path) || (a.line ?? 0) - (b.line ?? 0));
      for (const f of sorted) {
        const loc = f.where === 'path' ? '(file name)' : f.line ? `${f.line}:${f.col}` : `byte~${f.offset}${f.variant && f.variant !== 'latin1' ? ` ${f.variant}` : ''}`;
        console.error(`  ${f.path}:${loc}  [${f.rule}]  ${shown(f)}${f.count > 1 ? `  x${f.count}` : ''}`);
      }
      console.error('\nBy rule:');
      for (const [r, n] of Object.entries(byRule).sort((a, b) => b[1] - a[1])) console.error(`  ${String(n).padStart(6)}  ${r}`);
      console.error(`\nFix: replace with placeholders (<host>.<tailnet>.ts.net, example.com, 192.0.2.x) and move the real value to $HUI_PRIVATE_DIR.\nFalse positive: add '${ALLOW_MARKER}' to the line or a regex to .leak-guard-allow.`);
    }
    for (const e of errors) console.error(`leak-guard: ERROR: ${e}`);
  }
  if (errors.length) return 2;
  return real.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(`leak-guard: unexpected error: ${e?.stack || e}`);
      process.exit(2);
    },
  );
}
