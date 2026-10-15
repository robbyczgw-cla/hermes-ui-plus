// Settings search (pure, unit-tested): sections.tsx and SettingsScreen.tsx filter their rows with these.

const norm = (s: string) =>
  s
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

/** Search predicate: every word of the query must appear in one of the texts. Empty query → everything. */
export function makeMatcher(query: string): (texts: string[]) => boolean {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (!words.length) return () => true;
  return (texts) => {
    const hay = norm(texts.join(' '));
    return words.every((w) => hay.includes(w));
  };
}

type Searchable<R> = { title: string; keywords?: string[]; rows: R[] };

/** Visible rows of a section for a query (hit on the section title or its keywords → all rows). */
export function visibleRows<R extends { texts: string[] }>(section: Searchable<R>, match: (texts: string[]) => boolean): R[] {
  if (match([section.title, ...(section.keywords ?? [])])) return section.rows;
  return section.rows.filter((r) => match([section.title, ...r.texts]));
}
