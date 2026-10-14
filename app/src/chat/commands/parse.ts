/**
 * "/" trigger detection for the composer (pure).
 *
 * Only a slash at the VERY start of the input counts (no leading whitespace), followed by a command-shaped
 * token (letters/digits/_/-). So "1/2", "https://…", "siehe /etc" and paths like "~/x" are
 * ordinary text and never open the palette or get intercepted.
 */

export type SlashInput = {
  /** the token after "/" as typed ('' right after typing "/") */
  token: string;
  /** everything after the token's first whitespace, trimmed ('' when none) */
  arg: string;
  /** the user typed whitespace after the token (= is now typing the argument) */
  hasArgPart: boolean;
};

// letters (incl. umlauts/accents), digits, _ and -; nothing else (a second "/" makes it a path)
const SLASH_RE = /^\/([\p{L}\p{N}_-]*)(?:(\s)([\s\S]*))?$/u;

/** Parsed slash input, or null when the text is ordinary text. */
export function parseSlash(text: string): SlashInput | null {
  const m = SLASH_RE.exec(text);
  if (!m) return null;
  const token = m[1] ?? '';
  const hasArgPart = m[2] !== undefined;
  // "/ foo" (slash + space) is text, not an empty command
  if (!token && hasArgPart) return null;
  return { token, arg: (m[3] ?? '').trim(), hasArgPart };
}

/** composer text for a picked command: "/name " (argument follows) or "/name" */
export function completionText(name: string, withSpace: boolean): string {
  return `/${name}${withSpace ? ' ' : ''}`;
}
