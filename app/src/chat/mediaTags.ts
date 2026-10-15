/**
 * `MEDIA:<server path>` tags in Hermes answers. Hermes' agent announces generated files with a `MEDIA:` tag
 * (agent prompt convention; gateway/platforms/base.py `MEDIA_TAG_CLEANUP_RE`). Streamed chat completions pass the raw
 * tag through, so the app turns it into a file chip instead of showing the server path.
 *
 * Detection mirrors the server's rules: the path must be absolute (`/…`, `~/…`, `C:\…`) and end in a deliverable
 * extension; fenced code, blockquotes and inline code are masked (examples are not tags), except an inline code span
 * that is exactly one `MEDIA:` tag (models format paths that way). Pure (node:test, mediaTags.test.ts).
 */
import { bridgeOrigin } from '../attachments/uploadCore.ts';
import { extendsText, type AppendRun } from '../protocol/appendRun.ts';

export type MediaKind = 'image' | 'pdf' | 'audio' | 'video' | 'doc' | 'sheet' | 'slides' | 'archive' | 'text' | 'file';

export type MediaRef = {
  /** the path exactly as Hermes wrote it (server side) */
  path: string;
  /** file name (last path segment) */
  name: string;
  ext: string;
  kind: MediaKind;
  /** raster image the app can show inline */
  inlineImage: boolean;
};

const EXT_KIND: Record<string, MediaKind> = {};
const add = (kind: MediaKind, exts: string) => exts.split(' ').forEach((e) => (EXT_KIND[e] = kind));
add('image', 'png jpg jpeg gif webp bmp tiff svg');
add('video', 'mp4 mov avi mkv webm 3gp');
add('audio', 'mp3 m2a wav ogg opus m4a flac');
add('pdf', 'pdf');
add('doc', 'docx doc odt rtf epub');
add('sheet', 'xlsx xls ods csv tsv');
add('slides', 'pptx ppt odp key');
add('archive', 'zip tar gz tgz bz2 xz 7z rar apk ipa');
add('text', 'txt md json xml yaml yml html htm kml kmz geojson gpx');

const INLINE_IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']);
const EXT_ALT = Object.keys(EXT_KIND).sort((a, b) => b.length - a.length).join('|');
const CJK_END = '（）〈〉《》：，。；！？、“”‘’【】';

// Same structure as MEDIA_TAG_CLEANUP_RE: optional emphasis/quote markers, `MEDIA:`, a quoted or bare absolute path
// ending in a deliverable extension (bare paths may contain spaces), then a boundary.
/** global (`gi`): callers reset `lastIndex` (exported for the equivalence tests) */
export const TAG_RE = new RegExp(
  '[`"\'*_]{0,3}MEDIA:\\s*' +
    '(`[^`\\n]+?`|"[^"\\n]+?"|\'[^\'\\n]+?\'|' +
    '(?:~/|/|[A-Za-z]:[/\\\\])\\S+?(?:[^\\S\\n]+\\S+?)*?\\.(?:' +
    EXT_ALT +
    '))' +
    '(?=[\\s`"\'*_,;:)\\]}\\[' +
    CJK_END +
    ']|MEDIA:|\\.(?:\\s|$)|$)[`"\'*_]{0,3}\\.?',
  'gi',
);

/** Voice marker Hermes puts next to a MEDIA tag; never meant to be read. */
const VOICE_MARKER_RE = /\[\[audio_as_voice\]\]\s*/gi;

/**
 * `s` with the ranges `[from, to)` blanked (every char but `\n` → space), built in ONE pass: blanking range by range
 * copied the whole text per code span / quote line (O(text × spans), megabytes per streaming update of a long answer).
 * Ranges may overlap and come in any order.
 */
function blankRanges(s: string, ranges: [number, number][]): string {
  if (!ranges.length) return s;
  ranges.sort((a, b) => a[0] - b[0]);
  const parts: string[] = [];
  let pos = 0;
  for (const [from, to] of ranges) {
    const a = Math.max(from, pos);
    if (to <= a) continue;
    parts.push(s.slice(pos, a), s.slice(a, to).replace(/[^\n]/g, ' '));
    pos = to;
  }
  parts.push(s.slice(pos));
  return parts.join('');
}

