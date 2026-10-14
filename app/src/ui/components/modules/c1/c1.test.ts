import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isKnownLang, isRtl, languageName, nativeName, parseLang, sameLanguage, speechLocale, LANGUAGES } from './languages.ts';
import { isLongText, orderPanes, readTranslation, speakId, textSize } from './translationModel.ts';
import {
  addOption,
  allOptions,
  cancelVoting,
  castBallot,
  finishVoting,
  INITIAL_POLL_STATE,
  nextVoter,
  percentages,
  pollReply,
  readPoll,
  removeOption,
  setVote,
  splitEmoji,
  startVoting,
  tally,
  toggleDraft,
  undoLastBallot,
  voterPhase,
  type PollState,
} from './pollModel.ts';
import { dictionaries } from '../../../../i18n/core.ts';

/* ───────────── language map ───────────── */

test('languageName: localized names in de/en/es, region + script, unknown', () => {
  assert.equal(languageName('es', 'de'), 'Spanisch');
  assert.equal(languageName('de', 'es'), 'Alemán');
  assert.equal(languageName('ES', 'en'), 'Spanish');
  assert.equal(languageName('pt-BR', 'de'), 'Portugiesisch (Brasilien)');
  assert.equal(languageName('es_MX', 'es'), 'Español (México)');
  assert.equal(languageName('zh-Hant', 'de'), 'Chinesisch (traditionell)');
  assert.equal(languageName('en-NZ', 'en'), 'English (NZ)');
  assert.equal(languageName('ka', 'de'), 'KA');
  assert.equal(languageName('', 'de'), 'Unbekannte Sprache');
  assert.equal(languageName('und', 'en'), 'Unknown language');
  assert.equal(languageName(undefined, 'es'), 'Idioma desconocido');
  assert.equal(languageName('no', 'de'), 'Norwegisch'); // alias → nb
});

test('nativeName: own name, empty when same as localized or unknown', () => {
  assert.equal(nativeName('es', 'de'), 'Español');
  assert.equal(nativeName('es', 'es'), '');
  assert.equal(nativeName('ja', 'en'), '日本語');
  assert.equal(nativeName('xx', 'en'), '');
});

test('speechLocale: default region, explicit region kept, zh script', () => {
  assert.equal(speechLocale('de'), 'de-DE');
  assert.equal(speechLocale('es'), 'es-ES');
  assert.equal(speechLocale('es-mx'), 'es-MX');
  assert.equal(speechLocale('pt-BR'), 'pt-BR');
  assert.equal(speechLocale('zh-Hant'), 'zh-TW');
  assert.equal(speechLocale('zh'), 'zh-CN');
  assert.equal(speechLocale('ka'), 'ka');
  assert.equal(speechLocale('und'), '');
  assert.equal(speechLocale('es-419'), 'es-ES'); // numeric region → default voice
});

test('parseLang / rtl / sameLanguage / every entry complete', () => {
  assert.deepEqual(parseLang('zh_hant_tw'), { base: 'zh', script: 'Hant', region: 'TW', raw: 'zh_hant_tw' });
  assert.equal(parseLang('1234').base, 'und');
  assert.equal(isRtl('ar'), true);
  assert.equal(isRtl('he-IL'), true);
  assert.equal(isRtl('de'), false);
  assert.equal(sameLanguage('de', 'de-AT'), true);
  assert.equal(sameLanguage('und', 'und'), false);
  assert.equal(isKnownLang('fr-CA'), true);
  for (const [code, info] of Object.entries(LANGUAGES)) {
    assert.ok(info.de && info.en && info.es && info.native && info.speech, code);
    assert.match(code, /^[a-z]{2,3}$/);
  }
});

/* ───────────── translation model ───────────── */

test('readTranslation: partial / junk input, max 4 targets, romanization', () => {
  assert.deepEqual(readTranslation(null), { source: null, targets: [] });
  assert.deepEqual(readTranslation({ source: { lang: 'de' } }), { source: null, targets: [] });
  const m = readTranslation({
    source: { lang: 'de', text: '  Guten Morgen ' },
    targets: [{ lang: 'es', text: 'Buenos días' }, { lang: 'ja', text: 'おはよう', romanization: 'ohayō' }, null, { lang: 'fr', text: '' }, { lang: 'it', text: 'Buongiorno' }, { lang: 'en', text: 'Good morning' }, { lang: 'nl', text: 'Goedemorgen' }],
    note: 'informell',
  });
  assert.equal(m.source?.text, 'Guten Morgen');
  assert.deepEqual(m.targets.map((x) => x.lang), ['es', 'ja', 'it', 'en']);
  assert.equal(m.targets[1].romanization, 'ohayō');
  assert.equal(m.note, 'informell');
  assert.equal(readTranslation({ source: { text: 'x' }, targets: [] }).source?.lang, 'und');
});

