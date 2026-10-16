/**
 * Safety net for `compare` nodes over concrete products ("iPhone 17 vs Pixel 11", seven retro handhelds): the skill
 * asks for `products` with `compare:true` there, but when a model still writes generic compare columns without an
 * `imageQuery`, each column gets a small product thumbnail through the same image machinery as product cards
 * (autoQuery from the column title, web search only, the same privacy rules).
 *
 * Precision over recall: a node counts only when EVERY column (2+) looks like a product: its title names a model
 * (a model token like "N100", "XM6", "35XX", a known product line, or "Name 17"), its facts carry a one-off price or
 * typical device specs, and nothing reads like a subscription (recurring price) or a plan. Concepts, plans,
 * services and places ("Kubernetes vs Nomad", "Miete vs Kauf", "BahnCard 25 vs 50", "Lissabon vs Porto") stay
 * plain columns. Pure: no RN imports (tested in compareProducts.test.ts).
 */
import { productImageQuery } from '../../images/itemImage.ts';

type Column = { title?: unknown; items?: unknown; pros?: unknown; cons?: unknown; imageQuery?: unknown };

/** device / gadget lines that name a buyable product on their own */
const PRODUCT_LINE =
  /(^|[^\p{L}\p{N}])(iphone|ipad|macbook|imac|mac mini|airpods|apple watch|pixel|galaxy|xperia|oneplus|redmi|fairphone|thinkpad|ideapad|zenbook|vivobook|surface (pro|laptop|go|book)|kindle|kobo|tolino|playstation|ps[345]|xbox|nintendo|switch|steam deck|rog ally|legion go|ayaneo|trimui|anbernic|konkr|rg ?(\d{2,3}|rotate|cube|arc|nano|ds|slide)|miyoo|retroid|powkiddy|odin|game ?boy|gopro|garmin|fitbit|roborock|dyson|thermomix|nespresso|tesla model|quietcomfort|raspberry pi)(?![\p{L}])/iu;
/** makers: only together with a model token in the same title ("Sony WH-1000XM6", "Bose QC Ultra") */
const MAKER =
  /(^|[^\p{L}\p{N}])(apple|google|samsung|sony|bose|sennheiser|beyerdynamic|jbl|lg|lenovo|dell|hp|asus|acer|msi|razer|logitech|canon|nikon|fujifilm|panasonic|philips|bosch|siemens|miele|xiaomi|huawei|honor|oppo|anker|ecovacs|dji|ayn|vw|volkswagen|bmw|audi|mercedes|toyota|skoda|hyundai|kia|volvo|porsche|ford|renault)(?![\p{L}\p{N}])/iu;
/** letters and digits in one token ("N100", "XM6", "35XX", "S25", the "1000XM6" of "WH-1000XM6") */
const MIXED_TOKEN = /(?<![\p{L}\p{N}])(?=[\p{L}\p{N}]*\p{L})(?=[\p{L}\p{N}]*\d)[\p{L}\p{N}]+(?![\p{L}\p{N}])/gu;
/** technical / everyday tokens with digits that are no product model */
const NOT_A_MODEL = /^(co2e?|h2o|mp[34]|web\d|covid-?19|ipv[46]|b2[bc]|h\.?26[45]|wpa[23]|usb\d?|[1-6]g|q[1-4]|fy\d+|\d+(st|nd|rd|th|er|te|ten)|\d+(kb|mb|gb|tb|h|min|km|kg|w|v|mm|cm|m|s|x|p|k))$/i;
const MODEL_WORD = /(^|[^\p{L}\p{N}])(qc|ultra|pro|max|mini|plus|lite|oled)(?![\p{L}\p{N}])/iu;
/** "Odin 2", "Golf 8", "iPhone 17": a capitalised name followed by a model number */
const NAME_NUMBER = /(^|[^\p{L}\p{N}])\p{Lu}[\p{L}]+\s\d{1,4}(?![\d.,:%])/u;

const hasModelToken = (t: string): boolean => [...t.matchAll(MIXED_TOKEN)].some((m) => m[0].length >= 2 && !NOT_A_MODEL.test(m[0]));

const PRICE = /(€|\$|£|\b(eur|usd|chf|gbp)\b)\s?\d|\d\s?(€|\$|£|euro\b|eur\b|usd\b|chf\b|gbp\b)/i;
const RECURRING = /(\/|\b(pro|per|je|a|al|por) )\s?(monat|mon\.|mo\b|month|jahr|year|yr|woche|week|mes|año|gb|tb|stunde|hour|h\b|kwh|nutzer|user|seat|request)|monatlich|jährlich|monthly|yearly|annual|abo\b|subscription|p\.\s?a\.|tarif|vertrag|laufzeit|flatrate/i;
const SPEC_UNIT =
  /\d(?:[.,]\d+)?\s?(gb|tb|mb|mah|wh|hz|mp|kw|ps|ppi|nits?|zoll|inch|″|"|mm|kg|w)(?![\p{L}])/iu;
const SPEC_WORD =
  /(^|[^\p{L}])(oled|amoled|ips|lcd|snapdragon|tensor|dimensity|exynos|ryzen|core i\d|intel|unisoc|allwinner|rockchip|apple [am]\d+|[am]\d{2} (bionic|pro)|ram|ssd|akku|battery|display|chip|cpu|gpu|anc|bluetooth|wi-?fi|usb-?c|joystick|hall-?sticks?|android|ios)(?![\p{L}])/iu;

const texts = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/**
 * How surely the column title names a concrete model: 'strong' (a product line, or a maker with a model token),
 * 'weak' (a model token or "Name 17" alone: could be a version, a grade, a standard), or null.
 */
export function titleModelStrength(title: string): 'strong' | 'weak' | null {
  const t = title.trim();
  if (!t || t.length > 80) return null;
  if (PRODUCT_LINE.test(t)) return 'strong';
  const token = hasModelToken(t);
  const named = NAME_NUMBER.test(t);
  if (MAKER.test(t) && (token || named || MODEL_WORD.test(t))) return 'strong';
  return token || named ? 'weak' : null;
}

/**
 * One column: model-like title; a strong title needs a one-off price or device specs in its facts, a weak one device
 * specs; nothing subscription-like (recurring or usage price, plan, contract).
 */
export function columnLooksLikeProduct(c: Column): boolean {
  const title = typeof c.title === 'string' ? c.title : '';
  const strength = titleModelStrength(title);
  if (!strength) return false;
  const facts = [...texts(c.items), ...texts(c.pros), ...texts(c.cons)];
  if (RECURRING.test([title, ...facts].join('\n'))) return false;
  const spec = facts.some((f) => SPEC_UNIT.test(f) || SPEC_WORD.test(f));
  return spec || (strength === 'strong' && facts.some((f) => PRICE.test(f)));
}

/** Every column (2+) is a product: the compare node is a product comparison. */
export function compareLooksLikeProducts(columns: readonly Column[]): boolean {
  return columns.length >= 2 && columns.every(columnLooksLikeProduct);
}

/** Search query for a column's thumbnail: the title without a trailing note in brackets ("Mini-PC (Intel N100)" keeps it: has a model). */
export function compareProductQuery(title: string): string | undefined {
  const bare = title.replace(/\s*[([][^)\]]*[)\]]\s*$/, '').trim();
  return productImageQuery({ name: bare && titleModelStrength(bare) ? bare : title });
}
