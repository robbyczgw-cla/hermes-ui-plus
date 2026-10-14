import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeT } from '../i18n/core.ts';
import { formMessage, parseFormMessage, formSummary, formatDuration, plainCopyText, toolLabel, toolPreview, toolEmoji } from './format.ts';

test('form message round trip', () => {
  const msg = formMessage('trip', { ziel: 'Rom', tage: 3, flug: true });
  assert.equal(msg, '[form:trip] {"ziel":"Rom","tage":3,"flug":true}');
  const p = parseFormMessage(msg);
  assert.deepEqual(p, { formId: 'trip', values: { ziel: 'Rom', tage: 3, flug: true } });
  assert.equal(parseFormMessage('hallo'), null);
  assert.equal(parseFormMessage('[form:x] [1]'), null);
  assert.equal(formSummary({ ziel: 'Rom', flug: true, x: null, notiz: '' }, makeT('de', 'de-DE')), 'ziel: Rom · flug: ja');
});

test('formatDuration', () => {
  assert.equal(formatDuration(850, 'de-DE'), '850 ms');
  assert.equal(formatDuration(3240, 'de-DE'), '3,2 s');
  assert.equal(formatDuration(3240, 'en-US'), '3.2 s');
  assert.equal(formatDuration(12500, 'de-DE'), '13 s');
});

test('plainCopyText strips hui blocks (closed and open)', () => {
  const t = 'Intro\n\n```hui\n{"type":"text"}\n```\n\nMitte\n```hui-html\n<div>';
  assert.equal(plainCopyText(t), 'Intro\n\nMitte');
  assert.equal(plainCopyText('a\n```js\nx\n```'), 'a\n```js\nx\n```');
});

test('tool labels and emoji', () => {
  const t = makeT('de', 'de-DE');
  const en = makeT('en', 'en-US');
  assert.equal(toolLabel(t, 'web_search'), 'Websuche');
  assert.equal(toolPreview(t, 'web_search', 'Wetter Wien'), 'Wetter Wien');
  assert.equal(toolPreview(t, 'terminal', 'terminal'), null);
  assert.equal(toolPreview(t, 'web_search', 'Websuche…'), null);
  assert.equal(toolPreview(t, 'web_search', 'Websuche: wetter wien'), 'wetter wien');
  assert.equal(toolPreview(t, 'terminal', 'x'.repeat(80))?.length, 60);
  assert.equal(toolLabel(en, 'web_search'), 'Web search');
  assert.equal(toolPreview(en, 'web_search', 'Websuche: wetter wien'), 'wetter wien'); // German label from backend clients
  assert.equal(toolPreview(en, 'web_search', 'Web search: weather'), 'weather');
  assert.equal(toolEmoji('terminal', '🐚'), '🐚');
  assert.equal(toolLabel(t, 'my_custom_tool'), 'My custom tool');
  assert.equal(toolEmoji('web_search'), '🔍');
  assert.equal(toolEmoji('terminal'), '💻');
});
