#!/usr/bin/env node
// Grep-based guard against JS APIs that the Hermes engine (React Native 0.86 → Hermes V1
// 250829098.0.x, Android + iOS) does not provide or provides differently. A hit in app code
// crashes ONLY on the device (Node, the web build and the unit tests all have these APIs), e.g.
// `new Intl.PluralRules()` → "TypeError: undefined cannot be used as a constructor."
//
// Sources checked (tag hermes-v250829098.0.17): doc/IntlAPIs.md, lib/VM/JSLib/{Intl,Array,Object,
// Map,IteratorPrototype,RegExp,GlobalObject}.cpp, lib/Platform/Intl/java/.../DateTimeFormat.java,
// lib/Regex/RegexParser.cpp (+ HERMES_ENABLE_UNICODE_REGEXP_PROPERTY_ESCAPES, default ON).
//
// NOT flagged (available on device):
// - Intl.NumberFormat / DateTimeFormat (incl. dateStyle/timeStyle/timeZone/hourCycle), Collator,
//   getCanonicalLocales, localeCompare, toLocale*String, String#normalize
// - Array#at/findLast/findLastIndex/flat/flatMap/includes/toReversed/toSpliced/with, Object.hasOwn/
//   fromEntries, String#replaceAll/at/matchAll/isWellFormed, Set#union/intersection/…,
//   Promise.allSettled/any/withResolvers/try, WeakRef, Error.captureStackTrace, TextEncoder
// - RegExp lookbehind, named groups, \p{…} property escapes in /…/u literals (compiled by hermesc at
//   build time, so an unsupported literal fails the build instead of the app)
// - polyfilled by Expo's winter runtime (expo/src/winter/runtime.native.ts): TextDecoder, URL,
//   URLSearchParams, structuredClone, AbortSignal.timeout/any, Symbol.asyncIterator, streaming fetch;
//   by React Native: queueMicrotask, setImmediate, AbortController, Blob, FileReader
//
// Escape hatch: put `hermes-compat-ok: <reason>` in a comment on the same or the previous line
// (only for feature-detected / try-guarded code with a fallback).
//
// Usage: node scripts/hermes-compat-check.mjs [--root <dir>] [--json]
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** @type {{ id: string; re: RegExp; msg: string }[]} */
export const RULES = [
  {
    id: 'intl-missing',
    re: /\bIntl\s*\.\s*(PluralRules|RelativeTimeFormat|ListFormat|Segmenter|DisplayNames|Locale|DurationFormat|supportedValuesOf)\b/,
    msg: 'Hermes has no Intl.$1 (only Collator/NumberFormat/DateTimeFormat) – feature-detect + fallback (see i18n/core.ts)',
  },
  { id: 'intl-range', re: /\.formatRange(ToParts)?\s*\(/, msg: 'Intl formatRange/formatRangeToParts is not implemented in Hermes' },
  { id: 'intl-parts', re: /\.formatToParts\s*\(/, msg: 'formatToParts is platform-dependent in Hermes (NumberFormat: Android only) – format manually' },
  {
    id: 'dtf-options',
    re: /\b(dayPeriod|fractionalSecondDigits|formatMatcher)\s*:/,
    msg: 'Intl.DateTimeFormat option "$1" is not supported by Hermes on Android',
  },
  {
    id: 'nf-options',
    re: /\b(compactDisplay|signDisplay|roundingMode|roundingPriority|roundingIncrement|trailingZeroDisplay)\s*:|\bnotation\s*:\s*['"](compact|engineering|scientific)['"]/,
    msg: 'Intl.NumberFormat option not supported by Hermes on iOS (and rough on Android 11) – format manually',
  },
  { id: 'array-tosorted', re: /\.toSorted\s*\(/, msg: 'Array/TypedArray#toSorted is missing in Hermes – use [...arr].sort()' },
  { id: 'group-by', re: /\b(Object|Map)\.groupBy\s*\(/, msg: '$1.groupBy is missing in Hermes – group with a loop' },
  { id: 'array-fromasync', re: /\bArray\.fromAsync\b/, msg: 'Array.fromAsync is missing in Hermes' },
  {
    id: 'iterator-helpers',
    re: /\bIterator\.from\b|\.(keys|values|entries)\(\)\s*\.(map|filter|take|drop|flatMap|reduce|toArray|forEach|some|every|find)\(/,
    msg: 'Iterator helpers are missing in Hermes – spread into an array first: [...m.values()].map(…)',
  },
  { id: 'newer-builtins', re: /\bRegExp\.escape\b|\bMath\.sumPrecise\b|\bTemporal\.|\bFinalizationRegistry\b|\bAtomics\.|\bSharedArrayBuffer\b/, msg: 'not available in Hermes' },
  { id: 'regexp-v-flag', re: /new RegExp\([^)]*,\s*['"`][a-z]*v[a-z]*['"`]\s*\)/, msg: 'RegExp "v" (unicodeSets) flag is not supported by Hermes' },
  {
    id: 'regexp-runtime-property',
    re: /new RegExp\(.*\\\\[pP]\{/,
    msg: 'runtime RegExp with \\p{…}: Hermes supports only some property names – wrap in try/catch with a fallback and mark hermes-compat-ok',
  },
  {
    id: 'global-crypto',
    re: /(?<![\w.])crypto\.(randomUUID|getRandomValues|subtle)\b|globalThis\.crypto\.(randomUUID|getRandomValues|subtle)\b/,
    msg: 'no WebCrypto global in React Native/Hermes – use expo-crypto (Crypto.randomUUID / getRandomBytes) or feature-detect',
  },
  { id: 'web-streams', re: /new (ReadableStream|WritableStream|TransformStream|CompressionStream|DecompressionStream|TextDecoderStream)\b/, msg: 'web stream constructors are not globals on Hermes/RN' },
  { id: 'web-only-globals', re: /new (EventSource|Worker|SharedWorker|BroadcastChannel|MessageChannel|DOMParser|IntersectionObserver)\b/, msg: 'browser-only global, not available in React Native' },
];

/** Code that runs in a WebView/browser or is prompt text, never in Hermes. */
export const EXEMPT = [
  /(^|\/)sandbox\/shell\.ts$/,
  /(^|\/)sandbox\/idiomorph\.ts$/,
  /(^|\/)sandbox\/sandboxSamples\.ts$/,
  /(^|\/)onboarding\/demo\/html\.ts$/,
  /(^|\/)ui\/components\/modules\/b\/mapTemplate\.ts$/,
  /(^|\/)claude\/systemPrompt\.ts$/,
  /(^|\/)compat\/runtimeProbe\.ts$/, // probes these APIs on purpose (try/catch)
  /\.web\.tsx?$/,
  /\.test\.tsx?$/,
  /(^|\/)testkit\.ts$/,
  /(^|\/)__tests__\//,
];

const MARKER = 'hermes-compat-ok';

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name) && !name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

function isCommentLine(line) {
  const s = line.trimStart();
  return s.startsWith('//') || s.startsWith('*') || s.startsWith('/*');
}

/** Scan one file's text; returns findings (line numbers 1-based). */
export function scanText(text, file = '<text>') {
  const lines = text.split('\n');
  const found = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isCommentLine(line)) continue;
    if (line.includes(MARKER) || (i > 0 && lines[i - 1].includes(MARKER))) continue;
    for (const r of RULES) {
      const m = r.re.exec(line);
      if (!m) continue;
      found.push({ file, line: i + 1, rule: r.id, msg: r.msg.replace(/\$(\d)/g, (_, d) => m[Number(d)] ?? ''), text: line.trim().slice(0, 160) });
    }
  }
  return found;
}

export function scanDir(root) {
  const findings = [];
  for (const f of walk(root)) {
    const rel = relative(root, f).split('\\').join('/');
    if (EXEMPT.some((re) => re.test(rel))) continue;
    findings.push(...scanText(readFileSync(f, 'utf8'), rel));
  }
  return findings;
}

function main(argv) {
  const i = argv.indexOf('--root');
  const root = resolve(i >= 0 ? argv[i + 1] : join(here, '..', 'src'));
  const findings = scanDir(root);
  if (argv.includes('--json')) {
    process.stdout.write(JSON.stringify(findings, null, 2) + '\n');
  } else if (findings.length) {
    for (const f of findings) console.error(`${f.file}:${f.line}  [${f.rule}] ${f.msg}\n    ${f.text}`);
    console.error(`\nhermes-compat: ${findings.length} finding(s). Fix, or mark a guarded line with "// ${MARKER}: <reason>".`);
  } else {
    console.log(`hermes-compat: ok (${root})`);
  }
  return findings.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
