/**
 * Candidate filtering + ranking for image-by-query. Pure functions.
 *
 * Wikipedia: the article must match the query (exact title / redirect, or strong token overlap)
 * and its page image must be a raster photo (jpg/png/webp), not a logo/map/flag/diagram – unless
 * the query explicitly asks for one ("Karte von Rom", "Logo …").
 * Commons: the file title must contain the query tokens (model numbers exactly).
 */
import type { WikiFile, WikiPage } from './types.ts';

/** lowercase, no diacritics, ß→ss, non-alphanumerics → single spaces */
export function normalizeText(x: string): string {
  let t = x.toLowerCase();
  try {
    t = t.normalize('NFD').replace(/[̀-ͯ]/g, '');
  } catch {
    // engines without String.prototype.normalize: fold the common Latin accents by hand
    t = t.replace(/[àáâãäå]/g, 'a').replace(/[èéêë]/g, 'e').replace(/[ìíîï]/g, 'i').replace(/[òóôõö]/g, 'o').replace(/[ùúûü]/g, 'u').replace(/ç/g, 'c').replace(/ñ/g, 'n');
  }
  // no \p{…} classes (not supported by every RN JS engine): keep ASCII alnum + Latin/Greek/Cyrillic/CJK ranges
  return t
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9À-ɏͰ-ϿЀ-ӿ぀-ヿ㐀-鿿가-힯]+/g, ' ')
    .trim();
}

export function tokens(x: string): string[] {
  const t = normalizeText(x);
  return t ? t.split(' ') : [];
}

// "map"/"plan"/"symbol" etc. as separate words in a file name → probably not a photo
const NON_PHOTO = /(?:^| )(map|maps|karte|landkarte|stadtplan|locator|location|lagekarte|logo|wordmark|schriftzug|flag|flagge|fahne|wappen|coat of arms|emblem|seal|siegel|signature|unterschrift|diagram|diagramm|schema|schematic|chart|graph|grafik|graphic|icon|symbol|grundriss|floor plan|plan|vector|infographic|comparison)(?: |$)/;
const WANTS_NON_PHOTO = /(?:^| )(map|karte|landkarte|stadtplan|plan|logo|flag|flagge|fahne|wappen|coat of arms|emblem|diagram|diagramm|schema|grundriss|symbol|icon|signet)(?: |$)/;

export function wantsNonPhoto(query: string): boolean {
  return WANTS_NON_PHOTO.test(normalizeText(query));
}

export function isRasterName(file: string): boolean {
  return /\.(jpe?g|png|webp)$/i.test(file.trim());
}

export function isRasterMime(mime: string): boolean {
  return /^image\/(jpeg|png|webp)$/i.test(mime);
}

/** Is this file acceptable as the photo for `query`? */
export function acceptableFile(file: string, query: string): boolean {
  const name = file.replace(/\.[a-z0-9]+$/i, '');
  const wants = wantsNonPhoto(query);
  if (!isRasterName(file)) return wants && /\.svg$/i.test(file);
  return wants || !NON_PHOTO.test(normalizeText(name));
}

const isNumeric = (t: string) => /\d/.test(t);
const STOP = new Set(['der', 'die', 'das', 'the', 'of', 'von', 'und', 'and', 'in', 'im', 'am', 'a', 'an', 'de', 'la', 'le', 'il', 'di']);

/**
 * How well does `title` match `query` (0 = no match, 100 = exact). Rules:
 *  - tokens containing digits (model numbers "17", "s25") must appear exactly in the title
 *  - word tokens may match as substring of a longer title token ("hund" in "haushund")
 */
export function titleScore(title: string, query: string): number {
  const nt = normalizeText(title);
  const nq = normalizeText(query);
  if (!nt || !nq) return 0;
  if (nt === nq) return 100;
  const tt = nt.split(' ');
  const qt = nq.split(' ').filter((t) => !STOP.has(t));
  if (!qt.length) return 0;
  if (!qt.filter(isNumeric).every((t) => tt.includes(t))) return 0;
  let hit = 0;
  for (const q of qt) {
    if (tt.includes(q)) hit += 1;
    else if (q.length >= 4 && tt.some((t) => t.length > q.length && t.includes(q))) hit += 0.8;
  }
  const coverage = hit / qt.length;
  if (coverage < 0.6) return 0;
  const phrase = (' ' + nt + ' ').includes(' ' + nq + ' ') ? 20 : 0;
  const extra = Math.max(0, tt.length - qt.length);
  return Math.max(1, Math.round(coverage * 60 + phrase - Math.min(extra, 8) * 2));
}

