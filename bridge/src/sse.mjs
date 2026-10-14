// Side-channel SSE reader: observes the upstream byte stream (which is forwarded untouched)
// and collects the assistant text for the bridge's routing-context memory.

/** Encode one SSE frame like Hermes' _sse_frame (ensure_ascii JSON). */
export function sseFrame(event, data) {
  return `event: ${event}\ndata: ${asciiJson(data)}\n\n`;
}

/** JSON with non-ASCII escaped (safe for HTTP headers and byte-identical across platforms). */
export function asciiJson(v) {
  return JSON.stringify(v).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/** Largest single SSE line / frame the side-channel parsers keep (decoded characters, ~1 MiB). */
export const MAX_FRAME_CHARS = 1024 * 1024;

/**
 * Incremental SSE parser. Robust to arbitrary chunk boundaries (inside lines, inside UTF-8
 * sequences, CRLF split across chunks). Memory is bounded: a line or a frame (all its data lines) longer than
 * `maxFrameChars` is dropped - the rest of the line is skipped without buffering, the frame is not dispatched and
 * `onOversize({event, chars})` reports metadata only (never content). The stream itself is forwarded elsewhere,
 * untouched; only this observer skips the frame.
 * @param {(ev: {event: string, data: string}) => void} onEvent
 * @param {{maxFrameChars?: number, onOversize?: (info: {event: string, chars: number}) => void}} [o]
 */
export function createSseParser(onEvent, { maxFrameChars = MAX_FRAME_CHARS, onOversize } = {}) {
  const decoder = new TextDecoder('utf-8');
  let buf = '';
  let event = '';
  /** @type {string[]} */
  let data = [];
  let frameChars = 0;
  let dropped = 0; // > 0: the current frame is over the cap (chars seen so far)
  let skipLine = false; // inside an over-long line: discard until its end
  let pendingCR = false;

  const drop = (n) => {
    dropped = Math.max(dropped, frameChars) + n;
    data = [];
    frameChars = 0;
  };

  function line(l) {
    if (l === '') {
      if (dropped) {
        try { onOversize?.({ event: event || 'message', chars: dropped }); } catch { /* observer only */ }
      } else if (data.length) onEvent({ event: event || 'message', data: data.join('\n') });
      event = '';
      data = [];
      frameChars = 0;
      dropped = 0;
      return;
    }
    if (l.startsWith(':')) return; // comment / keepalive
    const i = l.indexOf(':');
    const field = i < 0 ? l : l.slice(0, i);
    let value = i < 0 ? '' : l.slice(i + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value.slice(0, 256);
    else if (field === 'data') {
      if (dropped) { dropped += value.length + 1; return; }
      frameChars += value.length + 1;
      if (frameChars > maxFrameChars) return drop(0);
      data.push(value);
    }
  }

  return {
    /** @param {Uint8Array} chunk */
    push(chunk) {
      let s = decoder.decode(chunk, { stream: true });
      if (skipLine) {
        const j = s.search(/[\r\n]/);
        if (j < 0) { dropped += s.length; return; }
        dropped += j;
        skipLine = false;
        // the terminator ends the skipped line (it is not an empty line of its own)
        if (s[j] === '\r') { pendingCR = true; s = s.slice(j + 1); } else { pendingCR = false; s = s.slice(j + 1); }
      }
      buf += s;
      let start = 0;
      for (let i = 0; i < buf.length; i++) {
        const c = buf[i];
        if (c === '\n') {
          if (pendingCR) { pendingCR = false; start = i + 1; continue; }
          line(buf.slice(start, i));
          start = i + 1;
        } else if (c === '\r') {
          line(buf.slice(start, i));
          start = i + 1;
          pendingCR = true;
          continue;
        }
        pendingCR = false;
      }
      buf = buf.slice(start);
      if (buf.length > maxFrameChars) {
        drop(buf.length); // unterminated over-long line: drop the frame, skip the rest of the line unbuffered
        buf = '';
        skipLine = true;
      }
    },
    end() {
      buf += decoder.decode();
      if (buf && !skipLine) line(buf);
      skipLine = false;
      line('');
      buf = '';
    },
  };
}

/** Collect assistant `delta.content` from OpenAI chat.completion.chunk frames. */
export function createAssistantCollector(maxChars = 8000, { onOversize } = {}) {
  let text = '';
  const parser = createSseParser(({ event, data }) => {
    if (event !== 'message' || data === '[DONE]' || text.length >= maxChars) return;
    try {
      const j = JSON.parse(data);
      const c = j?.choices?.[0]?.delta?.content;
      if (typeof c === 'string') text += c;
    } catch { /* not JSON: ignore */ }
  }, { onOversize });
  return {
    push: (/** @type {Uint8Array} */ chunk) => parser.push(chunk),
    end() { parser.end(); return text.slice(0, maxChars); },
  };
}
