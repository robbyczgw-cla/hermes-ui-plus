// Routines with the default bridge (no bot enabled) must not vanish without a word: the drawer keeps the row with a
// note, the screen explains how the owner turns them on and offers the chat route. Servers without the job API keep
// no row. Also guards the Skills tab text (no promise of a Hermes update that does not exist).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeT } from '../i18n/core.ts';
import '../i18n/en.ts';
import '../i18n/es.ts';
import { HermesError } from '../hermes/stream.ts';
import { routinesEntry, routinesProbeState } from './availability.ts';

const err = (status: number, code?: string) => new HermesError(status >= 500 ? 'server' : 'bad_request', 'x', { status, ...(code ? { code } : {}) });

test('probe state: off / forbidden / unsupported are lasting answers, network and 5xx are transient', () => {
  assert.equal(routinesProbeState(err(404, 'routines_off')), 'off');
  assert.equal(routinesProbeState(err(403, 'routines_forbidden')), 'forbidden');
  assert.equal(routinesProbeState(err(404)), 'unsupported'); // older Hermes / bridge without the job API
  assert.equal(routinesProbeState(err(405)), 'unsupported');
  assert.equal(routinesProbeState(err(501)), 'unsupported');
  assert.equal(routinesProbeState(err(502)), null);
  assert.equal(routinesProbeState(new Error('offline')), null);
});

test('drawer row: shown with a note when Routines are off or not allowed, hidden without a job API', () => {
  assert.deepEqual(routinesEntry('available'), { show: true, note: null });
  assert.deepEqual(routinesEntry('off'), { show: true, note: 'off' });
  assert.deepEqual(routinesEntry('forbidden'), { show: true, note: 'forbidden' });
  assert.deepEqual(routinesEntry('unsupported'), { show: false, note: null });
  assert.deepEqual(routinesEntry(undefined), { show: false, note: null });
});

for (const [lang, locale] of [['de', 'de-DE'], ['en', 'en-US'], ['es', 'es-ES']] as const) {
  const t = makeT(lang, locale);
  test(`${lang}: Routines off / no access explain the next step and the chat route`, () => {
    const off = t('routines.off.body', { bot: 'default' });
    assert.match(off, /hermes-ui-plus-bridge routines enable default/);
    assert.match(t('routines.forbidden.body', { bot: 'default' }), /routines grant <device-id> default read/);
    for (const k of ['routines.askChat', 'routines.askChatPrompt'] as const) {
      assert.ok(t(k) && t(k) !== k, `${k} translated`);
    }
  });
  test(`${lang}: the Skills tab does not promise a Hermes update that fixes the skill list`, () => {
    const body = t('library.skills.hermesBug');
    assert.doesNotMatch(body, /update|Update|actualizaci/);
    assert.match(body, /chat/i);
  });
}