/**
 * Place-type words that name no particular place on their own ("Altstadt", "Old Town", "Casco Antiguo", "Dom",
 * "Hauptbahnhof", "Beach" …), de/en/es, in normalizeText form. A query made only of these (plus stop words) has no
 * subject: a search for "Altstadt (Zentrum)" returns the old town of Warsaw as its top hit.
 */
const GENERIC = new Set(
  (
    // de
    'altstadt altstadtkern innenstadt zentrum stadtzentrum stadtmitte stadtkern city hauptbahnhof bahnhof hbf dom ' +
    'kathedrale munster kirche marktplatz markt hauptplatz rathaus rathausplatz hafen strand museum park stadtpark ' +
    'schloss burg festung garten altstadtgasse fussgangerzone promenade platz stadt viertel historisches historische ' +
    'historischer alte alter altes flughafen zoo see ' +
    // en
    'old town oldtown center centre downtown midtown main square hall cathedral church harbour harbor port beach ' +
    'station central railway train airport market castle palace garden gardens historic district quarter lake ' +
    // es
    'casco antiguo historico centro ciudad plaza mayor catedral iglesia ayuntamiento puerto playa museo parque ' +
    'estacion mercado castillo palacio jardin barrio aeropuerto'
  ).split(' '),
);

/** Query tokens that can identify a subject: not a stop word, not a generic place word. */
export function specificTokens(query: string): string[] {
  return tokens(query).filter((t) => !STOP.has(t) && !GENERIC.has(t));
}

/** Only generic place words ("Altstadt (Zentrum)", "Old Town", "Plaza Mayor"), nothing that names a place. */
export function isGenericPlaceName(name: string): boolean {
  return tokens(name).length > 0 && specificTokens(name).length === 0;
}

/**
 * Does `title` mention at least one specific token of `query` (word, or ≥ 4 letters inside a longer word:
 * "hamburg" in "Hamburger Hafen")? A query without specific tokens is never covered.
 */
export function coversSpecific(title: string, query: string): boolean {
  const spec = specificTokens(query);
  if (!spec.length) return false;
  const tt = tokens(title);
  return spec.some((q) => tt.includes(q) || (q.length >= 4 && tt.some((t) => t.length > q.length && t.includes(q))));
}

/**
 * Best Wikipedia article for the query (title lookup or search results), or null.
 * A query that names something specific ("Plaza Mayor Salamanca", "Mirabellgarten") only accepts titles that
 * mention it: generic words alone ("Plaza Mayor (Madrid)", "Warschauer Altstadt") are not a match. A query of
 * generic words only ("Altstadt") accepts nothing but the article of exactly that name (no "Warschauer Altstadt").
 */
export function pickWikiPage(pages: WikiPage[], query: string): WikiPage | null {
  let best: WikiPage | null = null;
  let bestScore = 0;
  const hasSpecific = specificTokens(query).length > 0;
  for (const p of pages) {
    if (p.disambiguation || !p.file || !p.thumb) continue;
    if (!acceptableFile(p.file, query)) continue;
    // "Pantheon (Rom)" → compare without the parenthetical qualifier too
    const bare = p.title.replace(/\s*\([^)]*\)\s*$/, '');
    const covers = coversSpecific(p.title, query);
    if (hasSpecific ? !covers : normalizeText(p.title) !== normalizeText(query)) continue;
    const ts = Math.max(titleScore(p.title, query), bare !== p.title ? titleScore(bare, query) - 25 : 0);
    // the top search hit (often a redirect target like "Hund" → "Haushund") gets some trust – only when it
    // mentions what the query names
    const score = ts > 0 ? ts - (p.index - 1) * 4 : p.index === 1 && covers ? 25 : 0;
    if (score > bestScore) {
      best = p;
      bestScore = score;
    }
  }
  return best;
}

/** Best Commons file for the query, or null (same subject rule as pickWikiPage). */
export function pickCommonsFile(files: WikiFile[], query: string): WikiFile | null {
  let best: WikiFile | null = null;
  let bestScore = 0;
  const hasSpecific = specificTokens(query).length > 0;
  for (const f of files) {
    if (!isRasterMime(f.mime) || !f.thumb) continue;
    if (Math.min(f.width, f.height) < 240) continue;
    if (!acceptableFile(f.name, query)) continue;
    const title = f.name.replace(/\.[a-z0-9]+$/i, '');
    if (hasSpecific ? !coversSpecific(title, query) : normalizeText(title) !== normalizeText(query)) continue;
    const ts = titleScore(title, query);
    if (ts <= 0) continue;
    const score = ts - (f.index - 1) * 3;
    if (score > bestScore) {
      best = f;
      bestScore = score;
    }
  }
  return best;
}
