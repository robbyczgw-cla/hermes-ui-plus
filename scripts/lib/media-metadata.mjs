// Media containers (mp4/mov/m4a, webm, mp3, png, jpeg, webp): find the compressed payload so the leak scanners can
// ignore it. Random bytes of an H.264/AAC/VP9/MP3/PNG/JPEG stream contain every short printable word sooner or later (a
// four-letter denylist term matched inside a video twice in one day); only the metadata and text parts of a media file can
// carry a name: ffprobe tags (MP4 udta/meta/ilst, XMP uuid boxes, Matroska Info/Tags), ID3/APE tags, EXIF/XMP/comment
// segments, PNG text chunks (zTXt/iTXt are inflated). The file NAME is always scanned by the caller.
//
// mediaPayload(path, buf) -> { exclude: [start, end)[], extra: Buffer[] } | null
//   exclude  byte ranges that are payload (the caller zeroes them, so offsets of findings stay valid)
//   extra    decoded metadata that is stored compressed (PNG zTXt/iTXt), scanned as additional content
//   null     not a media file by extension, or the container could not be PROVEN well-formed: the caller scans every
//            byte as before. An extension alone never switches filtering on, and a truncated, malformed or unknown
//            track layout (subtitle/text tracks keep their text in the payload) falls back to the full scan.
import { inflateSync } from 'node:zlib';

const EXT = (path) => /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase();
const MP4_VIDEO_CODECS = new Set(['avc1', 'avc3', 'hvc1', 'hev1', 'av01', 'vp08', 'vp09', 'mp4v']);
const MP4_AUDIO_CODECS = new Set(['mp4a', 'ac-3', 'ec-3', 'Opus']);

/** Bounded ISO BMFF boxes; malformed/truncated containers return null. */
function mp4Boxes(buf, start = 0, end = buf.length) {
  const boxes = [];
  for (let p = start; p < end;) {
    if (p + 8 > end) return null;
    let size = buf.readUInt32BE(p), header = 8;
    if (size === 1) {
      if (p + 16 > end) return null;
      const wide = buf.readBigUInt64BE(p + 8);
      if (wide > BigInt(Number.MAX_SAFE_INTEGER)) return null;
      size = Number(wide);
      header = 16;
    } else if (size === 0) size = end - p;
    if (size < header || size > end - p) return null;
    boxes.push({ type: buf.toString('latin1', p + 4, p + 8), start: p, data: p + header, end: p + size });
    p += size;
  }
  return boxes;
}

/**
 * Payload of an MP4/MOV/M4A whose tracks are ALL proven compressed audio/video: mdat, fragment boxes and every track's
 * sample tables (stbl: binary offset/size tables). Text/subtitle, unknown and malformed tracks return null (full scan).
 */
function mp4Payload(buf) {
  const top = mp4Boxes(buf);
  if (!top?.some((b) => b.type === 'ftyp' && b.end - b.data >= 8)) return null;
  const movies = top.filter((b) => b.type === 'moov');
  if (movies.length !== 1) return null;
  const children = (b) => b && mp4Boxes(buf, b.data, b.end);
  const only = (boxes, type) => {
    const matches = boxes?.filter((b) => b.type === type);
    return matches?.length === 1 ? matches[0] : null;
  };
  const tracks = children(movies[0])?.filter((b) => b.type === 'trak');
  if (!tracks?.length) return null;
  const exclude = top.filter((b) => ['mdat', 'moof', 'sidx', 'mfra'].includes(b.type)).map((b) => [b.data, b.end]);
  for (const track of tracks) {
    const media = children(only(children(track), 'mdia'));
    const handlerBox = only(media, 'hdlr');
    if (!handlerBox || handlerBox.data + 12 > handlerBox.end) return null;
    const handler = buf.toString('ascii', handlerBox.data + 8, handlerBox.data + 12);
    if (handler !== 'vide' && handler !== 'soun') return null;
    const stbl = only(children(only(media, 'minf')), 'stbl');
    const table = children(stbl);
    const descriptions = only(table, 'stsd');
    if (!descriptions || descriptions.data + 8 > descriptions.end) return null;
    if (buf.readUInt32BE(descriptions.data) !== 0) return null; // unsupported version/flags
    const count = buf.readUInt32BE(descriptions.data + 4);
    const entries = mp4Boxes(buf, descriptions.data + 8, descriptions.end);
    if (!count || entries?.length !== count) return null;
    const codecs = handler === 'vide' ? MP4_VIDEO_CODECS : MP4_AUDIO_CODECS;
    if (entries.some((e) => !codecs.has(e.type) || e.end - e.data < (handler === 'vide' ? 78 : 28))) return null;
    exclude.push([stbl.data, stbl.end]);
  }
  return { exclude, extra: [] };
}

