/**
 * Checklist logic: node → persisted state (actions/lists.ts contract), shopping categories, grouping
 * with checked items at the bottom, quick-add parsing, share text and reply. Pure (node:test).
 */
import type { ChecklistNodeState, ChecklistStateItem } from '../../../../actions/lists.ts';
import { formatNumber } from '../../../lib/format.ts';
import { checklistReply } from './replies.ts';
import { S_DE, type ModuleStrings } from './text.ts';

export type CItem = ChecklistStateItem;
export type ChecklistKind = 'shopping' | 'todo' | 'packing' | 'generic';
export type ChecklistState = ChecklistNodeState & { sentAt?: number };

type Rec = Record<string, unknown>;

export function asKind(k: unknown): ChecklistKind {
  return k === 'shopping' || k === 'todo' || k === 'packing' ? k : 'generic';
}

function str(v: unknown): string | undefined {
  if (typeof v === 'string') return v.trim() || undefined;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return undefined;
}

/** Items from the (possibly partial) node: explicit id or protocol fallback `i<index>`, unique. */
export function itemsFromNode(raw: unknown): CItem[] {
  if (!Array.isArray(raw)) return [];
  const out: CItem[] = [];
  const seen = new Set<string>();
  raw.forEach((x, i) => {
    const o: Rec | null = typeof x === 'string' ? { text: x } : x && typeof x === 'object' && !Array.isArray(x) ? (x as Rec) : null;
    if (!o) return;
    const text = str(o.text);
    if (!text) return;
    let id = str(o.id) ?? `i${i}`;
    while (seen.has(id)) id = `${id}_`;
    seen.add(id);
    const item: CItem = { id, text, checked: o.checked === true };
    const qty = typeof o.qty === 'number' && Number.isFinite(o.qty) ? o.qty : str(o.qty);
    if (qty !== undefined) item.qty = qty;
    const unit = str(o.unit);
    if (unit) item.unit = unit;
    const category = str(o.category);
    if (category) item.category = category;
    const note = str(o.note);
    if (note) item.note = note;
    out.push(item);
  });
  return out;
}

export function stateFromNode(node: Rec, createdAt: number): ChecklistState {
  const title = str(node.title);
  return { kind: 'checklist', createdAt, ...(title ? { title } : {}), items: itemsFromNode(node.items) };
}

/* ───────────── labels ───────────── */

export function formatQty(item: Pick<CItem, 'qty' | 'unit'>): string {
  const q = item.qty;
  const qs = typeof q === 'number' ? formatNumber(q, 2) : q ?? '';
  return [qs, item.unit ?? ''].filter(Boolean).join(' ');
}

/** "500 g Hackfleisch", "Milch" */
export function itemLabel(item: CItem): string {
  const q = formatQty(item);
  return q ? `${q} ${item.text}` : item.text;
}

/* ───────────── categories ───────────── */

/** Internal key of the catch-all group (also used when the model sends this exact category). */
export const OTHER_CATEGORY = 'Sonstiges';

const CATEGORY_LABEL_KEYS: Record<string, 'fruitVeg' | 'bakery' | 'chilled' | 'meatFish' | 'frozen' | 'pantry' | 'drinks' | 'drugstore' | 'household' | 'other'> = {
  'Obst & Gemüse': 'fruitVeg',
  'Brot & Backwaren': 'bakery',
  'Kühlregal': 'chilled',
  'Fleisch & Fisch': 'meatFish',
  'Tiefkühl': 'frozen',
  'Vorrat': 'pantry',
  'Getränke': 'drinks',
  'Drogerie': 'drugstore',
  'Haushalt': 'household',
  [OTHER_CATEGORY]: 'other',
};

/** Display name of a (German-keyed) built-in category; model-supplied categories pass through unchanged. */
export function categoryLabel(cat: string, S: ModuleStrings = S_DE): string {
  const k = CATEGORY_LABEL_KEYS[cat];
  return k ? S.checklist.category[k] : cat;
}

