// Official build (FLAVOR=hermes) leak walk: every connection kind, "new connection" entry, onboarding card, voice
// engine, slash command and every dictionary string the build can show must be free of non-Hermes providers
// (Claude/Anthropic, ChatGPT/OpenAI, OpenRouter, …). The walk reads the SAME
// functions the screens call (flavor.ts pickableKinds / otherBackendsAllowed, chat/commands/plan.ts
// visibleCommands, i18n dictionaries). Test gap 3 of review part 5.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dictionaries, makeT, type Lang, type TKey } from './i18n/core.ts';
import {
  FLAVOR,
  PERSONAL_ONLY_KEY_PREFIXES,
  PROVIDER_MENTION_ALLOWED,
  allowedKinds,
  allowedPairKinds,
  otherBackendsAllowed,
  pickableKinds,
} from './flavor.ts';
import { brand } from './brand.ts';
import { COMMANDS } from './chat/commands/registry.ts';
import { visibleCommands, type BackendKind, type CommandContext } from './chat/commands/plan.ts';

const PROVIDER = /xai|grok|claude|anthropic|openai|chatgpt|codex|\bmeta\b|openrouter|kilo|opencode|ollama|lm studio|vllm|litellm|gemini/i;
const LANGS: Lang[] = ['de', 'en', 'es'];

test('this test process runs the official flavor', () => {
  assert.equal(FLAVOR, 'hermes', 'run without EXPO_PUBLIC_FLAVOR=personal');
});

test('connection kinds: only Hermes and the demo are creatable, listed or pairable', () => {
  assert.deepEqual([...allowedKinds('hermes')].sort(), ['demo', 'hermes']);
  assert.deepEqual(pickableKinds('hermes'), ['hermes']);
  assert.deepEqual(allowedPairKinds('hermes'), ['hermes']);
  assert.equal(otherBackendsAllowed('hermes'), false, 'onboarding "Andere Verbindung" card');
});

test('texts of every visible connection kind name no other provider', () => {
  for (const lang of LANGS) {
    const t = makeT(lang, lang);
    for (const kind of pickableKinds('hermes')) for (const part of ['title', 'sub']) {
      const s = t(`settings.kinds.${kind}.${part}` as TKey);
      assert.ok(!PROVIDER.test(s), `${lang} settings.kinds.${kind}.${part}: ${s}`);
    }
  }
});

test('slash commands offered for a Hermes chat (every state) name no other provider', () => {
  const base: CommandContext = {
    kind: 'hermes',
    bridge: false,
    noPalette: false,
    hasRemoteSession: true,
    streaming: false,
    messageCount: 3,
    canRetry: true,
    approval: { choices: ['once', 'session', 'always', 'deny'] },
    options: { reasoning: true, fast: true, canDisableReasoning: true },
  };
  const ids = new Set<string>();
  for (const bridge of [false, true]) for (const streaming of [false, true]) for (const sessionsApi of [true, false, undefined]) {
    for (const c of visibleCommands({ ...base, bridge, streaming, sessionsApi })) ids.add(c.id);
  }
  assert.ok(ids.size > 5);
  for (const lang of LANGS) {
    const t = makeT(lang, lang);
    for (const id of ids) for (const part of ['desc', 'arg']) {
      const s = t(`slash.cmd.${id}.${part}` as TKey);
      assert.ok(!PROVIDER.test(s), `${lang} slash.cmd.${id}.${part}: ${s}`);
    }
  }
  // commands of other backends never show up for a Hermes chat as extra entries
  const other: BackendKind[] = ['demo'];
  for (const kind of other) {
    const visible = visibleCommands({ ...base, kind }).map((c) => c.id);
    // the offline demo has /skills on purpose: Skills & memory shows demo data (commands/plan.ts DEMO_TOO)
    const hermesOnly = kind === 'demo' ? ['approve', 'deny', 'branch'] : ['approve', 'deny', 'skills', 'branch'];
    for (const id of hermesOnly) assert.ok(!visible.includes(id as never), `${kind} ${id}`);
  }
  assert.ok(COMMANDS.every((c) => !PROVIDER.test(c.name) && c.hermesAliases.every((a) => !PROVIDER.test(a))));
});

test('brand strings of the official build name no other provider', () => {
  const b = brand('hermes');
  for (const [k, v] of Object.entries(b)) if (typeof v === 'string') assert.ok(!PROVIDER.test(v.replace(/hermes/gi, '')), `brand.${k}: ${v}`);
});

/** all [key, text] pairs of a dictionary */
function entries(dict: unknown, prefix = ''): [string, string][] {
  const out: [string, string][] = [];
  for (const [k, v] of Object.entries(dict as Record<string, unknown>)) {
    if (typeof v === 'string') out.push([`${prefix}${k}`, v]);
    else if (v && typeof v === 'object') out.push(...entries(v, `${prefix}${k}.`));
  }
  return out;
}
const under = (key: string, prefixes: readonly string[]) =>
  prefixes.some((p) => (p.endsWith('*') ? key.startsWith(p.slice(0, -1)) : key === p || key.startsWith(`${p}.`)));

test('dictionary walk: a string that names another provider is either personal-only (gated) or explicitly allowed', () => {
  const offenders: string[] = [];
  for (const lang of LANGS) {
    for (const [key, text] of entries(dictionaries[lang])) {
      if (!PROVIDER.test(text)) continue;
      if (under(key, PERSONAL_ONLY_KEY_PREFIXES) || under(key, Object.keys(PROVIDER_MENTION_ALLOWED))) continue;
      offenders.push(`${lang} ${key}: ${text.slice(0, 80)}`);
    }
  }
  assert.deepEqual(offenders, [], 'gate the string by flavor and list its prefix in flavor.ts PERSONAL_ONLY_KEY_PREFIXES (or justify it in PROVIDER_MENTION_ALLOWED)');
});

test('every declared personal-only prefix still matches a dictionary key (no stale entries)', () => {
  const keys = entries(dictionaries.en).map(([k]) => k);
  for (const p of [...PERSONAL_ONLY_KEY_PREFIXES, ...Object.keys(PROVIDER_MENTION_ALLOWED)]) {
    assert.ok(keys.some((k) => under(k, [p])), `stale prefix ${p}`);
  }
});