test('orderPanes: swap puts translations first', () => {
  const m = readTranslation({ source: { lang: 'de', text: 'Hallo' }, targets: [{ lang: 'es', text: 'Hola' }] });
  assert.deepEqual(orderPanes(m, false).map((p) => p.lang), ['de', 'es']);
  assert.deepEqual(orderPanes(m, true).map((p) => p.lang), ['es', 'de']);
  const only = readTranslation({ source: { lang: 'de', text: 'Hallo' } });
  assert.deepEqual(orderPanes(only, true).map((p) => p.lang), ['de']);
});

test('long text / size / speak id', () => {
  assert.equal(isLongText('kurz'), false);
  assert.equal(isLongText('x'.repeat(281)), true);
  assert.equal(isLongText('a\nb\nc\nd\ne\nf\ng'), true);
  assert.equal(textSize('Hola'), 'large');
  assert.equal(textSize('x'.repeat(100)), 'medium');
  assert.equal(textSize('x'.repeat(200)), 'body');
  assert.equal(speakId('tr1', 't0'), 'translation:tr1:t0');
});

/* ───────────── poll: reading + tally ───────────── */

const NODE = readPoll({
  id: 'essen',
  question: 'Was essen wir?',
  options: [{ label: 'Pizza', emoji: '🍕' }, { id: 'su', label: 'Sushi' }, { label: 'Burger' }, { label: '' }, 'Tacos'],
  voters: ['Anna', 'Ben', 'anna', ' Carla ', ''],
});

test('readPoll: ids o<index>, dedupe voters, string options, flags', () => {
  assert.deepEqual(NODE.options.map((o) => o.id), ['o0', 'su', 'o2', 'o4']);
  assert.equal(NODE.options[0].emoji, '🍕');
  assert.deepEqual(NODE.voters, ['Anna', 'Ben', 'Carla']);
  assert.equal(NODE.multiple, false);
  assert.equal(readPoll({ options: [{ id: 'x', label: 'A' }, { id: 'x', label: 'B' }] }).options[1].id, 'x_');
  assert.deepEqual(readPoll(undefined), { question: '', options: [], multiple: false, voters: [], allowAdd: false, anonymous: false });
});

test('percentages: largest remainder sums to 100; multiple uses participants', () => {
  assert.deepEqual(percentages([1, 1, 1], 3, true), [34, 33, 33]);
  assert.deepEqual(percentages([2, 1, 0], 3, true), [67, 33, 0]);
  assert.equal(percentages([1, 1, 1, 1, 1, 1, 1], 7, true).reduce((a, b) => a + b, 0), 100);
  assert.deepEqual(percentages([0, 0], 0, true), [0, 0]);
  assert.deepEqual(percentages([3, 2], 3, false), [100, 67]);
});

test('tally: single, ignores unknown ids and extra picks, leaders/tie', () => {
  const r = tally(NODE.options, { Anna: ['o0'], Ben: ['su', 'o0'], Carla: ['o0'], Ghost: ['nope'] }, false);
  assert.deepEqual(r.rows.map((x) => x.count), [2, 1, 0, 0]);
  assert.equal(r.participants, 3);
  assert.equal(r.totalVotes, 3);
  assert.deepEqual(r.leaders, ['o0']);
  assert.deepEqual(r.rows[0].voters, ['Anna', 'Carla']);
  assert.deepEqual(r.rows.map((x) => x.percent), [67, 33, 0, 0]);
  const tie = tally(NODE.options, { a: ['o0'], b: ['su'] }, false);
  assert.deepEqual(tie.leaders, ['o0', 'su']);
  assert.deepEqual(tally(NODE.options, {}, false).leaders, []);
});

