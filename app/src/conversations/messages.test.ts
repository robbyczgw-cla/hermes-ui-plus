/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChatMessage } from '../hermes/types';
import { conversations as convDe } from '../i18n/ns/conversations.de.ts';
import { conversations as convEn } from '../i18n/ns/conversations.en.ts';
import { localizePreview, attachmentMarker, attachmentUris, capMessages, firstUserText, messagesSignature, previewOf, messagesFileJson, prepareForStorage, searchTextOf, stripMessage, capStoredText, STORED_TEXT_MAX, STORED_TEXT_MARKER } from './messages.ts';

function msg(i: number, over: Partial<ChatMessage> = {}): ChatMessage {
  return { id: `m${i}`, role: i % 2 ? 'assistant' : 'user', text: `text ${i}`, tools: [], status: 'done', createdAt: i, ...over };
}

test('stripMessage removes transient fields and closes streaming state', () => {
  const m = msg(1, {
    status: 'streaming',
    reasoning: 'hmm',
    statusNote: 'retry',
    approval: { runId: 'r', command: 'rm', description: '', choices: ['once', 'deny'], timestamp: 1 },
    tools: [{ id: 't', name: 'terminal', label: 'ls', status: 'running', startedAt: 5 }],
  });
  const s = stripMessage(m);
  assert.equal(s.status, 'stopped');
  // already streamed reasoning stays visible after a reload (offline + reload)
  assert.equal(s.reasoning, 'hmm');
  assert.equal('statusNote' in s, false);
  assert.equal('approval' in s, false);
  assert.equal(s.tools[0].status, 'done');
  assert.equal(s.tools[0].detail?.cancelled, true); // "abgebrochen", not "✓ fertig"
  assert.equal(m.status, 'streaming'); // input untouched
});

test('capMessages keeps the newest N', () => {
  const list = Array.from({ length: 10 }, (_, i) => msg(i));
  const c = capMessages(list, 4);
  assert.deepEqual(c.map((m) => m.id), ['m6', 'm7', 'm8', 'm9']);
});

test('capMessages enforces a byte budget but keeps at least the last message', () => {
  const list = Array.from({ length: 5 }, (_, i) => msg(i, { text: 'x'.repeat(1000) }));
  const c = capMessages(list, 300, 2500);
  assert.equal(c.length, 2);
  assert.equal(c[1].id, 'm4');
  const one = capMessages([msg(1, { text: 'y'.repeat(5000) })], 300, 100);
  assert.equal(one.length, 1);
});

test('prepareForStorage default cap is 300', () => {
  const list = Array.from({ length: 450 }, (_, i) => msg(i));
  const p = prepareForStorage(list);
  assert.equal(p.length, 300);
  assert.equal(p[0].id, 'm150');
});

test('previewOf uses last message with text and flattens fences', () => {
  assert.equal(previewOf([msg(0), msg(1, { text: 'Antwort **fett**' })]), 'Antwort fett');
  assert.equal(previewOf([msg(1, { text: '```hui\n{"type":"chart"}\n```' })]), '[Komponente]');
  assert.equal(previewOf([msg(1, { text: 'a' }), msg(2, { text: '' })]), 'a');
  assert.equal(previewOf([]), '');
  assert.ok(Array.from(previewOf([msg(1, { text: 'z'.repeat(500) })])).length <= 90);
});

test('signature changes with content', () => {
  const a = [msg(0)];
  assert.notEqual(messagesSignature(a), messagesSignature([...a, msg(1)]));
  assert.notEqual(messagesSignature(a), messagesSignature([msg(0, { text: 'longer text' })]));
  assert.equal(messagesSignature(a), messagesSignature([msg(0)]));
});

test('searchTextOf joins message text', () => {
  assert.match(searchTextOf([msg(0), msg(1)]), /text 0\ntext 1/);
});

test('attachment-only messages get a preview, title and uri list', () => {
  const att = (kind: 'image' | 'file', name: string, uri: string) =>
    ({ id: name, kind, name, mimeType: kind === 'image' ? 'image/jpeg' : 'application/pdf', size: 1, uri, status: 'ready' as const });
  const u = msg(0, { text: '', attachments: [att('image', 'Foto 14-32.jpg', 'file:///a/x.jpg')] });
  const u2 = msg(2, { text: '  ', attachments: [att('file', 'bericht.pdf', 'file:///a/y.pdf')] });
  const a = msg(1);
  assert.equal(previewOf([u]), '[Bild]');
  assert.equal(previewOf([u, u2]), '[Datei]');
  assert.equal(attachmentMarker({}), '');
  assert.equal(firstUserText([u2]), 'bericht.pdf');
  assert.equal(firstUserText([a]), undefined);
  assert.deepEqual(attachmentUris([u, a, u2]), ['file:///a/x.jpg', 'file:///a/y.pdf']);
});