/**
 * `text` with fenced code and blockquotes blanked, and where a fence that is still open at the end of the text starts
 * (-1: none).
 */
function maskBlocks(text: string): [string, number] {
  const ranges: [number, number][] = [];
  let openAt = -1;
  // fenced code, closed or still open (streaming)
  const fence = /^[ \t]{0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n[ \t]{0,3}\1[ \t]*(?=\n|$)|(?![\s\S]))/gm;
  for (const m of text.matchAll(fence)) {
    const from = m.index ?? 0;
    ranges.push([from, from + m[0].length]);
    // a closed fence ends before the newline after its closing line; only an open one runs to the end
    if (from + m[0].length === text.length) openAt = from;
  }
  // blockquotes
  for (const m of text.matchAll(/^[ \t]{0,3}>.*$/gm)) ranges.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);
  return [blankRanges(text, ranges), openAt];
}

/** `out` (fences and quotes blanked) with inline code blanked too, except code spans that are a tag or its path. */
function maskInline(out: string): string {
  const inline = /(`+)([^`\n]|[^`\n][^\n]*?[^`\n])\1(?!`)/g;
  const spans: [number, number][] = [];
  for (const m of out.matchAll(inline)) {
    const start = m.index ?? 0;
    // checked on the text before blanking earlier spans: those end with a backtick, so blanking one never changes this
    if (/MEDIA:\s*$/i.test(out.slice(Math.max(0, start - 20), start))) continue; // quoted path of a tag
    if (/^\s*MEDIA:/i.test(m[2])) continue; // the whole tag inside code
    spans.push([start, start + m[0].length]);
  }
  return blankRanges(out, spans);
}

/** Length-preserving copy of `text` with fenced code, inline code (except whole tags) and blockquotes blanked. */
export function maskProtected(text: string): string {
  return maskInline(maskBlocks(text)[0]);
}

/** `media:` at `i - 5 … i` (ASCII case-insensitive; `| 32` lower-cases ASCII letters and maps nothing else onto them) */
function markerEndsAt(text: string, i: number): boolean {
  return (
    (text.charCodeAt(i - 1) | 32) === 97 && // a
    (text.charCodeAt(i - 2) | 32) === 105 && // i
    (text.charCodeAt(i - 3) | 32) === 100 && // d
    (text.charCodeAt(i - 4) | 32) === 101 && // e
    (text.charCodeAt(i - 5) | 32) === 109 // m
  );
}

/** the last text `hasMediaMarker` found no marker in: a streaming answer only grows, its prefix needs no rescan */
let markerFree = '';

/**
 * Case-insensitive `media:` anywhere in `text` (same result as `/media:/i.test(text)`). Runs on every streaming
 * update of the whole answer, so: native `indexOf(':')` + a 5-char check per colon instead of the regex (which
 * Hermes' interpreter steps through char by char), and only the part after the last marker-free text it extends.
 */
export function hasMediaMarker(text: string): boolean {
  // a marker needs its colon past the old end (the 5 chars before a colon inside the old text are all old text)
  const from = markerFree && text.length >= markerFree.length && text.startsWith(markerFree) ? markerFree.length : 0;
  if (firstMediaMarker(text, from) !== -1) return true;
  markerFree = text;
  return false;
}

/** index of the first `media:` (ASCII case-insensitive) whose colon is at `colonFrom` or later, -1 if none */
function firstMediaMarker(text: string, colonFrom = 0): number {
  for (let i = text.indexOf(':', Math.max(5, colonFrom)); i !== -1; i = text.indexOf(':', i + 1)) if (markerEndsAt(text, i)) return i - 5;
  return -1;
}

function stripQuotes(p: string): string {
  const t = p.trim();
  return /^(`[^`]+`|"[^"]+"|'[^']+')$/.test(t) ? t.slice(1, -1).trim() : t;
}

