/**
 * "Im Chat weitermachen" from a Routine result: the two messages a NEW chat is seeded with (controller.createBranch,
 * `seed: 2`). The result stays as it is; the chat only gets it as earlier turns, labelled as a Routine result, and the
 * first message the user sends carries them as context (hermes/turnOverride.ts branchSeedText). Nothing is sent here.
 * Pure, erasable TS.
 */
import type { TFn } from '../i18n/core.ts';
import type { ChatMessage } from '../hermes/types.ts';
import type { InboxItem } from './inbox.ts';

export type ContinueSeed = { messages: ChatMessage[]; title: string; bot: string | undefined };

/** Prompt longer than this is cut in the seed (the full task stays visible on the Routine's detail page). */
export const SEED_PROMPT_MAX = 1200;

function oneLine(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/**
 * user:      "Ergebnis der Routine „<title>“ vom <date>. Auftrag: <prompt>"   (no prompt known → without the second part)
 * assistant: the result text; a run without text reads "Der Lauf ist fehlgeschlagen: <error>" (or a plain note)
 */
export function continuationSeed(
  item: Pick<InboxItem, 'id' | 'title' | 'finishedAt' | 'text' | 'status' | 'error' | 'hermesProfile' | 'truncated'>,
  o: { t: TFn; formatDate: (ms: number) => string; prompt?: string; bot?: string; now?: number },
): ContinueSeed {
  const now = o.now ?? Date.now();
  const at = Date.parse(item.finishedAt);
  const date = Number.isFinite(at) ? o.formatDate(at) : '';
  const head = date ? o.t('routines.continue.seedUser', { title: item.title, date }) : o.t('routines.continue.seedUserNoDate', { title: item.title });
  const prompt = o.prompt?.trim() ? oneLine(o.prompt, SEED_PROMPT_MAX) : '';
  const userText = prompt ? `${head} ${o.t('routines.continue.seedTask', { prompt })}` : head;
  let answer = item.text.trim();
  if (!answer) answer = item.error ? o.t('routines.continue.seedFailed', { error: item.error }) : o.t('routines.continue.seedEmpty');
  else if (item.truncated) answer = `${answer}\n\n${o.t('routines.continue.seedTruncated')}`;
  const stamp = now.toString(36);
  const messages: ChatMessage[] = [
    { id: `rr_${item.id}_${stamp}_q`, role: 'user', text: userText, tools: [], status: 'done', createdAt: now - 1 },
    { id: `rr_${item.id}_${stamp}_a`, role: 'assistant', text: answer, tools: [], status: 'done', createdAt: now, finishReason: 'stop' },
  ];
  return { messages, title: oneLine(item.title, 80), bot: o.bot };
}
