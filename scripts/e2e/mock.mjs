#!/usr/bin/env node
// Deterministic Hermes + UI-bridge mock for the Android E2E smoke suite (scripts/e2e/smoke.sh, docs/E2E.md).
// Speaks what the app needs from a bridge: one-time-code pairing, `X-Hermes-UI-Bridge` on every answer, streamed turns
// with Idempotency-Key records and byte-offset resume (the bridge's own bridge/src/replay.mjs), a Hermes session store
// (recovery polling, "Send again" pre-check, drawer sync), run status, stop, bots (/bridge/profiles) and quick answers.
// A turn keeps running when the client goes away (like the bridge with a detached Hermes run).
//
//   node scripts/e2e/mock.mjs [--port 8791]          # binds 127.0.0.1 (the emulator reaches it as 10.0.2.2)
//
// Scenario = keywords in the user text (lower case): `long` (Markdown + cards + table + code, ~15 s), `checklist`,
// `table`, `slow` (numbered sentences, ~19 s), `perfreal` / `perfstress` (perf harness: ~13k chars at ~80 tok/s / as fast as
// the socket takes it), anything else a one-line answer that names the text. Same text → same
// bytes at the same rhythm (seeded). Test control, no auth (the mock listens on loopback only):
//   GET  /__e2e/state                     counters + config
//   POST /__e2e/pair-code                 → {code}: one-time code for a `hermesuiplus://pair?u=…&c=…` link
//   POST /__e2e/config {profiles, quick, routines, botsCreate}  bots on/off (`profiles: true` → default + research), quick answers on/off,
//                                        routines on/off (one job + one unread inbox result, read-only device; reset to unread), 'off' = default 0.2 bridge (no bot enabled)
//   POST /__e2e/seed {messages, title}    perf harness: a Hermes session with that many transcript rows (perf-answers.mjs)
//   POST /__e2e/fault {kind, match, …}    one-shot fault for the next chat turn whose text contains `match`:
//        refuse {status}                 answer 503 before anything runs (no Retry-After → the app shows "Answer failed")
//        hold {ms}                       no response headers for `ms`; a client that leaves meanwhile = nothing ran
//        drop {afterChunks, resumable}   cut the client's socket after N content chunks; the turn goes on (recorded);
//                                        `resumable: false` omits X-Hermes-UI-Resume (the app then polls the session)
//   GET  /__e2e/turns                    every turn: text, scenario, state, expected answer, attaches
//   GET  /__e2e/requests                 every request (method, path, status, kind, key, offset, session)
//   GET  /__e2e/uploads                  every POST /bridge/uploads (name, mimeType, size, first bytes as hex)
//   GET  /__e2e/expected?text=…          the answer a text gets
//   POST /__e2e/fire-reminder {profile?, name?, text?, comment?}  a `deliver: bot-chat` job fired into that bot's Bot Chat
//   POST /__e2e/live-turn {sid, text}     another device's turn in session `sid` (user row + the live-list answer, no
//                                        stream): the app sees it on its next transcript sync (live cards, two devices)
// Live cards (app/src/live): "Einkaufsliste für Samstag" creates a live shopping list (`"live":true`), "Wir grillen"
// sends a full new version; the mock applies the `[hui:live]` edits of each user message first, like Hermes would.
// Phase 2: "Rom … plan" creates a live trip (3 day tabs + a map tab), "regnen" sends a full version that moves two
// blocks; "Kopfhörer-Watchlist" (or "Kopfhoerer": adb cannot type umlauts) creates a live watchlist (3 products),
// "Preise" sends a price update as a patch callout.
// Creating bots (config.botsCreate: 'allowed' | 'owner_off' | false; false also forgets the bots made so far): GET /bridge/bots says whether this device may,
// POST /bridge/bots makes a bot (slug of the title, 409 for a taken name) that /bridge/profiles lists and /p/<name>/ serves.
// Bots (config.profiles): POST /api/sessions accepts only {title:"Bot Chat"} and adopts an existing one (like the bridge);
// GET /api/sessions?title=…&include_hidden=1 filters by title. "e2e approval" asks for an approval (`approval.request`,
// choices once/session/always/deny) and waits until POST /v1/runs/{id}/approval answers it (the turn records the choice).
// Reminders: "remind me" runs Hermes' cron tool the way v0.22.2 does with lazy tool discovery (tool_describe, then
// tool_call → cronjob_manage create for tomorrow 09:00, `deliver: local`): `hermes.tool.progress` events in the stream,
// the assistant tool_calls + tool result rows in the session, so the app shows its reminder card from the stored detail.
import http from 'node:http';
import { SCENARIOS } from '../demo-videos/scenarios.mjs';
import { createReplayStore, idempotencyKey, resumeOffset, RESUMABLE_HEADER } from '../../bridge/src/replay.mjs';
import { PERF_HUGE, PERF_LONG, perfHistory } from './perf-answers.mjs';

const args = process.argv.slice(2);
const PORT = Number(args.includes('--port') ? args[args.indexOf('--port') + 1] : 8791) || 8791;

// ── scripted answers ────────────────────────────────────────────────────────────────────────────────────────────────
const hui = (node) => '```hui\n' + JSON.stringify(node, null, 2) + '\n```\n';
const texts = (name) => SCENARIOS[name].steps({ userText: '', turn: 1, sessionId: 'e2e', now: new Date(0) }).filter((s) => 'text' in s).map((s) => s.text).join('');
const LONG = [
  '## E-bike or car for the city?\n\nShort version: for trips under 10 km the **e-bike wins** on cost and often on time.\n\n',
  '### What matters most\n\n- **Distance:** most city trips are short\n- **Parking:** an e-bike parks at the door\n- **Cargo:** a trailer or box handles shopping\n\n',
  texts('ebike'),
  '\n\n| Trip | E-bike | Car | Bus |\n|---|---:|---:|---:|\n| 3 km to work | 11 min | 14 min | 19 min |\n| 7 km to the gym | 24 min | 21 min | 33 min |\n| 12 km to friends | 41 min | 27 min | 48 min |\n\n',
  texts('ebikeTable'),
  '\n\nA quick cost check:\n\n```python\ndef yearly_cost(km_per_day, price_per_km, days=220):\n    return round(km_per_day * price_per_km * days, 2)\n\nprint(yearly_cost(14, 0.04))  # e-bike\n```\n\n',
  texts('blocksWifi'),
  '\n\n**Bottom line:** try the e-bike for two weeks before deciding. [end of long answer]',
].join('');
const CHECKLIST = 'Here is your pack list, tick what is done:\n\n' + hui({
  type: 'checklist', id: 'e2e-pack', title: 'E2E pack list', basis: 'illustrative',
  items: [{ id: 'a', text: 'Walking shoes' }, { id: 'b', text: 'Rain jacket' }, { id: 'c', text: 'Phone charger' }, { id: 'd', text: 'Water bottle' }],
});
const TABLE = [
  'Milestones of the microscope:\n\n',
  '| Year | Milestone | Who |\n|---|---|---|\n',
  '| c. 1011–1021 | Book of Optics on lenses and vision | Ibn al-Haytham |\n',
  '| 1590 | First compound microscope | Janssen |\n',
  '| 1665 | Micrographia with cell drawings | Hooke |\n',
  '| 1931 | Electron microscope | Ruska |\n\n',
  'All four changed how we see small things. [end of table answer]',
].join('');
const SLOW = Array.from({ length: 24 }, (_, i) => `Sentence ${String(i + 1).padStart(2, '0')} of the slow answer keeps the stream going.`).join(' ') + ' [end of slow answer]';
const SHORT = (t) => `Short answer to "${t.replace(/["\n]/g, ' ').slice(0, 60)}": apple, mango and strawberry.`;
const QUICK = 'Quick answer from the E2E mock: 42.';

