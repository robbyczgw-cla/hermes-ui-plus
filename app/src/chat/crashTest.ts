// Opt-in render-crash triggers for verifying the error boundaries on a device/emulator.
// Compiled out of normal builds: `EXPO_PUBLIC_HUI_CRASH_TEST` is inlined at bundle time and unset
// unless a test build sets it (e.g. app/.env.production.local in a throw-away worktree).
//   "__hui_crash_test__:message" in a user message → that message throws (MessageBoundary card)
//   "__hui_crash_test__:chat" in a user message → once a reply to it is finished (and persisted by
//   onTurnEnd), the whole chat view throws on every render (ChatBoundary, crash marker, restart)

const ENABLED = process.env.EXPO_PUBLIC_HUI_CRASH_TEST === '1';

export const CRASH_TEST_MESSAGE = '__hui_crash_test__:message';
export const CRASH_TEST_CHAT = '__hui_crash_test__:chat';

export function crashTestMessage(text: string): void {
  if (ENABLED && text.includes(CRASH_TEST_MESSAGE)) throw new Error('crash test: message render');
}

export function crashTestChat(messages: readonly { role: string; text: string; status: string }[]): void {
  if (!ENABLED) return;
  const i = messages.findIndex((m) => m.role === 'user' && m.text.includes(CRASH_TEST_CHAT));
  if (i >= 0 && messages.slice(i + 1).some((m) => m.role === 'assistant' && m.status !== 'streaming')) {
    throw new Error('crash test: chat render (persisted)');
  }
}
