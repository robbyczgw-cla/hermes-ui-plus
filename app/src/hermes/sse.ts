/**
 * Robust Server-Sent-Events parser (WHATWG "event stream interpretation").
 *
 * - works on arbitrarily split chunks (inside a line, between CR and LF, inside a UTF-8 sequence)
 * - line endings: LF, CRLF or lone CR
 * - named events (`event:`), multi-line `data:` (joined with "\n"), `id:`, `retry:`
 * - comment lines (": keepalive") never produce a frame; reported via `onComment`
 * - a leading UTF-8 BOM is dropped
 * - deviation from the spec: `flush()` also dispatches a final event that was not terminated by a
 *   blank line (spec says discard; for an API client losing the last frame is worse).
 * - bounded memory: a single line or a frame's data larger than `maxFrameChars` (default 1 MiB of UTF-16 code
 *   units) is dropped as a whole – the parser skips to the next line end and the next frame, nothing is
 *   buffered beyond the cap, later frames parse normally (`onOversize` reports the drop).
 *
 * Pure TS, no imports: runs in Hermes/JSC, browsers and Node.
 */

export type SseFrame = {
  /** event name, `message` when no `event:` line was present */
  event: string;
  /** data lines joined with "\n" */
  data: string;
  id?: string;
  retry?: number;
};

export type SseParser = {
  /** feed decoded text; returns all frames completed by this chunk */
  push(chunk: string): SseFrame[];
  /** call once at end of stream */
  flush(): SseFrame[];
};

export type SseParserOptions = {
  onComment?: (text: string) => void;
  /** cap for one line and for one frame's joined data (UTF-16 code units); default MAX_SSE_FRAME_CHARS */
  maxFrameChars?: number;
  /** a frame was dropped because a line or its data exceeded the cap */
  onOversize?: () => void;
};

/** 1 MiB: far above any real Hermes / OpenAI delta frame, small enough that a runaway stream can't exhaust memory */
export const MAX_SSE_FRAME_CHARS = 1024 * 1024;

export function createSseParser(options: SseParserOptions = {}): SseParser {
  const max = options.maxFrameChars ?? MAX_SSE_FRAME_CHARS;
  let buffer = ''; // incomplete trailing line
  let sawFirstChunk = false;
  let lastWasCR = false; // previous chunk ended with "\r": a leading "\n" belongs to it
  /** the start of the current line was over the cap and discarded: drop everything up to its line end */
  let skipLine = false;
  /** the current frame lost data to the cap: drop it at its end */
  let oversize = false;
  let dataSize = 0;

  let eventName = '';
  let dataLines: string[] = [];
  let hasData = false;
  let lastId: string | undefined;
  let retry: number | undefined;

  function dispatch(out: SseFrame[]): void {
    if (oversize) {
      options.onOversize?.();
    } else if (hasData) {
      const frame: SseFrame = { event: eventName || 'message', data: dataLines.join('\n') };
      if (lastId !== undefined) frame.id = lastId;
      if (retry !== undefined) frame.retry = retry;
      out.push(frame);
    }
    eventName = '';
    dataLines = [];
    hasData = false;
    retry = undefined;
    oversize = false;
    dataSize = 0;
  }

  function processLine(line: string, out: SseFrame[]): void {
    if (line === '') {
      dispatch(out);
      return;
    }
    if (line.length > max) {
      oversize = true;
      dataLines = [];
      return;
    }
    if (line.charCodeAt(0) === 58 /* ':' */) {
      options.onComment?.(line.slice(1).replace(/^ /, ''));
      return;
    }
    const colon = line.indexOf(':');
    let field: string;
    let value: string;
    if (colon === -1) {
      field = line;
      value = '';
    } else {
      field = line.slice(0, colon);
      value = line.slice(colon + 1);
      if (value.charCodeAt(0) === 32) value = value.slice(1);
    }
    switch (field) {
      case 'event':
        eventName = value;
        break;
      case 'data':
        hasData = true;
        if (oversize) break;
        dataSize += value.length + 1;
        if (dataSize > max) {
          oversize = true;
          dataLines = [];
          break;
        }
        dataLines.push(value);
        break;
      case 'id':
        if (value.indexOf('\u0000') === -1) lastId = value;
        break;
      case 'retry':
        if (/^\d+$/.test(value)) retry = parseInt(value, 10);
        break;
      default:
        break; // unknown fields ignored
    }
  }

  function push(chunk: string): SseFrame[] {
    const out: SseFrame[] = [];
    if (chunk === '') return out;
    let text = chunk;
    if (!sawFirstChunk) {
      sawFirstChunk = true;
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    }
    if (lastWasCR) {
      lastWasCR = false;
      if (text.charCodeAt(0) === 10) text = text.slice(1);
    }
    text = buffer + text;
    buffer = '';

    let start = 0;
    const len = text.length;
    for (let i = 0; i < len; i++) {
      const c = text.charCodeAt(i);
      if (c === 10 /* \n */ || c === 13 /* \r */) {
        if (skipLine) skipLine = false; // end of the over-long line: its tail is dropped too
        else processLine(text.slice(start, i), out);
        if (c === 13) {
          if (i + 1 < len) {
            if (text.charCodeAt(i + 1) === 10) i++;
          } else {
            lastWasCR = true; // maybe the LF arrives in the next chunk
          }
        }
        start = i + 1;
      }
    }
    buffer = skipLine ? '' : text.slice(start);
    if (buffer.length > max) {
      // an unterminated line beyond the cap: never buffer more of it
      buffer = '';
      skipLine = true;
      oversize = true;
      dataLines = [];
    }
    return out;
  }

  function flush(): SseFrame[] {
    const out: SseFrame[] = [];
    if (buffer !== '') {
      processLine(buffer, out);
      buffer = '';
    }
    skipLine = false;
    dispatch(out);
    lastWasCR = false;
    return out;
  }

  return { push, flush };
}