// ── live cards: one live shopping list per session ──────────────────────────────────────────────────────────────
const LIVE_TRAILER = /\n*\[hui:live\](\{[\s\S]*\})\[\/hui:live\]\s*$/;
/** user text without the live-card trailer + its batches (null: none or broken) */
export function splitLiveTrailer(text) {
  const m = LIVE_TRAILER.exec(text);
  if (!m) return { text, batches: null };
  try {
    return { text: text.slice(0, m.index), batches: JSON.parse(m[1]) };
  } catch {
    return { text: text.slice(0, m.index), batches: null };
  }
}
const LIVE_V1 = {
  type: 'checklist', id: 'einkauf', live: true, title: 'Einkauf Samstag', kind: 'shopping', groupBy: 'category',
  items: [
    { id: 'tomaten', text: 'Tomaten', qty: 6, category: 'Obst & Gemüse' },
    { id: 'gurke', text: 'Gurke', qty: 1, category: 'Obst & Gemüse' },
    { id: 'milch', text: 'Milch', qty: 1, unit: 'l', category: 'Kühlregal' },
    { id: 'eier', text: 'Eier', qty: 10, category: 'Kühlregal' },
    { id: 'mozzarella', text: 'Mozzarella', qty: 2, category: 'Kühlregal' },
    { id: 'brot', text: 'Brot', qty: 1, category: 'Backwaren' },
    { id: 'spaghetti', text: 'Spaghetti', qty: 500, unit: 'g', category: 'Trockenware' },
    { id: 'senf', text: 'Senf', qty: 1, unit: 'Glas', note: 'mittelscharf', category: 'Trockenware' },
  ],
};
function applyLiveOps(card, ops) {
  for (const op of ops ?? []) {
    const at = (id) => card.items.findIndex((i) => i.id === id);
    if (op.add && at(op.add.id) < 0) card.items.push({ ...op.add });
    else if (op.del && at(op.del) >= 0) card.items.splice(at(op.del), 1);
    else if (op.check && at(op.check) >= 0) card.items[at(op.check)].checked = true;
    else if (op.uncheck && at(op.uncheck) >= 0) delete card.items[at(op.uncheck)].checked;
    else if (op.set && at(op.set) >= 0) {
      const it = card.items[at(op.set)];
      for (const [k, v] of Object.entries(op)) if (k !== 'set') v === null ? delete it[k] : (it[k] = v);
    }
  }
}
// phase 2 (fake content): a trip kept flat ({days, blocks, map}) and sent as `tabs` of `agenda` days + a `map` tab,
// a watchlist sent as `products`; trailer ops use the node words (`title` / `name`, live/codec.ts)
const TRIP_V1 = {
  id: 'rom', title: 'Rom, 13.–15. November',
  days: [{ id: 'fr13', label: 'Fr 13.', date: '2026-11-13' }, { id: 'sa14', label: 'Sa 14.', date: '2026-11-14' }, { id: 'so15', label: 'So 15.', date: '2026-11-15' }],
  blocks: [
    { id: 'anreise', day: 'fr13', start: '16:00', end: '17:00', title: 'Ankunft und Hotel', kind: 'travel', location: 'Termini' },
    { id: 'aperitivo', day: 'fr13', start: '19:00', end: '20:30', title: 'Aperitivo am Campo de’ Fiori', kind: 'meal' },
    { id: 'kolosseum', day: 'sa14', start: '09:00', end: '10:30', title: 'Kolosseum', kind: 'event', note: 'Tickets 09:15, gebucht' },
    { id: 'forum', day: 'sa14', start: '11:00', end: '12:30', title: 'Forum Romanum', kind: 'event' },
    { id: 'prati', day: 'sa14', start: '13:30', end: '14:30', title: 'Mittag in Prati', kind: 'meal', note: 'nah an den Museen' },
    { id: 'vatikan', day: 'sa14', start: '15:00', end: '17:00', title: 'Vatikanische Museen', kind: 'event' },
    { id: 'trastevere', day: 'sa14', start: '19:30', end: '21:30', title: 'Abendessen Trastevere', kind: 'meal' },
    { id: 'pantheon', day: 'so15', start: '10:00', end: '11:00', title: 'Pantheon', kind: 'event' },
    { id: 'rueckreise', day: 'so15', start: '15:00', end: '16:00', title: 'Rückreise', kind: 'travel' },
  ],
  map: {
    title: 'Karte', route: true,
    markers: [
      { lat: 41.8902, lng: 12.4922, title: 'Kolosseum', number: 1 },
      { lat: 41.8925, lng: 12.4853, title: 'Forum Romanum', number: 2 },
      { lat: 41.9065, lng: 12.4536, title: 'Vatikanische Museen', number: 3 },
      { lat: 41.8986, lng: 12.4769, title: 'Pantheon', number: 4 },
    ],
  },
};
const WATCH_V1 = {
  type: 'products', id: 'kopfhoerer', live: true, title: 'Kopfhörer-Watchlist', source: 'Websuche, abgerufen 16.10.2026 09:28',
  products: [
    { id: 'xm5', name: 'WH-1000XM5', brand: 'Sony', price: 269, currency: 'EUR', offers: [{ merchant: 'Shop A', price: 269, url: 'https://example.com/a/xm5' }, { merchant: 'Shop B', price: 279, url: 'https://example.com/b/xm5' }, { merchant: 'Shop C', price: 289, url: 'https://example.com/c/xm5' }] },
    { id: 'qc', name: 'QC Ultra', brand: 'Bose', price: 349, currency: 'EUR', offers: [{ merchant: 'Shop A', price: 349, url: 'https://example.com/a/qc' }, { merchant: 'Shop B', price: 359, url: 'https://example.com/b/qc' }] },
    { id: 'm4', name: 'Momentum 4', brand: 'Sennheiser', price: 259, currency: 'EUR', offers: [{ merchant: 'Shop A', price: 259, url: 'https://example.com/a/m4' }] },
  ],
};
/** the trip as a live `tabs` node: one tab per day with its agenda, the map tab last */
export function tripNode(trip) {
  const tabs = trip.days.map((d) => ({
    id: d.id, label: d.label,
    children: [{ type: 'agenda', id: `${d.id}-plan`, date: d.date, blocks: trip.blocks.filter((b) => b.day === d.id).map(({ day: _day, ...b }) => b) }],
  }));
  if (trip.map) tabs.push({ id: 'karte', label: 'Karte', children: [{ type: 'map', ...trip.map }] });
  return { type: 'tabs', id: trip.id, live: true, title: trip.title, tabs };
}
const asBlock = (it) => {
  const { text, title, ...rest } = it;
  return { ...rest, title: title ?? text };
};
function applyTripOps(trip, ops) {
  for (const op of ops ?? []) {
    const at = (id) => trip.blocks.findIndex((b) => b.id === id);
    if (op.add && at(op.add.id) < 0) trip.blocks.push({ ...asBlock(op.add), day: op.to ?? op.add.day ?? trip.days[0].id });
    else if (op.del && at(op.del) >= 0) trip.blocks.splice(at(op.del), 1);
    else if (op.check && at(op.check) >= 0) trip.blocks[at(op.check)].checked = true;
    else if (op.uncheck && at(op.uncheck) >= 0) delete trip.blocks[at(op.uncheck)].checked;
    else if (op.move && at(op.move) >= 0 && op.to) trip.blocks[at(op.move)].day = op.to;
    else if (op.set && at(op.set) >= 0) {
      const b = trip.blocks[at(op.set)];
      for (const [k, v] of Object.entries(op)) if (k !== 'set') v === null ? delete b[k] : (b[k === 'text' ? 'title' : k] = v);
    }
  }
}
function applyWatchOps(watch, ops) {
  for (const op of ops ?? []) {
    const at = (id) => watch.products.findIndex((p) => p.id === id);
    if (op.add && at(op.add.id) < 0) {
      const { text, ...rest } = op.add;
      watch.products.push({ ...rest, name: rest.name ?? text });
    } else if (op.del && at(op.del) >= 0) watch.products.splice(at(op.del), 1);
    else if (op.check && at(op.check) >= 0) watch.products[at(op.check)].checked = true;
    else if (op.uncheck && at(op.uncheck) >= 0) delete watch.products[at(op.uncheck)].checked;
    else if (op.set && at(op.set) >= 0) {
      const p = watch.products[at(op.set)];
      for (const [k, v] of Object.entries(op)) if (k !== 'set') v === null ? delete p[k] : (p[k === 'text' ? 'name' : k] = v);
    }
  }
}
/** the trip / watchlist answer of a user text (phase 2), or null */
function livePhase2(s, t) {
  const block = (node) => '```hui\n' + JSON.stringify(node) + '\n```\n';
  if (/\brom\b/.test(t) && /plan/.test(t)) {
    s.trip = structuredClone(TRIP_V1);
    return { name: 'live-trip-create', text: `Hier ist dein Plan für Rom, drei Tage mit Karte.\n\n${block(tripNode(s.trip))}`, ms: [3, 6] };
  }
  if (s.trip && /regn/.test(t)) {
    // rain from noon on Saturday: the museums move to the morning, the forum to the afternoon
    applyTripOps(s.trip, [
      { set: 'vatikan', start: '11:00', end: '13:00', note: 'Regen ab Mittag, drinnen besser' },
      { set: 'forum', start: '15:30', end: '17:00', note: 'falls es aufklart, sonst Pantheon' },
    ]);
    return { name: 'live-trip-update', text: `Für Samstag ist ab Mittag Regen gemeldet. Ich habe die Vatikanischen Museen auf den Vormittag gezogen und das Forum auf den Nachmittag.\n\n${block(tripNode(s.trip))}`, ms: [3, 6] };
  }
  if (/kopfh(?:ö|oe)rer/.test(t) && /watchlist/.test(t)) {
    s.watch = structuredClone(WATCH_V1);
    return { name: 'live-watch-create', text: `Ich beobachte drei Modelle für dich.\n\n${block(s.watch)}`, ms: [3, 6] };
  }
  if (s.watch && /preise/.test(t)) {
    applyWatchOps(s.watch, [{ set: 'xm5', price: 239 }]);
    const patch = { type: 'callout', tone: 'info', title: 'Kopfhörer-Watchlist aktualisiert', text: 'WH-1000XM5: 239 €', livePatch: { card: 'kopfhoerer', ops: [{ set: 'xm5', price: 239 }] } };
    return { name: 'live-watch-patch', text: `Die Sony liegt jetzt bei 239 € und damit unter deinem Wunschpreis.\n\n${block(patch)}`, ms: [3, 6] };
  }
  return null;
}

