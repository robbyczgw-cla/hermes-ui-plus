/**
 * Inline review comments on diff lines (pure, node:test). Comments are collected per diff / review sheet and go back to
 * the agent as ONE message ("Request changes"): the Pi app sends it as a steer (CodeReviewContext.onSubmitComments),
 * elsewhere it is a normal chat message.
 */

export type ReviewComment = {
  /** stable key: file key + row key */
  id: string;
  path: string;
  /** line number on the commented side (new side, or old for a removed line); undefined in a snippet */
  line?: number;
  side: 'old' | 'new';
  /** the commented code line (quoted in the message) */
  code: string;
  text: string;
};

export type ReviewLabels = {
  /** first line of the message */
  intro: string;
  /** "{path}, line {line}" */
  at: (path: string, line: number) => string;
};

const MAX_QUOTE = 160;

/** One message from all comments, in file / line order: numbered items with the location, the quoted line and the comment. */
export function reviewMessage(comments: readonly ReviewComment[], labels: ReviewLabels): string {
  const sorted = [...comments].sort((a, b) => (a.path === b.path ? (a.line ?? 0) - (b.line ?? 0) : a.path < b.path ? -1 : 1));
  const items = sorted.map((c, i) => {
    const where = c.line !== undefined ? labels.at(c.path || '?', c.line) : c.path || '?';
    const code = c.code.trim();
    const quote = code ? `\n   > ${code.length > MAX_QUOTE ? code.slice(0, MAX_QUOTE - 1) + '…' : code}` : '';
    const text = c.text.trim().replace(/\n/g, '\n   ');
    return `${i + 1}. \`${where}\`${quote}\n   ${text}`;
  });
  return `${labels.intro}\n\n${items.join('\n\n')}`;
}

/** comments keyed by row: add / replace / remove without mutating */
export function upsertComment(list: readonly ReviewComment[], c: ReviewComment): ReviewComment[] {
  const text = c.text.trim();
  const rest = list.filter((x) => x.id !== c.id);
  return text ? [...rest, { ...c, text }] : rest;
}
