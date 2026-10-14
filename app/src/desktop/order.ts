/**
 * Chat order of the desktop shortcuts / menus (pure, node:test): the sidebar order – pinned first, then by
 * recency (conversations/group.ts), without archived chats. ⌘1–9, ⌥⌘↑/↓, the "Chat" menu and the dock menu use it.
 */
export type OrderMeta = { id: string; title?: string; pinned?: boolean; archived?: boolean; updatedAt: number; createdAt: number; profileKind?: string };

export function sidebarOrder<T extends OrderMeta>(list: readonly T[], visible: (m: T) => boolean = () => true): T[] {
  const shown = list.filter((m) => !m.archived && visible(m));
  const byRecency = shown.slice().sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt);
  return [...byRecency.filter((m) => m.pinned), ...byRecency.filter((m) => !m.pinned)];
}

/** menu entries: id + a one-line title */
export function menuChats(order: readonly OrderMeta[], untitled: string, max = 9): { id: string; title: string }[] {
  return order.slice(0, max).map((m) => ({ id: m.id, title: (m.title ?? '').replace(/\s+/g, ' ').trim() || untitled }));
}