export const SHOPPING_CATEGORIES = [
  'Obst & Gemüse',
  'Brot & Backwaren',
  'Kühlregal',
  'Fleisch & Fisch',
  'Tiefkühl',
  'Vorrat',
  'Getränke',
  'Drogerie',
  'Haushalt',
] as const;

// keyword rules: plain = substring (German compounds: "Vollkornbrot"), "=x" = whole word, "$x" = word suffix.
const RULES: Record<(typeof SHOPPING_CATEGORIES)[number], string[]> = {
  'Obst & Gemüse': [
    'apfel', 'äpfel', 'banane', 'birne', 'tomate', 'gurke', 'salat', 'karotte', 'möhre', 'zwiebel', 'knoblauch', 'kartoffel',
    'paprika', 'zucchini', 'zitrone', 'limette', 'orange', 'beere', 'traube', 'avocado', 'spinat', 'brokkoli', 'blumenkohl',
    'pilz', 'champignon', 'lauch', 'porree', 'ingwer', 'petersilie', 'basilikum', 'schnittlauch', 'koriander', 'kräuter',
    'aubergine', 'kürbis', 'mango', 'ananas', 'kiwi', 'sellerie', 'radieschen', 'rucola', 'kohl', 'obst', 'gemüse',
    'wassermelone', 'melone', 'pfirsich', 'nektarine', 'pflaume', 'kirsche', 'rote bete', 'fenchel', 'spargel', 'minze',
  ],
  'Brot & Backwaren': ['brot', 'brötchen', 'toast', 'baguette', 'croissant', 'brezel', 'laugen', 'knäcke', 'semmel', 'wrap', 'tortilla', 'kuchen'],
  Kühlregal: [
    'milch', 'joghurt', 'jogurt', 'quark', 'käse', 'butter', 'sahne', 'schmand', 'frischkäse', 'mozzarella', 'parmesan', 'feta',
    '=ei', 'eier', 'margarine', 'skyr', 'kefir', 'tofu', 'crème fraîche', 'creme fraiche', 'buttermilch', 'pudding', 'halloumi',
  ],
  'Fleisch & Fisch': [
    'hähnchen', 'hühnchen', 'huhn', 'pute', 'rind', 'schwein', 'hack', 'wurst', 'schinken', 'salami', 'speck', 'lachs', 'fisch',
    'garnele', 'steak', 'filet', 'bacon', 'würstchen', 'lamm', 'kalb',
  ],
  Tiefkühl: ['tiefkühl', '=tk', 'tk-', '=eis', 'eiswürfel', 'pommes', 'speiseeis', 'fischstäbchen'],
  Vorrat: [
    'nudeln', 'pasta', 'spaghetti', 'penne', 'fusilli', 'reis', 'mehl', 'zucker', 'salz', 'pfeffer', '$öl', '=öl', 'essig', 'konserve',
    'dose', 'tomatenmark', 'passata', 'linsen', 'bohnen', 'kichererbsen', 'haferflocken', 'müsli', 'cornflakes', 'honig',
    'marmelade', 'konfitüre', 'nutella', 'senf', 'ketchup', 'mayo', 'brühe', 'gewürz', 'backpulver', 'hefe', 'kaffee', '=tee',
    'kakao', 'thunfisch', 'schokolade', 'chips', 'kekse', 'nüsse', 'mandeln', 'paprikapulver', 'zimt', 'oregano', 'couscous',
    'bulgur', 'quinoa', 'erdnussbutter', 'sojasoße', 'sojasauce', 'kokosmilch',
  ],
  Getränke: ['wasser', 'saft', 'cola', 'limo', 'bier', 'wein', 'sprudel', 'schorle', 'sekt', 'eistee', 'hafermilch', 'mate'],
  Drogerie: [
    'zahnpasta', 'zahncreme', 'zahnbürste', 'shampoo', 'duschgel', 'seife', '=deo', 'deodorant', 'toilettenpapier', 'klopapier',
    'taschentücher', 'windeln', 'rasier', 'tampons', 'binden', 'sonnencreme', 'pflaster', 'wattestäbchen', 'spülung',
  ],
  Haushalt: [
    'spülmittel', 'waschmittel', 'müllbeutel', 'schwamm', 'alufolie', 'frischhaltefolie', 'backpapier', 'küchenrolle',
    'batterie', 'reiniger', 'geschirrtabs', 'spültabs', 'weichspüler', 'glühbirne', 'kerze',
  ],
};

