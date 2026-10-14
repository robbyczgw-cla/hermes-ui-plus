/**
 * `translation` node model (docs/SPEC-modules-v3.md): defensive reading of a possibly partial
 * (streaming) node, pane order for the "Tauschen" view, long-text detection. Pure → node:test-able.
 */

export type TranslationPane = {
  /** stable key: 'src' or 't<index>' */
  key: string;
  lang: string;
  text: string;
  romanization?: string;
  isSource: boolean;
};

export type TranslationModel = {
  source: TranslationPane | null;
  targets: TranslationPane[];
  note?: string;
};

const MAX_TARGETS = 4;

function str(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Read a raw/partial node. Texts are kept verbatim (only trimmed); empty texts are dropped. */
export function readTranslation(node: unknown): TranslationModel {
  const n = obj(node) ?? {};
  const s = obj(n.source);
  const srcText = s ? str(s.text).trim() : '';
  const source: TranslationPane | null = s && srcText ? { key: 'src', lang: str(s.lang).trim() || 'und', text: srcText, isSource: true } : null;
  const raw = Array.isArray(n.targets) ? n.targets : [];
  const targets: TranslationPane[] = [];
  raw.forEach((r, i) => {
    const o = obj(r);
    if (!o || targets.length >= MAX_TARGETS) return;
    const text = str(o.text).trim();
    if (!text) return;
    const rom = str(o.romanization).trim();
    targets.push({ key: `t${i}`, lang: str(o.lang).trim() || 'und', text, ...(rom ? { romanization: rom } : {}), isSource: false });
  });
  const note = str(n.note).trim();
  return { source, targets, ...(note ? { note } : {}) };
}

/**
 * Pane order. Normal: source, then targets. Swapped: targets first, source last – with one target
 * that is a true "Tauschen" (es ⇄ de); with several it puts the translations in front.
 */
export function orderPanes(m: TranslationModel, swapped: boolean): TranslationPane[] {
  const src = m.source ? [m.source] : [];
  return swapped && m.targets.length ? [...m.targets, ...src] : [...src, ...m.targets];
}

/** Collapse texts that would be taller than ~6 lines on a phone. */
export const LONG_TEXT_CHARS = 280;
export const LONG_TEXT_LINES = 6;

export function isLongText(text: string): boolean {
  return text.length > LONG_TEXT_CHARS || text.split('\n').length > LONG_TEXT_LINES;
}

/** Short phrases get a large display size, longer ones a comfortable reading size. */
export function textSize(text: string): 'large' | 'medium' | 'body' {
  const n = text.length;
  return n <= 60 ? 'large' : n <= 160 ? 'medium' : 'body';
}

/** Speaker id for one pane (global speaker plays one id at a time). */
export function speakId(nodeId: string, paneKey: string): string {
  return `translation:${nodeId}:${paneKey}`;
}
