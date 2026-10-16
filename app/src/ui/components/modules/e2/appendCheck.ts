/** Exact prefix verification. Callers without an append-generation token must accept replacements too. */
export const CHECK = 512;

export function extendsText(next: string, prev: string, at = 0): boolean {
  return next.startsWith(at === 0 ? prev : prev.slice(at));
}