// English keywords (added next to the German ones; categories keep their German keys).
const RULES_EN: Record<(typeof SHOPPING_CATEGORIES)[number], string[]> = {
  'Obst & Gemüse': [
    'apple', 'banana', 'pear', 'tomato', 'cucumber', 'lettuce', 'carrot', 'onion', 'garlic', 'potato', 'zucchini', 'courgette', 'lemon',
    'lime', 'berry', 'berries', 'grape', 'avocado', 'spinach', 'broccoli', 'cauliflower', 'mushroom', 'leek', 'ginger', 'parsley',
    'basil', 'cilantro', 'coriander', 'herbs', 'eggplant', 'pumpkin', 'pineapple', 'celery', 'radish', 'arugula', 'cabbage', 'fruit',
    'vegetable', 'watermelon', 'melon', 'peach', 'plum', 'cherry', 'beetroot', 'fennel', 'asparagus', '=mint', 'mango', 'kiwi',
  ],
  'Brot & Backwaren': ['bread', '=roll', '=rolls', 'bagel', 'pretzel', '=bun', '=buns', 'muffin', 'cake', 'croissant', 'baguette', 'tortilla'],
  Kühlregal: ['milk', 'yogurt', 'yoghurt', 'cheese', 'butter', '=cream', 'sour cream', '=egg', '=eggs', 'margarine', 'cottage', 'kefir', 'mozzarella', 'parmesan', 'feta'],
  'Fleisch & Fisch': ['chicken', 'turkey', 'beef', 'pork', '=mince', 'ground beef', 'sausage', '=ham', 'salami', 'bacon', 'salmon', '=fish', 'shrimp', 'prawn', 'steak', 'lamb', 'veal'],
  Tiefkühl: ['frozen', 'ice cream', '=fries', 'fish sticks'],
  Vorrat: [
    'pasta', 'noodle', '=rice', 'flour', 'sugar', '=salt', '=pepper', '=oil', 'vinegar', 'canned', 'tomato paste', 'lentil', '=beans', 'chickpea',
    'oats', 'cereal', 'honey', '=jam', 'mustard', 'ketchup', 'mayo', 'broth', 'spice', 'baking powder', 'yeast', 'coffee', '=tea',
    'cocoa', 'tuna', 'chocolate', '=chips', 'cookie', 'biscuit', '=nuts', 'almond', 'cinnamon', 'oregano', 'couscous', 'peanut butter',
    'soy sauce', 'coconut milk',
  ],
  Getränke: ['=water', 'juice', 'cola', 'soda', 'beer', '=wine', 'sparkling', 'iced tea', 'lemonade', 'oat milk'],
  Drogerie: [
    'toothpaste', 'toothbrush', 'shampoo', 'conditioner', 'shower gel', '=soap', 'deodorant', 'toilet paper', 'tissues', 'diaper',
    'razor', 'tampon', 'sunscreen',
  ],
  Haushalt: [
    'dish soap', 'detergent', 'trash bag', 'garbage bag', 'sponge', 'aluminum foil', 'aluminium foil', 'tin foil', 'cling film', 'plastic wrap',
    'baking paper', 'parchment', 'paper towel', 'battery', 'batteries', 'cleaner', 'light bulb', 'candle', 'fabric softener',
  ],
};

