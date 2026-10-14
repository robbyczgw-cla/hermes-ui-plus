import { createContext, useContext } from 'react';
import type { ChatMessage } from '../hermes/types';
import type { AnswerModelInfo, RetryVariant } from './answerMenu';

/**
 * Chat-level actions of the answer "⋯" menu (provided by ChatView, read by the message rows without threading
 * props through MessageList): branch from an answer, retry variants, the model line of the menu header.
 */
export type AnswerActions = {
  /** backend kind of the chat */
  kind: string;
  /** stored conversation */
  canBranch: boolean;
  /** "In neuem Chat fortsetzen" from this answer */
  branchFrom(messageId: string): void;
  /** "Erneut versuchen ▸ …" / "Ohne Websuche erneut versuchen" (last answer) */
  retry(variant: RetryVariant): void;
  /** header line: model + reasoning effort of this answer's turn */
  modelInfo(message: ChatMessage): AnswerModelInfo;
};

export const AnswerActionsContext = createContext<AnswerActions | null>(null);

export function useAnswerActions(): AnswerActions | null {
  return useContext(AnswerActionsContext);
}
