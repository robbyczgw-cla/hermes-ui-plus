// Bot mode in the offline demo (Bots v2, bots/): three invented example bots next to "Hermes · Standard", each with a
// short made-up history in its Bot Chat, plus bots the user makes with "Neuer Bot". Nothing leaves the device: a demo
// bot is a local entry that answers in its role with canned texts (scenes-bots.ts). Pure, erasable TS (demo.test.ts,
// bots.test.ts).
//  - Scout (deals): a delivered price check and a waiting approval ("Scout möchte etwas ausführen")
//  - Atlas (travel): a delivered reminder the day before a train trip
//  - Lumi (briefing): the morning briefing delivered at 7:00
import { botOf, DEFAULT_BOT, type HermesBot } from '../../hermes/bots.ts';
import type { ChatMessage, ToolEvent } from '../../hermes/types.ts';
import { previewOf } from '../../conversations/messages.ts';
import { BOT_COLORS, isTemplateId, LIMITS, templateColor, type CreatedBot, type CreateFailure, type TemplateId } from '../../bots/create/core.ts';
import { L, hui, suggestions, type DemoApproval, type DemoBotRole, type DemoLang, type DemoStep } from './kit.ts';

export type { DemoBotRole };

/** A bot made with "Neuer Bot" in the demo (kept on this device only, onboarding/demo/botStore.ts). */
export type DemoCreatedBot = { name: string; label: string; job: string; how: string; template: TemplateId; color: string; createdAt: number };

type Seeded = { name: string; label: string; template: TemplateId; job: (lang: DemoLang) => string };

/** the example bots, in roster order after Hermes (the roster then sorts by last activity) */
export const DEMO_SEEDED: readonly Seeded[] = [
  { name: 'scout', label: 'Scout', template: 'deals', job: (l) => L({ lang: l }, 'Preise und Angebote im Blick behalten', 'Keeps an eye on prices and deals', 'Vigila precios y ofertas') },
  { name: 'atlas', label: 'Atlas', template: 'travel', job: (l) => L({ lang: l }, 'Reisen planen und im Blick behalten', 'Plans trips and keeps track of them', 'Planifica viajes y los sigue') },
  { name: 'lumi', label: 'Lumi', template: 'briefing', job: (l) => L({ lang: l }, 'Jeden Morgen das Wichtigste, kurz', 'The essentials every morning, short', 'Lo esencial cada mañana, breve') },
];

export const DEMO_BOT_LIMIT = 12;

/** The demo connection's bots: Hermes first, the example bots, then the user's own (hermes/bots.ts botsForProfile). */
export function demoBotList(lang: DemoLang, created: readonly DemoCreatedBot[] = []): HermesBot[] {
  return [
    { name: DEFAULT_BOT, default: true },
    ...DEMO_SEEDED.map((b) => ({ name: b.name, default: false, label: b.label, description: b.job(lang), color: templateColor(b.template), template: b.template })),
    ...created.map((b) => ({ name: b.name, default: false, label: b.label, description: b.job, color: b.color, template: b.template })),
  ];
}

/** The role a demo bot answers in; undefined = Hermes (the ordinary demo). */
export function demoBotRole(bot: string | null | undefined, lang: DemoLang, created: readonly DemoCreatedBot[] = []): DemoBotRole | undefined {
  const b = botOf(bot);
  if (!b) return undefined;
  const s = DEMO_SEEDED.find((x) => x.name === b);
  if (s) return { template: s.template, name: s.label, job: s.job(lang) };
  const c = created.find((x) => x.name === b);
  return c ? { template: c.template, name: c.label, job: c.job } : undefined;
}

// ------------------------------------------------------------------ "Neuer Bot" in the demo

const RESERVED = new Set([DEFAULT_BOT, 'hermes', 'root', 'admin']);

/** Profile-like slug of a bot name (like Hermes Desktop: lower case, ASCII, dashes), unique among `taken`. */
export function demoSlug(title: string, taken: ReadonlySet<string>): string {
  let base = title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/, '');
  if (!base || !/^[a-z0-9]/.test(base)) base = 'bot';
  if (RESERVED.has(base)) base = `${base}-bot`;
  let slug = base;
  for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
  return slug;
}

type Body = { title?: unknown; job?: unknown; how?: unknown; template?: unknown; color?: unknown };
const oneLine = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

/**
 * What the demo does with the create form's body (bots/create/core.ts createBody): the same checks and answers as the
 * bridge (name taken → `exists`, too many → `limit`, empty / too long → `invalid`), but the bot only lands on this device.
 */