/** Description of the file behind a server path (name, type), or null when it has no deliverable extension. */
export function mediaRefOf(rawPath: string): MediaRef | null {
  const path = stripQuotes(rawPath);
  const name = path.split(/[\\/]/).pop() ?? '';
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  if (!name || !EXT_KIND[ext]) return null;
  return { path, name, ext, kind: EXT_KIND[ext], inlineImage: INLINE_IMAGE_EXT.has(ext) };
}

export type MediaExtract = {
  refs: MediaRef[];
  /** the answer without the tags (and without lines that only held a tag) */
  text: string;
};

type TagScan = {
  refs: MediaRef[];
  /** number of cut ranges (tags, plus an unfinished tag at the end while streaming) */
  cuts: number;
  /** `text` with the tags (and lines that only held a tag) cut out, before `cleanUp` */
  raw: string;
  /** the last cut runs to the end of the text */
  toEnd: boolean;
};

/** Tags of `text` (`masked`: `maskProtected(text)`) and the text without them. */
function scanTags(text: string, masked: string, streaming: boolean): TagScan {
  const refs: MediaRef[] = [];
  const cuts: [number, number][] = [];
  // a tag starts at most 3 chars (quotes / emphasis) before its `MEDIA:`, so nothing before the first marker can match:
  // the (case-insensitive, slow in Hermes) tag regex scans from there instead of from the start of a long answer
  // (exec runs until null, which resets the shared regex's lastIndex to 0)
  TAG_RE.lastIndex = Math.max(0, firstMediaMarker(text) - 3);
  for (let m = TAG_RE.exec(masked); m; m = TAG_RE.exec(masked)) {
    const ref = mediaRefOf(m[1]);
    if (!ref) continue;
    const from = m.index;
    cuts.push([from, from + m[0].length]);
    if (!refs.some((r) => r.path === ref.path)) refs.push(ref);
  }
  if (streaming) {
    // an unfinished tag runs to the end, i.e. sits in the last line (the char before it may be that line's `\n`)
    const lineStart = masked.lastIndexOf('\n') + 1;
    const tail = /(?:^|[\s`"'*_(])(MEDIA:[^\n]*)$/i.exec(masked.slice(lineStart));
    if (tail) {
      const from = lineStart + tail.index + tail[0].length - tail[1].length;
      if (!cuts.some(([a, b]) => from >= a && from < b)) cuts.push([from, text.length]);
    }
  }
  if (!cuts.length) return { refs, cuts: 0, raw: text, toEnd: false };
  cuts.sort((x, y) => x[0] - y[0]);
  let out = '';
  let pos = 0;
  let toEnd = false;
  for (let [a, b] of cuts) {
    if (a < pos) continue;
    const lineStart = text.lastIndexOf('\n', a - 1) + 1;
    const rest = /^[ \t]*(\n|$)/.exec(text.slice(b));
    if (rest && text.slice(lineStart, a).trim() === '') {
      a = lineStart; // the tag was alone on its line: the line goes
      b += rest[0].length;
    } else if (text[a - 1] === ' ' && text[b] === ' ') {
      b++; // inline tag between two spaces
    }
    out += text.slice(pos, a);
    pos = b;
    toEnd = b >= text.length;
  }
  out += text.slice(pos);
  return { refs, cuts: cuts.length, raw: out, toEnd };
}

/** The line-local cleanup after cutting: voice markers (when there are tags), trailing blanks, blank-line runs. */
function cleanUp(raw: string, voice: boolean): string {
  const out = voice ? raw.replace(VOICE_MARKER_RE, '') : raw;
  // a line that only held a tag leaves whitespace / a blank-line run behind
  return out.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n');
}

/**
 * Find the MEDIA tags of an answer. With `streaming`, a tag that is still being written at the end of the text
 * (`MEDIA:/tmp/ab…`) is hidden until it is complete, so the raw path never flashes.
 */
export function extractMedia(text: string, streaming = false): MediaExtract {
  if (!hasMediaMarker(text)) return { refs: [], text };
  const scan = scanTags(text, maskProtected(text), streaming);
  if (!scan.cuts) return { refs: scan.refs, text };
  const out = cleanUp(scan.toEnd && streaming ? scan.raw.trimEnd() : scan.raw, scan.refs.length > 0);
  return { refs: scan.refs, text: out.trim() === '' ? '' : out.replace(/^\n+/, '') };
}

// ---------------------------------------------------------------- streaming: only the tail is scanned again

/** cleaned frozen text (leading newlines dropped), its trailing newline count and whether it has non-blank chars */
type CleanPart = { s: string; trail: number; content: boolean };

/**
 * Per-message memo of `extractMediaCached`: the result for the text up to `end` (a line start) is frozen, every
 * update scans only the rest. Valid while the text extends `src`; anything else (a replaced answer) starts over.
 */
export type MediaTagCache = {
  src: string;
  end: number;
  /** a `media:` marker in the frozen part */
  marker: boolean;
  refs: MediaRef[];
  cuts: number;
  /** the frozen part cleaned without / with the voice markers removed (they go only when the answer has tags) */
  plain: CleanPart;
  voice: CleanPart;
  /** line start a freeze attempt failed at (retried only once a further line is complete) */
  tried: number;
  /** append run of the last text (protocol/appendRun.ts): the same run again → it extends `src` */
  run?: AppendRun;
};

export function createMediaTagCache(): MediaTagCache {
  return { src: '', end: 0, marker: false, refs: [], cuts: 0, plain: EMPTY_PART, voice: EMPTY_PART, tried: 0, run: undefined };
}

const EMPTY_PART: CleanPart = { s: '', trail: 0, content: false };
const NON_BLANK_RE = /\S/;
const VOICE_TAG = '[[audio_as_voice]]';

function leadingNewlines(s: string): number {
  let n = 0;
  while (n < s.length && s.charCodeAt(n) === 10) n++;
  return n;
}

function trailingNewlines(s: string): number {
  let n = 0;
  while (n < s.length && s.charCodeAt(s.length - 1 - n) === 10) n++;
  return n;
}

/**
 * `part` followed by the cleaned `next`, as if both had been cleaned as one text: a newline run across the seam
 * collapses to two (the cleanup's `\n{3,}` → `\n\n` is `min(run, 2)`, so cleaning the halves first is the same),
 * and leading newlines of the whole text go.
 */
function joinClean(part: CleanPart, next: string): string {
  if (part.s === '') return next.replace(/^\n+/, '');
  return next.slice(Math.max(0, part.trail + leadingNewlines(next) - 2));
}

function appendClean(part: CleanPart, next: string): CleanPart {
  const add = joinClean(part, next);
  if (!add) return part;
  const s = part.s + add;
  const trail = leadingNewlines(add) === add.length ? part.trail + add.length : trailingNewlines(add);
  return { s, trail, content: part.content || NON_BLANK_RE.test(add) };
}

/** the last non-blank chars of `masked` are a `media:` marker (a tag's path may still follow on a later line) */
function endsWithMarker(masked: string): boolean {
  let i = masked.length - 1;
  while (i >= 0 && NON_BLANK_RE.test(masked[i]) === false) i--;
  return i >= 5 && masked.charCodeAt(i) === 58 && markerEndsAt(masked, i);
}

type Frozen = { len: number; marker: boolean; refs: MediaRef[]; cuts: number; plain: string; voice: string };

/**
 * Scan `chunk` (complete lines, the text before it already frozen) on its own. Returns what it froze – all of it, or
 * the lines before a code fence that is still open – or null when its end is no safe cut: inside an open fence, after
 * a `media:` whose path may still follow (`MEDIA:\s*` spans lines), or after a voice marker whose trailing
 * whitespace the cleanup would eat across the cut. Fences and quotes are line based, inline code and tags never
 * span a line otherwise, so a scan from a safe cut finds exactly what a scan of the whole text finds there.
 */
function freezeChunk(chunk: string): Frozen | null {
  const [blocks, openAt] = maskBlocks(chunk);
  if (openAt !== -1) {
    const lineStart = chunk.lastIndexOf('\n', openAt - 1) + 1;
    return lineStart > 0 ? freezeChunk(chunk.slice(0, lineStart)) : null;
  }
  const marker = firstMediaMarker(chunk) !== -1;
  let scan: TagScan = { refs: [], cuts: 0, raw: chunk, toEnd: false };
  if (marker) {
    const masked = maskInline(blocks);
    // `blocks`: the inline-code check looks back across the cut on the text before inline code is blanked
    if (endsWithMarker(blocks) || endsWithMarker(masked)) return null;
    scan = scanTags(chunk, masked, false);
  }
  if (scan.raw.trimEnd().slice(-VOICE_TAG.length).toLowerCase() === VOICE_TAG) return null;
  return { len: chunk.length, marker, refs: scan.refs, cuts: scan.cuts, plain: cleanUp(scan.raw, false), voice: cleanUp(scan.raw, true) };
}

function mergeRefs(a: MediaRef[], b: MediaRef[]): MediaRef[] {
  if (!b.length) return a;
  const out = a.slice();
  for (const r of b) if (!out.some((x) => x.path === r.path)) out.push(r);
  return out;
}

/**
 * `extractMedia(text, streaming)` for an answer that grows between calls (same result, tested over many split
 * points): complete lines are scanned once and frozen in `cache`, each call scans only the tail from the last safe
 * line start. Without it a long answer with one tag was masked, regex-scanned and copied in full on every update.
 */
export function extractMediaCached(text: string, streaming: boolean, cache: MediaTagCache, run?: AppendRun): MediaExtract {
  if (!extendsText(cache.src, text, cache.run, run)) Object.assign(cache, createMediaTagCache());
  cache.run = run;
  // freeze up to the start of the last line (it may be the line being written, even when it already ends in `\n`)
  const lineStart = text.lastIndexOf('\n', text.length - 2) + 1;
  if (lineStart > cache.end && lineStart !== cache.tried) {
    const f = freezeChunk(text.slice(cache.end, lineStart));
    if (f) {
      cache.end += f.len;
      cache.src = text.slice(0, cache.end);
      cache.marker ||= f.marker;
      cache.refs = mergeRefs(cache.refs, f.refs);
      cache.cuts += f.cuts;
      cache.plain = appendClean(cache.plain, f.plain);
      cache.voice = appendClean(cache.voice, f.voice);
    }
    if (cache.end < lineStart) cache.tried = lineStart;
  }
  const tail = cache.end ? text.slice(cache.end) : text;
  const tailMarker = firstMediaMarker(tail) !== -1;
  if (!cache.marker && !tailMarker) return { refs: [], text };
  const scan: TagScan = tailMarker ? scanTags(tail, maskProtected(tail), streaming) : { refs: [], cuts: 0, raw: tail, toEnd: false };
  if (!cache.cuts && !scan.cuts) return { refs: [], text };
  const trimEnd = scan.toEnd && streaming;
  // the trim would reach into the frozen part (a tag alone on the last line): rare and short, the full scan does it
  if (trimEnd && !NON_BLANK_RE.test(scan.raw)) return extractMedia(text, streaming);
  const refs = mergeRefs(cache.refs, scan.refs);
  const voice = refs.length > 0;
  const part = voice ? cache.voice : cache.plain;
  const rest = joinClean(part, cleanUp(trimEnd ? scan.raw.trimEnd() : scan.raw, voice));
  const out = part.s + rest;
  return { refs, text: part.content || NON_BLANK_RE.test(rest) ? out : out.trim() === '' ? '' : out };
}

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml',
  pdf: 'application/pdf', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', opus: 'audio/ogg', m4a: 'audio/mp4', flac: 'audio/flac',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json',
  html: 'text/html', zip: 'application/zip',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

/** MIME type hint for the system share / open sheet. */
export function mediaMime(ref: Pick<MediaRef, 'ext'>): string {
  return MIME[ref.ext] ?? 'application/octet-stream';
}

/** Where the bridge serves a Hermes media file (`GET /bridge/media?path=`, bridge/src/media.mjs). */
export function mediaUrl(baseUrl: string, path: string): string {
  return `${bridgeOrigin(baseUrl)}/bridge/media?path=${encodeURIComponent(path)}`;
}
