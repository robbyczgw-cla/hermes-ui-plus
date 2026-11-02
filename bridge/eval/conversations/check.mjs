// Pure answer check for the live conversation test (run.mjs): parses one answer with the APP's own stream parser
// (app/src/protocol, the code the phone runs) and reports what the user would see per ```hui block.
//
//   failures  the answer shows less than it should: empty answer, a block that is neither a node nor a readable
//             fallback (only an error line), a list node without entries, a query-only web image although the
//             bridge has no image search (the skill rule from [hermes-ui-caps] image_search=off)
//             with `today`: a weekday next to a date that is another weekday ("Freitag, 31. Oktober" in 2026); an
//             echoed `[hui:quote …]` tag (the app's reply quote, which the model must read, not repeat)
//   warnings  shown, but worth a look: the block fell back to the readable list view
//   images    every image the answer asks for (gallery / image items, product / place photos), so the runner can
//             fetch the URLs through the bridge's image proxy: resolved photo, or the visible placeholder
import { createStreamParser } from '../../../app/src/protocol/streamParser.ts';
import { isEmptyCollection } from '../../../app/src/protocol/validate.ts';
import { provenanceInfo } from '../../../app/src/ui/components/modules/a/misc.ts';
import { factualBlock } from '../../../app/src/chat/answers/evidence.ts';
import { compareLooksLikeProducts, namesProducts, tableNamesProducts } from '../../../app/src/ui/components/compareProducts.ts';

/** node types whose `basis` / `source` the app shows as a provenance chip */
const DATA_TYPES = new Set(['table', 'chart', 'stats', 'compare', 'calc', 'map', 'products', 'places', 'weather']);
const FACT_TYPES = new Set(['products', 'places', 'weather']);
/** prose that claims a looked-up source / current data (de en es) */
const SOURCE_PROSE = /\b(quelle|quellen|source|sources|fuente|herstellerangaben|laut hersteller|per the manufacturer|manufacturer (data|specs)|official specs|offizielle(n)? (daten|angaben)|aktuellen daten|current data|datos actuales)\b/i;
/** prose that says the facts are model knowledge / may be outdated */
const MODEL_PROSE = /(modellwissen|model knowledge|aus meinem (wissen|gedächtnis)|from (my )?memory|kann veraltet|may be outdated|might be outdated|puede estar desactualizad|conocimiento del modelo|nicht sicher|not sure)/i;

