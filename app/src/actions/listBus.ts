/**
 * Tiny pub/sub between the action executor and the checklist module / chat shell.
 * Events are fire-and-forget; subscribers must not throw (errors are swallowed per subscriber).
 */

export type ListBusEvent =
  /** Items were appended to an existing checklist node's persisted state (the node re-renders itself). */
  | { type: 'items_added'; conversationId: string; messageId: string; nodeId: string; added: string[]; reopened: string[]; skipped: string[] }
  /** The conversation has no checklist: the chat shell should insert a LOCAL assistant message with a new checklist node. */
  | { type: 'create_list'; conversationId?: string; title: string; kind: 'shopping'; items: string[] };

export type ListBusListener = (event: ListBusEvent) => void;

export type ListBus = {
  subscribe(fn: ListBusListener): () => void;
  publish(event: ListBusEvent): void;
};

export function createListBus(): ListBus {
  const subs = new Set<ListBusListener>();
  return {
    subscribe(fn) {
      subs.add(fn);
      return () => {
        subs.delete(fn);
      };
    },
    publish(event) {
      for (const fn of [...subs]) {
        try {
          fn(event);
        } catch {
          /* a broken subscriber must not break the others */
        }
      }
    },
  };
}

/** Process-wide bus. */
export const listBus: ListBus = createListBus();
