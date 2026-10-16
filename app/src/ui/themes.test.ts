import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contrast, ensureContrast, normalizeHex } from './color.ts';
import { deltaE, worstPairs } from './cvd.ts';
import {
  FEATURED_THEME_FAMILIES,
  pickerFamilies,
  ACCENT_SWATCHES,
  THEME_FAMILIES,
  THEME_FAMILY_IDS,
  buildColors,
  checkCustomAccent,
  controlBorder,
  familySchemes,
  resolveVariant,
  scaleFont,
  scaleSpacing,
  scaleTypography,
  FONT_SCALE,
  SKELETON_MIN_CONTRAST,
  type ThemeFamilyId,
} from './themes.ts';

const SCHEMES = ['light', 'dark'] as const;
const HEX = /^#[0-9a-f]{6}$/i;
const COLOR = /^(#[0-9a-f]{6}|rgba\(\d+,\d+,\d+,(0|1|0?\.\d+)\))$/i;

// every key of ThemeColors (kept in sync with theme.ts; a missing one fails here and in tsc)
const KEYS = [
  'bg', 'surface', 'surfaceAlt', 'surfacePressed', 'text', 'muted', 'subtle', 'accent', 'accentText', 'onAccent', 'accentSoft',
  'border', 'borderStrong', 'borderControl', 'success', 'successSoft', 'warning', 'warningSoft', 'danger', 'dangerSoft',
  'ink', 'onInk', 'seal', 'onSeal', 'sealSoft', 'info', 'infoSoft',
  'codeBg', 'codeText', 'codeComment', 'codeKeyword', 'codeString', 'codeNumber', 'codeFunction',
  'skeleton', 'skeletonHighlight', 'overlay', 'chart',
];

const variants = THEME_FAMILY_IDS.flatMap((id) => familySchemes(id).map((s) => [id, s] as const));

test('registry: at least 9 families, ids match, every family has a dark or light variant', () => {
  assert.ok(THEME_FAMILY_IDS.length >= 9);
  for (const id of THEME_FAMILY_IDS) {
    assert.equal(THEME_FAMILIES[id].id, id);
    assert.ok(familySchemes(id).length >= 1, id);
  }
  // ≥ 16 own variants (Hell, Dunkel, OLED, Graphit ×2, Papier ×2, Nord ×2, Solarized ×2, Rosé ×2, Wald ×2, Ozean ×2)
  assert.ok(variants.length >= 17, `${variants.length} variants`);
});

test('System pairing: every family resolves for both schemes (OLED light → Standard light)', () => {
  for (const id of THEME_FAMILY_IDS) for (const s of SCHEMES) assert.ok(resolveVariant(id, s).spec, `${id}/${s}`);
  assert.equal(resolveVariant('oled', 'light').family, 'standard');
  assert.equal(resolveVariant('oled', 'dark').family, 'oled');
  assert.equal(resolveVariant('nord', 'dark').family, 'nord');
});

test('completeness: every variant has the full token set with valid colors + 8 distinct chart colors', () => {
  for (const id of THEME_FAMILY_IDS) {
    for (const s of SCHEMES) {
      const c = buildColors(id, s) as unknown as Record<string, unknown>;
      assert.deepEqual(Object.keys(c).sort(), [...KEYS].sort(), `${id}/${s} keys`);
      for (const k of KEYS) {
        if (k === 'chart') continue;
        assert.match(String(c[k]), COLOR, `${id}/${s}.${k} = ${c[k]}`);
      }
      const chart = c.chart as string[];
      assert.equal(chart.length, 8, `${id}/${s} chart length`);
      for (const col of chart) assert.match(col, HEX);
      assert.equal(new Set(chart.map((x) => x.toLowerCase())).size, 8, `${id}/${s} chart colors distinct`);
    }
  }
});

const ratio = (a: string, b: string) => Math.round(contrast(a, b) * 100) / 100;
function minOn(fg: string, ...bgs: string[]) {
  return Math.min(...bgs.map((b) => ratio(fg, b)));
}

const hexOnly = (...cs: string[]) => cs.filter((c) => HEX.test(c));
/** families that use the Hermes chart palette (validated as a set: ≥ 3:1 marks, CVD target ≥ 8, all-pairs for the first 3) */
const HERMES_PALETTE_FAMILIES: readonly ThemeFamilyId[] = ['standard', 'oled', 'graphite', 'paper', 'forest', 'ocean'];

for (const [id, s] of variants) {
  test(`WCAG contrast ${id}/${s}`, () => {
    const c = buildColors(id, s);
    const surfaces = [c.bg, c.surface, c.surfaceAlt];
    // every text tier is small text somewhere (body, timestamps, captions, credits): AA 4.5 on every surface, light and dark
    for (const k of ['text', 'muted', 'subtle'] as const) {
      const m = minOn(c[k], ...surfaces);
      assert.ok(m >= 4.5, `${k} ${m}`);
    }
    // three distinguishable steps: text > muted > subtle
    assert.ok(minOn(c.text, ...surfaces) > minOn(c.muted, ...surfaces), 'text stronger than muted');
    assert.ok(minOn(c.muted, ...surfaces) > minOn(c.subtle, ...surfaces), 'muted stronger than subtle');
    // the family accent is also link / text-button color: AA 4.5 on bg + surface, ≥ 3 (UI component) on surfaceAlt
    assert.ok(minOn(c.accent, c.bg, c.surface) >= 4.5, `accent ${minOn(c.accent, c.bg, c.surface)}`);
    assert.ok(minOn(c.accent, c.surfaceAlt) >= 3, `accent/alt ${minOn(c.accent, c.surfaceAlt)}`);
    // text on accent (primary buttons): ≥ 4.5; accent text on its soft tint (selected chips): ≥ 4.5
    assert.ok(ratio(c.onAccent, c.accent) >= 4.5, `onAccent ${ratio(c.onAccent, c.accent)}`);
    for (const soft of hexOnly(c.accentSoft)) assert.ok(ratio(c.accent, soft) >= 4.5, `accent on accentSoft ${ratio(c.accent, soft)}`);
    // the button system: ink-filled primary and seal-filled approval / danger buttons carry ≥ 4.5 labels; the seal is
    // also a small mark and text (risk seal, "Delete" outline) on bg, surface and its tint
    assert.ok(ratio(c.onInk, c.ink) >= 4.5, `onInk ${ratio(c.onInk, c.ink)}`);
    assert.ok(ratio(c.onSeal, c.seal) >= 4.5, `onSeal ${ratio(c.onSeal, c.seal)}`);
    assert.ok(minOn(c.seal, c.bg, c.surface, ...hexOnly(c.sealSoft)) >= 4.5, `seal ${minOn(c.seal, c.bg, c.surface, ...hexOnly(c.sealSoft))}`);
    // status + info colors are short labels (chips, deltas, errors): AA 4.5 on bg, surface and their own soft tint
    for (const [k, soft] of [['success', c.successSoft], ['warning', c.warningSoft], ['danger', c.dangerSoft], ['info', c.infoSoft]] as const) {
      const m = minOn(c[k], c.bg, c.surface, ...hexOnly(soft));
      assert.ok(m >= 4.5, `${k} ${m}`);
    }
    // code: text and every syntax color are small mono text → AA 4.5 on the code background
    for (const k of ['codeText', 'codeComment', 'codeKeyword', 'codeString', 'codeNumber', 'codeFunction'] as const) {
      assert.ok(ratio(c[k], c.codeBg) >= 4.5, `${k} ${ratio(c[k], c.codeBg)}`);
    }
    // syntax colors stay distinguishable from each other
    const syntax = [c.codeKeyword, c.codeString, c.codeNumber, c.codeFunction].map((x) => x.toLowerCase());
    assert.equal(new Set(syntax).size, 4, `${id}/${s} distinct syntax colors ${syntax}`);
    // chart marks always come with legend/labels; the Hermes palette also clears 3:1 (non-text), the others ≥ 2
    const markMin = HERMES_PALETTE_FAMILIES.includes(id) ? 3 : 2;
    for (const col of c.chart) assert.ok(ratio(col, c.surface) >= markMin, `chart ${col} ${ratio(col, c.surface)}`);
  });

  test(`chart palette under color-vision deficiency ${id}/${s}`, () => {
    const { chart } = buildColors(id, s);
    const hermes = HERMES_PALETTE_FAMILIES.includes(id);
    // neighbouring series (stacks, bars, lines): Machado 2009 protanopia / deuteranopia, OKLab ΔE × 100
    const adj = worstPairs(chart);
    for (const v of ['protan', 'deutan'] as const) {
      assert.ok(adj[v].dE >= (hermes ? 8 : 6), `${v} ${adj[v].a}/${adj[v].b} ΔE ${adj[v].dE.toFixed(1)}`);
    }
    assert.ok(adj.normal.dE >= 15, `normal vision ${adj.normal.a}/${adj.normal.b} ΔE ${adj.normal.dE.toFixed(1)}`);
    if (hermes) {
      // scatter / small multiples: the first three slots are safe as all-pairs
      const all3 = worstPairs(chart.slice(0, 3), 3);
      for (const v of ['protan', 'deutan'] as const) assert.ok(all3[v].dE >= 8, `all-pairs ${v} ${all3[v].dE.toFixed(1)}`);
    }
  });
}

/**
 * Text/icon color × background pairs the UI actually renders (found by scanning app/src for `color` tokens inside
 * elements with a `backgroundColor` token). Small text needs 4.5:1; the transient pressed surface is exempt.
 */
const USED_TEXT_PAIRS: readonly (readonly [fg: string, bgs: readonly string[]])[] = [
  ['text', ['bg', 'surface', 'surfaceAlt', 'surfacePressed', 'accentSoft', 'successSoft', 'warningSoft', 'dangerSoft', 'infoSoft', 'codeBg']],
  ['muted', ['bg', 'surface', 'surfaceAlt', 'surfacePressed', 'accentSoft', 'successSoft', 'warningSoft', 'dangerSoft', 'infoSoft', 'codeBg']],
  ['subtle', ['bg', 'surface', 'surfaceAlt', 'accentSoft', 'successSoft', 'warningSoft', 'dangerSoft', 'infoSoft', 'codeBg']],
  ['accent', ['bg', 'surface', 'surfaceAlt', 'accentSoft', 'codeBg']],
  ['accentText', ['bg', 'surface', 'surfaceAlt', 'accentSoft', 'codeBg']],
  ['info', ['bg', 'surface', 'surfaceAlt', 'infoSoft']],
  ['success', ['bg', 'surface', 'surfaceAlt', 'successSoft']],
  ['warning', ['bg', 'surface', 'surfaceAlt', 'warningSoft']],
  ['danger', ['bg', 'surface', 'surfaceAlt', 'dangerSoft']],
  ['onAccent', ['accent']],
];

for (const [id, s] of variants) {
  test(`WCAG contrast of every used text/background pair ${id}/${s}`, () => {
    const c = buildColors(id, s) as unknown as Record<string, string>;
    for (const [fg, bgs] of USED_TEXT_PAIRS) {
      for (const bg of bgs) {
        if (!HEX.test(c[bg])) continue;
        assert.ok(contrast(c[fg], c[bg]) >= 4.5, `${fg} on ${bg} ${ratio(c[fg], c[bg])}`);
      }
    }
    // text on a filled status badge (Guide / Workout / attachment error): onAccent is the light-or-dark pick for accent only
    for (const fill of ['success', 'danger'] as const) {
      assert.ok(Math.max(contrast('#ffffff', c[fill]), contrast('#0b0b0f', c[fill])) >= 4.5, `best text on ${fill}`);
    }
  });
}

test('accent swatches: every swatch × family × scheme keeps accent ≥ 3 and onAccent ≥ 4.5', () => {
  for (const id of THEME_FAMILY_IDS) {
    for (const s of SCHEMES) {
      for (const sw of ACCENT_SWATCHES) {
        const c = buildColors(id, s, sw.id);
        assert.ok(minOn(c.accent, c.bg, c.surface) >= 3, `${id}/${s}/${sw.id} accent ${minOn(c.accent, c.bg, c.surface)}`);
        assert.ok(ratio(c.onAccent, c.accent) >= 4.5, `${id}/${s}/${sw.id} onAccent ${ratio(c.onAccent, c.accent)}`);
        assert.equal(c.info, c.accentText);
      }
    }
  }
});

test('custom accent: format validation + contrast nudging', () => {
  assert.deepEqual(checkCustomAccent('nope'), { ok: false, reason: 'format' });
  assert.deepEqual(checkCustomAccent('#12345'), { ok: false, reason: 'format' });
  const yellow = checkCustomAccent('#FFE600', 'standard');
  assert.ok(yellow.ok);
  if (!yellow.ok) return;
  assert.equal(yellow.hex, '#ffe600');
  assert.ok(yellow.ratio.light < 3, 'raw yellow fails on white');
  assert.notEqual(yellow.adjusted.light, '#ffe600', 'adjusted for light');
  assert.ok(contrast(yellow.adjusted.light, '#ffffff') >= 3);
  assert.equal(yellow.adjusted.dark, '#ffe600', 'yellow fine on dark');
  // custom hex works for every family (short form too)
  for (const id of THEME_FAMILY_IDS as readonly ThemeFamilyId[]) {
    for (const s of SCHEMES) {
      const c = buildColors(id, s, '#808080');
      assert.ok(minOn(c.accent, c.bg, c.surface) >= 3, `${id}/${s} gray`);
      assert.ok(ratio(c.onAccent, c.accent) >= 4.5);
    }
  }
  assert.equal(normalizeHex('#AbC'), '#aabbcc');
});

test('ensureContrast: unchanged when passing, otherwise minimal nudge reaching the target', () => {
  assert.equal(ensureContrast('#000000', '#ffffff', 4.5), '#000000');
  const c = ensureContrast('#cccccc', '#ffffff', 4.5);
  assert.ok(contrast(c, '#ffffff') >= 4.5);
  assert.ok(contrast(c, '#ffffff') < 4.8, 'not overshooting');
});

test('font scale math: rounding, monotonic, line height ≥ 1.2 × size', () => {
  assert.deepEqual(scaleFont(15, 22, 1), { fontSize: 15, lineHeight: 22 });
  assert.deepEqual(scaleFont(16, 25, 1.25), { fontSize: 20, lineHeight: 31 });
  assert.deepEqual(scaleFont(13, 18, 0.9), { fontSize: 11.5, lineHeight: 16 });
  const sizes = Object.values(FONT_SCALE).sort((a, b) => a - b);
  let prev = 0;
  for (const sc of sizes) {
    const r = scaleFont(11, 14, sc);
    assert.ok(r.fontSize > prev);
    assert.ok(r.lineHeight >= r.fontSize * 1.2);
    prev = r.fontSize;
  }
  const ty = { body: { fontSize: 15, lineHeight: 22, fontWeight: '400' as const } };
  const scaled = scaleTypography(ty as never, 1.12) as unknown as typeof ty;
  assert.deepEqual(scaled.body, { fontSize: 17, lineHeight: 25, fontWeight: '400' });
  assert.equal(scaleTypography(ty as never, 1), ty, 'identity at 1');
});

test('density math: spacing scales, never below 1 px', () => {
  const sp = { xxs: 2, s: 8, l: 16 };
  assert.deepEqual(scaleSpacing(sp, 0.85), { xxs: 2, s: 7, l: 14 });
  assert.deepEqual(scaleSpacing(sp, 1.2), { xxs: 2, s: 10, l: 19 });
  assert.equal(scaleSpacing(sp, 1), sp);
  assert.deepEqual(scaleSpacing({ a: 1 }, 0.1), { a: 1 });
});

test('skeleton: visible against surface and bg in every variant, highlight differs', () => {
  for (const id of THEME_FAMILY_IDS) {
    for (const s of SCHEMES) {
      const c = buildColors(id, s);
      const min = s === 'dark' ? SKELETON_MIN_CONTRAST.dark : SKELETON_MIN_CONTRAST.light;
      assert.ok(contrast(c.skeleton, c.surface) >= min - 0.005, `${id}/${s} skeleton vs surface ${contrast(c.skeleton, c.surface).toFixed(3)}`);
      assert.ok(contrast(c.skeleton, c.bg) >= min - 0.005, `${id}/${s} skeleton vs bg`);
      assert.notEqual(c.skeleton.toLowerCase(), c.skeletonHighlight.toLowerCase(), `${id}/${s} highlight`);
    }
  }
  assert.notEqual(buildColors('standard', 'light').skeleton.toLowerCase(), '#efeff1');
});

test('theme picker: 5 featured families up front, all 9 when expanded, selected never hidden', () => {
  assert.deepEqual([...FEATURED_THEME_FAMILIES], ['standard', 'oled', 'paper', 'nord', 'rose']);
  assert.deepEqual(pickerFamilies('standard', false), { shown: ['standard', 'oled', 'paper', 'nord', 'rose'], hiddenCount: 4 });
  const open = pickerFamilies('standard', true);
  assert.equal(open.shown.length, THEME_FAMILY_IDS.length);
  assert.deepEqual(new Set(open.shown), new Set(THEME_FAMILY_IDS));
  assert.deepEqual(pickerFamilies('forest', false), { shown: ['standard', 'oled', 'paper', 'nord', 'rose', 'forest'], hiddenCount: 3 });
});

// accent as TEXT (links, text buttons, selected labels): a custom accent is only held to 3:1 as a fill / icon / border,
// `accentText` is its readable copy
const ODD_ACCENTS = ['#FFE600', '#808080', '#00FF00', '#FF69B4', '#FFFFFF', '#000000', '#7A7AFF', '#C0C0C0', '#1E90FF'];

test('accentText: AA (4.5:1) on bg, surface, surfaceAlt and accentSoft for every swatch and odd custom colour, in every theme', () => {
  const accents: string[] = [...ACCENT_SWATCHES.map((s) => s.id), ...ODD_ACCENTS];
  for (const id of THEME_FAMILY_IDS) {
    for (const s of SCHEMES) {
      for (const a of [undefined, ...accents]) {
        const c = buildColors(id, s, a);
        for (const bg of ['bg', 'surface', 'surfaceAlt', 'accentSoft'] as const) {
          if (!HEX.test(c[bg])) continue;
          assert.ok(contrast(c.accentText, c[bg]) >= 4.5, `${id}/${s}/${a ?? 'theme'} accentText on ${bg} ${ratio(c.accentText, c[bg])}`);
        }
        // the fill / icon accent keeps its own (3:1) contract
        assert.ok(minOn(c.accent, c.bg, c.surface) >= 3, `${id}/${s}/${a ?? 'theme'} accent`);
      }
    }
  }
});

test('accentText: equals accent where the accent already reads as text; differs only for custom colours that need it', () => {
  for (const [id, s] of variants) {
    const c = buildColors(id, s);
    assert.equal(c.accentText, c.accent, `${id}/${s}`);
  }
  const yellow = buildColors('standard', 'light', '#FFE600');
  assert.notEqual(yellow.accentText, yellow.accent);
  // already dark enough on a light theme: unchanged
  const dark = buildColors('standard', 'light', '#1A237E');
  assert.equal(dark.accentText, dark.accent);
  // same hue family: the nudge only moves lightness (stays closer to the pick than to the text colour)
  assert.ok(contrast(yellow.accentText, yellow.accent) < contrast(yellow.accentText, '#ffffff'));
});

for (const [id, s] of variants) {
  test(`borderControl: 3:1 on bg / surface / surfaceAlt (WCAG 1.4.11) ${id}/${s}`, () => {
    const c = buildColors(id, s);
    assert.ok(HEX.test(c.borderControl), c.borderControl);
    for (const bg of ['bg', 'surface', 'surfaceAlt'] as const) assert.ok(contrast(c.borderControl, c[bg]) >= 3, `borderControl on ${bg} ${ratio(c.borderControl, c[bg])}`);
    // it is a control outline, not a text colour: weaker than the text itself
    assert.ok(contrast(c.borderControl, c.surface) < contrast(c.text, c.surface));
  });
}

test('borderControl: the smallest step that reaches 3:1 (not just black / white); decorative borders keep their tuned values', () => {
  const light = controlBorder({ bg: '#ffffff', surface: '#ffffff', surfaceAlt: '#f4f4f5', text: '#111111' });
  assert.ok(contrast(light, '#f4f4f5') >= 3 && contrast(light, '#f4f4f5') < 3.3, String(ratio(light, '#f4f4f5')));
  const dark = controlBorder({ bg: '#000000', surface: '#111111', surfaceAlt: '#1c1c1e', text: '#f5f5f5' });
  assert.ok(Math.min(contrast(dark, '#000000'), contrast(dark, '#111111'), contrast(dark, '#1c1c1e')) >= 3);
  const c = buildColors('standard', 'light');
  assert.match(c.border, /^rgba\(/);
});