/** the live-list answer of a user text in session `s` (its [hui:live] edits applied first), or null */
function liveScenario(s, userText) {
  const { text, batches } = splitLiveTrailer(userText);
  const t = text.toLowerCase();
  if (s.live && batches?.[s.live.id]) {
    const b = batches[s.live.id];
    if (b.state) s.live.items = b.state.items.map((i) => ({ ...i }));
    applyLiveOps(s.live, b.ops);
  }
  if (s.trip && batches?.[s.trip.id]) applyTripOps(s.trip, batches[s.trip.id].ops);
  if (s.watch && batches?.[s.watch.id]) applyWatchOps(s.watch, batches[s.watch.id].ops);
  const p2 = livePhase2(s, t);
  if (p2) return p2;
  const block = () => '```hui\n' + JSON.stringify(s.live) + '\n```\n';
  if (/einkaufsliste/.test(t) && /samstag/.test(t)) {
    s.live = structuredClone(LIVE_V1);
    return { name: 'live-create', text: `Ich habe dir eine Einkaufsliste für Samstag angelegt und oben angeheftet.\n\n${block()}`, ms: [3, 6] };
  }
  if (s.live && /wir grillen/.test(t)) {
    applyLiveOps(s.live, [
      { add: { id: 'grillkohle', text: 'Grillkohle', qty: 1, unit: 'Sack', category: 'Grill' } },
      { add: { id: 'maiskolben', text: 'Maiskolben', qty: 4, category: 'Grill' } },
      { add: { id: 'halloumi', text: 'Halloumi', qty: 2, unit: 'Pck.', category: 'Kühlregal' } },
      { del: 'tomaten' },
      { set: 'senf', note: 'süß' },
    ]);
    const kept = s.live.items.filter((i) => i.checked).length;
    return { name: 'live-update', text: `Grillsachen sind drauf, die Tomaten sind weg.${kept ? ' Deine Häkchen bleiben.' : ''}\n\n${block()}`, ms: [3, 6] };
  }
  if (s.live && /mozzarella/.test(t)) {
    // another device asked for more mozzarella and less cucumber: changes fields this device may be editing too
    applyLiveOps(s.live, [{ set: 'mozzarella', qty: 4 }, { del: 'gurke' }]);
    return { name: 'live-update', text: `Vier Mozzarella, die Gurke ist gestrichen.\n\n${block()}`, ms: [3, 6] };
  }
  if (batches) return { name: 'live-ack', text: 'Alles klar.', ms: [10, 20] };
  return null;
}