test('tally: multiple counts each pick, percent of participants', () => {
  const r = tally(NODE.options, { a: ['o0', 'su'], b: ['o0', 'o0'], c: ['o2'] }, true);
  assert.deepEqual(r.rows.map((x) => x.count), [2, 1, 1, 0]);
  assert.equal(r.participants, 3);
  assert.equal(r.totalVotes, 4);
  assert.deepEqual(r.rows.map((x) => x.percent), [67, 33, 33, 0]);
});

/* ───────────── poll: reply ───────────── */

test('pollReply: spec format, ranked, zeros last, singular', () => {
  const anon = { ...NODE, voters: [] };
  const r = tally(NODE.options, { '#1': ['o0'], '#2': ['o0'], '#3': ['su'], '#4': ['o0'] }, false);
  assert.equal(pollReply('essen', anon, r), '[poll:essen] Pizza 3 · Sushi 1 · Burger 0 · Tacos 0 (4 Stimmen)');
  const one = tally(NODE.options, { '#1': ['o2'] }, false);
  assert.equal(pollReply('essen', anon, one), '[poll:essen] Burger 1 · Pizza 0 · Sushi 0 · Tacos 0 (1 Stimme)');
});

test('pollReply: multiple adds people; named voters appended unless anonymous', () => {
  const multi = { ...NODE, multiple: true };
  const r = tally(NODE.options, { Anna: ['o0', 'su'], Ben: ['o0'] }, true);
  assert.equal(pollReply('essen', multi, r), '[poll:essen] Pizza 2 · Sushi 1 · Burger 0 · Tacos 0 (3 Stimmen · 2 Personen) — Anna: Pizza, Sushi; Ben: Pizza');
  assert.equal(pollReply('essen', { ...multi, anonymous: true }, r), '[poll:essen] Pizza 2 · Sushi 1 · Burger 0 · Tacos 0 (3 Stimmen · 2 Personen)');
  assert.ok(pollReply('  ', NODE, r).startsWith('[poll:poll] '));
});

/* ───────────── poll: votes, ballots, added options ───────────── */

test('toggleDraft: single replaces / clears, multiple toggles', () => {
  assert.deepEqual(toggleDraft([], 'a', false), ['a']);
  assert.deepEqual(toggleDraft(['a'], 'b', false), ['b']);
  assert.deepEqual(toggleDraft(['a'], 'a', false), []);
  assert.deepEqual(toggleDraft(['a'], 'b', true), ['a', 'b']);
  assert.deepEqual(toggleDraft(['a', 'b'], 'a', true), ['b']);
});

test('setVote / castBallot / undoLastBallot', () => {
  let s: PollState = setVote(INITIAL_POLL_STATE, 'Anna', ['o0', 'su'], NODE.options, false);
  assert.deepEqual(s.votes, { Anna: ['o0'] }); // single → first only
  s = setVote(s, 'Anna', [], NODE.options, false);
  assert.deepEqual(s.votes, {});
  let b = castBallot(INITIAL_POLL_STATE, ['su'], NODE.options, false);
  b = castBallot(b, ['o0'], NODE.options, false);
  b = castBallot(b, [], NODE.options, false); // ignored
  assert.deepEqual(b.votes, { '#1': ['su'], '#2': ['o0'] });
  assert.equal(b.seq, 2);
  b = undoLastBallot(b);
  assert.deepEqual(b.votes, { '#1': ['su'] });
  b = castBallot(b, ['o2'], NODE.options, false);
  assert.deepEqual(Object.keys(b.votes), ['#1', '#3']); // seq keeps counting → no key reuse
  assert.equal(undoLastBallot(INITIAL_POLL_STATE), INITIAL_POLL_STATE);
});

