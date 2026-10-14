/**
 * Reply messages to the model (docs/SPEC-modules-v2.md "Replies to the model"). These are PROTOCOL:
 * a machine tag + a human-readable part. Do not translate the tags/keywords. Pure, node:test-able.
 */

/** Collapse whitespace/newlines so a reply stays one readable line. */
export function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function tag(kind: string, id: string): string {
  return `[${kind}:${oneLine(id) || kind}]`;
}

/**
 * `[choice:<id>] <question> → <label>, <label>` (+ `, Andere: <text>`).
 * Without a question: `[choice:<id>] → <label>`.
 */
export function choiceReply(id: string, question: string | undefined, labels: readonly string[], other?: string): string {
  const parts = labels.map(oneLine).filter(Boolean);
  const o = other ? oneLine(other) : '';
  if (o) parts.push(`Andere: ${o}`);
  const q = question ? oneLine(question) : '';
  return `${tag('choice', id)} ${q ? `${q} ` : ''}→ ${parts.join(', ')}`;
}

/** `[checklist:<id>] erledigt: a, b · offen: c` (empty side → "–"). */
export function checklistReply(id: string, done: readonly string[], open: readonly string[]): string {
  const list = (xs: readonly string[]) => (xs.length ? xs.map(oneLine).join(', ') : '–');
  return `${tag('checklist', id)} erledigt: ${list(done)} · offen: ${list(open)}`;
}

/** `[quiz:<id>] 4/5 richtig` */
export function quizReply(id: string, correct: number, total: number): string {
  return `${tag('quiz', id)} ${correct}/${total} richtig`;
}

/** `[slot:<id>] <label>` */
export function slotReply(id: string, label: string): string {
  return `${tag('slot', id)} ${oneLine(label)}`;
}

/** `[slot:<id>] keiner passt` */
export function slotNoneReply(id: string): string {
  return `${tag('slot', id)} keiner passt`;
}

/** `[paths:<id>] <title>` – the row the user picked in a selectable `paths` node */
export function pathsReply(id: string, title: string): string {
  return `${tag('paths', id)} ${oneLine(title)}`;
}

/** `[confirm:<id>] ja|nein` */
export function confirmReply(id: string, yes: boolean): string {
  return `${tag('confirm', id)} ${yes ? 'ja' : 'nein'}`;
}
