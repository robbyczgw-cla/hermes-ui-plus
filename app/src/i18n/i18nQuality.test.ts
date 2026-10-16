// Translation quality gates: key parity, placeholders, unused keys, hardcoded user-visible strings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dictionaries } from './core.ts';
import { flatten, placeholders, syntaxProblems } from './lint.ts';
import { scanHardcoded } from './hardcoded.ts';

// The public export drops personal-only code: keys and allowlist entries only that code uses are legitimately idle there,
// so the two "nothing unused" checks are strict in the full (private) tree only.
const FULL_TREE = false;

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const LANGS = ['de', 'en', 'es'] as const;
const flat = Object.fromEntries(LANGS.map((l) => [l, flatten(dictionaries[l])])) as Record<(typeof LANGS)[number], Record<string, string>>;

function* sourceFiles(dir: string): Generator<string> {
  for (const f of readdirSync(dir)) {
    if (f === 'node_modules' || f.startsWith('.')) continue;
    const p = join(dir, f);
    if (statSync(p).isDirectory()) yield* sourceFiles(p);
    else if (/\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !p.startsWith(join(SRC, 'i18n') + '/')) yield p;
  }
}

test('every locale has exactly the German key set (no missing, no extra, no empty values except slash command `.arg` hints)', () => {
  const de = Object.keys(flat.de).sort();
  for (const l of ['en', 'es'] as const) {
    const have = Object.keys(flat[l]).sort();
    assert.deepEqual(de.filter((k) => !(k in flat[l])), [], `${l}: keys missing vs de`);
    assert.deepEqual(have.filter((k) => !(k in flat.de)), [], `${l}: keys not in de`);
  }
  for (const l of LANGS) assert.deepEqual(Object.entries(flat[l]).filter(([k, v]) => !v.trim() && !k.endsWith('.arg')).map(([k]) => k), [], `${l}: empty values`);
});

test('placeholders / interpolation variables match across locales and messages are well-formed', () => {
  const bad: string[] = [];
  for (const [k, de] of Object.entries(flat.de)) {
    const want = placeholders(de).join(',');
    for (const l of LANGS) {
      const v = flat[l][k];
      if (v === undefined) continue;
      if (placeholders(v).join(',') !== want) bad.push(`${l} ${k}: {${placeholders(v).join(',')}} vs de {${want}}`);
      for (const p of syntaxProblems(v)) bad.push(`${l} ${k}: ${p}`);
      if (/%[sd@]|\$\{/.test(v)) bad.push(`${l} ${k}: foreign placeholder syntax (this app uses {name})`);
    }
  }
  assert.deepEqual(bad, []);
});

test('no stray surrounding whitespace or double spaces in any locale', () => {
  const bad: string[] = [];
  for (const l of LANGS) {
    for (const [k, v] of Object.entries(flat[l])) {
      if (v !== v.trim() && !/\s$/.test(v.replace(/\S/g, ''))) bad.push(`${l} ${k}: whitespace`);
      if (/\S {2,}\S/.test(v)) bad.push(`${l} ${k}: double space`);
    }
  }
  assert.deepEqual(bad, []);
});

// Terminology and register rules per locale (decided in the translation pass; keep new strings consistent).
const TERMS: { lang: 'de' | 'en' | 'es'; re: RegExp; why: string }[] = [
  { lang: 'de', re: /\bKey\b(?<!Session-Key)(?!\))/, why: 'say "Schlüssel" / "API-Schlüssel" (Session-Key is the one technical exception)' },
  { lang: 'de', re: /Mitteilung|Anmelde-Code|Pair-Link|Richtlinien-Gründen|angepinnt|anpinnen/i, why: 'Benachrichtigung, Anmeldecode, Kopplungslink, Richtliniengründen, anheften' },
  { lang: 'de', re: /\bIhre[mnrs]?\b|\bIhnen\b|\bIhr\b/, why: 'German UI copy uses informal "du"' },
  { lang: 'es', re: /\busted(es)?\b/i, why: 'Spanish UI copy uses informal "tú"' },
  { lang: 'es', re: /[“”]/, why: 'Spanish uses «guillemets»' },
  { lang: 'es', re: /vincul|\bpetici[oó]n\b|\bpeticiones\b|clave API|\binaccesible|habilidad/i, why: 'emparejar / solicitud / clave de API / no accesible / skill' },
  { lang: 'es', re: /\b[Ll]a UI[- ][Bb]ridge|\b[Ll]a [Bb]ridge|\{bridge\}\b.*\bla\b|\bla \{bridge\}|\b[Uu]na Bridge/, why: '"bridge" is masculine in Spanish: el bridge' },
  { lang: 'de', re: /Hermes UI(?!\+)(?![-\w])|Hermes-UI-/, why: 'use {app}/{appShort} instead of the old product name' },
  { lang: 'es', re: /Hermes UI(?!\+)(?![-\w])/, why: 'use {app}/{appShort} instead of the old product name' },
  { lang: 'en', re: /Hermes UI(?!\+)(?![-\w])/, why: 'use {app}/{appShort} instead of the old product name' },
];

