/** Quiz + flashcards logic. Pure (node:test). */

type Rec = Record<string, unknown>;

export type QuizQuestion = { q: string; options: string[]; answer: number[]; explanation?: string; multi: boolean };

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : typeof x === 'number' ? String(x) : '')).filter((x) => x.trim()) : [];
}

/** Valid answer indices (sorted, unique, in range) or null if the question has no valid answer. */
export function normalizeAnswer(answer: unknown, optionCount: number): number[] | null {
  const raw = Array.isArray(answer) ? answer : [answer];
  const idx = [...new Set(raw.filter((n): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < optionCount))].sort((a, b) => a - b);
  return idx.length ? idx : null;
}

/** Questions with a valid answer (others are dropped, matching normalizeNode). */
export function readQuestions(raw: unknown): QuizQuestion[] {
  if (!Array.isArray(raw)) return [];
  const out: QuizQuestion[] = [];
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue;
    const o = x as Rec;
    const q = typeof o.q === 'string' ? o.q.trim() : '';
    const options = strList(o.options);
    const answer = normalizeAnswer(o.answer, options.length);
    if (!q || options.length < 1 || !answer) continue;
    out.push({ q, options, answer, explanation: typeof o.explanation === 'string' && o.explanation.trim() ? o.explanation : undefined, multi: Array.isArray(o.answer) && answer.length > 1 });
  }
  return out;
}

/** Exact set match. An empty selection (skipped) is never correct. */
export function isCorrect(selected: readonly number[] | null | undefined, answer: readonly number[]): boolean {
  if (!selected || !selected.length) return false;
  const a = [...new Set(selected)].sort((x, y) => x - y);
  return a.length === answer.length && a.every((v, i) => v === answer[i]);
}

/** Persisted quiz progress. `answers[i]`: null = not answered yet, [] = skipped, [..] = checked selection. */
export type QuizState = { i: number; answers: (number[] | null)[]; finished: boolean; sent: boolean };

export const initialQuizState: QuizState = { i: 0, answers: [], finished: false, sent: false };

export function scoreQuiz(questions: readonly QuizQuestion[], answers: readonly (number[] | null)[]): { correct: number; total: number } {
  let correct = 0;
  questions.forEach((q, i) => {
    if (isCorrect(answers[i], q.answer)) correct++;
  });
  return { correct, total: questions.length };
}

export function answerQuestion(s: QuizState, index: number, selection: number[]): QuizState {
  const answers = [...s.answers];
  while (answers.length <= index) answers.push(null);
  answers[index] = [...selection];
  return { ...s, answers };
}

/** Next question, or finished after the last one. */
export function advanceQuiz(s: QuizState, total: number): QuizState {
  if (s.i + 1 >= total) return { ...s, finished: true };
  return { ...s, i: s.i + 1 };
}

/* ───────────── flashcards ───────────── */

export type Flashcard = { front: string; back: string };

export function readCards(raw: unknown): Flashcard[] {
  if (!Array.isArray(raw)) return [];
  const out: Flashcard[] = [];
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue;
    const o = x as Rec;
    const front = typeof o.front === 'string' ? o.front.trim() : '';
    const back = typeof o.back === 'string' ? o.back.trim() : '';
    if (front) out.push({ front, back });
  }
  return out;
}

/**
 * Persisted deck. `queue` = card indices still to learn (head = current card); "nochmal" moves the
 * head to the end, "gewusst" removes it. `misses[i]` counts "nochmal" per card.
 */
export type DeckState = { queue: number[]; known: number[]; misses: number[]; total: number };

export function initDeck(total: number, order?: readonly number[]): DeckState {
  const queue = order && order.length === total ? [...order] : Array.from({ length: total }, (_, i) => i);
  return { queue, known: [], misses: Array.from({ length: total }, () => 0), total };
}

/** Grow a deck that was created while the card list was still streaming. */
export function syncDeck(d: DeckState, total: number): DeckState {
  if (total <= d.total) return d;
  const extra = Array.from({ length: total - d.total }, (_, k) => d.total + k);
  return { ...d, queue: [...d.queue, ...extra], misses: [...d.misses, ...extra.map(() => 0)], total };
}

export function answerCard(d: DeckState, verdict: 'known' | 'again'): DeckState {
  if (!d.queue.length) return d;
  const [head, ...rest] = d.queue;
  if (verdict === 'known') return { ...d, queue: rest, known: [...d.known, head] };
  const misses = [...d.misses];
  misses[head] = (misses[head] ?? 0) + 1;
  return { ...d, queue: [...rest, head], misses };
}

/** Number of passes needed (1 = every card known the first time). */
export function deckRounds(d: DeckState): number {
  return 1 + Math.max(0, ...d.misses);
}

/** Fisher–Yates with an injectable random source. */
export function shuffled(n: number, rnd: () => number = Math.random): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