export function demoCreate(
  body: unknown,
  existing: readonly HermesBot[],
  now: number,
): { ok: true; bot: CreatedBot; entry: DemoCreatedBot } | { ok: false; failure: CreateFailure } {
  const b = (typeof body === 'object' && body ? body : {}) as Body;
  const title = oneLine(b.title);
  const job = oneLine(b.job);
  const how = typeof b.how === 'string' ? b.how.trim() : '';
  for (const [field, v] of [['title', title], ['job', job], ['how', how]] as const) {
    if (!v || v.length > LIMITS[field]) return { ok: false, failure: { kind: 'invalid', field } };
  }
  const own = existing.filter((x) => !x.default);
  const fold = (s: string) => s.toLocaleLowerCase();
  if (existing.some((x) => fold(x.label ?? (x.default ? 'Hermes' : x.name)) === fold(title))) return { ok: false, failure: { kind: 'exists' } };
  if (own.length >= DEMO_BOT_LIMIT) return { ok: false, failure: { kind: 'limit', limit: DEMO_BOT_LIMIT } };
  const name = demoSlug(title, new Set(existing.map((x) => x.name)));
  const template: TemplateId = isTemplateId(b.template) ? b.template : 'own';
  const color = typeof b.color === 'string' && BOT_COLORS.includes(b.color.toLowerCase()) ? b.color.toLowerCase() : templateColor(template);
  const entry: DemoCreatedBot = { name, label: title, job, how, template, color, createdAt: now };
  return { ok: true, bot: { name, label: title, description: job, color, template }, entry };
}

// ------------------------------------------------------------------ the example bots' histories

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Hermes' injected row for a job's delivery into a Bot Chat (bots/core.ts cronDelivery parses it) */
export function cronRow(name: string, output: string): string {
  return `[Cronjob "${name}" output — scheduled job, not the user. Review it, act on anything that needs action, and summarize for the chat.]\n\n${output}`;
}

let seq = 0;
const user = (text: string, at: number): ChatMessage => ({ id: `u-demo-${(seq++).toString(36)}`, role: 'user', text, tools: [], status: 'done', createdAt: at });
const answer = (text: string, at: number, tools: ToolEvent[] = []): ChatMessage => ({ id: `a-demo-${(seq++).toString(36)}`, role: 'assistant', text, tools, status: 'done', createdAt: at });
const toolDone = (name: string, label: string, emoji: string, at: number): ToolEvent => ({ id: `call-demo-${(seq++).toString(36)}`, name, label, emoji, status: 'done', startedAt: at, endedAt: at + 1500, textAt: 0 });

/** `hh:00` today (or yesterday when that is still ahead of `now`) */
function todayAt(now: number, hour: number, minute = 0): number {
  const d = new Date(now);
  d.setHours(hour, minute, 0, 0);
  return d.getTime() <= now - 10 * MIN ? d.getTime() : d.getTime() - DAY;
}

/** last full 5 minutes `back` ago */
const roundBack = (now: number, back: number) => Math.floor((now - back) / (5 * MIN)) * 5 * MIN;

export const SCOUT_PRICE_JOB = (l: DemoLang) => L({ lang: l }, 'Preis-Check: Fjord Calm 5', 'Price check: Fjord Calm 5', 'Control de precio: Fjord Calm 5');
export const ATLAS_REMINDER_JOB = (l: DemoLang) => L({ lang: l }, 'Erinnerung: Zug nach Wien', 'Reminder: train to Vienna', 'Recordatorio: tren a Viena');
export const LUMI_BRIEFING_JOB = (l: DemoLang) => L({ lang: l }, 'Morgenbriefing', 'Morning briefing', 'Resumen matutino');

/** when Scout's price check delivered today (its approval waits since a minute later) */
export const scoutDeliveredAt = (now: number) => roundBack(now, 70 * MIN);

