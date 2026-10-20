import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createServer } from '../src/server.mjs';
import { silentLogger } from '../src/log.mjs';
import { filterRequestHeaders } from '../src/bridge.mjs';
import { routingContext } from '../src/router/context.mjs';
import { createRouter } from '../src/router/router.mjs';
import { liveCardDecision, liveFocusDecision, parseLiveHeader, splitLiveTrailer } from '../src/router/live.mjs';
import { buildHint } from '../src/router/hint.mjs';

const trailer = (b) => `\n\n[hui:live]${JSON.stringify(b)}[/hui:live]`;

test('live: the trailer is cut from the routing context, the routed text is what the user typed', () => {
  const turns = routingContext([{ role: 'user', content: `Danke!${trailer({ einkauf: { v: 2, ops: [{ check: 'milch' }] } })}` }]);
  assert.deepEqual(turns, [{ role: 'user', content: 'Danke!' }]);
  assert.deepEqual(splitLiveTrailer('kein Trailer [hui:live] mitten im Text'), { text: 'kein Trailer [hui:live] mitten im Text' });
});

test('live: "Hermes fragen" (focus) → checklist + card=<id>, deterministic, no backend call', async () => {
  const msg = { role: 'user', content: `Was fehlt noch?${trailer({ einkauf: { v: 3, ops: [], focus: true } })}` };
  const turns = routingContext([msg]);
  assert.equal(turns[0].liveFocus, 'einkauf');
  assert.deepEqual(liveFocusDecision(turns), { format: 'checklist', confidence: 0.95, reason: 'live card', card: 'einkauf' });
  let called = 0;
  const router = createRouter({ backend: { id: 'x', model: 'x', decide: async () => (called++, { format: 'text', confidence: 0.9 }) } });
  const d = await router.route(turns);
  assert.equal(called, 0);
  assert.equal(buildHint(d), 'UI-ROUTER-HINT: format=checklist card=einkauf confidence=0.9');
});

test('live: only the latest user turn carries the focus; bad ids and broken trailers give none', () => {
  const turns = routingContext([
    { role: 'user', content: `A${trailer({ alt: { v: 1, focus: true } })}` },
    { role: 'assistant', content: 'B' },
    { role: 'user', content: 'C' },
  ]);
  assert.equal(liveFocusDecision(turns), null);
  assert.equal(splitLiveTrailer(`x${trailer({ '../x': { focus: true } })}`).focus, undefined);
  assert.deepEqual(splitLiveTrailer('x\n\n[hui:live]{nope}[/hui:live]'), { text: 'x' });
  assert.equal(buildHint({ format: 'checklist', card: 'bad id!', confidence: 0.9 }), 'UI-ROUTER-HINT: format=checklist confidence=0.9');
});

// ---- open cards header (X-HUI-Live) + type-aware focus + edit heuristic ----------------------------------------------

const user = (content, liveFocus) => [{ role: 'user', content, ...(liveFocus ? { liveFocus } : {}) }];
const card = (id, type, o = {}) => ({ id, type, focused: false, patches: 0, ...o });
const decide = (text, cards) => liveCardDecision(user(text), cards);

test('X-HUI-Live: grammar <id>:<type>[:f][:p<N>], comma separated', () => {
  assert.deepEqual(parseLiveHeader('einkauf:checklist, reise:trip:f:p12,watch.1:products:p0'), [
    card('einkauf', 'checklist'), card('reise', 'trip', { focused: true, patches: 12 }), card('watch.1', 'products'),
  ]);
  assert.deepEqual(parseLiveHeader('a:checklist:zzz:p7:f'), [card('a', 'checklist', { focused: true, patches: 7 })]);
  assert.deepEqual(parseLiveHeader(['a:trip', 'b:products']), [card('a', 'trip'), card('b', 'products')]);
});

test('X-HUI-Live: junk never throws; bad ids / types / duplicates dropped, patches 0..999, at most 8 cards', () => {
  for (const junk of [undefined, null, 5, {}, '', ',,,', ':', 'a', 'a:', ':trip', 'a:b:c:d', '\u0000:trip', 'x'.repeat(5000)]) {
    assert.deepEqual(parseLiveHeader(junk), [], String(junk).slice(0, 20));
  }
  assert.deepEqual(parseLiveHeader('__proto__:trip,constructor:trip,prototype:trip,../x:trip,-a:trip,a b:trip,ok:Trip,ok:hasOwnProperty'), []);
  assert.deepEqual(parseLiveHeader(`${'a'.repeat(41)}:trip,${'a'.repeat(40)}:trip`).map((c) => c.id.length), [40]);
  assert.deepEqual(parseLiveHeader('a:trip,a:products,b:checklist:p1000,c:checklist:p-1,d:checklist:p999'),
    [card('a', 'trip'), card('b', 'checklist'), card('c', 'checklist'), card('d', 'checklist', { patches: 999 })]);
  assert.equal(parseLiveHeader(Array.from({ length: 30 }, (_, i) => `c${i}:trip`).join(',')).length, 8);
});

