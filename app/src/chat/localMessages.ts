/**
 * Messages the chat shell inserts locally (never sent to the model): e.g. the checklist created by
 * an `add_to_list` action when the conversation has no list yet (actions/INTEGRATION.md §4).
 * Pure (node:test).
 */
import type { ChatMessage } from '../hermes/types';

export const LOCAL_ID_PREFIX = 'local-';

export function isLocalMessage(m: Pick<ChatMessage, 'id'>): boolean {
  return m.id.startsWith(LOCAL_ID_PREFIX);
}

export type CreateListEvent = { title: string; kind: 'shopping'; items: string[] };

/** A finished assistant message holding one ```hui checklist node (`fallbackTitle`: translated default list title). */
export function localChecklistMessage(e: CreateListEvent, now = Date.now(), rand = Math.random, fallbackTitle = ''): ChatMessage {
  const suffix = `${now.toString(36)}${Math.floor(rand() * 1e6).toString(36)}`;
  const items = e.items.map((x) => x.trim()).filter(Boolean).map((text) => ({ text }));
  const node = { type: 'checklist', id: `list-${suffix}`, title: e.title || fallbackTitle, kind: e.kind, items };
  return {
    id: `${LOCAL_ID_PREFIX}${suffix}`,
    role: 'assistant',
    text: `\`\`\`hui\n${JSON.stringify(node)}\n\`\`\``,
    tools: [],
    status: 'done',
    createdAt: now,
  };
}