// ── Matroska / WebM (EBML) ───────────────────────────────────────────────────────────────────────────────────────
const MKV = { ebml: 0x1a45dfa3, segment: 0x18538067, cluster: 0x1f43b675, cues: 0x1c53bb6b, void: 0xec };

/** @returns {{id:number, data:number, end:number, unknown:boolean, start:number}|null} */
function ebmlElement(buf, p, limit) {
  if (p >= limit) return null;
  const first = buf[p];
  let idLen = 1;
  while (idLen <= 4 && !(first & (0x80 >> (idLen - 1)))) idLen++;
  if (idLen > 4 || p + idLen >= limit) return null;
  let id = 0;
  for (let i = 0; i < idLen; i++) id = id * 256 + buf[p + i];
  const s0 = buf[p + idLen];
  let sLen = 1;
  while (sLen <= 8 && !(s0 & (0x80 >> (sLen - 1)))) sLen++;
  if (sLen > 8 || p + idLen + sLen > limit) return null;
  let size = s0 & (0xff >> sLen), allOnes = size === (0xff >> sLen);
  for (let i = 1; i < sLen; i++) { const b = buf[p + idLen + i]; size = size * 256 + b; if (b !== 0xff) allOnes = false; }
  const data = p + idLen + sLen;
  if (allOnes) return { id, start: p, data, end: limit, unknown: true };
  if (size > limit - data) return null;
  return { id, start: p, data, end: data + size, unknown: false };
}

function mkvPayload(buf) {
  const head = ebmlElement(buf, 0, buf.length);
  if (head?.id !== MKV.ebml || head.unknown) return null;
  const exclude = [];
  let segments = 0;
  for (let p = head.end; p < buf.length;) {
    const seg = ebmlElement(buf, p, buf.length);
    if (!seg) return null;
    if (seg.id === MKV.segment) {
      segments++;
      for (let q = seg.data; q < seg.end;) {
        const el = ebmlElement(buf, q, seg.end);
        if (!el) return null;
        if (el.id === MKV.cluster) {
          if (el.unknown) return null; // live streams: the cluster end is not known without decoding it
          exclude.push([el.data, el.end]);
        } else if (el.id === MKV.cues || el.id === MKV.void) exclude.push([el.data, el.end]);
        else if (el.unknown) return null;
        q = el.end;
      }
    }
    p = seg.end;
  }
  return segments === 1 ? { exclude, extra: [] } : null;
}

// ── MP3 ──────────────────────────────────────────────────────────────────────────────────────────────────────────
function mp3Payload(buf) {
  const id3 = buf.length >= 10 && buf.toString('latin1', 0, 3) === 'ID3';
  const sync = buf.length >= 4 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0;
  if (!id3 && !sync) return null;
  let start = 0;
  if (id3) {
    if ([6, 7, 8, 9].some((i) => buf[i] & 0x80)) return null;
    start = 10 + ((buf[6] << 21) | (buf[7] << 14) | (buf[8] << 7) | buf[9]) + (buf[5] & 0x10 ? 10 : 0);
    if (start > buf.length) return null;
  }
  const tail = Math.max(start, buf.length - 2048); // ID3v1, APEv2, Lyrics3 trailers
  return { exclude: [[start, tail]], extra: [] };
}

// ── PNG ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const PNG_BINARY = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'fdAT', 'fcTL', 'acTL', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'sBIT', 'bKGD', 'hIST',
  'pHYs', 'sPLT', 'tIME', 'iCCP', 'cICP', 'mDCV', 'cLLI']);
