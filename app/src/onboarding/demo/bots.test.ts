/// <reference types="node" />
// Bot mode in the offline demo (onboarding/demo/bots.ts, scenes-bots.ts): the example bots and their histories, Scout's
// waiting approval, the canned answers per role (starters, follow-ups, typos in de/en/es), "Neuer Bot" on this device,
// the bots' own routines. Everything invented and offline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEvent, createAssistantMessage, finalize } from '../../hermes/chatState.ts';
import type { ChatMessage, HermesEvent } from '../../hermes/types';
import { parseMessage } from '../../protocol/streamParser.ts';
import { makeT, type TKey } from '../../i18n/core.ts';
import { reformatMessage } from '../../chat/reformat.ts';
import { checklistReply } from '../../ui/components/modules/a/replies.ts';
import { cronDelivery } from '../../bots/core.ts';
import { toApprovalView } from '../../approvals/approvalModel.ts';
import { resolveRunApprovals, withDeadline } from '../../hermes/approvals.ts';
import { createBody, draftFor, ROLE_TEMPLATES, templateColor, WITH_STARTERS, type TemplateId } from '../../bots/create/core.ts';
import { previewOf } from '../../conversations/messages.ts';
import { demoBotJobs, createDemoRoutines } from '../../routines/demo.ts';
import {
  ATLAS_REMINDER_JOB, DEMO_BOT_LIMIT, DEMO_SEEDED, LUMI_BRIEFING_JOB, SCOUT_APPROVAL, SCOUT_PRICE_JOB, demoBotHistory, demoBotList, demoBotRole, demoCreate, demoSlug,
  historyMeta, scoutPendingSteps, type DemoCreatedBot,
} from './bots.ts';
import type { DemoBotRole, DemoLang, DemoStep } from './kit.ts';
import { COMMON_PROMPTS, ROLE_PROMPTS, pickBotScenario, roleScenarioNames } from './scenes-bots.ts';
import { pickScenario } from './scenarios.ts';
import { INSTANT_TIMING, runDemoTurn } from './transport.ts';

const LANGS: DemoLang[] = ['de', 'en', 'es'];
const LOCALE = { de: 'de-DE', en: 'en-US', es: 'es-ES' } as const;
const tr = (lang: DemoLang) => makeT(lang, LOCALE[lang]);
const NOW = new Date(2026, 9, 20, 11, 40).getTime();
const noSleep = (_ms: number, signal?: AbortSignal) => (signal?.aborted ? Promise.reject(Object.assign(new Error('a'), { name: 'AbortError' })) : Promise.resolve());

const roleOf = (template: TemplateId, lang: DemoLang): DemoBotRole => {
  const seeded = DEMO_SEEDED.find((b) => b.template === template);
  if (seeded) return demoBotRole(seeded.name, lang)!;
  const t = tr(lang);
  return { template, name: template === 'own' ? 'Kiwi' : t(`botCreate.templates.${template}.name` as TKey), job: template === 'own' ? 'Pflanzen gießen' : t(`botCreate.templates.${template}.job` as TKey) };
};

async function replay(text: string, o: { lang?: DemoLang; role?: DemoBotRole; approve?: 'once' | 'deny'; script?: { name: string; steps: DemoStep[] }; history?: string[] } = {}) {
  const events: HermesEvent[] = [];
  let msg: ChatMessage = createAssistantMessage(0);
  const r = await runDemoTurn({
    text,
    sessionId: 'demo-bot-1',
    turn: 1,
    lang: o.lang ?? 'de',
    role: o.role,
    script: o.script,
    history: o.history,
    timing: INSTANT_TIMING,
    sleep: noSleep,
    now: () => new Date(NOW),
    onEvent: (ev) => {
      events.push(ev);
      msg = applyEvent(msg, ev, 1);
    },
    // like useDemoChat.respondApproval: the tapped choice resolves the open request (the receipt shows it)
    waitForApproval: async (runId) => {
      const choice = o.approve ?? 'once';
      msg = resolveRunApprovals(msg, runId, choice, 1);
      return choice;
    },
  });
  if (msg.status === 'streaming') msg = finalize(msg, 'done', undefined, 2);
  return { r, events, msg };
}

type HuiNode = { type: string; [k: string]: unknown };
function nodes(msg: ChatMessage): HuiNode[] {
  const out: HuiNode[] = [];
  for (const seg of parseMessage(msg.text)) if (seg.kind === 'hui') {
    assert.ok(seg.node, `invalid hui block: ${seg.raw?.slice(0, 120)}`);
    out.push(seg.node as HuiNode);
  }
  return out;
}
const chipsOf = (msg: ChatMessage) => nodes(msg).filter((n) => n.type === 'suggestions').flatMap((n) => n.items as string[]);