test('live focus: format follows the card type, without header entry it stays checklist', () => {
  const cards = [card('a', 'checklist'), card('b', 'trip'), card('c', 'products')];
  const fmt = (id) => liveCardDecision(user('Was fehlt noch?', id), cards)?.format;
  assert.equal(fmt('a'), 'checklist');
  assert.equal(fmt('b'), 'agenda');
  assert.equal(fmt('c'), 'products');
  assert.equal(fmt('unbekannt'), 'checklist');
  assert.equal(liveCardDecision(user('Was fehlt noch?', 'x'))?.format, 'checklist');
  assert.deepEqual(liveCardDecision(user('Was fehlt noch?', 'b'), cards), { format: 'agenda', confidence: 0.95, reason: 'live card', card: 'b' });
});

test('live focus: the f flag of the header counts as focus (no trailer needed)', () => {
  const d = decide('Wie sieht das aus?', [card('a', 'checklist'), card('b', 'products', { focused: true })]);
  assert.deepEqual(d, { format: 'products', confidence: 0.95, reason: 'live card', card: 'b' });
  assert.equal(decide('Wie sieht das aus?', [card('a', 'checklist')]), null);
});

test('live edit: edit phrases with exactly one fitting open card give a deterministic card decision', () => {
  const cl = [card('einkauf', 'checklist')];
  const positive = [
    'Füg Milch und Eier hinzu', 'Milch hinzufügen', 'Streich die Butter', 'Ergänze Brot', 'Aktualisier die Liste', 'Setz Reis auf die Liste',
    'Nimm die Eier wieder raus', 'Eier rausnehmen', 'Lösch Butter', 'Entferne den Käse', 'Pack noch Äpfel dazu', 'Noch Joghurt dazu', 'Milch dazu',
    'Ich brauche keine Butter mehr, brauch sie nicht mehr', 'Tausch Milch gegen Hafermilch', 'Änder die Menge', 'Nimm Käse von der Einkaufsliste',
    'Please update the list', 'Add milk to the list', 'Remove the eggs from it', 'Swap butter for oil', 'Move eggs to the top',
    'Añade leche', 'Agrega huevos', 'Quita la mantequilla', 'Elimina el queso', 'Mueve los huevos', 'Actualiza la lista', 'Cambia la cantidad',
  ];
  for (const t of positive) assert.deepEqual(decide(t, cl), { format: 'checklist', confidence: 0.9, reason: 'live card edit', card: 'einkauf' }, t);
  const negative = [
    'Mach mir eine Einkaufsliste für Sonntag', 'Plane mir einen Tag in Rom', 'Welche Kopfhörer soll ich kaufen?', 'Was meinst du dazu?',
    'Erkläre mir, wie ein Closure funktioniert', 'Wie hoch ist die Zugspitze?', 'Write a poem about autumn', 'Danke!',
    'Dame una receta de paella', 'Hast du Tipps für Hafermilch?',
  ];
  for (const t of negative) assert.equal(decide(t, cl), null, t);
});

test('live edit: type fit (prices -> products, move/swap -> trip+checklist, general -> any)', () => {
  const [cl, trip, prod] = [card('a', 'checklist'), card('b', 'trip'), card('c', 'products')];
  assert.deepEqual(decide('Preise prüfen', [cl, prod]), { format: 'products', confidence: 0.9, reason: 'live card edit', card: 'c' });
  assert.equal(decide('Preise prüfen', [cl, trip]), null);
  assert.equal(decide('Check prices please', [prod])?.card, 'c');
  assert.equal(decide('Comprueba los precios', [prod])?.card, 'c');
  assert.equal(decide('Preis prüfen', [trip]), null);
  assert.deepEqual(decide('Verschieb Kolosseum auf Dienstag', [prod, trip]), { format: 'agenda', confidence: 0.9, reason: 'live card edit', card: 'b' });
  assert.equal(decide('Move the Colosseum to Tuesday', [prod]), null);
  assert.equal(decide('Mueve el Coliseo al martes', [trip])?.format, 'agenda');
  assert.equal(decide('Tausch das Hotel', [prod]), null);
  assert.equal(decide('Füg ein Museum hinzu', [prod])?.format, 'products');
});

test('live edit: two or more fitting cards -> no card; no header -> nothing; new-list requests never get a card', () => {
  const two = [card('a', 'checklist'), card('b', 'checklist')];
  assert.equal(decide('Füg Milch hinzu', two), null);
  assert.equal(decide('Füg Milch hinzu', [card('a', 'checklist'), card('b', 'trip'), card('c', 'products')]), null);
  assert.equal(decide('Füg Milch hinzu', [card('a', 'checklist'), card('c', 'products')]), null);
  assert.equal(decide('Füg Milch hinzu', []), null);
  assert.equal(decide('Füg Milch hinzu', undefined), null);
  for (const t of ['Mach eine neue Liste und füg Milch hinzu', 'Füg das auf eine andere Liste hinzu', 'Erstell eine neue Einkaufsliste, ergänz Brot',
    'Add milk to a new list', 'Add this to another list', 'Añade esto a otra lista', 'Añade una nueva lista', 'Lösch das und mach eine zweite Liste']) {
    assert.equal(decide(t, [card('a', 'checklist')]), null, t);
  }
  // a focused card still wins over the phrase check
  assert.equal(decide('Füg Milch hinzu', [card('a', 'checklist', { focused: true }), card('b', 'checklist')])?.reason, 'live card');
});