function scoutHistory(lang: DemoLang, now: number): ChatMessage[] {
  const ctx = { lang };
  const asked = roundBack(now, 2 * DAY + 3 * HOUR);
  const delivered = scoutDeliveredAt(now);
  return [
    user(L(ctx, 'Behalte die Kopfhörer Fjord Calm 5 im Blick. Unter 250 € wären gut.', 'Keep an eye on the Fjord Calm 5 headphones. Below €250 would be good.', 'Vigila los auriculares Fjord Calm 5. Por debajo de 250 € estaría bien.'), asked),
    answer(
      L(
        ctx,
        'Mach ich. Gerade kosten sie **279 €** bei Example Shop. Ich sehe jeden Morgen um 7:30 bei drei Shops nach und melde mich hier im Chat, sobald sie unter 250 € liegen.\n\nRoutine angelegt: **Preis-Check: Fjord Calm 5**, täglich 7:30.',
        'Will do. Right now they cost **€279** at Example Shop. I check three shops every morning at 7:30 and report here in the chat as soon as they are below €250.\n\nRoutine created: **Price check: Fjord Calm 5**, daily at 7:30.',
        'De acuerdo. Ahora cuestan **279 €** en Example Shop. Miro tres tiendas cada mañana a las 7:30 y te aviso aquí en el chat en cuanto bajen de 250 €.\n\nRutina creada: **Control de precio: Fjord Calm 5**, cada día a las 7:30.',
      ),
      asked + MIN,
      [toolDone('web_search', L(ctx, 'Fjord Calm 5 Preis', 'Fjord Calm 5 price', 'Fjord Calm 5 precio'), '\u{1F50D}', asked + 10_000)],
    ),
    user(
      cronRow(
        SCOUT_PRICE_JOB(lang),
        L(
          ctx,
          'Fjord Calm 5: 239 € bei Example Shop B (gestern 279 €). Example Shop A 269 €, Example Shop C 275 €. Unter dem Wunschpreis von 250 €.',
          'Fjord Calm 5: €239 at Example Shop B (yesterday €279). Example Shop A €269, Example Shop C €275. Below the target price of €250.',
          'Fjord Calm 5: 239 € en Example Shop B (ayer 279 €). Example Shop A 269 €, Example Shop C 275 €. Por debajo del precio objetivo de 250 €.',
        ),
      ),
      delivered,
    ),
    answer(
      L(ctx, 'Gute Nachricht: **239 €** statt 279 €, also unter deinen 250 €.\n\n', 'Good news: **€239** instead of €279, so below your €250.\n\n', 'Buenas noticias: **239 €** en lugar de 279 €, por debajo de tus 250 €.\n\n') +
        hui({
          type: 'table',
          caption: L(ctx, 'Fjord Calm 5, heute 7:30', 'Fjord Calm 5, today 7:30', 'Fjord Calm 5, hoy 7:30'),
          source: L(ctx, 'Beispieldaten', 'Sample data', 'Datos de ejemplo'),
          basis: 'illustrative',
          columns: [L(ctx, 'Shop', 'Shop', 'Tienda'), L(ctx, 'Preis', 'Price', 'Precio'), L(ctx, 'Gestern', 'Yesterday', 'Ayer')],
          rows: [
            ['Example Shop B', '239 €', '279 €'],
            ['Example Shop A', '269 €', '269 €'],
            ['Example Shop C', '275 €', '279 €'],
          ],
        }) +
        L(
          ctx,
          '\nKaufen musst du selbst, ich bestelle nichts. Die Preisliste in deinem Notizen-Ordner bringe ich auf den neuen Stand.',
          '\nYou do the buying yourself, I never order anything. I will bring the price list in your notes folder up to date.',
          '\nLa compra la haces tú, yo no pido nada. Actualizo la lista de precios de tu carpeta de notas.',
        ),
      delivered + MIN,
    ),
  ];
}