const DAY_NAMES = [
  ['sonntag', 'so', 'sunday', 'sun', 'domingo', 'dom'],
  ['montag', 'mo', 'monday', 'mon', 'lunes', 'lun'],
  ['dienstag', 'di', 'tuesday', 'tue', 'tues', 'martes', 'mar'],
  ['mittwoch', 'mi', 'wednesday', 'wed', 'miércoles', 'miercoles', 'mié', 'mie'],
  ['donnerstag', 'do', 'thursday', 'thu', 'thurs', 'jueves', 'jue'],
  ['freitag', 'fr', 'friday', 'fri', 'viernes', 'vie'],
  ['samstag', 'sa', 'saturday', 'sat', 'sábado', 'sabado', 'sáb', 'sab'],
];
const DAY_OF = new Map(DAY_NAMES.flatMap((names, i) => names.map((n) => [n, i])));
const MONTH_OF = new Map(Object.entries({
  jan: 1, januar: 1, january: 1, enero: 1, feb: 2, februar: 2, february: 2, febrero: 2, 'mär': 3, 'märz': 3, mar: 3, march: 3, marzo: 3,
  apr: 4, april: 4, abril: 4, mai: 5, may: 5, mayo: 5, jun: 6, juni: 6, june: 6, junio: 6, jul: 7, juli: 7, july: 7, julio: 7,
  aug: 8, august: 8, agosto: 8, sep: 9, sept: 9, september: 9, septiembre: 9, okt: 10, oktober: 10, oct: 10, october: 10, octubre: 10,
  nov: 11, november: 11, noviembre: 11, dez: 12, dezember: 12, dec: 12, december: 12, diciembre: 12,
}));
const DAY_RE = [...DAY_OF.keys()].sort((a, b) => b.length - a.length).join('|');
const MON_RE = [...MONTH_OF.keys()].sort((a, b) => b.length - a.length).join('|');
// "Freitag, 30. Oktober" · "Fr 30.10." · "Friday, Oct 30" · "Fri 30 October" · "viernes 30 de octubre"
const WEEKDAY_DATE = new RegExp(
  `(?<![\\p{L}])(${DAY_RE})\\.?,?\\s+(?:(\\d{1,2})\\.\\s*(${MON_RE})\\b|(\\d{1,2})\\.(\\d{1,2})\\.?|(${MON_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b|(\\d{1,2})(?:st|nd|rd|th)?\\.?\\s+(?:de\\s+)?(${MON_RE})\\b)`,
  'giu',
);
const WEEKDAY_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Weekday/date pairs in an answer (prose and card strings) whose weekday is not the calendar's, counted from `today`
 * (YYYY-MM-DD in the user's zone; a date more than ~4 months before it is read as next year).
 * @param {string} text @param {string} today @returns {{text: string, is: string}[]}
 */
export function weekdayMismatches(text, today) {
  const m0 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(today ?? ''));
  if (!m0) return [];
  const base = Date.UTC(+m0[1], +m0[2] - 1, +m0[3]);
  const out = [];
  for (const m of String(text ?? '').matchAll(WEEKDAY_DATE)) {
    const wd = DAY_OF.get(m[1].toLowerCase());
    const day = +(m[2] ?? m[4] ?? m[7] ?? m[8]);
    const mon = m[3] ? MONTH_OF.get(m[3].toLowerCase()) : m[5] ? +m[5] : MONTH_OF.get((m[6] ?? m[9]).toLowerCase());
    if (wd === undefined || !mon || mon > 12 || day < 1 || day > 31) continue;
    let at = Date.UTC(+m0[1], mon - 1, day);
    if (at < base - 120 * 86_400_000) at = Date.UTC(+m0[1] + 1, mon - 1, day);
    const is = new Date(at).getUTCDay();
    if (is !== wd) out.push({ text: m[0], is: WEEKDAY_EN[is] });
  }
  return out;
}

const isHttps = (u) => typeof u === 'string' && /^https:\/\/[^\s/]+\.[^\s/]+/i.test(u);

/** All nodes of a tree (card/stack children, tabs, accordion sections …): any nested object with a string `type`. */
function walk(node, out = [], depth = 0) {
  if (!node || typeof node !== 'object' || depth > 12) return out;
  if (Array.isArray(node)) {
    for (const x of node) walk(x, out, depth + 1);
    return out;
  }
  if (typeof node.type === 'string') out.push(node);
  for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v, out, depth + 1);
  return out;
}

/** Image requests of one node: {kind, url?, query?, web} */
function imagesOf(n) {
  const out = [];
  if (n.type === 'image') out.push({ kind: 'image', url: n.url, query: n.query, web: n.source === 'web' });
  if (n.type === 'gallery' && Array.isArray(n.items)) {
    for (const it of n.items) if (it && typeof it === 'object') out.push({ kind: 'gallery', url: it.url, query: it.query, web: n.source === 'web' || it.source === 'web', caption: it.caption });
  }
  for (const [kind, list] of [['products', n.products], ['places', n.places]]) {
    if (n.type !== kind || !Array.isArray(list)) continue;
    // cards always render (category icon fallback); `image` URLs are fetched like gallery URLs
    for (const it of list) if (it && typeof it === 'object' && (it.image || it.imageQuery)) out.push({ kind, url: it.image, query: it.imageQuery, web: true, card: true });
  }
  return out;
}

/**
 * @param {string} text  the full answer text (Markdown + ```hui blocks)
 * @param {{imageSearch?: 'on'|'off'|null, web?: 'on'|'off'|null, today?: string}} [o]  the bridge's capabilities (null: unknown);
 *   `today` (YYYY-MM-DD, the user's zone) turns on the weekday check
 *
 * `evidence` (research item 12): with web=off nothing in the chat was looked up, so every `source` / `basis:"sourced"`
 * is a claim the model made up (failure: the skill rule), `chips` is what the app's provenance chip shows the user for
 * each data node, `sourceProse` / `modelProse` flag the prose ("Quelle: …", "aktuelle Daten" vs "aus Modellwissen").
 */