// Spanish keywords (categories keep their German keys). Accent-free variants are matched too (see inferCategory).
const RULES_ES: Record<(typeof SHOPPING_CATEGORIES)[number], string[]> = {
  'Obst & Gemüse': [
    'manzana', 'plátano', 'platano', 'banana', '=pera', '=peras', 'tomate', 'pepino', 'lechuga', 'zanahoria', 'cebolla', '=ajo', '=ajos', 'patata', '=papa', '=papas',
    'pimiento', 'calabacín', 'calabacin', 'limón', 'limon', '=lima', '=limas', 'fresa', 'frambuesa', 'arándano', 'arandano', '=uva', '=uvas', 'aguacate',
    'espinaca', 'brócoli', 'brocoli', 'coliflor', 'champiñón', 'champinon', '=seta', '=setas', 'puerro', 'jengibre', 'perejil', 'albahaca',
    'cilantro', 'hierbas', 'berenjena', 'calabaza', 'piña', 'pina', '=apio', 'rábano', 'rabano', 'rúcula', 'rucula', '=col', '=coles', 'fruta',
    'verdura', 'sandía', 'sandia', 'melón', 'melon', 'melocotón', 'melocoton', 'durazno', 'ciruela', 'cereza', 'remolacha', 'hinojo',
    'espárrago', 'esparrago', 'menta', 'naranja', 'mandarina', 'kiwi', 'mango',
  ],
  'Brot & Backwaren': ['=pan', 'bollo', 'tostada', 'baguette', 'barra de pan', 'croissant', 'cruasán', 'cruasan', 'magdalena', 'tortilla de trigo', 'tarta', 'bizcocho', 'pastel', 'galleta'],
  Kühlregal: [
    'leche', 'yogur', 'yogurt', 'queso', 'mantequilla', '=nata', 'crema agria', 'requesón', 'requeson', 'mozzarella', 'parmesano', 'feta',
    '=huevo', '=huevos', 'margarina', 'kéfir', 'kefir', 'tofu', 'cuajada', 'flan', 'natillas',
  ],
  'Fleisch & Fisch': [
    'pollo', 'pavo', 'ternera', 'vacuno', 'cerdo', 'carne picada', 'carne', 'salchicha', 'jamón', 'jamon', 'salami', 'chorizo', 'beicon',
    'bacon', 'panceta', 'salmón', 'salmon', 'pescado', 'merluza', 'atún fresco', 'gamba', 'camarón', 'camaron', 'filete', 'cordero', 'chuleta',
  ],
  Tiefkühl: ['congelado', 'helado', 'hielo', 'patatas fritas congeladas', 'palitos de pescado', 'pizza congelada'],
  Vorrat: [
    'pasta', 'espagueti', 'macarrones', 'fideos', '=arroz', 'harina', 'azúcar', 'azucar', '=sal', 'pimienta', 'aceite', 'vinagre', 'conserva',
    'tomate frito', 'tomate triturado', 'concentrado de tomate', 'lentejas', 'alubias', 'judías', 'judias', 'garbanzos', 'avena', 'cereales',
    'muesli', 'miel', 'mermelada', 'mostaza', 'kétchup', 'ketchup', 'mayonesa', 'caldo', 'especias', 'levadura', 'café', 'cafe', '=té',
    'cacao', 'atún', 'atun', 'chocolate', 'patatas fritas', 'frutos secos', 'almendra', 'nueces', 'canela', 'orégano', 'oregano', 'cuscús', 'cuscus',
    'quinoa', 'crema de cacahuete', 'mantequilla de cacahuete', 'salsa de soja', 'leche de coco', 'aceitunas',
  ],
  Getränke: ['agua', 'zumo', 'jugo', 'refresco', '=cola', 'limonada', 'cerveza', '=vino', '=cava', 'champán', 'champan', 'té helado', 'bebida', 'gaseosa', 'tónica', 'tonica'],
  Drogerie: [
    'pasta de dientes', 'dentífrico', 'dentifrico', 'cepillo de dientes', 'champú', 'champu', 'gel de ducha', 'gel de baño', 'jabón', 'jabon',
    'desodorante', 'papel higiénico', 'papel higienico', 'pañuelos', 'pañales', 'panales', 'cuchilla', 'afeitar', 'tampones', 'compresas',
    'protector solar', 'crema solar', 'tiritas', 'bastoncillos', 'acondicionador',
  ],
  Haushalt: [
    'lavavajillas', 'detergente', 'suavizante', 'bolsas de basura', 'bolsa de basura', 'esponja', 'papel de aluminio', 'film transparente',
    'papel de horno', 'papel de cocina', '=pilas', 'limpiador', 'lejía', 'lejia', 'bombilla', '=vela', '=velas', 'fregasuelos', 'estropajo',
  ],
};

