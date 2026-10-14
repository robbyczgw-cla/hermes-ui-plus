/**
 * Desktop shell events (pure, node:test): parsing of the `hermes-desktop` CustomEvent detail and the
 * de-duplication of key commands that may arrive twice (menu accelerator + web keydown).
 */

export type DesktopEvent = {
  cmd: string;
  /** open-recent: 0-based position in the sidebar order */
  index?: number;
  /** open-chat: conversation id */
  id?: string;
  /** context-action */
  token?: string;
  action?: string;
  /** chrome */
  fullscreen?: boolean;
  /** internal: events with a payload that must never be dropped as duplicates */
  args?: boolean;
};

/** commands a key press can produce (menu accelerator and/or the web key handler) */
export const KEY_COMMANDS = [
  'new-chat',
  'find',
  'search',
  'toggle-sidebar',
  'settings',
  'stop',
  'copy-last',
  'focus-composer',
  'prev-chat',
  'next-chat',
  'open-recent',
] as const;
export type KeyCommand = (typeof KEY_COMMANDS)[number];

const KEY_SET = new Set<string>(KEY_COMMANDS);
const NAME = /^[a-z][a-z0-9-]{0,39}$/;

export function parseDesktopEvent(detail: unknown): DesktopEvent | null {
  if (typeof detail === 'string') return NAME.test(detail) ? { cmd: detail } : null;
  if (!detail || typeof detail !== 'object') return null;
  const o = detail as Record<string, unknown>;
  if (typeof o.cmd !== 'string' || !NAME.test(o.cmd)) return null;
  const e: DesktopEvent = { cmd: o.cmd };
  if (typeof o.index === 'number' && Number.isInteger(o.index) && o.index >= 0 && o.index < 100) e.index = o.index;
  if (typeof o.id === 'string' && o.id.length <= 200) e.id = o.id;
  if (typeof o.token === 'string' && o.token.length <= 40) e.token = o.token;
  if (typeof o.action === 'string' && o.action.length <= 40) e.action = o.action;
  if (typeof o.fullscreen === 'boolean') e.fullscreen = o.fullscreen;
  if (!KEY_SET.has(e.cmd)) e.args = true;
  return e;
}

export const DEDUPE_MS = 500;

/** key commands only: the same command (and index) again within DEDUPE_MS is the same key press */
export function sameCommandWithin(last: { cmd: string; at: number }, e: DesktopEvent, now: number, ms = DEDUPE_MS): boolean {
  if (e.args || !KEY_SET.has(e.cmd)) return false;
  return last.cmd === dedupeKey(e) && now - last.at < ms;
}

export function dedupeKey(e: DesktopEvent): string {
  return e.index === undefined ? e.cmd : `${e.cmd}:${e.index}`;
}