/** "remind me …": one cron create through the lazy-discovery wrapper (rows as Hermes v0.22.2 stores them, 2026-10-20) */
export const REMINDER_JOB = 'e2e0000000aa';
function reminderScenario() {
  const at = new Date();
  at.setDate(at.getDate() + 1);
  at.setHours(9, 0, 0, 0);
  const off = -at.getTimezoneOffset();
  const pad = (n) => String(Math.abs(n)).padStart(2, '0');
  const local = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T09:00:00`;
  const iso = `${local}${off >= 0 ? '+' : '-'}${pad(Math.trunc(off / 60))}:${pad(off % 60)}`;
  // the skill asks for `deliver: "bot-chat"`: the fired reminder lands in the bot's thread (POST /__e2e/fire-reminder)
  const args = { action: 'create', schedule: local, prompt: 'Reminder: buy tea. Write the user one short line.', name: 'Buy tea', repeat: 1, deliver: 'bot-chat' };
  const result = {
    success: true, job_id: REMINDER_JOB, name: 'Buy tea', skill: null, skills: [], schedule: `once at ${local.replace('T', ' ').slice(0, 16)}`,
    repeat: 'once', deliver: 'bot-chat', next_run_at: iso,
    message: "Cron job 'Buy tea' created.",
  };
  return {
    name: 'reminder', ms: [20, 30],
    text: "Done: I'll remind you tomorrow at 9:00 to buy tea.",
    tools: [
      { id: 'toolu_e2e_describe', name: 'tool_describe', label: 'Reading tool details · 1 tool', emoji: '⚡', args: { names: ['cronjob_manage'] }, result: { tools: { cronjob_manage: { description: 'Manage scheduled cron jobs (mock)' } } } },
      { id: 'toolu_e2e_cron', name: 'cronjob_manage', label: 'create', emoji: '⏰', wrapped: true, args, result },
    ],
  };
}

/** scenario of a user text: {name, text, ms: [min, max] per chunk, tools?} */
export function scenarioFor(userText) {
  // a live-card trailer is not what the user typed: it never picks the scenario
  const t = splitLiveTrailer(userText).text.toLowerCase();
  // perf harness (scripts/perf/droid.sh): the same ~13k-char answer at a realistic (~80 tok/s) or a stress rate
  if (/\bperfreal\b/.test(t)) return { name: 'perf-real', text: PERF_LONG, ms: [8, 16] };
  if (/\bperfstress\b/.test(t)) return { name: 'perf-stress', text: PERF_LONG, ms: [0, 2] };
  if (/\bperfhuge\b/.test(t)) return { name: 'perf-huge', text: PERF_HUGE, ms: [0, 2] };
  if (/\blong\b/.test(t)) return { name: 'long', text: LONG, ms: [12, 20] };
  if (/\bchecklist\b/.test(t)) return { name: 'checklist', text: CHECKLIST, ms: [4, 8] };
  if (/\btable\b/.test(t)) return { name: 'table', text: TABLE, ms: [8, 14] };
  if (/\bslow\b/.test(t)) return { name: 'slow', text: SLOW, ms: [45, 60] };
  // the --live stage's prompts, so the stage can be dry-run against this mock (docs/E2E.md)
  if (/exactly the word pong/.test(t)) return { name: 'live-pong', text: 'pong', ms: [20, 30] };
  if (/2 plus 3/.test(t)) return { name: 'live-sum', text: '5', ms: [20, 30] };
  if (/\bremind me\b/.test(t)) return reminderScenario();
  if (/\be2e approval\b/.test(t)) return { name: 'approval', text: 'Approval answered, the E2E folder check is done.', ms: [20, 30] };
  return { name: 'short', text: SHORT(userText.trim()), ms: [20, 30] };
}

/** mulberry32: small seeded PRNG */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const seedOf = (s) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);

/** provider-like pieces: a word with its leading whitespace, long words cut into 2–7 chars */
export function chunks(text, rand) {
  const out = [];
  for (const piece of text.match(/\s*\S+|\s+/g) || []) {
    for (let i = 0; i < piece.length; ) {
      const n = 2 + Math.floor(rand() * 6);
      out.push(piece.slice(i, i + n));
      i += n;
    }
  }
  return out;
}

// ── creating bots (bridge/src/bots-manage.mjs in small) ─────────────────────────────────────────────────────────
async function botsRoute(req, res, path) {
  const create = config.botsCreate === 'allowed' ? { allowed: true } : { allowed: false, reason: config.botsCreate === 'owner_off' ? 'owner_off' : 'plugin_not_configured' };
  if (path !== '/bridge/bots') return apiError(res, 404, 'Unknown bot', 'unknown_bot');
  if (req.method === 'GET') return json(res, 200, { create, admin: true, limit: 50, count: createdBots.length });
  if (req.method !== 'POST') return apiError(res, 405, 'Method not allowed', 'method_not_allowed');
  const b = JSON.parse((await readBody(req)) || '{}');
  if (!create.allowed) return json(res, 404, { error: { message: 'Bots cannot be created on this server', code: 'bots_unavailable', reason: create.reason } });
  for (const f of ['title', 'job', 'how']) if (typeof b[f] !== 'string' || !b[f].trim()) return json(res, 400, { error: { message: `Invalid ${f}`, code: 'invalid_field', field: f } });
  const title = b.title.trim();
  if (createdBots.some((x) => x.label.toLowerCase() === title.toLowerCase())) return json(res, 409, { error: { message: 'A bot with this name exists', code: 'exists' } });
  const name = title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'bot';
  const bot = { name, label: title, description: b.job.trim(), color: b.color, template: b.template };
  createdBots.push(bot);
  return json(res, 201, { bot });
}

// ── state ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const config = { profiles: false, quick: false, routines: false, botsCreate: false };
/** bots made through POST /bridge/bots (bots/create in the app) */
const createdBots = [];

// ── routines (bridge slice 2): one job of the default bot, read-only device, one unread inbox result ──────────────
const ROUTINE_JOB = 'e2e000000001';
const ROUTINE_ITEM = 'ri_' + 'e2e0'.repeat(5);
const ROUTINE_TEXT = 'Three things for today [e2e routine result]:\n\n1. **Library** opens on Sundays from November.\n2. **Rail** works on the north line at night.\n3. **Weather** stays dry until Thursday.\n\n' + hui({
  type: 'summary', text: 'E2E briefing in short.', points: ['Library: Sundays from November', 'Rail: night work', 'Weather: dry'],
});
const routineState = { read: false };
function routineJob() {
  const at = new Date(Date.now() - 3600_000).toISOString();
  return {
    id: ROUTINE_JOB, name: 'E2E morning briefing', prompt: 'Summarize three local items.', skills: [],
    schedule: { kind: 'cron', expr: '0 7 * * 1-5', display: 'weekdays at 7am' }, schedule_display: 'weekdays at 7am',
    enabled: true, state: 'scheduled', next_run_at: new Date(Date.now() + 20 * 3600_000).toISOString(), last_run_at: at, last_status: 'ok',
    deliver_kind: 'local', origin_platform: 'api_server',
  };
}
function routineItem(full) {
  const at = new Date(Date.now() - 3600_000).toISOString();
  const it = {
    id: ROUTINE_ITEM, hermesProfile: 'default', jobId: ROUTINE_JOB, title: 'E2E morning briefing', runAt: at, finishedAt: at,
    status: 'ok', summary: 'Three things for today: Library opens on Sundays from November.', sessionId: `cron_${ROUTINE_JOB}_20261016_070000`,
    hasRich: true, truncated: false, read: routineState.read,
  };
  return full ? { ...it, text: ROUTINE_TEXT } : it;
}
/** /api/jobs* and /bridge/routines/* while `config.routines` (a read-only device: pause / resume / run refused);
 * `routines: 'off'` = a 0.2 bridge in its default state (no bot enabled): 404 routines_off, capabilities say unavailable */
async function routines(req, res, path, url) {
  if (config.routines === 'off') {
    if (path === '/bridge/routines/capabilities')
      return json(res, 200, {
        version: 1, hermesProfile: url.searchParams.get('hermesProfile') || 'default', available: false, rights: 'none', mode: 'control',
        inbox: { available: false, durable: true, retentionDays: 30, maxItems: 300 }, push: { available: false },
        features: { crud: false, preservePausedRun: false, runLedger: false, timezone: false }, reasons: ['bot_not_enabled'],
      });
    if (req.method !== 'GET') await readBody(req);
    return apiError(res, 404, 'Routines are disabled for this bot', 'routines_off');
  }
  if (path === '/api/jobs') return json(res, 200, { jobs: [routineJob()], hui: { routines: 'read', rights: 'read' } });
  if (path === `/api/jobs/${ROUTINE_JOB}`) return json(res, 200, { job: routineJob(), hui: { routines: 'read', rights: 'read' } });
  if (path.startsWith('/api/jobs/')) {
    await readBody(req);
    return apiError(res, 403, 'This device may only view routines', 'routines_read_only');
  }
  if (path === '/bridge/routines/capabilities')
    return json(res, 200, {
      version: 1, hermesProfile: url.searchParams.get('hermesProfile') || 'default', available: true, rights: 'read', mode: 'control',
      inbox: { available: true, durable: true, retentionDays: 30, maxItems: 300 }, push: { available: false },
      features: { crud: false, preservePausedRun: false, runLedger: false, timezone: false }, reasons: ['read_only_device'],
    });
  const unread = () => (routineState.read ? 0 : 1);
  if (req.method === 'GET' && path === '/bridge/routines/inbox') {
    const items = url.searchParams.get('filter') === 'unread' && routineState.read ? [] : [routineItem(false)];
    return json(res, 200, { items, unreadCount: unread(), nextCursor: null });
  }
  if (path === `/bridge/routines/inbox/${ROUTINE_ITEM}`) {
    if (req.method === 'PATCH') {
      const b = JSON.parse((await readBody(req)) || '{}');
      if (typeof b.read === 'boolean') routineState.read = b.read;
      return json(res, 200, { item: routineItem(false), unreadCount: unread() });
    }
    return json(res, 200, { item: routineItem(true) });
  }
  if (req.method === 'POST' && path === '/bridge/routines/inbox/read-all') {
    await readBody(req);
    const updated = unread();
    routineState.read = true;
    return json(res, 200, { updated, unreadCount: 0 });
  }
  return apiError(res, 404, `Not found: ${path}`, 'not_found');
}
let fault = null; // one-shot
const codes = new Set();
const tokens = new Set(['nca_e2e_test_token_static_0000000000']);
const replay = createReplayStore({ retainMs: 30 * 60_000 });
/** @type {Map<string, {id: string, profile: string|null, title: string, rows: any[], started: number, last: number}>} */
const sessions = new Map();
const turns = []; // public turn records
const requests = [];
const uploads = []; // POST /bridge/uploads ("Share to HUI+" images / files)
let rowId = 0;
const nowS = () => Date.now() / 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const frame = (data, event) => `${event ? `event: ${event}\n` : ''}data: ${JSON.stringify(data)}\n\n`;
const BRIDGE = { 'X-Hermes-UI-Bridge': '1' };

function json(res, status, body, headers = {}) {
  if (res.headersSent || res.destroyed) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...BRIDGE, ...headers });
  res.end(JSON.stringify(body));
}
const apiError = (res, status, message, code, type = 'invalid_request_error') => json(res, status, { error: { message, type, param: null, code } });
const readBody = (req) =>
  new Promise((resolve, reject) => {
    const c = [];
    req.on('data', (d) => c.push(d));
    req.on('end', () => resolve(Buffer.concat(c).toString('utf8')));
    req.on('error', reject);
  });
const contentText = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => (p?.type === 'text' ? p.text : '')).join('') : '');

function session(id, profile) {
  let s = sessions.get(id);
  if (!s) sessions.set(id, (s = { id, profile, title: '', rows: [], started: nowS(), last: nowS() }));
  return s;
}
function addRow(s, role, content, extra = {}) {
  s.rows.push({ id: ++rowId, role, content, timestamp: nowS(), ...extra });
  s.last = nowS();
  if (!s.title && role === 'user') s.title = content.slice(0, 40);
}

// ── a chat turn ─────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Runs the scripted answer into `rec` (replay record, may be null) and the original response while it is attached.
 * Never stops because the client left; only stop() (bridge/chat/stop) ends it early.
 */
function runTurn(t, res, rec, opts) {
  const parts = chunks(t.expected, rng(seedOf(t.text)));
  const rand = rng(seedOf(t.text) ^ 0x9e3779b9);
  const head = {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Hermes-Session-Id': t.sid, ...BRIDGE, ...(rec && opts.resumable ? { [RESUMABLE_HEADER]: '1' } : {}) },
  };
  let attached = !res.destroyed;
  res.on('close', () => (attached = false));
  if (attached) {
    res.writeHead(head.status, head.headers);
    res.flushHeaders?.();
  }
  rec?.start(head);
  if (rec && !opts.resumable) rec.unresumable(); // keeps the key (no second turn) without offering byte resume
  t.state = 'live';
  t.startedAt = Date.now();
  let sent = 0;
  const emit = (s) => {
    const b = Buffer.from(s);
    rec?.append(b);
    if (attached) res.write(b);
  };
  const created = Math.floor(Date.now() / 1000);
  const chunk = (delta, finish = null, x = {}) => ({ id: t.completionId, object: 'chat.completion.chunk', created, model: 'hermes-agent', choices: [{ index: 0, delta, finish_reason: finish }], ...x });
  t.stop = () => (t.state = 'stopped');
  (async () => {
    await sleep(300);
    emit(frame({ format: 'text', confidence: 0.6, reason: 'E2E', model: 'router', ms: 5 }, 'hermes.ui.route'));
    emit(frame(chunk({ role: 'assistant' })));
    if (t.scenario === 'approval') {
      // Hermes waits for the answer (POST /v1/runs/{completionId}/approval), at most 120 s like a short approvals.timeout
      t.approval = { requestId: `req-e2e-${t.n}`, pending: true, choice: null };
      emit(frame({ run_id: t.completionId, request_id: t.approval.requestId, command: 'rm -rf /tmp/e2e-approval-check', description: 'delete in root path', choices: ['once', 'session', 'always', 'deny'], timestamp: Date.now() / 1000, session_id: t.sid }, 'approval.request'));
      const until = Date.now() + 120_000;
      while (t.approval.pending && t.state === 'live' && Date.now() < until) await sleep(150);
      t.approval.pending = false;
    }
    for (const tool of t.tools ?? []) {
      // live: progress with the inner tool's name; stored: the wrapper call (tool_call {calls:[…]}) + the inner result row
      emit(frame({ tool: tool.name, emoji: tool.emoji, label: tool.label, toolCallId: tool.id, status: 'running' }, 'hermes.tool.progress'));
      await sleep(200);
      emit(frame({ tool: tool.name, toolCallId: tool.id, status: 'completed' }, 'hermes.tool.progress'));
      const s = session(t.sid, t.profile);
      const fn = tool.wrapped ? { name: 'tool_call', arguments: JSON.stringify({ calls: [{ name: tool.name, arguments: tool.args }] }) } : { name: tool.name, arguments: JSON.stringify(tool.args) };
      addRow(s, 'assistant', '', { tool_calls: [{ id: tool.id, type: 'function', function: fn }], finish_reason: 'tool_calls' });
      addRow(s, 'tool', JSON.stringify(tool.result, null, 2), { tool_call_id: tool.id, tool_name: tool.name });
    }
    for (const p of parts) {
      if (t.state !== 'live') break;
      await sleep(t.ms[0] + rand() * (t.ms[1] - t.ms[0]));
      if (t.state !== 'live') break;
      emit(frame(chunk({ content: p })));
      if (!t.streamed) t.firstChunkAt = Date.now();
      t.streamed += p;
      sent++;
      if (opts.dropAfter && sent === opts.dropAfter && attached) {
        t.drops++;
        attached = false;
        res.destroy(); // the client loses its connection; the turn goes on
      }
    }
    const s = session(t.sid, t.profile);
    if (t.state === 'stopped') {
      addRow(s, 'assistant', t.streamed, { finish_reason: 'stop' });
      rec?.end(true);
      if (attached) res.destroy();
    } else {
      emit(frame(chunk({}, 'stop', { usage: { prompt_tokens: 900, completion_tokens: Math.ceil(t.expected.length / 4), total_tokens: 900 + Math.ceil(t.expected.length / 4) } })));
      emit('data: [DONE]\n\n');
      t.state = 'ended';
      addRow(s, 'assistant', t.expected, { finish_reason: 'stop' });
      rec?.end(false);
      if (attached) res.end();
    }
    t.endedAt = Date.now();
    t.stop = null;
    console.log(`${new Date().toISOString().slice(11, 23)} turn ${t.n} ${t.scenario} ${t.state} ${sent}/${parts.length} chunks ${((t.endedAt - t.startedAt) / 1000).toFixed(1)} s`);
  })();
}

async function chat(req, res, path, profile, token, log) {
  const raw = await readBody(req);
  const key = idempotencyKey(req.headers);
  const offset = resumeOffset(req.headers);
  const sid = String(req.headers['x-hermes-session-id'] || '').trim();
  log.key = key;
  log.sid = sid;
  if (offset !== undefined) log.offset = offset;
  const scope = key ? `${token}\0${profile ?? ''}\0${key}` : '';
  if (key) {
    const known = replay.get(scope);
    const rerun = known && offset === undefined && replay.rerunnable(known);
    if ((known && !rerun) || offset !== undefined) {
      log.kind = offset !== undefined ? 'resume' : 'reattach';
      const t = turns.find((x) => x.scope === scope);
      if (t) t.attaches.push({ at: Date.now(), offset: offset ?? 0 });
      if (offset === null) return apiError(res, 400, 'Invalid X-Hermes-UI-Resume-Offset', 'invalid_resume_offset');
      if (!known) return apiError(res, 409, 'Nothing to resume for this Idempotency-Key', 'resume_unavailable');
      if (sid !== known.sessionId) return apiError(res, 409, 'Idempotency-Key was used for another session', 'idempotency_key_conflict');
      const refused = known.attach(res, offset ?? 0);
      if (refused) {
        log.status = refused.status;
        log.code = refused.code;
        return apiError(res, refused.status, refused.message, refused.code, refused.status === 429 ? 'rate_limit_error' : 'invalid_request_error');
      }
      return;
    }
  }
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return apiError(res, 400, 'Invalid JSON', 'invalid_json');
  }
  const convo = (body.messages || []).filter((m) => m.role === 'user' || m.role === 'assistant');
  const userText = contentText(convo[convo.length - 1]?.content).trim();
  log.text = userText.slice(0, 120);
  let f = null;
  if (fault && userText.includes(fault.match ?? '')) [f, fault] = [fault, null];
  if (f) log.fault = f.kind;
  if (f?.kind === 'refuse') {
    log.kind = 'refused';
    return apiError(res, f.status ?? 503, 'The UI bridge refused the send (E2E fault)', 'e2e_refused', 'server_error');
  }
  if (!body.stream) return apiError(res, 400, 'The E2E mock only streams', 'stream_required');
  // live list state lives on the session; a turn that never runs (held + dropped) must not create one
  const prev = sessions.get(sid);
  const liveHolder = { live: prev?.live ? structuredClone(prev.live) : null, trip: prev?.trip ? structuredClone(prev.trip) : null, watch: prev?.watch ? structuredClone(prev.watch) : null };
  const sc = liveScenario(liveHolder, userText) ?? scenarioFor(userText);
  const t = {
    n: turns.length + 1, text: userText, scenario: sc.name, ms: sc.ms, expected: sc.text, tools: sc.tools, streamed: '', sid: sid || `api-e2e-${turns.length + 1}`,
    profile, key, scope, state: 'pending', completionId: `chatcmpl-e2e-${turns.length + 1}`, attaches: [], drops: 0, receivedAt: Date.now(),
  };
  log.kind = 'turn';
  if (f?.kind === 'hold') {
    // "delayed confirmation": nothing is acknowledged for f.ms; a client that leaves meanwhile never reached Hermes
    t.state = 'held';
    turns.push(t);
    log.kind = 'held';
    let gone = false;
    res.on('close', () => (gone = true));
    const until = Date.now() + (f.ms ?? 60_000);
    while (!gone && Date.now() < until) await sleep(100);
    if (gone) {
      t.state = 'dropped';
      return;
    }
    t.state = 'pending';
  } else turns.push(t);
  const rec = key ? replay.begin(scope, sid) : null;
  const s = session(t.sid, profile);
  if (liveHolder.live) s.live = liveHolder.live;
  if (liveHolder.trip) s.trip = liveHolder.trip;
  if (liveHolder.watch) s.watch = liveHolder.watch;
  addRow(s, 'user', userText);
  runTurn(t, res, rec, { resumable: f?.kind === 'drop' ? f.resumable !== false : true, dropAfter: f?.kind === 'drop' ? f.afterChunks ?? 30 : 0 });
}

function quick(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', ...BRIDGE });
  const id = `chatcmpl-quick-${Date.now()}`;
  res.write(frame({ id, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] }));
  for (const p of chunks(QUICK, rng(1))) res.write(frame({ id, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: p }, finish_reason: null }] }));
  res.write(frame({ id, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }));
  res.end('data: [DONE]\n\n');
}

function sessionList(profile, url) {
  const title = url.searchParams.get('title');
  const hidden = url.searchParams.get('include_hidden') === '1';
  const all = [...sessions.values()]
    .filter((s) => (s.profile ?? null) === (profile ?? null) && (!title || (s.title ?? '').startsWith(title)) && (hidden || !s.hidden))
    .sort((a, b) => b.last - a.last);
  const limit = Number(url.searchParams.get('limit') || 50);
  const off = Number(url.searchParams.get('offset') || 0);
  const data = all.slice(off, off + limit).map((s) => ({
    id: s.id, source: 'api_server', title: s.title || null, preview: s.rows.at(-1)?.content.slice(0, 80) ?? '', model: 'hermes-agent',
    started_at: s.started, last_active: s.last, message_count: s.rows.length,
  }));
  return { object: 'list', data, has_more: off + limit < all.length, limit, offset: off };
}

// ── control + routing ───────────────────────────────────────────────────────────────────────────────────────────────
async function control(req, res, path, url) {
  if (path === '/__e2e/state') return json(res, 200, { config, fault, turns: turns.length, requests: requests.length, sessions: sessions.size, replay: replay.stats() });
  if (path === '/__e2e/turns') return json(res, 200, turns.map(({ stop: _s, scope: _c, ...t }) => t));
  if (path === '/__e2e/requests') return json(res, 200, requests);
  if (path === '/__e2e/uploads') return json(res, 200, uploads);
  if (path === '/__e2e/expected') return json(res, 200, scenarioFor(url.searchParams.get('text') || ''));
  if (path === '/__e2e/sessions') return json(res, 200, [...sessions.values()].map((x) => ({ id: x.id, profile: x.profile ?? null, title: x.title, rows: x.rows.length, live: x.live ?? null })));
  if (req.method !== 'POST') return json(res, 404, { error: 'unknown control route' });
  const body = JSON.parse((await readBody(req)) || '{}');
  if (path === '/__e2e/pair-code') {
    const code = `e2e-pair-test-${Date.now().toString(36)}-${codes.size}`;
    codes.add(code);
    return json(res, 200, { code });
  }
  if (path === '/__e2e/config') {
    Object.assign(config, body);
    if ('routines' in body) routineState.read = false; // every routines check starts with one unread result
    if ('botsCreate' in body && !body.botsCreate) createdBots.length = 0; // creating off = no bots made in an earlier check
    return json(res, 200, config);
  }
  if (path === '/__e2e/seed') {
    // perf harness: a Hermes session with `messages` transcript rows (perf-answers.mjs); `hui-` id = one of the app's
    // own sessions, so its default drawer filter lists it (conversations/remoteSync.ts)
    const n = Math.max(2, Math.min(20_000, Number(body.messages) || 2400));
    const s = session(`hui-perf-history-${n}`, null);
    s.rows = perfHistory(n).map((r) => ({ id: ++rowId, ...r }));
    s.title = body.title || `Perf history ${n}`;
    s.started = s.rows[0].timestamp;
    s.last = nowS();
    return json(res, 200, { id: s.id, title: s.title, rows: s.rows.length });
  }
  if (path === '/__e2e/fire-reminder') {
    // a `deliver: bot-chat` job fired: Hermes writes into the bot's "Bot Chat" (creating it, source cli, when there is
    // none yet): the injected output row + the bot's comment. {profile?, name?, text?}
    const b = body;
    const profile = b.profile ?? null;
    let s = [...sessions.values()].find((x) => (x.profile ?? null) === profile && x.title === 'Bot Chat');
    if (!s) {
      s = session(`20261020_090000_e2e${sessions.size + 1}`, profile);
      s.title = 'Bot Chat';
    }
    const name = b.name ?? 'Buy tea';
    addRow(s, 'user', `[Cronjob "${name}" output — scheduled job, not the user. Review it, act on anything that needs action, and summarize for the chat.]\n\n${b.text ?? 'Time to buy tea.'}`);
    addRow(s, 'assistant', b.comment ?? 'The reminder ran, nothing else to do.');
    return json(res, 200, { sessionId: s.id, rows: s.rows.length });
  }
  if (path === '/__e2e/live-turn') {
    const s = sessions.get(String(body.sid || ''));
    if (!s) return json(res, 404, { error: 'unknown session' });
    const text = String(body.text || '');
    const sc = liveScenario(s, text) ?? scenarioFor(text);
    addRow(s, 'user', text);
    addRow(s, 'assistant', sc.text, { finish_reason: 'stop' });
    return json(res, 200, { scenario: sc.name, rows: s.rows.length });
  }
  if (path === '/__e2e/fault') {
    fault = body.kind ? body : null;
    return json(res, 200, { fault });
  }
  return json(res, 404, { error: 'unknown control route' });
}

/** web builds (scripts/ux-check/live-shots.mjs) call the mock from another origin */
const CORS = {
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, Idempotency-Key, X-Hermes-Session-Id, X-Hermes-Session-Key, X-Hermes-UI-Resume-Offset, X-Filename',
  'Access-Control-Expose-Headers': 'X-Hermes-Session-Id, X-Hermes-UI-Bridge, X-Hermes-UI-Resume, X-Hermes-UI-Server-Time, Retry-After',
  'Access-Control-Max-Age': '600',
};

async function handle(req, res) {
  if (req.headers.origin) {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
    res.setHeader('Vary', 'Origin');
    for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }
  }
  const url = new URL(req.url, 'http://x');
  let path = url.pathname.replace(/\/+$/, '') || '/';
  if (path.startsWith('/__e2e/')) return control(req, res, path, url);
  const log = { t: Date.now(), method: req.method, path, status: 200 };
  requests.push(log);
  res.on('finish', () => (log.status = res.statusCode));
  res.on('close', () => !res.writableFinished && (log.closed = 'early'));
  let profile = null;
  const pm = /^\/p\/([a-z0-9][a-z0-9_-]{0,63})(\/.*)$/.exec(path);
  if (pm) [profile, path] = [pm[1], pm[2]];
  if (req.method === 'GET' && !profile && (path === '/health' || path === '/v1/health')) return json(res, 200, { status: 'ok', platform: 'hermes-agent', version: 'e2e-mock' });
  if (req.method === 'POST' && path === '/bridge/pair/redeem') {
    const { code } = JSON.parse((await readBody(req)) || '{}');
    if (!codes.delete(code)) return apiError(res, 410, 'Pairing link expired or already used', 'pair_code_invalid');
    const token = `nca_e2e_test_token_${String(tokens.size).padStart(24, '0')}`;
    tokens.add(token);
    return json(res, 200, { token, deviceId: `e2e-device-${tokens.size}`, name: 'E2E' });
  }
  const auth = String(req.headers.authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!tokens.has(token)) return apiError(res, 401, 'Invalid bridge token', 'invalid_api_key');
  if (profile && !(config.profiles && profile === 'research') && !createdBots.some((b) => b.name === profile)) return apiError(res, 404, 'Not found', 'unknown_profile');
  if (path === '/health' || path === '/v1/health') return json(res, 200, { status: 'ok', platform: 'hermes-agent', version: 'e2e-mock' });
  if (path === '/v1/models') return json(res, 200, { object: 'list', data: [{ id: 'hermes-agent', object: 'model', owned_by: 'hermes' }] });
  if (path === '/v1/capabilities')
    return json(res, 200, {
      object: 'hermes.api_server.capabilities', platform: 'hermes-agent', model: 'hermes-agent',
      features: { streaming: true, tool_progress: true, session_continuity_header: 'X-Hermes-Session-Id' },
      endpoints: { chat_completions: { method: 'POST', path: '/v1/chat/completions' } },
    });
  if (path === '/v1/skills') return json(res, 200, { object: 'list', data: [] });
  if (req.method === 'POST' && path === '/v1/chat/completions') return chat(req, res, path, profile, token, log);
  const answer = /^\/v1\/runs\/([^/]+)\/approval$/.exec(path);
  if (answer && req.method === 'POST') {
    const t = turns.find((x) => x.completionId === answer[1]);
    if (!t?.approval?.pending) return apiError(res, 409, 'No approval pending', 'approval_not_pending');
    const b = JSON.parse((await readBody(req)) || '{}');
    t.approval.choice = b.choice ?? null;
    t.approval.pending = false;
    return json(res, 200, { object: 'hermes.run.approval_response', run_id: t.completionId, choice: b.choice, request_id: b.request_id ?? t.approval.requestId, resolved: 1 });
  }
  const run = /^\/v1\/runs\/([^/]+)$/.exec(path);
  if (run) {
    const t = turns.find((x) => x.completionId === run[1]);
    if (!t) return apiError(res, 404, 'Run not found', 'run_not_found');
    if (t.approval?.pending) {
      return json(res, 200, { id: t.completionId, status: 'waiting_for_approval', approval: { run_id: t.completionId, request_id: t.approval.requestId, command: 'rm -rf /tmp/e2e-approval-check', description: 'delete in root path', choices: ['once', 'session', 'always', 'deny'] } });
    }
    return json(res, 200, { id: t.completionId, status: t.state === 'live' ? 'running' : t.state === 'ended' ? 'completed' : 'cancelled' });
  }
  if (path === '/api/model/options') return json(res, 200, { providers: [] });
  if (req.method === 'GET' && path === '/api/sessions') return json(res, 200, sessionList(profile, url));
  if (req.method === 'POST' && path === '/api/sessions') {
    // the bridge's Bot Chat route: only that title, adopt before create
    const b = JSON.parse((await readBody(req)) || '{}');
    if (b.title !== 'Bot Chat' || Object.keys(b).length !== 1) return apiError(res, 403, 'Only the bot\'s "Bot Chat" session', 'bot_chat_only');
    const have = [...sessions.values()].find((x) => (x.profile ?? null) === (profile ?? null) && x.title === 'Bot Chat');
    const row = (x) => ({ id: x.id, source: 'api_server', title: x.title, started_at: x.started, last_active: x.last, message_count: x.rows.length, hidden: !!x.hidden });
    if (have) return json(res, 200, { object: 'hermes.session', session: row(have), adopted: true });
    const s = session(`api_e2e_botchat_${sessions.size + 1}`, profile);
    s.title = 'Bot Chat';
    return json(res, 201, { object: 'hermes.session', session: row(s), adopted: false });
  }
  const sm = /^\/api\/sessions\/([^/]+)(\/messages|\/model|\/fork)?$/.exec(path);
  if (sm) {
    const s = sessions.get(sm[1]);
    if (!s) return apiError(res, 404, 'Session not found', 'session_not_found');
    if (sm[2] === '/messages') {
      const limit = Number(url.searchParams.get('limit') || 120);
      return json(res, 200, { object: 'list', session_id: s.id, data: s.rows.slice(-limit) });
    }
    if (sm[2] === '/model') return json(res, 200, { ok: true, model: 'hermes-agent' });
    if (sm[2] === '/fork') return apiError(res, 501, 'Not supported by the E2E mock', 'not_supported');
    if (req.method === 'DELETE') {
      sessions.delete(s.id);
      return json(res, 200, { object: 'hermes.session.deleted', id: s.id, deleted: true });
    }
    if (req.method === 'PATCH') {
      const b = JSON.parse((await readBody(req)) || '{}');
      if (typeof b.title === 'string') s.title = b.title;
      return json(res, 200, { session: { id: s.id, title: s.title } });
    }
    return json(res, 200, { id: s.id, title: s.title, source: 'api_server', message_count: s.rows.length });
  }
  if (req.method === 'POST' && path === '/bridge/uploads') {
    // the bridge contract (app/src/attachments/uploadCore.ts): raw bytes, Content-Type, X-Filename → 201 RemoteRef
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const bytes = Buffer.concat(chunks);
    let name = 'file';
    try {
      name = decodeURIComponent(String(req.headers['x-filename'] || 'file'));
    } catch {
      // keep the default
    }
    const mimeType = String(req.headers['content-type'] || 'application/octet-stream').split(';')[0].trim();
    const id = `e2e-up-${uploads.length + 1}`;
    uploads.push({ id, name, mimeType, size: bytes.length, head: bytes.subarray(0, 8).toString('hex') });
    return json(res, 201, { id, path: `/tmp/e2e-uploads/${id}-${name.replace(/[^\w.-]/g, '_')}`, name, size: bytes.length, mimeType });
  }
  if (!profile && (path === '/bridge/bots' || path.startsWith('/bridge/bots/'))) return botsRoute(req, res, path);
  if (path === '/bridge/profiles')
    return json(res, 200, { object: 'list', mode: 'list', data: [{ name: 'default', default: true, model: 'hermes-agent' }, ...(config.profiles ? [{ name: 'research', default: false, label: 'Research', model: 'hermes-agent' }] : []), ...createdBots.map((b) => ({ ...b, default: false, model: 'hermes-agent' }))] });
  if (path === '/bridge/quick/config')
    return json(res, 200, config.quick ? { available: true, source: 'hermes-plugin', model: 'quick-mock', provider: 'mock', limits: { perDeviceMinute: 20, perDeviceDay: 500 }, streaming: true } : { available: false });
  if (req.method === 'POST' && (path === '/bridge/quick/v1/chat/completions' || path === '/bridge/quick')) {
    await readBody(req);
    if (!config.quick) return apiError(res, 404, 'Quick answers are off', 'feature_off');
    return quick(req, res);
  }
  if (req.method === 'POST' && path === '/bridge/chat/stop') {
    const b = JSON.parse((await readBody(req)) || '{}');
    log.sid = b.sessionId;
    const live = turns.filter((t) => t.sid === b.sessionId && t.state === 'live' && t.stop);
    for (const t of live) t.stop();
    return json(res, 200, { stopped: live.length });
  }
  if (config.routines && !profile && (path === '/api/jobs' || path.startsWith('/api/jobs/') || path.startsWith('/bridge/routines/'))) return routines(req, res, path, url);
  if (path === '/bridge/meta') return apiError(res, 404, 'Off in the E2E mock', 'feature_off');
  if (path === '/bridge/push/config') return json(res, 200, {});
  if (path === '/bridge/voice/config') return json(res, 200, { stt: { available: false }, tts: { available: false } });
  if (path === '/bridge/images/config') return json(res, 200, { available: false });
  if (path === '/bridge/status') return json(res, 200, { ok: true, router: null, hint: 'off', resume: { enabled: true, ...replay.stats() } });
  return apiError(res, 404, `Not found: ${path}`, 'not_found');
}

/** the mock as an http.Server (not listening); every server has its own state only if the module is re-imported */
export function createServer() {
  return http.createServer((req, res) =>
    handle(req, res).catch((e) => {
      console.error(e);
      if (!res.headersSent) apiError(res, 500, String(e), 'mock_error', 'server_error');
      else res.destroy();
    })
  );
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  createServer().listen(PORT, '127.0.0.1', () => console.log(`e2e mock on http://127.0.0.1:${PORT} (emulator: http://10.0.2.2:${PORT}/v1)`));
}
