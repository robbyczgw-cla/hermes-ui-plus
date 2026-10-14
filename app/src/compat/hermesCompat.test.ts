import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, '..', '..', 'scripts', 'hermes-compat-check.mjs');

function run(args: string[]) {
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
}

test('app sources pass the Hermes compatibility guard', () => {
  const r = run([]);
  assert.equal(r.status, 0, `hermes-compat-check found problems:\n${r.stderr}`);
});

test('the guard flags Hermes-incompatible APIs and honours the escape hatch', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hui-compat-'));
  try {
    mkdirSync(join(dir, 'sandbox'));
    writeFileSync(
      join(dir, 'bad.ts'),
      [
        'const pr = new Intl.PluralRules("de");',
        'const parts = new Intl.NumberFormat("de").formatToParts(1);',
        'const s = list.toSorted();',
        'const g = Object.groupBy(xs, (x) => x.k);',
        'const id = crypto.randomUUID();',
        'const d = new Intl.DateTimeFormat("de", { dayPeriod: "short" });',
        'const vals = m.values().map((x) => x);',
        '// a comment mentioning new Intl.ListFormat() is fine',
        '// hermes-compat-ok: guarded',
        'const ok = new Intl.RelativeTimeFormat("de");',
        'const fine = Crypto.randomUUID(); // expo-crypto',
        'const t: Intl.RelativeTimeFormatUnit = "day";',
      ].join('\n'),
    );
    writeFileSync(join(dir, 'sandbox', 'shell.ts'), 'new Intl.Segmenter(); // runs in the WebView');
    const r = run(['--root', dir, '--json']);
    const findings = JSON.parse(r.stdout) as { file: string; line: number; rule: string }[];
    assert.deepEqual(
      findings.map((f) => `${f.line}:${f.rule}`),
      ['1:intl-missing', '2:intl-parts', '3:array-tosorted', '4:group-by', '5:global-crypto', '6:dtf-options', '7:iterator-helpers'],
    );
    assert.ok(findings.every((f) => f.file === 'bad.ts'));
    assert.equal(run(['--root', dir]).status, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('i18n works in a Hermes-like runtime without Intl.PluralRules / RelativeTimeFormat', () => {
  const core = pathToFileURL(join(here, '..', 'i18n', 'core.ts')).href;
  const code = `
    delete Intl.PluralRules; delete Intl.RelativeTimeFormat;
    const { makeT, formatRelative } = await import(${JSON.stringify(core)});
    const t = makeT('de', 'de-DE');
    const en = makeT('en', 'en-US');
    console.log(JSON.stringify([
      t('chat.toolTimeline.toolCount', { count: 1 }), t('chat.toolTimeline.toolCount', { count: 3 }),
      t('chat.toolChips.used', { count: 2 }), en('chat.toolTimeline.stepCount', { count: 1 }),
      formatRelative('de-DE', 0, 120000), formatRelative('en-US', 0, 120000),
    ]));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), ['1 Werkzeug', '3 Werkzeuge', '2 Werkzeuge verwendet', '1 step', 'vor 2 Minuten', '2 minutes ago']);
});
