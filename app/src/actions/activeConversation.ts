/**
 * The conversation the chat shell currently shows (set by ChatScreen). Lets deferred UI work – e.g.
 * the 1.5 s undo window of a choice/scale answer – check that its chat is still the open one before
 * it sends (bugs review 2026-10-11 P2-1). Module state: no provider needed, readable from cleanups.
 *
 * `undefined` = no chat shell (gallery, tests): nothing to compare against.
 */
let active: string | null | undefined;

export function setActiveConversation(id: string | null | undefined): void {
  active = id;
}

export function getActiveConversation(): string | null | undefined {
  return active;
}

/**
 * Should a pending commit that started in `origin` still run when its component unmounts?
 * Yes when it is not bound to a chat or no shell is known, or when its chat is still open (the row was
 * only virtualised away). No when the user left that chat (switch, new chat, deleted) → cancel.
 */
export function commitOnUnmount(origin: string | null | undefined, current: string | null | undefined = active): boolean {
  if (!origin || current === undefined) return true;
  return current === origin;
}
