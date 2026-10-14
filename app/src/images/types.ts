/**
 * Image-by-query resolution (Wikipedia / Wikimedia Commons). Pure types – no RN imports so the
 * resolver core runs under `node --test`.
 */

export interface ImageAttribution {
  /** plain-text author/artist (HTML stripped), if known */
  author?: string;
  /** short license name, e.g. "CC BY-SA 4.0", "Public domain" */
  license?: string;
  licenseUrl?: string;
  /** file description page (license + full credits), e.g. https://commons.wikimedia.org/wiki/File:… */
  sourceUrl: string;
  /** where the image was found ('source' = URL given directly in the node, from a tool/source) */
  provider: 'wikipedia' | 'commons' | 'source' | 'web';
  /** web search results: source domain shown as "Bild: example.com" (sourceUrl = the page it was found on) */
  domain?: string;
}

export interface ResolvedImage {
  /** display-size URL (~960 px wide thumbnail, never the multi-MB original) */
  url: string;
  /** small thumbnail URL (~330 px) for 56–64 px thumbs */
  thumbUrl: string;
  /** pixel size of `url` (aspect ratio = width / height) */
  width: number;
  height: number;
  /** article title (Wikipedia) or file title (Commons) */
  title: string;
  attribution: ImageAttribution;
}

/** A Wikipedia article returned by a title lookup or search (prop=pageimages|pageprops). */
export interface WikiPage {
  title: string;
  /** search rank (1 = best); title lookups use 1 */
  index: number;
  disambiguation: boolean;
  /** page image file name without namespace, e.g. "Colosseo_2020.jpg" */
  file?: string;
  thumb?: { url: string; width: number; height: number };
}

/** A media file with metadata (prop=imageinfo&iiprop=url|size|mime|extmetadata). */
export interface WikiFile {
  /** file name without namespace, spaces instead of underscores */
  name: string;
  index: number;
  mime: string;
  width: number;
  height: number;
  thumb?: { url: string; width: number; height: number };
  descriptionUrl?: string;
  author?: string;
  license?: string;
  licenseUrl?: string;
  objectName?: string;
}

export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; headers: { get(name: string): string | null }; text(): Promise<string> }>;

/** Minimal AsyncStorage subset. */
export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}
