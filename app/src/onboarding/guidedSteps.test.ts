import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canGoBack, current, guidedProgress, guidedReducer, initialGuidedState, onboardingVariant, type GEvent, type GState } from './guidedSteps.ts';
import { newLinkHistory, onboardingBack } from './backNav.ts';

const run = (s: GState, ...evs: GEvent[]) => evs.reduce(guidedReducer, s);

test('flavor gating: official build guided, personal keeps the classic flow', () => {
  assert.equal(onboardingVariant('hermes'), 'guided');
  assert.equal(onboardingVariant('personal'), 'classic');
});

test('fast path: welcome → setup → scan → check → consent → done', () => {
  const s0 = initialGuidedState();
  assert.equal(current(s0), 'welcome');
  assert.equal(guidedProgress(s0), undefined);
  const s = run(s0, { type: 'connect' }, { type: 'choose', choice: 'link' }, { type: 'paired' });
  assert.deepEqual(s.history, ['welcome', 'setup', 'scan', 'check']);
  assert.equal(guidedProgress(s), 2);
  const c = guidedReducer(s, { type: 'saved', consentNeeded: true });
  assert.equal(current(c), 'consent');
  assert.equal(c.saved, true);
  assert.equal(canGoBack(c), false); // saved: no back
  assert.equal(guidedReducer(c, { type: 'back' }), c);
  const d = guidedReducer(c, { type: 'consented' });
  assert.equal(current(d), 'done');
  assert.equal(guidedProgress(d), 4);
  assert.equal(canGoBack(d), false);
  assert.equal(d.finished, false);
});

test('consent already given → straight to done', () => {
  const s = run(initialGuidedState(), { type: 'connect' }, { type: 'choose', choice: 'link' }, { type: 'paired' }, { type: 'saved', consentNeeded: false });
  assert.equal(current(s), 'done');
});

test('no bridge: agent prompt → "Ich habe den Link" → scan; self setup likewise; manual = limited form', () => {
  const nb = run(initialGuidedState(), { type: 'connect' }, { type: 'choose', choice: 'noBridge' });
  assert.equal(current(nb), 'noBridge');
  const agent = run(nb, { type: 'bridgeOption', option: 'agent' }, { type: 'haveLink' });
  assert.deepEqual(agent.history.slice(-3), ['noBridge', 'agentSetup', 'scan']);
  const self = run(nb, { type: 'bridgeOption', option: 'self' }, { type: 'haveLink' });
  assert.deepEqual(self.history.slice(-2), ['selfSetup', 'scan']);
  const manual = run(nb, { type: 'bridgeOption', option: 'manual' });
  assert.equal(current(manual), 'manual');
  assert.equal(current(guidedReducer(manual, { type: 'saved', consentNeeded: false })), 'done');
  // back walks the history
  assert.equal(current(run(agent, { type: 'back' }, { type: 'back' })), 'noBridge');
});

test('no Hermes yet → info screen → demo; demo done screen can go back', () => {
  const s = run(initialGuidedState(), { type: 'connect' }, { type: 'choose', choice: 'noHermes' });
  assert.equal(current(s), 'noHermes');
  const d = guidedReducer(s, { type: 'demo' });
  assert.equal(current(d), 'done');
  assert.equal(d.demo, true);
  assert.equal(guidedProgress(d), undefined);
  assert.equal(canGoBack(d), true);
  const back = guidedReducer(d, { type: 'back' });
  assert.equal(current(back), 'noHermes');
  assert.equal(back.demo, false);
});

test('welcome demo shortcut', () => {
  const d = guidedReducer(initialGuidedState(), { type: 'demo' });
  assert.deepEqual(d.history, ['welcome', 'done']);
  assert.equal(d.demo, true);
});

test('deep links: valid → check (keeps intro), invalid → scan; ignored after saving', () => {
  const s = run(initialGuidedState(), { type: 'connect' }, { type: 'choose', choice: 'noBridge' }, { type: 'bridgeOption', option: 'agent' });
  assert.deepEqual(guidedReducer(s, { type: 'deepLink', ok: true }).history, ['welcome', 'setup', 'check']);
  assert.deepEqual(guidedReducer(s, { type: 'deepLink', ok: false }).history, ['welcome', 'setup', 'scan']);
  const cold = guidedReducer(initialGuidedState('choose', true), { type: 'deepLink', ok: true });
  assert.deepEqual(cold.history, ['setup', 'check']);
  const saved = guidedReducer(cold, { type: 'saved', consentNeeded: true });
  assert.equal(guidedReducer(saved, { type: 'deepLink', ok: true }), saved);
});

test('finishAfterSave (Settings / re-pairing): finish after saving, consent first when needed', () => {
  const s = run(initialGuidedState('choose', true), { type: 'choose', choice: 'link' }, { type: 'paired' });
  assert.equal(guidedProgress(initialGuidedState('choose', true)), 1);
  const done = guidedReducer(s, { type: 'saved', consentNeeded: false });
  assert.equal(done.finished, true);
  const c = guidedReducer(s, { type: 'saved', consentNeeded: true });
  assert.equal(current(c), 'consent');
  const f = guidedReducer(c, { type: 'consented' });
  assert.equal(f.finished, true);
  // finished state is frozen
  assert.equal(guidedReducer(f, { type: 'back' }), f);
});

