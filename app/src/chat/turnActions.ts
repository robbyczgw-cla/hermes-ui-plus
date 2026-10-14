import { createContext, useContext } from 'react';

/**
 * Per-chat turn actions the message rows need without threading props through MessageList
 * (provided by ChatView): "Fortsetzen" of a cut answer (background/cut.ts), chat-native card buttons (reminders).
 */
export type TurnActions = {
  continueTurn?: () => boolean;
  /** sends a user message from a card button (reminder "Löschen"); false = refused (a turn is running) */
  sendMessage?: (text: string) => boolean;
  /** puts text into the composer without sending (reminder "Ändern") */
  prefillComposer?: (text: string) => void;
};

export const TurnActionsContext = createContext<TurnActions>({});

export function useTurnActions(): TurnActions {
  return useContext(TurnActionsContext);
}
