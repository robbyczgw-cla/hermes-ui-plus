/**
 * Screens outside the chat (the group chat, the Bots tab's group rows) ask the chat screen to close its phone drawer
 * before they navigate, like Settings does: back from a group shows the chat, and "Öffnen" on an approval line shows
 * the bot's chat with its card, not the drawer on top of it.
 */
const listeners = new Set<() => void>();

export function requestCloseDrawer(): void {
  for (const fn of Array.from(listeners)) fn();
}

/** ChatScreen: close the drawer on request. Returns the unsubscribe function. */
export function onCloseDrawerRequest(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
