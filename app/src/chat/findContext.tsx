/**
 * "Im Chat suchen": the find state the chat view provides (query, messages with matches, the current one) and
 * the per-message highlight scope the text renderers (Markdown runs, user bubbles) read.
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { Text } from 'react-native';
import { useTheme } from '../ui';
import { splitMatches } from './findInChat';

export type FindState = {
  query: string;
  /** messages with at least one match */
  ids: ReadonlySet<string>;
  /** message of the current match */
  currentId?: string;
};

export const FindContext = createContext<FindState | null>(null);

export type FindHighlight = { query: string; current: boolean };

const HighlightContext = createContext<FindHighlight | null>(null);

/** highlight scope of one message (null when it has no match → renderers skip all work) */
export function FindScope({ messageId, children }: { messageId: string; children: ReactNode }) {
  const find = useContext(FindContext);
  const hit = !!find && find.ids.has(messageId);
  const query = hit ? find.query : '';
  const current = hit && find.currentId === messageId;
  const value = useMemo(() => (query ? { query, current } : null), [query, current]);
  return <HighlightContext.Provider value={value}>{children}</HighlightContext.Provider>;
}

export function useFindHighlight(): FindHighlight | null {
  return useContext(HighlightContext);
}

/** find colours: soft marker for every hit, a strong one for the message of the current match */
export function useFindColors(current: boolean): { backgroundColor: string; color?: string } {
  const t = useTheme();
  if (current) return { backgroundColor: t.dark ? '#FBBF24' : '#F59E0B', color: '#1A1A1A' };
  return { backgroundColor: t.dark ? 'rgba(251,191,36,0.32)' : '#FDE68A' };
}

/** a text run with the matches marked (null when nothing matches → caller renders the plain text) */
export function Highlighted({ text, hl }: { text: string; hl: FindHighlight }) {
  const colors = useFindColors(hl.current);
  const parts = splitMatches(text, hl.query);
  if (parts.length === 1 && !parts[0].hit) return <>{text}</>;
  return (
    <>
      {parts.map((p, i) =>
        p.hit ? (
          <Text key={i} style={colors}>
            {p.text}
          </Text>
        ) : (
          p.text
        ),
      )}
    </>
  );
}

/** highlight of one message read directly from the find state (user bubbles, which have no scope of their own) */
export function useMessageHighlight(messageId: string): FindHighlight | null {
  const find = useContext(FindContext);
  const hit = !!find && find.ids.has(messageId);
  const query = hit ? find.query : '';
  const current = hit && find.currentId === messageId;
  return useMemo(() => (query ? { query, current } : null), [query, current]);
}