type Rule = { kw: string; mode: 'sub' | 'word' | 'suffix'; cat: string };
const RULE_LIST: Rule[] = [...Object.entries(RULES), ...Object.entries(RULES_EN), ...Object.entries(RULES_ES)]
  .flatMap(([cat, kws]) =>
    kws.map((k): Rule => (k[0] === '=' ? { kw: k.slice(1), mode: 'word', cat } : k[0] === '$' ? { kw: k.slice(1), mode: 'suffix', cat } : { kw: k, mode: 'sub', cat })),
  )
  // longest keyword wins ("Tomatenmark" → Vorrat, "Eisbergsalat" → Obst & Gemüse, "Reis" → Vorrat)
  .sort((a, b) => b.kw.length - a.kw.length);

/** Best-effort supermarket category for a German item text; undefined if unknown. */
export function inferCategory(text: string): string | undefined {
  const lower = text.toLowerCase();
  const words = lower.split(/[^a-zäöüßáéíóúñ-]+/).filter(Boolean);
  for (const r of RULE_LIST) {
    if (r.mode === 'sub' ? lower.includes(r.kw) : r.mode === 'word' ? words.includes(r.kw) : words.some((w) => w.endsWith(r.kw))) return r.cat;
  }
  return undefined;
}

/* ───────────── grouping ───────────── */

export type ChecklistGroup = { key: string; title: string; items: CItem[] };
export type GroupedChecklist = { groups: ChecklistGroup[]; done: CItem[]; total: number; doneCount: number };

/** Whether to show category headers. */
export function shouldGroup(kind: ChecklistKind, groupBy: unknown, items: readonly CItem[]): boolean {
  if (groupBy === 'none') return false;
  if (groupBy === 'category') return true;
  return kind === 'shopping' || items.some((i) => !!i.category);
}

/**
 * Open items (grouped by category when `grouped`) first, all checked items in `done` at the bottom.
 * Shopping lists infer missing categories and use supermarket order; others keep first-appearance
 * order. "Sonstiges" always comes last. Item order inside a group = list order.
 */
export function groupChecklist(items: readonly CItem[], o: { kind: ChecklistKind; grouped: boolean }): GroupedChecklist {
  const open = items.filter((i) => !i.checked);
  const done = items.filter((i) => i.checked);
  const base = { done, total: items.length, doneCount: done.length };
  if (!o.grouped) return { ...base, groups: open.length ? [{ key: '', title: '', items: open }] : [] };
  const other = OTHER_CATEGORY;
  const map = new Map<string, CItem[]>();
  for (const it of open) {
    const cat = it.category ?? (o.kind === 'shopping' ? inferCategory(it.text) : undefined) ?? other;
    const list = map.get(cat);
    if (list) list.push(it);
    else map.set(cat, [it]);
  }
  const order = (c: string): number => {
    if (c === other) return 1e6;
    const i = o.kind === 'shopping' ? (SHOPPING_CATEGORIES as readonly string[]).indexOf(c) : -1;
    return i >= 0 ? i : 1000;
  };
  const keys = [...map.keys()];
  const groups = keys
    .map((k, idx) => ({ k, idx }))
    .sort((a, b) => order(a.k) - order(b.k) || a.idx - b.idx)
    .map(({ k }) => ({ key: k, title: k, items: map.get(k)! }));
  // a single "Sonstiges" group needs no header
  if (groups.length === 1 && groups[0].key === other) groups[0] = { ...groups[0], title: '' };
  return { ...base, groups };
}

/* ───────────── mutations ───────────── */

export function toggleItem(s: ChecklistState, id: string): ChecklistState {
  return { ...s, items: s.items.map((i) => (i.id === id ? { ...i, checked: !i.checked } : i)) };
}

export function removeItem(s: ChecklistState, id: string): { state: ChecklistState; removed: CItem | null; index: number } {
  const index = s.items.findIndex((i) => i.id === id);
  if (index < 0) return { state: s, removed: null, index };
  return { state: { ...s, items: s.items.filter((i) => i.id !== id) }, removed: s.items[index], index };
}

