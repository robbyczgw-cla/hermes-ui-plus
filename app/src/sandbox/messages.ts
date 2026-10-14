// Message contract between the sandbox shell (inside WebView / iframe) and the host.
// Pure, no RN imports (runs under `node --test`). Everything coming FROM the sandbox is
// untrusted model output and goes through `parseSandboxMessage` before it is acted on.

/** Subset of the SPEC `HuiAction` a sandboxed widget may trigger (structurally compatible). */
export type HtmlBlockAction =
  | { type: 'send'; text: string }
  | { type: 'copy'; text: string }
  | { type: 'open_url'; url: string };

export type SandboxMessage =
  | { t: 'ready' }
  | { t: 'height'; h: number }
  | { t: 'paint' }
  | { t: 'done' }
  | { t: 'error'; message: string }
  | { t: 'action'; action: HtmlBlockAction };

export const LIMITS = {
  /** Raw string from postMessage; anything larger is dropped unparsed. */
  rawMessage: 64_000,
  sendText: 4_000,
  copyText: 32_000,
  url: 2_048,
  errorMessage: 300,
  maxHeight: 20_000,
} as const;

const ALLOWED_URL_PROTOCOLS = new Set(['https:', 'http:', 'mailto:']);

/** Returns a normalized URL if it is an absolute http(s)/mailto URL within limits, else null. */
export function normalizeOpenUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s || s.length > LIMITS.url) return null;
  // no control chars / whitespace inside URLs (blocks header-smuggling & spoofing tricks)
  if (/[\u0000-\u001f\u007f\s]/.test(s)) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (!ALLOWED_URL_PROTOCOLS.has(u.protocol)) return null;
  if (u.protocol !== 'mailto:' && !u.hostname) return null;
  // credentials in URLs are a classic phishing trick (https://bank.example.com@evil.example.com)
  if (u.username || u.password) return null;
  return u.href;
}

function cleanText(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null;
  // strip NUL and other C0 controls except tab/newline/carriage return
  const s = raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  if (!s || s.length > max) return null;
  return s;
}

export function parseAction(raw: unknown): HtmlBlockAction | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  switch (a.type) {
    case 'send': {
      const text = cleanText(a.text, LIMITS.sendText);
      return text ? { type: 'send', text } : null;
    }
    case 'copy': {
      const text = cleanText(a.text, LIMITS.copyText);
      return text ? { type: 'copy', text } : null;
    }
    case 'open_url': {
      const url = normalizeOpenUrl(a.url);
      return url ? { type: 'open_url', url } : null;
    }
    default:
      return null;
  }
}

/**
 * Validates one message from the sandbox. Accepts the JSON string (native `onMessage`
 * data, iframe postMessage) or an already-parsed object. Returns null for anything
 * malformed, oversized, or unknown.
 */
export function parseSandboxMessage(raw: unknown): SandboxMessage | null {
  let data: unknown = raw;
  if (typeof raw === 'string') {
    if (raw.length > LIMITS.rawMessage) return null;
    try {
      data = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const m = data as Record<string, unknown>;
  switch (m.t) {
    case 'ready':
    case 'paint':
    case 'done':
      return { t: m.t };
    case 'height': {
      const h = m.h;
      if (typeof h !== 'number' || !Number.isFinite(h)) return null;
      return { t: 'height', h: Math.max(0, Math.min(Math.ceil(h), LIMITS.maxHeight)) };
    }
    case 'error': {
      // empty = the widget gave no reason; the app shows its translated "unknown error" text
      const msg = typeof m.message === 'string' ? m.message : '';
      const clean = msg.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
      return { t: 'error', message: clean.length > LIMITS.errorMessage ? clean.slice(0, LIMITS.errorMessage - 1) + '…' : clean };
    }
    case 'action': {
      const action = parseAction(m.action);
      return action ? { t: 'action', action } : null;
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------- host -> sandbox

export type HostMessage =
  | { t: 'render'; body: string; css: string; final: boolean; scripts: { src?: string; code: string; module: boolean }[] }
  | { t: 'theme'; css: string; scheme: 'light' | 'dark' };

/** JS snippet for `WebView.injectJavaScript` that delivers one host message to the shell. */
export function injectionFor(msg: HostMessage): string {
  // JSON.stringify twice: the shell receives the same string it would get via postMessage.
  // U+2028/2029 are legal in JSON and (since ES2019) in JS string literals.
  return `window.__hui&&window.__hui.receive(${JSON.stringify(JSON.stringify(msg))});true;`;
}

/**
 * Navigation policy for the sandbox: only the initial shell document may load. Every other
 * navigation (links, location changes, form posts, iframes, meta refresh) is refused; links
 * the user taps are routed through `window.hermes.openUrl` by the shell instead.
 */
export function isAllowedNavigation(url: unknown): boolean {
  if (typeof url !== 'string') return false;
  return url === 'about:blank' || url.startsWith('about:blank#') || url === 'about:srcdoc';
}