function atlasHistory(lang: DemoLang, now: number): ChatMessage[] {
  const ctx = { lang };
  const asked = roundBack(now, 4 * DAY + 2 * HOUR);
  const delivered = roundBack(now, 3 * HOUR + 10 * MIN);
  return [
    user(L(ctx, 'Ich fahre morgen in einer Woche mit dem Zug nach Wien. Erinnere mich einen Tag vorher.', 'I am taking the train to Vienna a week from tomorrow. Remind me the day before.', 'Voy en tren a Viena dentro de una semana, mañana. Recuérdamelo el día antes.'), asked),
    answer(
      L(
        ctx,
        'Notiert. Ich melde mich hier im Chat einen Tag vor der Abfahrt, mit Gleis und Platz.\n\nRoutine angelegt: **Erinnerung: Zug nach Wien**, einmal, 24 Stunden vorher.',
        'Noted. I will get back to you here in the chat one day before departure, with platform and seat.\n\nRoutine created: **Reminder: train to Vienna**, once, 24 hours before.',
        'Anotado. Te escribo aquí en el chat un día antes de la salida, con andén y asiento.\n\nRutina creada: **Recordatorio: tren a Viena**, una vez, 24 horas antes.',
      ),
      asked + MIN,
    ),
    user(
      cronRow(
        ATLAS_REMINDER_JOB(lang),
        L(
          ctx,
          'Morgen 8:12 ab Hauptbahnhof, Gleis 7, Wagen 24, Platz 61 (Fenster). Ohne Umstieg, Ankunft 12:20.',
          'Tomorrow 8:12 from the central station, platform 7, coach 24, seat 61 (window). No change, arrival 12:20.',
          'Mañana a las 8:12 desde la estación central, andén 7, coche 24, asiento 61 (ventanilla). Sin transbordo, llegada 12:20.',
        ),
      ),
      delivered,
    ),
    answer(
      L(
        ctx,
        'Morgen geht es los. In Wien sind es 14 °C, am Nachmittag Schauer: Ein Schirm lohnt sich.\n\n',
        'Tomorrow is the day. Vienna has 14 °C, showers in the afternoon: an umbrella is worth it.\n\n',
        'Mañana es el día. En Viena hace 14 °C, con chubascos por la tarde: merece la pena llevar paraguas.\n\n',
      ) +
        suggestions(
          L(ctx, 'Packliste für das Wochenende', 'Packing list for the weekend', 'Lista de equipaje para el fin de semana'),
          L(ctx, 'Was kann ich am Samstag in Wien machen?', 'What can I do in Vienna on Saturday?', '¿Qué puedo hacer el sábado en Viena?'),
        ),
      delivered + MIN,
    ),
  ];
}

function lumiHistory(lang: DemoLang, now: number): ChatMessage[] {
  const ctx = { lang };
  const asked = roundBack(now, 6 * DAY + 5 * HOUR);
  const delivered = todayAt(now, 7);
  return [
    user(L(ctx, 'Briefing werktags um 7, höchstens fünf Punkte. Termine zuerst.', 'Briefing on weekdays at 7, five points at most. Appointments first.', 'Resumen los días laborables a las 7, cinco puntos como mucho. Las citas primero.'), asked),
    answer(
      L(
        ctx,
        'Gern. Jeden Werktag um 7:00 kommt dein Briefing hier in den Chat: erst Termine, dann Wetter, dann was heute eine Entscheidung braucht.\n\nRoutine angelegt: **Morgenbriefing**, werktags 7:00.',
        'Sure. Every weekday at 7:00 your briefing arrives here in the chat: appointments first, then weather, then what needs a decision today.\n\nRoutine created: **Morning briefing**, weekdays at 7:00.',
        'Claro. Cada día laborable a las 7:00 llega tu resumen a este chat: primero las citas, luego el tiempo y después lo que necesita una decisión hoy.\n\nRutina creada: **Resumen matutino**, días laborables a las 7:00.',
      ),
      asked + MIN,
    ),
    user(
      cronRow(
        LUMI_BRIEFING_JOB(lang),
        L(
          ctx,
          '1. 9:30 Zahnarzt, Praxis am Markt.\n2. 13:00 Mittagessen mit Alice.\n3. Wetter: 12 °C, trocken bis 16 Uhr, danach Regen.\n4. Die Stadtbibliothek will das ausgeliehene Buch bis Freitag zurück.\n5. Entscheidung: Bis 18 Uhr für den Kurs am Donnerstag zu- oder absagen.',
          '1. 9:30 dentist, practice at the market square.\n2. 13:00 lunch with Alice.\n3. Weather: 12 °C, dry until 4 pm, rain afterwards.\n4. The city library wants the borrowed book back by Friday.\n5. Decision: confirm or cancel Thursday’s class by 6 pm.',
          '1. 9:30 dentista, consulta junto al mercado.\n2. 13:00 comida con Alice.\n3. Tiempo: 12 °C, seco hasta las 16 h, después lluvia.\n4. La biblioteca municipal quiere el libro prestado antes del viernes.\n5. Decisión: confirmar o cancelar la clase del jueves antes de las 18 h.',
        ),
      ),
      delivered,
    ),
    answer(
      L(
        ctx,
        'Das Wichtigste zuerst: der Zahnarzt um 9:30. Für den Heimweg nimm einen Schirm mit, ab 16 Uhr regnet es. Zum Kurs am Donnerstag sag einfach Bescheid, dann erinnere ich dich nicht mehr daran.',
        'Most important first: the dentist at 9:30. Take an umbrella for the way home, rain starts at 4 pm. For Thursday’s class just tell me, then I stop reminding you.',
        'Lo más importante primero: el dentista a las 9:30. Para la vuelta lleva paraguas, a partir de las 16 h llueve. Sobre la clase del jueves solo dime algo y dejo de recordártelo.',
      ),
      delivered + MIN,
    ),
  ];
}