test('events in the wrong step are ignored', () => {
  const s = initialGuidedState();
  assert.equal(guidedReducer(s, { type: 'paired' }), s);
  assert.equal(guidedReducer(s, { type: 'choose', choice: 'link' }), s);
  assert.equal(guidedReducer(s, { type: 'back' }), s);
});

// Review: a pair link delivered while "Verbinden" ran switched the flow to the scanner (invalid link) – the running
// connection's `saved` event was then ignored although the profile was saved. A save that went through is followed
// from whatever step is shown; only a second one after the first is ignored.
test('saved: always followed, also when the step changed meanwhile', () => {
  const s = run(initialGuidedState(), { type: 'connect' }, { type: 'choose', choice: 'link' }, { type: 'paired' }, { type: 'deepLink', ok: false });
  assert.equal(current(s), 'scan');
  const c = guidedReducer(s, { type: 'saved', consentNeeded: true });
  assert.equal(current(c), 'consent');
  assert.equal(c.saved, true);
  assert.deepEqual(c.history, ['consent']);
  const f = guidedReducer(run(initialGuidedState('choose', true), { type: 'deepLink', ok: false }), { type: 'saved', consentNeeded: false });
  assert.equal(f.finished, true);
  assert.equal(guidedReducer(c, { type: 'saved', consentNeeded: false }), c, 'saved once');
});

// E2E round 5, N1: after a successful Connect, Android Back on the privacy step led back to "Verbindung prüfen" (or out
// to Welcome); its Connect button then burned the spent code. Once saved, the steps before are gone from the history.
test('saved: the connect step and everything before it leave the history; Back stays on the post-connect steps', () => {
  const s = run(initialGuidedState(), { type: 'connect' }, { type: 'choose', choice: 'link' }, { type: 'paired' });
  const c = guidedReducer(s, { type: 'saved', consentNeeded: true });
  assert.deepEqual(c.history, ['consent']);
  const d = guidedReducer(c, { type: 'consented' });
  assert.deepEqual(d.history, ['consent', 'done']);
  assert.equal(guidedReducer(d, { type: 'back' }), d);
  const m = run(initialGuidedState(), { type: 'connect' }, { type: 'choose', choice: 'noBridge' }, { type: 'bridgeOption', option: 'manual' }, { type: 'saved', consentNeeded: false });
  assert.deepEqual(m.history, ['done']);
  // a pair link arriving later never reopens the check
  assert.equal(guidedReducer(c, { type: 'deepLink', ok: true }), c);
});

test('hardware Back: pops before the save, swallowed after it (never passed on to the host / router)', () => {
  const s = run(initialGuidedState(), { type: 'connect' }, { type: 'choose', choice: 'link' }, { type: 'paired' });
  assert.equal(onboardingBack({ busy: false, saved: s.saved, canPop: canGoBack(s) }), 'pop');
  assert.equal(onboardingBack({ busy: true, saved: s.saved, canPop: canGoBack(s) }), 'swallow', 'Connect in flight');
  const c = guidedReducer(s, { type: 'saved', consentNeeded: true });
  assert.equal(onboardingBack({ busy: false, saved: c.saved, canPop: canGoBack(c) }), 'swallow', 'privacy step');
  const d = guidedReducer(c, { type: 'consented' });
  assert.equal(onboardingBack({ busy: false, saved: d.saved, canPop: canGoBack(d) }), 'swallow', 'done step');
  // nothing saved, first step: the host / router decide (close a dismissable flow, leave the app)
  assert.equal(onboardingBack({ busy: false, saved: false, canPop: false }), 'pass');
});

// Review: an expired / used link (final redeem failure) on a connect screen without Back – a link confirmed without the
// intro steps in the first-run onboarding has the history ['form'] – left no footer action at all. "New link" always
// leads to the scanner, with the setup choice behind it.
test('classic flow: "new link" after a final redeem failure always reaches the scanner, the choice behind it', () => {
  assert.deepEqual(newLinkHistory(['form']), ['choose', 'scan'], 'link opened in the first-run onboarding');
  assert.deepEqual(newLinkHistory(['welcome', 'form']), ['welcome', 'choose', 'scan']);
  assert.deepEqual(newLinkHistory(['choose', 'form']), ['choose', 'scan']);
  assert.deepEqual(newLinkHistory(['welcome', 'choose', 'scan', 'form']), ['welcome', 'choose', 'scan']);
});

test('guided flow: "new link" after a final redeem failure → scanner, the setup choice behind it', () => {
  const cold = run(initialGuidedState(), { type: 'deepLink', ok: true });
  assert.deepEqual(cold.history, ['welcome', 'check']);
  const s = guidedReducer(cold, { type: 'newLink' });
  assert.deepEqual(s.history, ['welcome', 'setup', 'scan']);
  assert.equal(current(guidedReducer(s, { type: 'back' })), 'setup');
  assert.deepEqual(guidedReducer(run(initialGuidedState('choose', true), { type: 'deepLink', ok: true }), { type: 'newLink' }).history, ['setup', 'scan']);
  // only from the connect step, never after a save
  const w = initialGuidedState();
  assert.equal(guidedReducer(w, { type: 'newLink' }), w);
  const saved = guidedReducer(cold, { type: 'saved', consentNeeded: true });
  assert.equal(guidedReducer(saved, { type: 'newLink' }), saved);
});