test('addOption / removeOption / splitEmoji', () => {
  assert.deepEqual(splitEmoji('🌮 Tacos al pastor'), { emoji: '🌮', label: 'Tacos al pastor' });
  assert.deepEqual(splitEmoji('👍🏽Gut'), { emoji: '👍🏽', label: 'Gut' });
  assert.deepEqual(splitEmoji('Pasta'), { label: 'Pasta' });
  const n = { ...NODE, allowAdd: true };
  const r = addOption(INITIAL_POLL_STATE, n, '🍝 Pasta');
  assert.equal(r.error, undefined);
  assert.equal(r.id, 'a1');
  assert.deepEqual(r.state.added, [{ id: 'a1', label: 'Pasta', emoji: '🍝', added: true }]);
  assert.equal(addOption(r.state, n, 'pizza').error, 'exists');
  assert.equal(addOption(r.state, n, '   ').error, 'empty');
  assert.equal(allOptions(n, r.state).length, 5);
  let full = r.state;
  for (let i = 0; i < 20; i++) full = addOption(full, n, `X${i}`).state;
  assert.equal(allOptions(n, full).length, 12);
  assert.equal(addOption(full, n, 'Noch eins').error, 'max');
  const voted = setVote(setVote(r.state, 'Anna', ['a1'], allOptions(n, r.state), true), 'Ben', ['a1', 'o0'], allOptions(n, r.state), true);
  const removed = removeOption(voted, 'a1');
  assert.deepEqual(removed.added, []);
  assert.deepEqual(removed.votes, { Ben: ['o0'] });
  assert.equal(removeOption(voted, 'o0'), voted); // only added options can be removed
});

/* ───────────── poll: pass-the-phone flow ───────────── */

test('nextVoter: wraps, skips voters who voted, null when done', () => {
  const v = ['Anna', 'Ben', 'Carla'];
  assert.equal(nextVoter(v, {}, null), 'Anna');
  assert.equal(nextVoter(v, { Anna: ['o0'] }, 'Anna'), 'Ben');
  assert.equal(nextVoter(v, { Anna: ['o0'], Carla: ['su'] }, 'Carla'), 'Ben');
  assert.equal(nextVoter(v, { Ben: ['o0'] }, 'Carla'), 'Anna');
  assert.equal(nextVoter(v, { Anna: ['x'], Ben: ['x'], Carla: ['x'] }, 'Ben'), null);
  assert.equal(nextVoter([], {}, null), null);
});

test('voter flow: pick → vote → handoff → … → done, cancel, revote', () => {
  let s = INITIAL_POLL_STATE;
  assert.equal(voterPhase(NODE.voters, s), 'pick');
  s = startVoting(s, 'Ben');
  assert.equal(voterPhase(NODE.voters, s), 'vote');
  s = finishVoting(s, ['su'], NODE, NODE.options);
  assert.deepEqual(s.votes, { Ben: ['su'] });
  assert.equal(s.active, null);
  assert.equal(s.next, 'Carla');
  assert.equal(voterPhase(NODE.voters, s), 'handoff');
  s = { ...s, next: null }; // "Jemand anderes"
  assert.equal(voterPhase(NODE.voters, s), 'pick');
  s = finishVoting(startVoting(s, 'Carla'), ['o0'], NODE, NODE.options);
  assert.equal(s.next, 'Anna');
  s = startVoting(s, 'Anna');
  s = cancelVoting(s);
  assert.equal(voterPhase(NODE.voters, s), 'pick');
  s = finishVoting(startVoting(s, 'Anna'), ['o0'], NODE, NODE.options);
  assert.equal(s.next, null);
  assert.equal(voterPhase(NODE.voters, s), 'done');
  // Ben changes his mind, then removes his vote
  s = finishVoting(startVoting(s, 'Ben'), ['o2'], NODE, NODE.options);
  assert.deepEqual(s.votes.Ben, ['o2']);
  s = finishVoting(startVoting(s, 'Ben'), [], NODE, NODE.options);
  assert.equal(s.votes.Ben, undefined);
  assert.equal(s.next, null); // never hand the phone back to the same person
  assert.equal(voterPhase(NODE.voters, s), 'pick');
  assert.equal(finishVoting(INITIAL_POLL_STATE, ['o0'], NODE, NODE.options), INITIAL_POLL_STATE); // nobody active
  assert.equal(voterPhase(NODE.voters, { ...INITIAL_POLL_STATE, active: 'Fremd' }), 'pick'); // unknown name
});

/* ───────────── i18n ───────────── */

test('i18n: translation + poll keys exist in de/en/es with the same shape', () => {
  for (const ns of ['translation', 'poll'] as const) {
    const de = Object.keys(dictionaries.de.ui[ns]).sort();
    assert.deepEqual(Object.keys(dictionaries.en.ui[ns]).sort(), de, `en ${ns}`);
    assert.deepEqual(Object.keys(dictionaries.es.ui[ns]).sort(), de, `es ${ns}`);
  }
});