export function checkAnswer(text, o = {}) {
  const failures = [];
  const warnings = [];
  const blocks = [];
  const images = [];
  const evidence = { claims: [], chips: [], sourceProse: false, modelProse: false };
  const noWeb = o.web === 'off' ? { web: false } : undefined;
  if (!String(text ?? '').trim()) failures.push('empty answer');
  const p = createStreamParser();
  p.push(String(text ?? ''));
  p.end();
  for (const seg of p.segments()) {
    if (seg.kind !== 'hui') continue;
    const type = seg.node && typeof seg.node.type === 'string' ? seg.node.type : null;
    blocks.push({ type: type ?? '(none)', fallback: !!seg.fallback, error: seg.error ?? null });
    if (!seg.node) {
      failures.push(`block without content (${seg.error ?? 'no node'})`);
      continue;
    }
    if (seg.fallback) {
      warnings.push(`block shown as readable fallback (${seg.error ?? 'not a node'})`);
      if (noWeb && factualBlock(seg.raw)) evidence.chips.push({ type: `${/"type"\s*:\s*"([a-z_]+)"/.exec(seg.raw)?.[1] ?? '?'} (fallback)`, chip: provenanceInfo(undefined, undefined, undefined, noWeb, true)?.label ?? null });
    }
    for (const n of walk(seg.node)) {
      if (!seg.fallback && DATA_TYPES.has(n.type)) {
        const src = typeof n.source === 'string' ? n.source.trim() : '';
        // a `source` that itself says "model knowledge, may be outdated" is honest, not a made-up source
        if ((src && !MODEL_PROSE.test(src)) || n.basis === 'sourced') evidence.claims.push({ type: n.type, basis: n.basis ?? null, source: src || null });
        // like the app: products / places / weather, a compare or table about products (content.tsx Compare, Table.tsx)
        const cols = Array.isArray(n.columns) ? n.columns : [];
        const factual = FACT_TYPES.has(n.type)
          || (n.type === 'compare' && (compareLooksLikeProducts(cols.filter((c) => c && typeof c === 'object')) || namesProducts(cols.map((c) => c?.title))))
          || (n.type === 'table' && tableNamesProducts(n.columns, n.rows));
        const chip = provenanceInfo(n.basis, n.source, undefined, noWeb, factual);
        evidence.chips.push({ type: n.type, chip: chip?.label ?? null });
      }
      if (isEmptyCollection(n)) failures.push(`${n.type}: empty list`);
      for (const img of imagesOf(n)) {
        const url = isHttps(img.url) ? img.url : undefined;
        const query = typeof img.query === 'string' && img.query.trim() ? img.query.trim() : undefined;
        images.push({ ...img, url, query });
        if (!img.card && !url && query && img.web && o.imageSearch === 'off') {
          failures.push(`${img.kind}: query-only web image "${query.slice(0, 60)}" although the bridge has no image search (skill rule)`);
        }
      }
    }
  }
  const prose = p.segments().filter((x) => x.kind === 'markdown' || x.kind === 'text').map((x) => x.text ?? '').join('\n') || String(text ?? '').replace(/```[\s\S]*?```/g, '');
  evidence.sourceProse = SOURCE_PROSE.test(prose);
  evidence.modelProse = MODEL_PROSE.test(prose);
  if (noWeb) {
    for (const c of evidence.claims) failures.push(`${c.type}: names a source without any web tool (${c.basis ? `basis ${c.basis}` : ''}${c.basis && c.source ? ', ' : ''}${c.source ? `"${c.source.slice(0, 60)}"` : ''}; skill rule)`);
    if (evidence.sourceProse && !evidence.modelProse) warnings.push('prose names a source / current data without saying it is model knowledge');
  }
  if (o.today) for (const w of weekdayMismatches(text, o.today)) failures.push(`weekday "${w.text}" is a ${w.is} (skill rule)`);
  if (/\[\/?hui:quote\b/.test(String(text ?? ''))) failures.push('repeats the [hui:quote] tag of the user message (skill rule)');
  return { failures, warnings, blocks, images, evidence };
}