test('stripMessage keeps tool details and trace, capped for storage', () => {
  const big = 'x'.repeat(20_000);
  const m = msg(3, {
    tools: [
      {
        id: 't',
        name: 'web_search',
        label: 'q',
        status: 'done',
        startedAt: 1,
        endedAt: 2,
        detail: { tool: 'web_search', input: { query: 'q' }, output: { big }, summary: '3 Treffer', links: [{ title: 'A', url: 'https://a.de' }] },
        raw: [{ big }],
      },
    ],
    trace: [{ id: 'status-0', kind: 'status', at: 1, text: 'Warte', data: { kind: 'lifecycle' } }],
    metrics: { model: 'claude-sonnet-5-5', inputTokens: 10, outputTokens: 2, endedAt: 9 },
  });
  const s = stripMessage(m);
  assert.deepEqual(s.tools[0].detail?.input, { query: 'q' });
  assert.equal(s.tools[0].detail?.summary, '3 Treffer');
  assert.deepEqual(s.tools[0].detail?.links, [{ title: 'A', url: 'https://a.de' }]);
  assert.equal(typeof s.tools[0].detail?.output, 'string');
  assert.ok(JSON.stringify(s).length < 8000);
  assert.deepEqual(s.trace, m.trace);
  assert.deepEqual(s.metrics, m.metrics);
});

test('localizePreview maps stored German markers to the active language, leaves other text alone', () => {
  const mk = (ns: typeof convDe | typeof convEn) => (key: string, vars?: Record<string, string | number>) => {
    const raw = (ns.marker as Record<string, string>)[key.replace('conversations.marker.', '')];
    return raw.replace('{count}', String(vars?.count ?? ''));
  };
  const stored = previewOf([msg(1, { text: 'Hier: ```hui\n{}\n``` und ```js\nx\n```' })]);
  assert.match(stored, /\[Komponente\]/);
  assert.equal(localizePreview(stored, mk(convDe) as never), stored);
  const en = localizePreview(stored, mk(convEn) as never);
  assert.match(en, /\[Component\]/);
  assert.match(en, /\[Code\]/);
  assert.doesNotMatch(en, /Komponente/);
  assert.equal(localizePreview('[Bild]', mk(convEn) as never), '[Image]');
  assert.equal(localizePreview('[3 Bilder]', mk(convEn) as never), '[3 images]');
  assert.equal(localizePreview('[Grafik] [Datei] [Unbekannt]', mk(convEn) as never), '[Graphic] [File] [Unbekannt]');
});

test('H5: signature changes for every persisted change (same-length text, approval outcome, attachments, reasoning)', () => {
  const base = msg(0, { text: 'abc' });
  const sig = messagesSignature([base]);
  assert.notEqual(messagesSignature([{ ...base, text: 'xyz' }]), sig, 'same-length replacement');
  const rec = { runId: 'r1', command: 'ls', outcome: 'once' as const, requestedAt: 1, at: 2 };
  const pending = { ...base, approvalLog: [{ ...rec, outcome: 'expired' as const }] };
  assert.notEqual(messagesSignature([{ ...base, approvalLog: [rec] }]), messagesSignature([pending]), 'approval outcome');
  assert.notEqual(messagesSignature([{ ...base, approvalLog: [rec] }]), sig, 'approval record added');
  assert.notEqual(messagesSignature([{ ...base, reasoning: 'r1' }]), messagesSignature([{ ...base, reasoning: 'r2' }]), 'reasoning content');
  assert.equal(messagesSignature([{ ...base }]), sig, 'identical content → identical signature');
  // runtime-only fields are not persisted → no write
  assert.equal(messagesSignature([{ ...base, statusNote: 'thinking…' } as typeof base]), sig);
});

test('stored text is capped per message with an explicit marker, so one huge answer cannot evict the transcript', () => {
  const huge: ChatMessage = { id: 'a1', role: 'assistant', text: 'z'.repeat(STORED_TEXT_MAX * 3), tools: [], status: 'done', createdAt: 1 };
  const s = stripMessage(huge);
  assert.equal(s.text.length, STORED_TEXT_MAX + STORED_TEXT_MARKER.length);
  assert.ok(s.text.endsWith(STORED_TEXT_MARKER));
  assert.equal(s.textCapped, true);
  assert.equal(huge.text.length, STORED_TEXT_MAX * 3, 'live message untouched');
  const small: ChatMessage = { id: 'a2', role: 'assistant', text: 'ok', tools: [], status: 'done', createdAt: 1 };
  assert.equal(stripMessage(small).textCapped, undefined);
  // 5 huge answers + small ones: all fit after capping instead of only the newest
  const list: ChatMessage[] = [];
  for (let i = 0; i < 5; i++) list.push({ ...huge, id: `h${i}` }, { ...small, id: `s${i}`, role: 'user' });
  assert.equal(prepareForStorage(list).length, 10);
  assert.equal(capStoredText('a😀', 2).text, `a${STORED_TEXT_MARKER}`);
});