/**
 * Incremental UTF-8 decoder that does not depend on `TextDecoder` streaming support
 * (Expo documents its native TextDecoder as "not spec-compliant"). Incomplete trailing
 * sequences are carried over to the next call; invalid bytes become U+FFFD.
 */
export type Utf8Decoder = {
  decode(bytes: Uint8Array): string;
  /** emit U+FFFD for a dangling incomplete sequence */
  flush(): string;
};

export function createUtf8Decoder(): Utf8Decoder {
  let pending: number[] = []; // bytes of an incomplete sequence from the previous call

  function seqLen(b: number): number {
    if (b < 0x80) return 1;
    if (b >= 0xc2 && b <= 0xdf) return 2;
    if (b >= 0xe0 && b <= 0xef) return 3;
    if (b >= 0xf0 && b <= 0xf4) return 4;
    return 0; // continuation byte or invalid lead
  }

  function decode(bytes: Uint8Array): string {
    let src: ArrayLike<number> = bytes;
    if (pending.length > 0) {
      const merged = new Array<number>(pending.length + bytes.length);
      for (let i = 0; i < pending.length; i++) merged[i] = pending[i];
      for (let i = 0; i < bytes.length; i++) merged[pending.length + i] = bytes[i];
      src = merged;
      pending = [];
    }
    const n = src.length;
    const parts: string[] = [];
    let run: number[] = [];
    const flushRun = () => {
      if (run.length) {
        parts.push(String.fromCharCode.apply(null, run));
        run = [];
      }
    };
    let i = 0;
    while (i < n) {
      const b = src[i];
      if (b < 0x80) {
        run.push(b);
        i++;
        if (run.length >= 4096) flushRun();
        continue;
      }
      const need = seqLen(b);
      if (need === 0) {
        run.push(0xfffd);
        i++;
        continue;
      }
      if (i + need > n) {
        // possibly incomplete: verify the bytes we have are valid continuations, then carry over
        let ok = true;
        for (let k = i + 1; k < n; k++) {
          if ((src[k] & 0xc0) !== 0x80) {
            ok = false;
            break;
          }
        }
        if (ok) {
          for (let k = i; k < n; k++) pending.push(src[k]);
          i = n;
        } else {
          run.push(0xfffd);
          i++;
        }
        continue;
      }
      let valid = true;
      for (let k = 1; k < need; k++) {
        if ((src[i + k] & 0xc0) !== 0x80) {
          valid = false;
          break;
        }
      }
      if (!valid) {
        run.push(0xfffd);
        i++;
        continue;
      }
      let cp: number;
      if (need === 2) {
        cp = ((b & 0x1f) << 6) | (src[i + 1] & 0x3f);
      } else if (need === 3) {
        cp = ((b & 0x0f) << 12) | ((src[i + 1] & 0x3f) << 6) | (src[i + 2] & 0x3f);
        if (cp < 0x800 || (cp >= 0xd800 && cp <= 0xdfff)) {
          run.push(0xfffd);
          i++;
          continue;
        }
      } else {
        cp =
          ((b & 0x07) << 18) |
          ((src[i + 1] & 0x3f) << 12) |
          ((src[i + 2] & 0x3f) << 6) |
          (src[i + 3] & 0x3f);
        if (cp < 0x10000 || cp > 0x10ffff) {
          run.push(0xfffd);
          i++;
          continue;
        }
      }
      if (cp >= 0x10000) {
        const v = cp - 0x10000;
        run.push(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff));
      } else {
        run.push(cp);
      }
      i += need;
    }
    flushRun();
    return parts.join('');
  }

  function flush(): string {
    if (pending.length === 0) return '';
    pending = [];
    return '�';
  }

  return { decode, flush };
}