function pngPayload(buf) {
  if (buf.length < 8 || buf.compare(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 0, 8, 0, 8) !== 0) return null;
  const exclude = [], extra = [];
  const inflate = (b) => { try { return inflateSync(b, { maxOutputLength: 4 * 1024 * 1024 }); } catch { return null; } };
  let sawEnd = false;
  for (let p = 8; p < buf.length;) {
    if (p + 12 > buf.length) return null;
    const len = buf.readUInt32BE(p);
    const type = buf.toString('latin1', p + 4, p + 8);
    const data = p + 8, end = data + len;
    if (end + 4 > buf.length) return null;
    if (PNG_BINARY.has(type)) exclude.push([data, end]);
    else if (type === 'zTXt') { // keyword\0 method compressed-text
      const nul = buf.indexOf(0, data);
      if (nul < 0 || nul >= end) return null;
      const text = inflate(buf.subarray(nul + 2, end));
      if (!text) return null; // undecodable text chunk: do not guess, scan everything
      extra.push(text);
    } else if (type === 'iTXt') { // keyword\0 flag method lang\0 translated\0 text
      const nul = buf.indexOf(0, data);
      if (nul < 0 || nul + 3 > end) return null;
      if (buf[nul + 1] === 1) {
        let q = buf.indexOf(0, nul + 3);
        if (q < 0 || q >= end) return null;
        q = buf.indexOf(0, q + 1);
        if (q < 0 || q >= end) return null;
        const text = inflate(buf.subarray(q + 1, end));
        if (!text) return null;
        extra.push(text);
      }
    }
    if (type === 'IEND') sawEnd = true;
    p = end + 4;
  }
  return sawEnd ? { exclude, extra } : null;
}

// ── JPEG ─────────────────────────────────────────────────────────────────────────────────────────────────────────
function jpegPayload(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  const exclude = [];
  let p = 2, ended = false;
  while (p + 2 <= buf.length) {
    if (buf[p] !== 0xff) return null;
    const m = buf[p + 1];
    if (m === 0xff) { p++; continue; } // fill byte
    if (m === 0xd9) { ended = true; break; }
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd8)) { p += 2; continue; }
    if (p + 4 > buf.length) return null;
    const len = buf.readUInt16BE(p + 2);
    if (len < 2 || p + 2 + len > buf.length) return null;
    const seg = [p + 4, p + 2 + len];
    const isIcc = m === 0xe2 && buf.toString('latin1', seg[0], seg[0] + 11) === 'ICC_PROFILE';
    if (!((m >= 0xe0 && m <= 0xef) || m === 0xfe) || isIcc) exclude.push(seg); // keep APPn (EXIF/XMP/IPTC) and COM
    p += 2 + len;
    if (m === 0xda) { // entropy-coded scan: up to the next marker that is not a stuffed 0xFF or a restart
      const from = p;
      while (p + 1 < buf.length && !(buf[p] === 0xff && buf[p + 1] !== 0x00 && !(buf[p + 1] >= 0xd0 && buf[p + 1] <= 0xd7))) p++;
      if (p + 1 >= buf.length) return null;
      exclude.push([from, p]);
    }
  }
  return ended ? { exclude, extra: [] } : null;
}

// ── WebP ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const WEBP_BINARY = new Set(['VP8 ', 'VP8L', 'VP8X', 'ALPH', 'ANIM', 'ANMF', 'ICCP']);
function webpPayload(buf) {
  if (buf.length < 12 || buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP') return null;
  const total = 8 + buf.readUInt32LE(4);
  if (total > buf.length || total < 12) return null;
  const exclude = [];
  for (let p = 12; p < total;) {
    if (p + 8 > total) return null;
    const type = buf.toString('latin1', p, p + 4), len = buf.readUInt32LE(p + 4);
    const end = p + 8 + len;
    if (end > total) return null;
    if (WEBP_BINARY.has(type)) exclude.push([p + 8, end]);
    p = end + (len & 1);
  }
  return { exclude, extra: [] };
}

/** @returns {{exclude:number[][], extra:Buffer[]}|null} */
export function mediaPayload(path, buf) {
  try {
    switch (EXT(path)) {
      case 'mp4': case 'm4v': case 'mov': case 'm4a': return mp4Payload(buf);
      case 'webm': case 'mkv': return mkvPayload(buf);
      case 'mp3': return mp3Payload(buf);
      case 'png': return pngPayload(buf);
      case 'jpg': case 'jpeg': return jpegPayload(buf);
      case 'webp': return webpPayload(buf);
      default: return null;
    }
  } catch {
    return null; // any out-of-range read of a malformed file: full scan
  }
}

/** @returns {{buf:Buffer, extra:Buffer[]}|null} a copy with the payload zeroed (offsets stay), or null = scan the file as it is */
export function maskMediaPayload(path, buf) {
  const payload = mediaPayload(path, buf);
  if (!payload) return null;
  const masked = Buffer.from(buf);
  for (const [s, e] of payload.exclude) masked.fill(0, s, e);
  return { buf: masked, extra: payload.extra };
}