// ---------------------------------------------------------------- per-save work: same results as before

/** the previous previewOf text path: flatten the WHOLE text, then truncate by code points */
function previewRef(text: string, max = 90): string {
  const f = text
    .replace(/```(?:hui-html|html)[\s\S]*?(?:```|$)/g, ' [Grafik] ')
    .replace(/```hui[\s\S]*?(?:```|$)/g, ' [Komponente] ')
    .replace(/```[\s\S]*?(?:```|$)/g, ' [Code] ')
    .replace(/[`*_#>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = Array.from(f);
  return chars.length <= max ? f : chars.slice(0, max - 1).join('').trimEnd() + '…';
}

test('previewOf: head-only flattening / truncation equals flattening the whole text (fuzz, long texts)', () => {
  let seed = 3;
  const r = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32;
  const pieces = ['word ', 'x', ' ', '\n', '\n\n', '`', '``', '```', '```hui\n', '```html\n', '```hui-html\n', '```ts\n', '**', '_', '#', '> ', '😀', 'ü', '\t', 'a'.repeat(40), ' '.repeat(30), '`'.repeat(4)];
  for (let k = 0; k < 1500; k++) {
    let text = '';
    const n = Math.floor(r() * 400);
    for (let i = 0; i < n; i++) text += pieces[Math.floor(r() * pieces.length)];
    const want = previewRef(text) || '';
    assert.equal(previewOf([msg(1, { text })]), want, JSON.stringify(text));
  }
});

test('prepareForStorage / searchTextOf: cached per message object, same results as stripping everything', () => {
  const list = Array.from({ length: 30 }, (_, i) => msg(i, { text: `t${i} `.repeat(i * 50), status: i === 29 ? 'streaming' : 'done' }));
  const want = capMessages(list.map(stripMessage));
  assert.deepEqual(prepareForStorage(list), want);
  // a second save (only the last message replaced) reuses the stored objects of the unchanged ones
  const next = [...list.slice(0, -1), { ...list[29], text: list[29].text + ' mehr' }];
  const a = prepareForStorage(list);
  const b = prepareForStorage(next);
  assert.equal(b[0], a[0]);
  assert.notEqual(b[29], a[29]);
  assert.deepEqual(b, capMessages(next.map(stripMessage)));
  assert.equal(searchTextOf(b), searchTextOf(capMessages(next.map(stripMessage))));
  // the byte cap drops from the front exactly like capMessages
  const big = Array.from({ length: 8 }, (_, i) => msg(i, { text: 'x'.repeat(200_000) }));
  assert.deepEqual(prepareForStorage(big), capMessages(big.map(stripMessage)));
  assert.ok(prepareForStorage(big).length < big.length);
});

test('messagesFileJson: JSON.stringify({ v, messages }) byte for byte, each stored message serialized once', () => {
  const list = prepareForStorage([
    { id: 'a', role: 'user', text: 'Hallo "du" \\   😀', tools: [], status: 'done', createdAt: 1 },
    { id: 'b', role: 'assistant', text: 'x'.repeat(50), tools: [], status: 'streaming', createdAt: 2, error: undefined },
  ] as ChatMessage[]);
  assert.equal(messagesFileJson(1, list), JSON.stringify({ v: 1, messages: list }));
  assert.equal(messagesFileJson(1, []), JSON.stringify({ v: 1, messages: [] }));
  // the cache is per object: a message object passed again is not serialized again
  let calls = 0;
  const counted = { id: 'c', toJSON: () => (calls++, { id: 'c' }) } as unknown as ChatMessage;
  const withCounted = [...list, counted];
  assert.equal(messagesFileJson(1, withCounted), JSON.stringify({ v: 1, messages: withCounted }));
  calls = 0;
  messagesFileJson(1, withCounted);
  messagesFileJson(1, withCounted);
  assert.equal(calls, 0);
  // array element semantics for holes / undefined
  const holes = [undefined, list[0]] as unknown as ChatMessage[];
  assert.equal(messagesFileJson(1, holes), JSON.stringify({ v: 1, messages: holes }));
});