const GERMAN = /\b(und|nicht|ist|für|mit|der|die|ein|eine|dein|deine|wird|oder)\b|[äöüß]/i;
const ENGLISH_ONLY = /\b(the|and|with|your|you|this|that|for|are)\b/i;
/** prose of an answer without code, commands, URLs and names */
const prose = (s: string) => s.replace(/```(?!hui)[\s\S]*?```/g, '').replace(/`[^`]*`/g, '').replace(/https?:\/\/\S+/g, '').replace(/Example Shop \w|Fjord Demo|Lumo Demo|Aurel Demo|Example \w+/g, '');

// ── the roster ─────────────────────────────────────────────────────────────────────────────────────────────────────

test('demo roster: Hermes first, then Scout, Atlas and Lumi with their role look, then the bots made on this device', () => {
  const made: DemoCreatedBot = { name: 'kiwi', label: 'Kiwi', job: 'Pflanzen gießen', how: 'Kurz.', template: 'own', color: '#3f7d6e', createdAt: NOW };
  const list = demoBotList('de', [made]);
  assert.deepEqual(list.map((b) => b.name), ['default', 'scout', 'atlas', 'lumi', 'kiwi']);
  assert.ok(list[0].default);
  const scout = list.find((b) => b.name === 'scout')!;
  assert.equal(scout.label, 'Scout');
  assert.equal(scout.color, templateColor('deals'));
  assert.equal(scout.template, 'deals');
  for (const lang of LANGS) for (const b of demoBotList(lang)) if (!b.default) assert.ok(b.description && b.description.length > 10, `${lang} ${b.name} has a line`);
  assert.equal(demoBotList('en').find((b) => b.name === 'lumi')!.description, 'The essentials every morning, short');
  assert.deepEqual(demoBotRole('kiwi', 'de', [made]), { template: 'own', name: 'Kiwi', job: 'Pflanzen gießen' });
  assert.equal(demoBotRole(undefined, 'de'), undefined, 'Hermes answers with the ordinary demo');
  assert.equal(demoBotRole('default', 'de'), undefined);
});

// ── histories ──────────────────────────────────────────────────────────────────────────────────────────────────────

test('example bots: a short history in every language, with a delivered routine result shown as a marker, never a user bubble', () => {
  const jobs = { scout: SCOUT_PRICE_JOB, atlas: ATLAS_REMINDER_JOB, lumi: LUMI_BRIEFING_JOB };
  for (const lang of LANGS) {
    for (const b of DEMO_SEEDED) {
      const h = demoBotHistory(b.name, lang, NOW)!;
      assert.ok(h.length >= 4, `${b.name} ${lang}`);
      assert.equal(h[h.length - 1].role, 'assistant', 'the bot comments the delivery');
      for (let i = 1; i < h.length; i++) assert.ok(h[i].createdAt > h[i - 1].createdAt, `${b.name}: messages in order`);
      assert.ok(h[h.length - 1].createdAt < NOW, 'all in the past');
      const cron = h.map((m) => (m.role === 'user' ? cronDelivery(m.text) : null)).filter(Boolean);
      assert.equal(cron.length, 1, `${b.name} has one delivery`);
      assert.equal(cron[0]!.name, jobs[b.name as keyof typeof jobs](lang));
      assert.ok(!cron[0]!.silent && cron[0]!.output.length > 20);
      const meta = historyMeta(h);
      assert.equal(meta.messageCount, h.length);
      assert.equal(meta.updatedAt, h[h.length - 1].createdAt);
      assert.equal(meta.preview, previewOf(h));
      assert.ok(meta.preview && !meta.preview.startsWith('[Cronjob'), `roster line is readable: ${meta.preview}`);
      for (const m of h) {
        nodes(m);
        for (const url of m.text.match(/https?:\/\/[^\s"'<>)\]]+/g) ?? []) assert.match(new URL(url).hostname, /^([a-z0-9-]+\.)?example\.(com|org|net)$/);
        const p = prose(m.text.replace(/^\[Cronjob [^\]]*\]/, ''));
        if (lang !== 'de') assert.doesNotMatch(p, GERMAN, `${b.name} ${lang}: ${p.match(GERMAN)?.[0]}`);
        else assert.doesNotMatch(p, ENGLISH_ONLY, `${b.name} de: ${p.match(ENGLISH_ONLY)?.[0]}`);
      }
    }
  }
  assert.equal(demoBotHistory(undefined, 'de', NOW), null, 'Hermes starts empty');
  assert.equal(demoBotHistory('kiwi', 'de', NOW), null, 'a new bot starts empty');
});

test('the morning briefing is delivered at 7:00 today, or yesterday when it is earlier than that', () => {
  const at = (h: number, m = 0) => demoBotHistory('lumi', 'de', new Date(2026, 9, 20, h, m).getTime())!.find((x) => cronDelivery(x.text))!.createdAt;
  assert.equal(new Date(at(11)).getDate(), 20);
  assert.equal(new Date(at(11)).getHours(), 7);
  assert.equal(new Date(at(6)).getDate(), 19, 'before 7: yesterday’s');
});

// ── Scout's approval ───────────────────────────────────────────────────────────────────────────────────────────────

test('Scout waits for an approval with a fixed request (Bots tab and chat agree); allow and deny both end honestly', async () => {
  for (const lang of LANGS) {
    for (const approve of ['once', 'deny'] as const) {
      const { events, msg } = await replay('', { lang, approve, role: demoBotRole('scout', lang), script: { name: 'bot:deals:pending', steps: scoutPendingSteps(lang) } });
      const req = events.find((e) => e.type === 'approval');
      assert.ok(req && req.type === 'approval');
      const a = req.approval;
      assert.equal(a.requestId, SCOUT_APPROVAL.requestId);
      assert.equal(a.runId, SCOUT_APPROVAL.runId);
      assert.deepEqual(a.choices, ['once', 'deny'], 'the demo offers no "always" (no server allowlist)');
      assert.ok(a.timeoutSeconds && a.timeoutSeconds >= 3600, 'does not run out while the user looks around');
      // the card says "wartet auf dich, seit <when it was shown>" (approvals/ApprovalSheet.tsx: deadline − timeout)
      const v = toApprovalView(withDeadline(a, { receivedAt: NOW }), { now: NOW });
      assert.equal(v.deadlineMs - v.timeoutSeconds * 1000, NOW);
      assert.ok(!v.expired);
      assert.equal(msg.status, 'done');
      // the receipt carries the tapped choice, never "not answered – run ended"
      assert.deepEqual(msg.approvalLog?.map((r) => [r.requestId, r.outcome]), [[SCOUT_APPROVAL.requestId, approve]], `${lang}: receipt`);
      assert.ok(!msg.pendingApprovals?.length);
      if (approve === 'once') {
        assert.ok(msg.tools.some((t) => t.name === 'terminal'), 'the command shows as a tool step');
        assert.match(msg.text, lang === 'de' ? /In der Demo wurde nichts gelöscht/ : lang === 'en' ? /Nothing was deleted in the demo/ : /En la demo no se borró nada/);
      } else {
        assert.ok(!msg.tools.some((t) => t.name === 'terminal'), 'denied: nothing runs');
      }
    }
  }
});

// ── roles: starters, prompts, follow-ups, typos ────────────────────────────────────────────────────────────────────

test('every role answers the three starters of its start screen with its own answer, in every language', () => {
  for (const lang of LANGS) {
    const t = tr(lang);
    for (const template of WITH_STARTERS) {
      const role = roleOf(template, lang);
      for (const n of [1, 2, 3]) {
        const s = t(`botCreate.templates.${template}.s${n}` as TKey);
        const { name } = pickBotScenario(s, role);
        assert.ok(name.startsWith(`bot:${template}:`), `${lang} ${template} s${n} "${s}" → ${name}`);
      }
    }
  }
});

test('the role chips and the common questions route back to their own answers (never the introduction)', () => {
  for (const lang of LANGS) {
    for (const template of ROLE_TEMPLATES) {
      const role = roleOf(template, lang);
      for (const [key, text] of Object.entries(ROLE_PROMPTS[template])) assert.equal(pickBotScenario(text[lang], role).name, `bot:${template}:${key}`, `${lang} ${template} ${key}`);
      for (const [key, text] of Object.entries(COMMON_PROMPTS)) assert.equal(pickBotScenario(text[lang], role).name, `bot:${key}`, `${lang} ${template} ${key}`);
    }
  }
});

test('the generic starters of a bot without its own (Eigene Rolle, leerer Agent) get real answers too', () => {
  for (const lang of LANGS) {
    const t = tr(lang);
    for (const template of ['own', 'blank'] as const) {
      const role = roleOf(template, lang);
      const got = (['starterWhat', 'starterLast', 'starterKnow'] as const).map((k) => pickBotScenario(t(`bots.chat.${k}`), role).name);
      assert.deepEqual(got, ['bot:who', 'bot:last', 'bot:know'], `${lang} ${template}`);
    }
    // Hermes' own Bot Chat in the demo: the same starters reach the ordinary demo, never its fallback
    for (const k of ['starterWhat', 'starterLast', 'starterKnow'] as const) assert.notEqual(pickScenario(t(`bots.chat.${k}`)).name, 'plain', `${lang} Hermes ${k}`);
  }
});

test('typical follow-ups and typos stay in the role: price history, table, photos, buy, packing, weather, script', () => {
  const cases: [TemplateId, string, string][] = [
    ['deals', 'zeig mir den preisverlaif', 'bot:deals:history'],
    ['deals', 'Und wie war der Preisverlauf?', 'bot:deals:history'],
    ['deals', 'vergliech die mal mit zwei anderen', 'bot:deals:compare'],
    ['deals', 'kauf sie für mich', 'bot:deals:buy'],
    ['deals', 'buy them for me pls', 'bot:deals:buy'],
    ['deals', 'cómpralos por mí', 'bot:deals:buy'],
    ['deals', 'fotos?', 'bot:photos'],
    ['deals', 'photos?', 'bot:photos'],
    ['deals', 'mehr details?', 'bot:more'],
    ['deals', 'als tabelle?', 'bot:deals:shops'],
    ['travel', 'als tabelle?', 'bot:table'],
    ['briefing', 'as a table?', 'bot:table'],
    ['research', 'kürzer bitte', 'bot:table'],
    ['deals', 'more details?', 'bot:more'],
    ['deals', 'más detalles?', 'bot:more'],
    ['deals', 'let me knwo when they drop below 200', 'bot:deals:alert'],
    ['deals', 'avisame cuando baje de 200 €', 'bot:deals:alert'],
    ['travel', 'packlsite bitte', 'bot:travel:packing'],
    ['travel', 'what shoudl I pack', 'bot:travel:packing'],
    ['travel', 'remnid me the day before', 'bot:travel:remind'],
    ['travel', 'wochende in wien?', 'bot:travel:weekend'],
    ['travel', 'ist der zug pünktlich?', 'bot:travel:train'],
    ['travel', '¿qué puedo hacer el sabado?', 'bot:travel:saturday'],
    ['briefing', 'was steht huete an', 'bot:briefing:today'],
    ['briefing', 'whats on tday', 'bot:briefing:today'],
    ['briefing', 'brauch ich nen schirm', 'bot:briefing:weather'],
    ['briefing', 'sag den kurs ab', 'bot:briefing:course'],
    ['briefing', 'menos noticias porfa', 'bot:briefing:fewer'],
    ['research', 'whats new on heat pumps', 'bot:research:news'],
    ['research', 'quellen?', 'bot:research:sources'],
    ['research', 'summarise it', 'bot:research:summary'],
    ['code', 'was sagt mir dieser tracebak', 'bot:code:traceback'],
    ['code', 'räum die downloads auf', 'bot:code:cleanup'],
    ['code', 'escribe un scrpit', 'bot:code:script'],
    ['own', 'jeden morgen um 8 gießen', 'bot:routine'],
    ['blank', 'hallo', 'bot:who'],
    ['blank', 'merk dir dass ich tee mag', 'bot:remember'],
    ['own', 'asdf qwer', 'bot:fallback'],
  ];
  for (const [template, text, want] of cases) assert.equal(pickBotScenario(text, roleOf(template, 'de')).name, want, `${template}: "${text}"`);
  // taps on the role's own blocks and the reshape chips are acknowledged by the bot, not the general demo
  assert.equal(pickBotScenario(checklistReply('demo-bot-pack-vienna', ['Schirm'], []), roleOf('travel', 'de')).name, 'bot:reply');
  assert.equal(pickBotScenario(reformatMessage('table', tr('de')), roleOf('deals', 'de')).name, 'bot:reply');
});

test('every role answer replays through the real parser in de/en/es: valid blocks, the chat language, chips that stay in the role', async () => {
  let checked = 0;
  for (const lang of LANGS) {
    for (const template of ROLE_TEMPLATES) {
      const role = roleOf(template, lang);
      const asks = [...Object.values(ROLE_PROMPTS[template]).map((p) => p[lang]), ...Object.values(COMMON_PROMPTS).map((p) => p[lang]), 'fotos?', 'asdf', reformatMessage('shorter', tr(lang))];
      if (WITH_STARTERS.includes(template)) for (const n of [1, 2, 3]) asks.push(tr(lang)(`botCreate.templates.${template}.s${n}` as TKey));
      const seen = new Set<string>();
      for (const ask of asks) {
        for (const approve of ['once', 'deny'] as const) {
          const { r, msg } = await replay(ask, { lang, role, approve });
          seen.add(r.scenario);
          assert.equal(msg.status, 'done', `${lang} ${template} "${ask}"`);
          assert.ok(msg.text.trim().length > 40, `${lang} ${template} "${ask}" answers something`);
          nodes(msg);
          const p = prose(msg.text).replace(/"(?:Kiwi|Lupe|Lens|Lupa|Scout|Atlas|Lumi|Code|Trip|Reise|Viaje|Morgen|Morning|Mañana)"/g, '');
          if (lang !== 'de') assert.doesNotMatch(p.replace(/Pflanzen gießen|Du hast geschrieben|asdf/g, ''), GERMAN, `${lang} ${template} "${ask}": ${p.match(GERMAN)?.[0]}`);
          for (const url of msg.text.match(/https?:\/\/[^\s"'<>)\]]+/g) ?? []) assert.match(new URL(url).hostname, /^([a-z0-9-]+\.)?example\.(com|org|net)$/);
          for (const chip of chipsOf(msg)) {
            checked++;
            const to = pickBotScenario(chip, role).name;
            assert.notEqual(to, 'bot:fallback', `${lang} ${template}: chip "${chip}" falls through`);
          }
        }
      }
      for (const name of seen) assert.ok(roleScenarioNames(template).includes(name), `${template} answered with ${name}`);
    }
  }
  assert.ok(checked > 200, `checked ${checked} chips`);
});

test('routines, memory and commands: a bot says what only a real Hermes does', async () => {
  for (const lang of LANGS) {
    const weekly = (await replay(ROLE_PROMPTS.deals.weekly[lang], { lang, role: roleOf('deals', lang) })).msg;
    const callout = nodes(weekly).find((n) => n.type === 'callout');
    assert.ok(callout, 'a routine request gets the "Demo: keine echte Routine" note');
    assert.match(String(callout.title), /Demo/);
    const mem = (await replay(COMMON_PROMPTS.remember[lang], { lang, role: roleOf('travel', lang) })).msg.text;
    assert.match(mem, lang === 'de' ? /In der Demo merke ich mir nichts/ : lang === 'en' ? /In the demo I remember nothing/ : /En la demo no recuerdo nada/);
    // the code bot asks before deleting, and the demo deletes nothing
    const { events, msg } = await replay(ROLE_PROMPTS.code.cleanup[lang], { lang, role: roleOf('code', lang), approve: 'once' });
    assert.ok(events.some((e) => e.type === 'approval'), 'cleanup asks for an approval');
    assert.match(msg.text, lang === 'de' ? /In der Demo wurde nichts gelöscht/ : lang === 'en' ? /Nothing was deleted in the demo/ : /En la demo no se borró nada/);
    const buy = (await replay(lang === 'de' ? 'Kauf sie mir' : lang === 'en' ? 'Buy them for me' : 'Cómpralos', { lang, role: roleOf('deals', lang) })).msg;
    assert.ok(nodes(buy).some((n) => n.type === 'callout'), 'buying is handed back to the user');
  }
});

test('a realistic chat with Scout: history, then price history, "as a table?", "photos?", "buy it" (with typos)', async () => {
  const role = demoBotRole('scout', 'de')!;
  const asks = ['zeig mir den preisverlauf', 'als tabelle?', 'fotos?', 'kauf sie', 'wo ist es am günstigsten?'];
  const history: string[] = [];
  const names: string[] = [];
  for (const ask of asks) {
    const { r, msg } = await replay(ask, { lang: 'de', role, history: history.slice().reverse() });
    names.push(r.scenario);
    assert.ok(msg.text.length > 40);
    history.push(ask);
  }
  assert.deepEqual(names, ['bot:deals:history', 'bot:deals:shops', 'bot:photos', 'bot:deals:buy', 'bot:deals:shops']);
  assert.ok(names.every((n) => n.startsWith('bot:')), names.join(', '));
});

// ── "Neuer Bot" ────────────────────────────────────────────────────────────────────────────────────────────────────

test('"Neuer Bot" in the demo: the form body becomes a local bot; taken names, empty fields and the limit are refused', () => {
  const existing = demoBotList('de');
  const body = (t: TemplateId, title?: string) => {
    const d = draftFor(t, (k) => tr('de')(`botCreate.templates.${t}.${k}` as TKey));
    return createBody(title ? { ...d, title } : d, 'de-DE');
  };
  const lupe = demoCreate(body('research'), existing, NOW);
  assert.ok(lupe.ok);
  assert.equal(lupe.bot.name, 'lupe');
  assert.equal(lupe.bot.label, 'Lupe');
  assert.equal(lupe.bot.template, 'research');
  assert.equal(lupe.entry.color, templateColor('research'));
  assert.deepEqual(demoBotRole('lupe', 'de', [lupe.entry]), { template: 'research', name: 'Lupe', job: 'Quellen finden und zusammenfassen' });
  // the deals template is called Scout, like the example bot: refused like the bridge would (409 exists)
  const scout = demoCreate(body('deals'), existing, NOW);
  assert.deepEqual(scout, { ok: false, failure: { kind: 'exists' } });
  assert.deepEqual(demoCreate(body('deals', 'scout '), existing, NOW), { ok: false, failure: { kind: 'exists' } }, 'case and spaces do not matter');
  assert.deepEqual(demoCreate(body('deals', 'Hermes'), existing, NOW), { ok: false, failure: { kind: 'exists' } });
  const empty = demoCreate({ ...body('own'), title: 'Kiwi' }, existing, NOW);
  assert.ok(!empty.ok && empty.failure.kind === 'invalid', 'own role without a job');
  const many = [...existing, ...Array.from({ length: DEMO_BOT_LIMIT }, (_, i) => ({ name: `b${i}`, default: false, label: `B${i}` }))];
  assert.deepEqual(demoCreate(body('code'), many, NOW), { ok: false, failure: { kind: 'limit', limit: DEMO_BOT_LIMIT } });
  // a name of any shape gets a profile-like slug, unique
  assert.equal(demoSlug('Größte Hilfe!', new Set()), 'grosste-hilfe');
  assert.equal(demoSlug('Café Crème', new Set(['cafe-creme'])), 'cafe-creme-2');
  assert.equal(demoSlug('***', new Set()), 'bot');
  assert.equal(demoSlug('default', new Set()), 'default-bot');
  assert.equal(demoSlug('Ünïcödé '.repeat(10), new Set()).length <= 32, true);
});

test('a bot made in the demo answers in its role right away (its starters)', async () => {
  for (const lang of LANGS) {
    const made = demoCreate(createBody(draftFor('code', (k) => tr(lang)(`botCreate.templates.code.${k}` as TKey)), LOCALE[lang]), demoBotList(lang), NOW);
    assert.ok(made.ok);
    const role = demoBotRole(made.bot.name, lang, [made.entry])!;
    const { r } = await replay(tr(lang)('botCreate.templates.code.s2'), { lang, role });
    assert.equal(r.scenario, 'bot:code:script');
  }
});

// ── the bots' routines ("Über <Name>") ─────────────────────────────────────────────────────────────────────────────

test('"Über <Name>": each example bot has its own routines, delivered into its chat, named like the delivery in its history', async () => {
  const name = { scout: SCOUT_PRICE_JOB, atlas: ATLAS_REMINDER_JOB, lumi: LUMI_BRIEFING_JOB };
  for (const lang of LANGS) {
    for (const b of DEMO_SEEDED) {
      const jobs = demoBotJobs(b.name, NOW, lang);
      assert.ok(jobs.length >= 1, b.name);
      assert.ok(jobs.every((j) => j.deliverKind === 'bot-chat'));
      assert.ok(jobs.some((j) => j.name === name[b.name as keyof typeof name](lang)), `${b.name} ${lang}`);
      for (const j of jobs) assert.match(j.id, /^[0-9a-f]{12}$/);
    }
    assert.deepEqual(demoBotJobs('kiwi', NOW, lang), [], 'a bot made in the demo has none yet');
  }
  const scout = createDemoRoutines(NOW, 'de', 'scout');
  const list = await scout.list();
  assert.equal(list.jobs.length, 2);
  const paused = await scout.act(list.jobs[0].id, 'pause');
  assert.equal(paused.state, 'paused', 'pause works in memory');
  assert.equal((await createDemoRoutines(NOW, 'de').list()).jobs.length, 5, 'Hermes keeps the routines of the Routines screen');
});
