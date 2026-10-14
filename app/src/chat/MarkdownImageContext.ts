import { createContext, useContext } from 'react';

/**
 * Where relative image links in assistant markdown point to: the base URL of the chat's profile
 * (provided by ChatView). null = no base (relative links are not shown).
 */
export const MarkdownImageContext = createContext<string | null>(null);

export function useMarkdownImageBase(): string | null {
  return useContext(MarkdownImageContext);
}
