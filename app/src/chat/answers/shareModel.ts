/**
 * Share-as-image, the decisions without React (unit-tested, shareModel.test.ts):
 *  - planShare      which parts of an answer go into the image (text, cards) and what is left out: sandboxed HTML
 *                   widgets run in a WebView / iframe that cannot be put into an image – a placeholder marks their
 *                   place; follow-up chips are chat chrome
 *  - shareQuestion  the user's question as one short header line (or null: nothing to show, toggle hidden)
 *  - clipBody       long answers: full height up to a maximum, then a fade (never a cut through a card edge)
 *  - shareFileName  local-time file name of the PNG
 *  - shareActions   what the sheet offers per platform (share sheet / download / save / copy)
 * Nothing here sends anything anywhere: the image is made on the device and only leaves it through the action the
 * user picks in the sheet (the system share sheet, a download, the clipboard).
 */
import type { HuiNode, Segment } from '../../protocol/types';

/** logical width of the shared frame (a phone column: cards lay out as they do in the chat) */
export const SHARE_FRAME_WIDTH = 390;
/** web/desktop render scale: 390 → 1170 px (native captures at the device pixel ratio) */
export const SHARE_SCALE = 3;
/** answer body above this height (logical px) ends in a fade */
export const SHARE_MAX_BODY_HEIGHT = 1500;
/** capture waits until nothing loaded for this long … */
export const SHARE_QUIET_MS = 450;
/** … or until this deadline: what is still loading then is drawn as its fallback */
export const SHARE_DEADLINE_MS = 5000;
/** question header: characters before the ellipsis */
export const QUESTION_MAX_CHARS = 160;

export type SharePart =
  | { kind: 'markdown'; key: string; text: string }
  | { kind: 'hui'; key: string; node: HuiNode }
  /** a sandboxed HTML widget: drawn as a quiet "not in the image" placeholder at its place */
  | { kind: 'widget'; key: string };

export type SharePlan = {
  parts: SharePart[];
  /** sandboxed HTML widgets that are not in the image */
  widgets: number;
  /** nothing to draw besides widget placeholders (e.g. an answer that is only an HTML widget) */
  empty: boolean;
};

/** node types that are chat chrome, not answer content (follow-up chips) */
const SKIP_TYPES = new Set(['suggestions']);

export function planShare(segments: readonly Segment[]): SharePlan {
  const parts: SharePart[] = [];
  let widgets = 0;
  for (const seg of segments) {
    if (seg.kind === 'markdown') {
      if (seg.text.trim()) parts.push({ kind: 'markdown', key: seg.key, text: seg.text });
    } else if (seg.kind === 'hui') {
      // a block that failed to parse has nothing presentable (the chat shows an error box + raw JSON): left out
      if (seg.node && !SKIP_TYPES.has(seg.node.type)) parts.push({ kind: 'hui', key: seg.key, node: seg.node });
    } else if (seg.html.trim()) {
      widgets++;
      parts.push({ kind: 'widget', key: seg.key });
    }
  }
  return { parts, widgets, empty: parts.length === widgets };
}

/**
 * The question as one header line: whitespace collapsed, at most QUESTION_MAX_CHARS characters (never splitting an
 * emoji / surrogate pair), null when there is no text (attachment-only message, no question found).
 */
export function shareQuestion(text: string | null | undefined, max = QUESTION_MAX_CHARS): string | null {
  if (!text) return null;
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!flat) return null;
  const chars = Array.from(flat);
  if (chars.length <= max) return flat;
  return chars.slice(0, max - 1).join('').trimEnd() + '…';
}

/** raw text of the user message an answer replies to: the nearest user message before it (null: none / not found) */
export function questionBefore(messages: readonly { id: string; role: string; text: string }[], answerId: string): string | null {
  const i = messages.findIndex((m) => m.id === answerId);
  for (let j = i - 1; j >= 0; j--) if (messages[j].role === 'user') return messages[j].text;
  return null;
}

/** body box of the frame: its full height up to `max`; above that `max` + a fade over the last part */
export function clipBody(contentHeight: number, max = SHARE_MAX_BODY_HEIGHT): { height: number; clipped: boolean } {
  if (!(contentHeight > 0)) return { height: 0, clipped: false };
  // a few px over the limit is not worth a fade
  if (contentHeight <= max + 24) return { height: Math.ceil(contentHeight), clipped: false };
  return { height: max, clipped: true };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `<prefix>-2026-10-16-1432.png` (local time) */
export function shareFileName(at: Date, prefix = 'hui-answer'): string {
  const safe = prefix.replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'answer';
  return `${safe}-${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}.png`;
}

export type ShareEnv = {
  platform: 'ios' | 'android' | 'web' | 'other';
  /** inside the Tauri desktop app */
  desktop: boolean;
  /** web: navigator.canShare({ files: [png] }) */
  canShareFiles: boolean;
  /** web / desktop: an image can be written to the clipboard (ClipboardItem + clipboard.write) */
  canCopyImage: boolean;
};

/** share = system share sheet · download = browser download · save = desktop: file in Downloads · copy = clipboard */
export type ShareActionKind = 'share' | 'download' | 'save' | 'copy';

/** the sheet's buttons, the primary one last */
export function shareActions(env: ShareEnv): ShareActionKind[] {
  if (env.platform === 'ios' || env.platform === 'android') return ['share'];
  if (env.desktop) return env.canCopyImage ? ['copy', 'save'] : ['save'];
  if (env.platform === 'web') {
    const out: ShareActionKind[] = [];
    if (env.canCopyImage) out.push('copy');
    out.push('download');
    if (env.canShareFiles) out.push('share');
    return out;
  }
  return [];
}

/** the privacy line of the sheet for this platform */
export function privacyNoteKey(env: ShareEnv): 'privacyNative' | 'privacyLocal' {
  return env.platform === 'ios' || env.platform === 'android' ? 'privacyNative' : 'privacyLocal';
}

/** native: how long a PNG handed to the share sheet stays in the cache (the receiving app may read it late) */
export const KEEP_SHARED_MS = 30 * 60_000;

/** native: the shared captures (uri → time handed over) that may be deleted now */
export function expiredShares(shared: ReadonlyMap<string, number>, now: number, keepMs = KEEP_SHARED_MS): string[] {
  const out: string[] = [];
  for (const [uri, at] of shared) if (now - at >= keepMs) out.push(uri);
  return out;
}