test('terminology and register stay consistent per locale', () => {
  const bad: string[] = [];
  for (const { lang, re, why } of TERMS) {
    for (const [k, v] of Object.entries(flat[lang])) {
      // consent texts are fingerprinted (AI_CONSENT_VERSION): wording changes there need a version bump
      if (k.startsWith('compliance.consent.') || !re.test(v)) continue;
      bad.push(`${lang} ${k}: /${re.source}/ (${why}) in "${v.slice(0, 80)}"`);
    }
  }
  assert.deepEqual(bad, []);
});

test('brand and agent names are never translated', () => {
  // "HUI+" and "Hermes" must survive in every locale wherever English mentions them
  const bad: string[] = [];
  for (const [k, en] of Object.entries(flat.en)) {
    for (const name of ['HUI+', 'Hermes']) {
      if (!en.includes(name)) continue;
      for (const l of ['de', 'es'] as const) if (!flat[l][k].includes(name)) bad.push(`${l} ${k}: lost "${name}"`);
    }
  }
  assert.deepEqual(bad, []);
});

// Keys that are built at runtime (template literal / lookup by code) and therefore invisible to the literal scan.
const DYNAMIC_KEYS: RegExp[] = [
  /^waiting\.(first|slow|still)\.p\d+$/, // ui/loaders/waiting.ts range()
  /^waiting\.tool\.\w+\.p\d+$/,
  /^onboarding\.(pairErrors|urlErrors|redeem)\./, // keyed by error code
  /^hermesTools\.todo\.(pending|in_progress|completed|cancelled)$/, // keyed by todo status
];