export function restoreItem(s: ChecklistState, item: CItem, index: number): ChecklistState {
  if (s.items.some((i) => i.id === item.id)) return s;
  const items = [...s.items];
  items.splice(Math.max(0, Math.min(index, items.length)), 0, item);
  return { ...s, items };
}

const UNITS = ['kg', 'g', 'mg', 'l', 'ml', 'cl', 'dl', 'stk', 'stk.', 'stück', 'pck', 'pck.', 'packung', 'packungen', 'dose', 'dosen', 'bund', 'glas', 'gläser', 'flasche', 'flaschen', 'becher', 'tl', 'el', 'x', 'beutel', 'kopf', 'rolle', 'rollen', 'tüte'];

/** Quick-add parsing: "2 l Milch" → {qty: 2, unit: 'l', text: 'Milch'}; "6 Eier" → {qty: 6, text: 'Eier'}; "1,5kg Mehl". */
export function parseItemInput(input: string): { text: string; qty?: number; unit?: string } | null {
  const s = input.replace(/\s+/g, ' ').trim();
  if (!s) return null;
  const m = /^(\d+(?:[.,]\d+)?|½|¼|¾)\s*([a-zA-ZäöüÄÖÜ.]+)?\s+(.+)$/.exec(s);
  if (!m) return { text: s };
  const frac: Record<string, number> = { '½': 0.5, '¼': 0.25, '¾': 0.75 };
  const qty = frac[m[1]] ?? Number(m[1].replace(',', '.'));
  if (!Number.isFinite(qty)) return { text: s };
  const unitRaw = m[2];
  if (unitRaw && UNITS.includes(unitRaw.toLowerCase())) return { qty, unit: unitRaw === 'X' ? 'x' : unitRaw, text: m[3] };
  // "6 Eier" – no unit; the word belongs to the text
  return { qty, text: unitRaw ? `${unitRaw} ${m[3]}` : m[3] };
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

export type AddOutcome = 'added' | 'reopened' | 'duplicate' | 'empty';

/** Add a typed entry (case-insensitive de-dup like add_to_list: checked duplicate → reopened). */
export function addItem(s: ChecklistState, input: string, newId: () => string, kind: ChecklistKind): { state: ChecklistState; outcome: AddOutcome; id?: string } {
  const p = parseItemInput(input);
  if (!p) return { state: s, outcome: 'empty' };
  const hit = s.items.find((i) => norm(i.text) === norm(p.text));
  if (hit) {
    if (!hit.checked) return { state: s, outcome: 'duplicate', id: hit.id };
    return { state: toggleItem(s, hit.id), outcome: 'reopened', id: hit.id };
  }
  const item: CItem = { id: newId(), text: p.text, checked: false };
  if (p.qty !== undefined) item.qty = p.qty;
  if (p.unit) item.unit = p.unit;
  if (kind === 'shopping') {
    const cat = inferCategory(p.text);
    if (cat) item.category = cat;
  }
  return { state: { ...s, items: [...s.items, item] }, outcome: 'added', id: item.id };
}

/* ───────────── output ───────────── */

export function checklistReplyFor(id: string, items: readonly CItem[]): string {
  return checklistReply(
    id,
    items.filter((i) => i.checked).map(itemLabel),
    items.filter((i) => !i.checked).map(itemLabel),
  );
}

/** Plain-text export for the share sheet / clipboard. */
export function checklistShareText(title: string, items: readonly CItem[], o: { kind: ChecklistKind; grouped: boolean }, S: ModuleStrings = S_DE): string {
  const g = groupChecklist(items, o);
  const lines: string[] = [S.checklist.shareHeader(title, g.doneCount, g.total)];
  for (const grp of g.groups) {
    lines.push('');
    if (grp.title) lines.push(categoryLabel(grp.title, S));
    for (const it of grp.items) lines.push(`☐ ${itemLabel(it)}${it.note ? ` (${it.note})` : ''}`);
  }
  if (g.done.length) {
    lines.push('', S.checklist.done(g.done.length));
    for (const it of g.done) lines.push(`☑ ${itemLabel(it)}`);
  }
  return lines.join('\n');
}
