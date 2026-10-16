import assert from 'node:assert/strict';
import { test } from 'node:test';
import { columnLooksLikeProduct, compareLooksLikeProducts, compareProductQuery, titleModelStrength } from './compareProducts.ts';

const col = (title: string, items: string[] = [], extra: { pros?: string[]; cons?: string[] } = {}) => ({ title, items, ...extra });

// the owner's case, anonymised shape: seven retro handhelds as generic compare columns, chip/RAM, display, battery, price
const HANDHELDS = [
  col('TrimUI Brick Hammer', ['Chip: Allwinner A133P, 1 GB RAM', 'Display: 3,2″ IPS', 'Akku: 3000 mAh', 'ca. 90 €']),
  col('Pocket Mini V2', ['Chip: Unisoc T618', 'Display: 3,92″ OLED', 'ca. 150 €']),
  col('AYN Odin 2 Mini', ['Snapdragon 8 Gen 2, 8 GB RAM', '5″ OLED, 1080p', 'Akku: 5000 mAh', 'ab ca. 400 €']),
  col('RG 35XX SP', ['H700, 1 GB RAM', '3,5″ IPS, klappbar', 'ca. 70 €']),
  col('RG 28XX', ['H700', '2,83″ IPS', 'ca. 50 €']),
  col('Konkr Pocket Advance', ['Display: 4,7″ IPS', 'Hall-Sticks']),
  col('RG Rotate', ['Drehbares 3,5″ Display', 'ca. 100 €']),
];

test('the owner\'s seven handhelds are a product comparison (every column)', () => {
  for (const c of HANDHELDS) assert.equal(columnLooksLikeProduct(c), true, c.title);
  assert.equal(compareLooksLikeProducts(HANDHELDS), true);
});

test('phones, headphones, cars, appliances (EN/DE) are products', () => {
  const cases = [
    [col('iPhone 17', ['6,3″ OLED, 120 Hz', 'ab ca. 950 €']), col('Pixel 11', ['Tensor G6', 'ab ca. 900 €'])],
    [col('Sony WH-1000XM6', ['30 h battery', '$449']), col('Bose QC Ultra', ['24 h battery', '$429'])],
    [col('Tesla Model 3', ['ab 39.990 €', '513 km WLTP']), col('BMW i4', ['ab 57.000 €', '340 PS'])],
    [col('Dyson V15', ['230 AW', '3 kg']), col('Roborock S8', ['Saugroboter', '6000 Pa', 'ca. 500 €'])],
    [col('Raspberry Pi 5', ['ca. 80-120 €', '3-8 W']), col('Mini-PC (Intel N100)', ['ca. 130-180 €', '6-12 W'])],
    // fictional demo headphones (scripts/demo-videos/compare-shots.mjs); "Ultra hybrid" is no "a h(our)" price
    [col('Aurel QX7', ['ANC: adaptive, 8 mics', 'Battery: 32 h', 'about €329']), col('Halden H2', ['ANC: Ultra hybrid', 'about €149'])],
  ];
  for (const cols of cases) assert.equal(compareLooksLikeProducts(cols), true, cols.map((c) => c.title).join(' vs '));
});

test('concepts, plans, services, places and versions stay plain compare columns', () => {
  const cases = [
    [col('Kubernetes', ['Großes Ökosystem', 'Komplex']), col('Nomad', ['Einfach', 'Kleineres Ökosystem'])],
    [col('Miete', ['Flexibel', 'ca. 1.100 € warm']), col('Kauf', ['Vermögensaufbau', 'Kaufpreis 450.000 €'])],
    [col('Lissabon', ['Flug ab 89 €', 'Hügelig']), col('Porto', ['Flug ab 79 €', 'Kleiner'])],
    [col('BahnCard 25', ['62,90 € / Jahr', '25 % Rabatt']), col('BahnCard 50', ['244 € pro Jahr', '50 % Rabatt'])],
    [col('Tarif M', ['20 GB', '19,99 €/Monat']), col('Tarif L', ['40 GB', '29,99 € monatlich'])],
    [col('Python 3.12', ['Schneller']), col('Python 3.13', ['Freies GIL experimentell'])],
    [col('IPv4', ['32-Bit-Adressen', 'NAT nötig']), col('IPv6', ['128-Bit-Adressen'])],
    [col('5G', ['bis 10 GB/s', 'Neue Masten']), col('4G', ['bis 300 Mbit/s'])],
    [col('AWS S3', ['$0.023 per GB']), col('Cloudflare R2', ['$0.015 per GB', 'keine Egress-Kosten'])],
    [col('Pflegegrad 2', ['332 €']), col('Pflegegrad 3', ['573 €'])],
    [col('Apple Music', ['10,99 €/Monat']), col('Spotify', ['10,99 €/Monat'])],
  ];
  for (const cols of cases) assert.equal(compareLooksLikeProducts(cols), false, cols.map((c) => c.title).join(' vs '));
});

test('precision: one non-product column, a lone column or titles without facts → no thumbnails', () => {
  assert.equal(compareLooksLikeProducts([HANDHELDS[0], col('Emulation am PC', ['Kostenlos', 'Kein Akku'])]), false);
  assert.equal(compareLooksLikeProducts([HANDHELDS[0]]), false);
  assert.equal(compareLooksLikeProducts([col('iPhone 17'), col('Pixel 11')]), false, 'no price, no specs');
  assert.equal(compareLooksLikeProducts([]), false);
});

test('title strength: product lines and maker + model are strong, bare model tokens weak', () => {
  assert.equal(titleModelStrength('iPhone 17 Pro'), 'strong');
  assert.equal(titleModelStrength('Bose QC Ultra'), 'strong');
  assert.equal(titleModelStrength('RG 35XX SP'), 'weak');
  assert.equal(titleModelStrength('Golf 8'), 'weak');
  assert.equal(titleModelStrength('Kubernetes'), null);
  assert.equal(titleModelStrength('CO2-Steuer'), null);
  // weak titles need device specs, a price alone is not enough
  assert.equal(columnLooksLikeProduct(col('Golf 8', ['ab 30.000 €'])), false);
  assert.equal(columnLooksLikeProduct(col('Golf 8', ['ab 30.000 €', '150 PS'])), true);
});

test('thumbnail query: the title, a trailing note in brackets dropped when the rest still names a model', () => {
  assert.equal(compareProductQuery('AYN Odin 2 Mini'), 'AYN Odin 2 Mini');
  assert.equal(compareProductQuery('Pixel 11 (Empfehlung)'), 'Pixel 11');
  assert.equal(compareProductQuery('Mini-PC (Intel N100)'), 'Mini-PC (Intel N100)');
});
