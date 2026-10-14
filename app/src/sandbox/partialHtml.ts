// Partial-HTML processing for streamed ```hui-html blocks. Pure, no DOM, no RN imports
// (runs under `node --test`).
//
// The streaming pipeline is ported from OpenIntelligentUI
// (refs/OpenIntelligentUI apps/app/src/components/generative-ui/open-generative-ui/process-partial-html.ts,
// MIT, (c) Atai Barkai / CopilotKit; itself forked from @copilotkit/react-core processPartialHtml)
// and extended: scripts are extracted (and only returned once the block is complete),
// complete <style> blocks are hoisted, <link rel=stylesheet> from <head> is kept, dangerous
// document-level tags (<base>, <meta http-equiv>) are dropped.

export type SandboxScript = {
  /** External script URL (CSP decides whether it may load). */
  src?: string;
  /** Inline code (empty for external scripts). */
  code: string;
  module: boolean;
};

export type ProcessedHtml = {
  /** Body markup for #hui-root (no <script>/<style>, no incomplete trailing tag). */
  body: string;
  /** Concatenated inner text of all complete <style> blocks. */
  css: string;
  /** Scripts in document order. Always empty while `complete` is false. */
  scripts: SandboxScript[];
};

const SCRIPT_BLOCK = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const STYLE_BLOCK = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
const HEAD_BLOCK = /<head\b[^>]*>([\s\S]*?)<\/head\s*>/i;

/** Read one attribute value from a raw attribute string (`src="x" type=module`). */
export function readAttr(attrs: string, name: string): string | undefined {
  const re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\`]+))`, 'i');
  const m = re.exec(attrs);
  if (m) return decodeBasicEntities(m[1] ?? m[2] ?? m[3] ?? '');
  // boolean attribute present without value
  if (new RegExp(`(?:^|\\s)${name}(?=\\s|$|/)`, 'i').test(attrs)) return '';
  return undefined;
}

function decodeBasicEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** Extracts all complete <style> blocks' inner CSS (OpenIntelligentUI `extractCompleteStyles`). */
export function extractCompleteStyles(html: string): string {
  const parts: string[] = [];
  html.replace(STYLE_BLOCK, (_m, css: string) => {
    parts.push(css.trim());
    return '';
  });
  return parts.filter(Boolean).join('\n');
}

/** Strips a single surrounding ``` fence if the model wrapped the HTML twice. */
function stripFence(html: string): string {
  const m = /^\s*```[a-z-]*\s*\n([\s\S]*?)(?:\n```\s*)?$/i.exec(html);
  return m ? m[1]! : html;
}

/**
 * Turns (possibly partial) model HTML into something safe to morph into the live document.
 *
 * Pipeline (order matters):
 *  1. (streaming only) drop an incomplete tag / comment at the end
 *  2. collect + strip complete <script> blocks (returned only when complete), strip an
 *     unterminated trailing <script …
 *  3. collect + strip complete <style> blocks into `css`, strip an unterminated <style …
 *  4. keep <link rel=stylesheet> from <head>, drop the rest of <head>
 *  5. drop doctype, <html>, <base>, <meta>, <title>, comments
 *  6. extract <body> content if present
 *  7. (streaming only) drop an incomplete trailing HTML entity
 */
export function processHtml(input: string, complete: boolean): ProcessedHtml {
  let html = stripFence(input ?? '');

  if (!complete) {
    // unterminated comment: hide everything after `<!--`
    html = html.replace(/<!--(?![\s\S]*?-->)[\s\S]*$/, '');
    // incomplete tag at the very end (`<div class="a`)
    html = html.replace(/<[^>]*$/, '');
  }

  const scripts: SandboxScript[] = [];
  html = html.replace(SCRIPT_BLOCK, (_m, attrs: string, code: string) => {
    if (complete) {
      const type = (readAttr(attrs, 'type') ?? '').trim().toLowerCase();
      const isModule = type === 'module';
      const runnable = isModule || type === '' || /^(text|application)\/(java|ecma)script$/.test(type);
      if (runnable) {
        const src = readAttr(attrs, 'src');
        if (src) scripts.push({ src: src.trim(), code: '', module: isModule });
        else if (code.trim()) scripts.push({ code, module: isModule });
      }
    }
    return '';
  });
  // unterminated script (still streaming, or broken final output)
  html = html.replace(/<script\b[\s\S]*$/i, '');

  const css = extractCompleteStyles(html);
  html = html.replace(STYLE_BLOCK, '');
  html = html.replace(/<style\b[\s\S]*$/i, '');

  // <head>: keep stylesheet links (e.g. Leaflet CSS), drop the rest
  let headLinks = '';
  const head = HEAD_BLOCK.exec(html);
  if (head) {
    headLinks = (head[1]!.match(/<link\b[^>]*>/gi) ?? []).filter((l) => /rel\s*=\s*["']?stylesheet/i.test(l)).join('');
    html = html.replace(HEAD_BLOCK, '');
  }
  html = html.replace(/<head\b[\s\S]*$/i, '');

  html = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!doctype[^>]*>/gi, '')
    .replace(/<\/?html\b[^>]*>/gi, '')
    .replace(/<(base|meta)\b[^>]*>/gi, '')
    // review L10: only stylesheet links survive (no preconnect / dns-prefetch / prefetch / preload side channels)
    .replace(/<link\b[^>]*>/gi, (l) => (/rel\s*=\s*["']?stylesheet["'\s>]/i.test(l) ? l : ''))
    .replace(/<title\b[^>]*>[\s\S]*?<\/title\s*>/gi, '');

  const body = /<body\b[^>]*>([\s\S]*)/i.exec(html);
  if (body) html = body[1]!.replace(/<\/body\s*>[\s\S]*$/i, '');
  else html = html.replace(/<\/body\s*>/gi, '');

  if (!complete) html = html.replace(/&[a-zA-Z0-9#]*$/, '');

  return { body: (headLinks + html).trim(), css, scripts: complete ? scripts : [] };
}

/** True when the processed body has something visible to paint (not only whitespace). */
export function hasVisibleContent(p: ProcessedHtml): boolean {
  return p.body.replace(/<link\b[^>]*>/gi, '').trim().length > 0;
}