test('live edit: the latest user message decides, not earlier turns', () => {
  const turns = [{ role: 'user', content: 'Füg Milch hinzu' }, { role: 'assistant', content: 'ok' }, { role: 'user', content: 'Danke, super' }];
  assert.equal(liveCardDecision(turns, [card('a', 'checklist')]), null);
});

test('live full: p>=10 on the chosen card adds `full` to the hint (focus and edit), p9 does not', async () => {
  const router = createRouter({ backend: null });
  const hint = async (text, cards) => buildHint(await router.route(user(text), { liveCards: cards }));
  assert.equal(await hint('Füg Milch hinzu', [card('a', 'checklist', { patches: 10 })]), 'UI-ROUTER-HINT: format=checklist card=a full confidence=0.9');
  assert.equal(await hint('Füg Milch hinzu', [card('a', 'checklist', { patches: 9 })]), 'UI-ROUTER-HINT: format=checklist card=a confidence=0.9');
  assert.equal(await hint('Was fehlt?', [card('b', 'trip', { focused: true, patches: 40 })]), 'UI-ROUTER-HINT: format=agenda card=b full confidence=0.9');
  assert.equal(await hint('Preise prüfen', [card('c', 'products', { patches: 12 })]), 'UI-ROUTER-HINT: format=products card=c full confidence=0.9 data=live');
});

test('live router: decided before the cache - same text routes differently with and without open cards', async () => {
  let called = 0;
  const router = createRouter({ backend: { id: 'x', model: 'x', decide: async () => (called++, { format: 'text', confidence: 0.9 }) } });
  const text = 'Füg Milch hinzu';
  const plain = await router.route(user(text));
  const withCard = await router.route(user(text), { liveCards: [card('a', 'checklist')] });
  const plainAgain = await router.route(user(text));
  assert.equal(plain.format, 'text');
  assert.equal(withCard.format, 'checklist');
  assert.equal(withCard.card, 'a');
  assert.equal(plainAgain.format, 'text');
  assert.equal(plainAgain.card, undefined);
  assert.equal(called, 1);
  const again = await router.route(user(text), { liveCards: [card('a', 'checklist')] });
  assert.equal(again.card, 'a');
  assert.equal(again.cached, undefined);
});

test('X-HUI-Live is not in the upstream allow-list', () => {
  assert.equal(filterRequestHeaders({ 'x-hui-live': 'a:trip:f', 'content-type': 'application/json' })['x-hui-live'], undefined);
});

test('bridge e2e: X-HUI-Live reaches the router (hint), never Hermes; CORS preflight echoes the header', async () => {
  const seen = [];
  const upstream = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    seen.push({ headers: req.headers, body: Buffer.concat(chunks).toString() });
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n');
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const ctx = createServer({
    HERMES_BASE_URL: `http://127.0.0.1:${upstream.address().port}`, HERMES_API_KEY: 'up-key', BRIDGE_TOKEN: 'bridge-token-live-test-0000',
    BRIDGE_ROUTER: 'heuristic', BRIDGE_BOOTSTRAP: 'off', BRIDGE_CORS_ORIGINS: 'https://app.example.com',
  }, { logger: silentLogger });
  ctx.server.listen(0, '127.0.0.1');
  await once(ctx.server, 'listening');
  const base = `http://127.0.0.1:${ctx.server.address().port}`;
  try {
    const post = (extra) => fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: 'Bearer bridge-token-live-test-0000', 'content-type': 'application/json', ...extra },
      body: JSON.stringify({ stream: true, messages: [{ role: 'user', content: 'Füg Milch hinzu' }] }),
    }).then((r) => r.text());
    await post({ 'x-hui-live': 'einkauf:checklist:p10' });
    const sys = (i) => JSON.parse(seen[i].body).messages.filter((m) => m.role === 'system').map((m) => m.content);
    assert.equal(seen[0].headers['x-hui-live'], undefined);
    assert.ok(sys(0).includes('UI-ROUTER-HINT: format=checklist card=einkauf full confidence=0.9'), JSON.stringify(sys(0)));
    await post({});
    assert.ok(!sys(1).some((c) => c.includes('card=')), JSON.stringify(sys(1)));
    const pre = await fetch(`${base}/v1/chat/completions`, {
      method: 'OPTIONS',
      headers: { origin: 'https://app.example.com', 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization, content-type, x-hui-live' },
    });
    assert.equal(pre.status, 204);
    assert.match(pre.headers.get('access-control-allow-headers'), /x-hui-live/);
  } finally {
    for (const s of [ctx.server, upstream]) { s.close(); s.closeAllConnections(); }
  }
});