/** The made-up history of an example bot's Bot Chat (null for Hermes and the user's own bots: they start empty). */
export function demoBotHistory(bot: string | undefined, lang: DemoLang, now: number): ChatMessage[] | null {
  switch (botOf(bot)) {
    case 'scout':
      return scoutHistory(lang, now);
    case 'atlas':
      return atlasHistory(lang, now);
    case 'lumi':
      return lumiHistory(lang, now);
    default:
      return null;
  }
}

/** What the roster shows before the chat is opened: last line, count, time of the last message. */
export function historyMeta(messages: readonly ChatMessage[]): { preview: string; messageCount: number; updatedAt: number } {
  const last = messages[messages.length - 1];
  return { preview: previewOf(messages as ChatMessage[]), messageCount: messages.length, updatedAt: last?.createdAt ?? 0 };
}

// ------------------------------------------------------------------ Scout's waiting approval

/** fixed ids: the Bots tab's "Wartet auf dich" item and the chat's card are the same request */
/** how long the demo's approval stays answerable once shown (s) */
export const SCOUT_APPROVAL_WAIT_S = 12 * 3600;

export const SCOUT_APPROVAL = { requestId: 'req-demo-scout-prices', runId: 'chatcmpl-demo-scout-prices', messageId: 'a-demo-scout-pending' } as const;

/**
 * The rest of Scout's turn after its last message: it wants to replace the old price list (a file deletion → Hermes asks).
 * Answerable in the demo with "Einmal erlauben" / "Ablehnen"; nothing is deleted, the answer says so.
 */
export function scoutPendingSteps(lang: DemoLang): DemoStep[] {
  const ctx = { lang };
  const approval: DemoApproval = {
    command: 'rm ~/notes/prices-fjord-old.csv',
    description: L(ctx, 'Datei löschen', 'delete a file', 'borrar un archivo'),
    pattern_key: 'delete',
    pattern_keys: ['delete'],
    requestId: SCOUT_APPROVAL.requestId,
    runId: SCOUT_APPROVAL.runId,
    // a demo request does not run out while the user looks around (Hermes would deny it after its timeout); the card
    // waits since the chat was opened, the turn is replayed on every open until it is answered
    timeoutSeconds: SCOUT_APPROVAL_WAIT_S,
    allow: [
      { tool: { name: 'terminal', label: 'rm ~/notes/prices-fjord-old.csv', emoji: '\u{1F4BB}', ms: 700 } },
      { tool: { name: 'write_file', label: '~/notes/prices-fjord.csv', emoji: '\u{1F4C4}', ms: 600 } },
      {
        text: L(
          ctx,
          'Erledigt: Die alte Liste ist weg, die neue liegt unter `~/notes/prices-fjord.csv`. Den Preis behalte ich weiter im Blick.\n\nIn der Demo wurde nichts gelöscht. Mit Hermes läuft so ein Befehl auf deinem Server, und erst nach deiner Freigabe.',
          'Done: the old list is gone, the new one is at `~/notes/prices-fjord.csv`. I keep watching the price.\n\nNothing was deleted in the demo. With Hermes a command like this runs on your server, and only after you approve it.',
          'Hecho: la lista antigua ya no está, la nueva está en `~/notes/prices-fjord.csv`. Sigo vigilando el precio.\n\nEn la demo no se borró nada. Con Hermes, un comando así se ejecuta en tu servidor y solo después de tu aprobación.',
        ),
      },
    ],
    deny: [
      {
        text: L(
          ctx,
          'Okay, ich lasse die alte Liste, wie sie ist, und schreibe nichts. Den Preis behalte ich weiter im Blick.',
          'Okay, I leave the old list as it is and write nothing. I keep watching the price.',
          'De acuerdo, dejo la lista antigua como está y no escribo nada. Sigo vigilando el precio.',
        ),
      },
    ],
  };
  return [
    { text: L(ctx, 'Dafür ersetze ich die alte Liste:\n\n', 'For that I replace the old list:\n\n', 'Para eso sustituyo la lista antigua:\n\n') },
    { approval },
  ];
}
