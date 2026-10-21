// Sync error banners (drawer sync, "load older", rename/delete on the server, opening a remote chat) in the app's
// language: sessionErrorText speaks the language of the `t` it gets, and every caller in the app passes the app's
// `t` (0.2.0 called it without one in conversations/hermesSync.ts, so an English or Spanish app showed German).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dictionaries, makeT } from '../i18n/core.ts';
import { sessionErrorText } from './sessions.ts';
import { HermesError } from './stream.ts';

const t = { de: makeT('de', 'de-DE'), en: makeT('en', 'en-US'), es: makeT('es', 'es-ES') };
const errors = (l: 'de' | 'en' | 'es') => dictionaries[l].backends.hermes.errors;

test('each session error kind in de / en / es', () => {
  const busy = new HermesError('bad_request', 'busy', { status: 409, code: 'session_active_turn' });
  const title = new HermesError('bad_request', 'too long', { status: 400, code: 'invalid_title' });
  const unsupported = new HermesError('server', 'not here', { status: 501 });
  const auth = new HermesError('auth', 'Invalid bridge token', { status: 401 });
  for (const l of ['de', 'en', 'es'] as const) {
    const e = errors(l);
    assert.equal(sessionErrorText(busy, t[l]), e.sessionActiveTurn, l);
    assert.equal(sessionErrorText(title, t[l]), e.invalidTitle.replace('{detail}', 'too long'), l);
    assert.equal(sessionErrorText(unsupported, t[l]), e.sessionApiUnsupported, l);
    assert.equal(sessionErrorText(auth, t[l]), e.apiKeyInvalid, l);
  }
  // the three languages really differ (a missing translation would fall back to German and pass silently)
  assert.notEqual(errors('en').sessionApiUnsupported, errors('de').sessionApiUnsupported);
  assert.notEqual(errors('es').sessionApiUnsupported, errors('de').sessionApiUnsupported);
});

test("every caller in the app passes the app's translator (no German default in an English app)", () => {
  const src = fileURLToPath(new URL('..', import.meta.url));
  const bad: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(f) && !f.includes('.test.')) {
        readFileSync(p, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            // a call with a single argument: sessionErrorText(e) / sessionErrorText(err)
            if (/sessionErrorText\(\s*[\w.]+\s*\)/.test(line)) bad.push(`${p.slice(src.length)}:${i + 1}`);
          });
      }
    }
  };
  walk(src);
  assert.deepEqual(bad, []);
});
