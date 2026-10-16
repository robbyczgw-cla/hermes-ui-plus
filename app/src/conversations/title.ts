import { DEFAULT_TITLE, TITLE_MAX } from './types.ts';

/**
 * Auto title = first user message, whitespace collapsed, truncated to `max` chars (incl. the ellipsis).
 * Later improvement (not implemented): ask the model for a 3-5 word title after the first answer and
 * replace it while `titleSource === 'auto'`.
 */
export function makeTitle(text: string, max: number = TITLE_MAX): string {
  let t = text
    // drop form/command prefixes like "[form:abc] "? keep content, but flatten markdown noise
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[`*_#>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return DEFAULT_TITLE;
  const chars = Array.from(t);
  if (chars.length <= max) return t;
  // cut on a word boundary if that does not lose too much
  let cut = chars.slice(0, max - 1).join('');
  const lastSpace = cut.lastIndexOf(' ');
  if (lastSpace >= max * 0.6) cut = cut.slice(0, lastSpace);
  return cut.replace(/[\s.,;:!?-]+$/, '') + '…';
}

/**
 * Title as shown: the stored placeholder `DEFAULT_TITLE` is German (it is persisted and synced, so it stays as-is) –
 * render it as the UI language's "new chat" label instead.
 */
export function displayTitle(title: string, newChat: string): string {
  return title === DEFAULT_TITLE ? newChat : title;
}

/** User-entered title: trimmed, single line, bounded; empty -> null (caller keeps old title). */
export function cleanUserTitle(input: string, max = 80): string | null {
  const t = input.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const chars = Array.from(t);
  return chars.length > max ? chars.slice(0, max).join('') : t;
}

/**
 * Hermes session titles are unique per server (PATCH → 400 `invalid_title` otherwise; web test 2, N8: generated
 * titles of repeated prompts collided with older sessions). First free variant of `title` among `taken`
 * (case-insensitive): "Titel", "Titel #2", "Titel #3", … (Hermes' own lineage style).
 */
export function uniqueTitle(title: string, taken: Iterable<string | undefined>): string {
  const used = new Set<string>();
  for (const t of taken) if (t) used.add(t.trim().toLowerCase());
  if (!used.has(title.trim().toLowerCase())) return title;
  for (let n = 2; n < 1000; n++) {
    const c = `${title} #${n}`;
    if (!used.has(c.toLowerCase())) return c;
  }
  return `${title} #${Date.now() % 100000}`;
}

/**
 * PATCH a generated title, stepping to the next free variant when the server reports a conflict
 * (`isConflict`). At most `attempts` requests; resolves to the title the server accepted, null if none.
 */
export async function renameUnique(
  title: string,
  taken: readonly (string | undefined)[],
  rename: (title: string) => Promise<void>,
  isConflict: (e: unknown) => boolean,
  attempts = 3,
): Promise<string | null> {
  const tried: string[] = [...taken.filter((t): t is string => !!t)];
  for (let i = 0; i < attempts; i++) {
    const t = uniqueTitle(title, tried);
    try {
      await rename(t);
      return t;
    } catch (e) {
      if (!isConflict(e)) return null;
      tried.push(t);
    }
  }
  return null;
}
