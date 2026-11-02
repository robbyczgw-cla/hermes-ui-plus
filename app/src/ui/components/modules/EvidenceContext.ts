import { createContext, useContext } from 'react';
import type { EvidenceView } from './a/misc.ts';

/**
 * What the chat's tool calls up to the answer being rendered can back (chat/answers/evidence.ts), for ProvenanceChip.
 * Provided per assistant message (chat/MessageItem.tsx); undefined (gallery, demo, unknown) = show what the node says.
 */
export const EvidenceContext = createContext<EvidenceView | undefined>(undefined);

export function useEvidence(): EvidenceView | undefined {
  return useContext(EvidenceContext);
}