test('no unused keys (a key must be referenced from src, or match a documented dynamic pattern)', () => {
  let code = '';
  for (const f of sourceFiles(SRC)) code += readFileSync(f, 'utf8') + '\n';
  const literals = new Set<string>();
  for (const m of code.matchAll(/['"`]([a-zA-Z][\w]*(?:\.[\w]+)+)['"`]/g)) literals.add(m[1]);
  const templates: RegExp[] = [];
  for (const m of code.matchAll(/`([a-zA-Z][\w.]*(?:\$\{[^}]*\}[\w.]*)+)`/g)) {
    if (!m[1].includes('.')) continue;
    templates.push(new RegExp('^' + m[1].split(/\$\{[^}]*\}/).map((x) => x.replace(/\./g, '\\.')).join('[\\w.]+') + '$'));
  }
  const unused = Object.keys(flat.de).filter((k) => !literals.has(k) && !templates.some((r) => r.test(k)) && !DYNAMIC_KEYS.some((r) => r.test(k)));
  if (FULL_TREE) assert.deepEqual(unused, [], 'unused keys: delete them from de/en/es or reference them');
});

/**
 * Files that legitimately contain visible-looking text without t():
 *  - dev gallery / sample content / fixtures (never shown to users in normal operation)
 *  - model- or agent-facing text (prompts, tool results, reply messages): not UI copy, stays German on purpose
 *  - brand / model catalogs
 * Anything else with a hit fails the test; an entry that no longer has a hit fails too (keep the list honest).
 */
const ALLOW: [RegExp, string][] = [
  [/^ui\/(galleryData|Gallery)\.tsx?$/, 'dev gallery'],
  [/^ui\/components\/(GallerySection\w+|modules\/\w+\/(GallerySection\w+|samples|galleryInteractive))\.tsx?$/, 'dev gallery'],
  [/^onboarding\/demo\//, 'offline demo content: per-language scripts (L() triples / de,en,es tables)'],
  [/^sandbox\/sandboxSamples\.ts$/, 'sandbox sample apps'],
  [/^pi\/stepSamples\.ts$/, 'dev gallery: StepSummary samples (fake paths and output)'],
  [/^pi\/pocket\/turns\.ts$/, 'Pi Pocket port: SUMMARY_EN keeps summarize()\'s English output; the UI formats through ui.steps.* (formatSummary)'],
  [/\.fixtures\.ts$|^openaicompat\/fixtures\.ts$/, 'test fixtures'],
  [/^(chat\/models|openaicompat\/presets|settings\/profiles)\.ts$/, 'model / provider names'],
  [/^settings\/testConnection\.ts$/, 'endpoint names'],
  [/^support\/report\.ts$/, 'problem report is English by design (read by the maintainers)'],
  [/^onboarding\/agentPrompts\.ts$/, 'prompts for the user\'s agent: German variant of the setup prompt'],
  [/^(attachments\/encode\w+|attachments\/pickers|chat\/ask|chat\/replyMessage|hermes\/sessionMapping|hermes\/trace|claude\/(dateContext|systemPrompt)|ui\/components\/modules\/d3\/mindmapModel|actions\/lists|compat\/runtimeProbe)\.ts$/, 'model-facing text (attachment markers, replies, prompts) or probe data'],
  [/^ui\/components\/modules\/(a\/checklistModel|b\/mapModel|d1\/d1Model)\.ts$/, 'category keywords / canonical German category ids / parser patterns'],
  [/^protocol\/streamParser\.ts$/, 'parser diagnostics (logged, not rendered)'],
  [/^meta\/core\.ts$/, 'metaErrorText has no UI caller yet'],
  [/^settings\/storage\.ts$/, 'error is mapped to settings.storage.readOnlySave by every caller'],
  [/^hermes\/chatState\.ts$|^(hermes\/useHermesChat|claude\/useClaudeChat|openaicompat\/useOpenAICompatChat)\.ts$/, 'last-resort fallback behind an errorText key / provider error text'],
  [/^calc\/\w+\.ts$/, 'KNOWN GAP: calc engine diagnostics are German (see report: needs error codes + args to localize)'],
  [/^(claude\/toolResults)\.ts$/, 'KNOWN GAP: provider reducers bake German status text into persisted messages (needs key-based statusNote)'],
];

test('no hardcoded user-visible strings outside the documented allowlist', () => {
  const unexpected: string[] = [];
  const used = new Set<number>();
  for (const f of sourceFiles(SRC)) {
    const rel = relative(SRC, f);
    const hits = scanHardcoded(f, readFileSync(f, 'utf8'));
    if (!hits.length) continue;
    const idx = ALLOW.findIndex(([re]) => re.test(rel));
    if (idx >= 0) {
      used.add(idx);
      continue;
    }
    for (const h of hits) unexpected.push(`${rel}:${h.line} ${h.kind} ${JSON.stringify(h.text.slice(0, 80))}`);
  }
  assert.deepEqual(unexpected, [], 'use t() / the module copy, or justify the file in ALLOW');
  const stale = ALLOW.filter((_, i) => !used.has(i)).map(([re]) => String(re));
  if (FULL_TREE) assert.deepEqual(stale, [], 'ALLOW entries without any hit: remove them');
});

test('hardcoded scanner finds what it should and ignores brand names', async () => {
  const { scanHardcoded: scan } = await import('./hardcoded.ts');
  const src = [
    'const a = <Text>Hallo Welt</Text>;',
    'const b = <Button title="Abbrechen" accessibilityLabel={"Close the dialog"} />;',
    'const c = <Text>HUI+ Hermes</Text>;',
    'const d = <Text>{t("x.y")}</Text>;',
    'const e = <TextInput placeholder="sk-ant-…" />;',
    "Alert.alert('Fehler', 'Etwas ist schiefgelaufen');",
    'const f = L(ctx, "Hallo da", "Hello there", "Hola");',
  ].join('\n');
  const hits = scan('x.tsx', src).map((h) => `${h.line}:${h.kind}`);
  assert.deepEqual(hits, ['1:jsx-text', '2:prop:title', '2:prop:accessibilityLabel', '6:call:alert', '6:call:alert']);
});
