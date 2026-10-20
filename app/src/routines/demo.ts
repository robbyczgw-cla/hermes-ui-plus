/**
 * Offline demo connection: a few invented Routines and their result inbox, so the screen can be tried (and
 * screenshotted) without a server. Never sent anywhere; pause/resume/run and the read state only change memory.
 * Text follows the UI language like the other demo content (L() triples, onboarding/demo/kit.ts). Pure, erasable TS.
 */
import type { Lang } from '../i18n/core.ts';
import type { JobAction, JobList, RoutineJob } from './jobs.ts';
import type { LastResult } from './lastResult.ts';
import { HermesError } from '../hermes/stream.ts';
import { sortInbox, type InboxApi, type InboxFilter, type InboxItem, type InboxPage, type InboxSummary } from './inbox.ts';
import type { RoutinesCapabilities } from './rights.ts';

export type DemoLang = Lang;

const HOUR = 3600_000;
const L = (lang: DemoLang | undefined, de: string, en: string, es: string): string => (lang === 'en' ? en : lang === 'es' ? es : de);
const hui = (node: unknown) => '```hui\n' + JSON.stringify(node, null, 2) + '\n```';

/** ISO instant with a fixed +02:00 offset (the demo bot's clock), like Hermes writes `next_run_at`. */
function at(ms: number): string {
  const d = new Date(ms + 2 * HOUR);
  return `${d.toISOString().slice(0, 19)}+02:00`;
}

/** Next `hour`:00 (+02:00) after `now` on one of `days` (0 = Sunday). */
function nextAt(now: number, hour: number, days: number[]): number {
  for (let i = 0; i < 8; i++) {
    const day = new Date(now + 2 * HOUR + i * 24 * HOUR);
    day.setUTCHours(hour, 0, 0, 0);
    const ms = day.getTime() - 2 * HOUR;
    if (ms > now && days.includes(day.getUTCDay())) return ms;
  }
  return now + 24 * HOUR;
}

const ID = { briefing: 'd0000000000a', price: 'd0000000000b', status: 'd0000000000c', reminder: 'd0000000000d', disk: 'd0000000000e' } as const;

const NAMES = {
  briefing: (l?: DemoLang) => L(l, 'Morgenbriefing', 'Morning briefing', 'Resumen matutino'),
  price: (l?: DemoLang) => L(l, 'Preisprüfung: Espressomühle', 'Price check: espresso grinder', 'Control de precio: molinillo de espresso'),
  status: (l?: DemoLang) => L(l, 'Statusseite beobachten', 'Status page watch', 'Vigilar la página de estado'),
  reminder: (l?: DemoLang) => L(l, 'Erinnerung: Parkausweis verlängern', 'Reminder: renew the parking permit', 'Recordatorio: renovar el permiso de aparcamiento'),
  disk: (l?: DemoLang) => L(l, 'Speicherplatz auf dem Heimserver', 'Disk space on the home server', 'Espacio en disco del servidor de casa'),
};

const STATUS_ERROR = (l?: DemoLang) =>
  L(l, 'status.example.com hat nicht innerhalb von 30 Sekunden geantwortet.', 'status.example.com did not respond within 30 seconds.', 'status.example.com no respondió en 30 segundos.');

export function demoJobs(now = Date.now(), lang?: DemoLang): RoutineJob[] {
  return [
    {
      id: ID.briefing,
      name: NAMES.briefing(lang),
      prompt: L(
        lang,
        'Fasse die fünf wichtigsten Meldungen aus meinen gespeicherten öffentlichen Quellen zusammen, je ein Satz mit Link.',
        'Summarize the five most relevant items from my saved public sources, each with one sentence and a link.',
        'Resume las cinco noticias más relevantes de mis fuentes públicas guardadas, cada una con una frase y un enlace.',
      ),
      skills: ['hermes-ui'],
      schedule: { kind: 'cron', expr: '0 7 * * 1-5', display: 'weekdays at 7am' },
      enabled: true,
      state: 'scheduled',
      createdAt: at(now - 20 * 24 * HOUR),
      nextRunAt: at(nextAt(now, 7, [1, 2, 3, 4, 5])),
      lastRunAt: at(now - 9 * HOUR),
      lastStatus: 'ok',
      failureStreak: 0,
      noAgent: false,
      deliverKind: 'local',
      originPlatform: 'cli',
    },
    {
      id: ID.price,
      name: NAMES.price(lang),
      prompt: L(
        lang,
        'Prüfe den aktuellen Preis der Mühle auf den beiden Shopseiten bei example.com und sag mir, ob er unter 180 EUR liegt.',
        'Check the current price of the grinder on the two shop pages at example.com and tell me if it is below 180 EUR.',
        'Comprueba el precio actual del molinillo en las dos tiendas de example.com y dime si está por debajo de 180 EUR.',
      ),
      skills: ['hermes-ui'],
      schedule: { kind: 'cron', expr: '0 9 * * 1', display: 'every monday 9am' },
      enabled: true,
      state: 'scheduled',
      createdAt: at(now - 40 * 24 * HOUR),
      nextRunAt: at(nextAt(now, 9, [1])),
      lastRunAt: at(now - 4 * 24 * HOUR),
      lastStatus: 'ok',
      failureStreak: 0,
      noAgent: false,
      deliverKind: 'telegram',
      originPlatform: 'telegram',
    },
    {
      id: ID.status,
      name: NAMES.status(lang),
      prompt: L(
        lang,
        'Sieh dir https://status.example.com an und melde dich nur, wenn sich der Wartungstermin geändert hat.',
        'Look at https://status.example.com and report only if the maintenance date changed.',
        'Mira https://status.example.com y avísame solo si cambió la fecha de mantenimiento.',
      ),
      skills: [],
      schedule: { kind: 'interval', minutes: 720, display: 'every 720m' },
      enabled: true,
      state: 'scheduled',
      createdAt: at(now - 10 * 24 * HOUR),
      nextRunAt: at(now + 9 * HOUR),
      lastRunAt: at(now - 3 * HOUR),
      lastStatus: 'error',
      lastError: STATUS_ERROR(lang),
      failureStreak: 1,
      noAgent: false,
      deliverKind: 'local',
      originPlatform: 'api_server',
    },
    {
      id: ID.reminder,
      name: NAMES.reminder(lang),
      prompt: L(
        lang,
        'Erinnere mich daran, den Parkausweis zu verlängern, und prüfe, ob sich das Formular auf example.com geändert hat.',
        'Remind me to renew the parking permit and check whether the form on example.com changed.',
        'Recuérdame renovar el permiso de aparcamiento y comprueba si cambió el formulario en example.com.',
      ),
      skills: [],
      schedule: { kind: 'once', runAt: at(now - 6 * 24 * HOUR), display: 'once in 2d' },
      enabled: false,
      state: 'completed',
      createdAt: at(now - 8 * 24 * HOUR),
      lastRunAt: at(now - 6 * 24 * HOUR),
      lastStatus: 'ok',
      failureStreak: 0,
      repeat: { times: 1, completed: 1 },
      noAgent: false,
      deliverKind: 'origin',
      originPlatform: 'telegram',
    },
    {
      id: ID.disk,
      name: NAMES.disk(lang),
      prompt: L(
        lang,
        'Prüfe den freien Speicherplatz auf dem Heimserver und melde dich nur, wenn weniger als 15 Prozent frei sind.',
        'Check the free disk space on the home server and report only if less than 15 percent is free.',
        'Comprueba el espacio libre del servidor de casa y avísame solo si queda menos del 15 por ciento.',
      ),
      skills: [],
      schedule: { kind: 'interval', minutes: 360, display: 'every 360m' },
      enabled: false,
      state: 'paused',
      pausedAt: at(now - 2 * 24 * HOUR),
      createdAt: at(now - 12 * 24 * HOUR),
      nextRunAt: at(now - 2 * HOUR),
      lastRunAt: at(now - 2 * 24 * HOUR - HOUR),
      lastStatus: 'ok',
      failureStreak: 0,
      noAgent: false,
      deliverKind: 'local',
      originPlatform: 'api_server',
    },
  ];
}

function briefingText(lang?: DemoLang): string {
  return (
    L(
      lang,
      'Fünf Meldungen für heute:\n\n1. **Stadtbibliothek** verlängert ab November die Öffnungszeiten am Wochenende.\n2. **Bahn**: Nachtarbeiten auf der Nordstrecke, Dienstag bis Donnerstag.\n3. **Wetter**: trocken bis Donnerstag, ab Freitagnachmittag Regen.\n4. **Open-Source-Release**: Die neue Version des Editors, dem du folgst, behebt den Sync-Fehler.\n5. **Wochenmarkt** zieht für zwei Wochen auf den Rathausplatz.',
      'Five items for today:\n\n1. **City library** extends weekend opening hours from November.\n2. **Rail operator** announces night work on the north line, Tuesday to Thursday.\n3. **Weather**: dry until Thursday, rain from Friday afternoon.\n4. **Open-source release**: a new minor version of the editor you follow fixes the sync bug.\n5. **Local market** moves to the town hall square for two weeks.',
      'Cinco noticias para hoy:\n\n1. **La biblioteca municipal** amplía el horario de fin de semana a partir de noviembre.\n2. **El operador ferroviario** anuncia obras nocturnas en la línea norte, de martes a jueves.\n3. **Tiempo**: seco hasta el jueves, lluvia a partir del viernes por la tarde.\n4. **Versión de código abierto**: la nueva versión del editor que sigues corrige el error de sincronización.\n5. **El mercado semanal** se traslada dos semanas a la plaza del ayuntamiento.',
    ) +
    '\n\n' +
    hui({
      type: 'sources',
      items: [
        { title: L(lang, 'Stadtbibliothek: Öffnungszeiten', 'City library: opening hours', 'Biblioteca municipal: horario'), url: 'https://example.com/library', siteName: 'example.com' },
        { title: L(lang, 'Bahn: Bauarbeiten Nordstrecke', 'Rail: north line works', 'Tren: obras en la línea norte'), url: 'https://example.com/rail', siteName: 'example.com' },
        { title: L(lang, 'Versionshinweise des Editors', 'Editor release notes', 'Notas de la versión del editor'), url: 'https://example.com/release', siteName: 'example.com' },
      ],
    })
  );
}

function priceText(lang?: DemoLang): string {
  return (
    L(
      lang,
      'Bei **Shop B** kostet die Mühle heute **176 EUR** und liegt damit unter deiner Grenze von 180 EUR. Shop A verlangt weiter 189 EUR.\n\n',
      'At **Shop B** the grinder costs **176 EUR** today, below your limit of 180 EUR. Shop A still asks 189 EUR.\n\n',
      'En **Shop B** el molinillo cuesta hoy **176 EUR**, por debajo de tu límite de 180 EUR. Shop A sigue pidiendo 189 EUR.\n\n',
    ) +
    hui({
      type: 'products',
      id: 'demo-grinder',
      title: L(lang, 'Espressomühle, Stand heute', 'Espresso grinder, as of today', 'Molinillo de espresso, a día de hoy'),
      basis: 'illustrative',
      products: [
        {
          id: 'grinder-one',
          name: 'Example Grinder One',
          brand: 'Example',
          price: 176,
          currency: 'EUR',
          badge: L(lang, 'Unter 180 EUR', 'Below 180 EUR', 'Por debajo de 180 EUR'),
          verdict: L(lang, 'Günstigstes geprüftes Angebot', 'Lowest offer checked', 'La oferta más baja comprobada'),
          offers: [
            { merchant: 'Shop B', price: 176, url: 'https://example.com/shop-b/grinder' },
            { merchant: 'Shop A', price: 189, url: 'https://example.com/shop-a/grinder' },
          ],
        },
      ],
    })
  );
}

const REMINDER_TEXT = (lang?: DemoLang) =>
  L(
    lang,
    'Erinnerung: Heute den **Parkausweis verlängern**. Das Formular auf example.com ist unverändert, du kannst die gespeicherte Vorlage verwenden.',
    'Reminder: **renew the parking permit** today. The form on example.com is unchanged, so the saved template still works.',
    'Recordatorio: hoy toca **renovar el permiso de aparcamiento**. El formulario de example.com no ha cambiado, puedes usar la plantilla guardada.',
  );

const NO_CHANGE = (lang?: DemoLang) => L(lang, 'Keine Änderung. Der Wartungstermin ist weiterhin der 24. Oktober.', 'No change. The maintenance date is still 24 October.', 'Sin cambios. La fecha de mantenimiento sigue siendo el 24 de octubre.');

/** Invented inbox (newest first): two unread (briefing, failed watch), the rest read. Ids like the bridge's (`ri_` + hex). */
export function demoInbox(now = Date.now(), lang?: DemoLang): InboxItem[] {
  const item = (o: Omit<InboxItem, 'runAt' | 'finishedAt' | 'createdAt' | 'truncated' | 'deliveryFailed' | 'hermesProfile'> & { ago: number; runFor?: number }): InboxItem => {
    const { ago, runFor, ...rest } = o;
    const end = now - ago;
    return { hermesProfile: 'default', runAt: at(end - (runFor ?? 40_000)), finishedAt: at(end), createdAt: end + 30_000, truncated: false, deliveryFailed: false, ...rest };
  };
  const briefing = briefingText(lang);
  return [
    item({ id: 'ri_d00000000000000000a1', jobId: ID.status, title: NAMES.status(lang), ago: 3 * HOUR, status: 'failed', summary: '', text: '', error: STATUS_ERROR(lang), sessionId: null, hasRich: false, read: false }),
    item({
      id: 'ri_d00000000000000000a2',
      jobId: ID.briefing,
      title: NAMES.briefing(lang),
      ago: 9 * HOUR,
      runFor: 95_000,
      status: 'ok',
      summary: L(lang, 'Fünf Meldungen für heute: Stadtbibliothek verlängert ab November die Öffnungszeiten am Wochenende.', 'Five items for today: City library extends weekend opening hours from November.', 'Cinco noticias para hoy: la biblioteca municipal amplía el horario de fin de semana a partir de noviembre.'),
      text: briefing,
      sessionId: 'cron_d0000000000a_demo2',
      hasRich: true,
      read: false,
    }),
    item({ id: 'ri_d00000000000000000a3', jobId: ID.status, title: NAMES.status(lang), ago: 15 * HOUR, status: 'silent', summary: NO_CHANGE(lang), text: NO_CHANGE(lang), sessionId: 'cron_d0000000000c_demo1', hasRich: false, read: true }),
    item({
      id: 'ri_d00000000000000000a4',
      jobId: ID.price,
      title: NAMES.price(lang),
      ago: 4 * 24 * HOUR,
      runFor: 120_000,
      status: 'ok',
      summary: L(lang, 'Bei Shop B kostet die Mühle heute 176 EUR und liegt damit unter deiner Grenze von 180 EUR.', 'At Shop B the grinder costs 176 EUR today, below your limit of 180 EUR.', 'En Shop B el molinillo cuesta hoy 176 EUR, por debajo de tu límite de 180 EUR.'),
      text: priceText(lang),
      sessionId: 'cron_d0000000000b_demo1',
      hasRich: true,
      read: true,
    }),
    item({
      id: 'ri_d00000000000000000a5',
      jobId: ID.reminder,
      title: NAMES.reminder(lang),
      ago: 6 * 24 * HOUR,
      status: 'ok',
      summary: L(lang, 'Erinnerung: Heute den Parkausweis verlängern. Das Formular auf example.com ist unverändert.', 'Reminder: renew the parking permit today. The form on example.com is unchanged.', 'Recordatorio: hoy toca renovar el permiso de aparcamiento. El formulario de example.com no ha cambiado.'),
      text: REMINDER_TEXT(lang),
      sessionId: 'cron_d0000000000d_demo1',
      hasRich: false,
      read: true,
    }),
  ];
}

const summaryOf = (i: InboxItem): InboxSummary => {
  const { text: _t, error: _e, ...s } = i;
  return s;
};

/**
 * The demo's example bots (onboarding/demo/bots.ts) have routines of their own, delivering into their Bot Chat; bots
 * made in the demo have none yet. undefined = Hermes (the list above).
 */
export function demoBotJobs(bot: string, now = Date.now(), lang?: DemoLang): RoutineJob[] {
  const base = { skills: ['hermes-ui'], failureStreak: 0, noAgent: false, deliverKind: 'bot-chat', originPlatform: 'api_server' };
  if (bot === 'scout') {
    return [
      {
        ...base,
        id: 'd0000000001a',
        name: L(lang, 'Preis-Check: Fjord Calm 5', 'Price check: Fjord Calm 5', 'Control de precio: Fjord Calm 5'),
        prompt: L(lang, 'Prüfe den Preis der Fjord Calm 5 bei drei Shops auf example.com und melde dich nur, wenn er unter 250 € liegt.', 'Check the price of the Fjord Calm 5 at three shops on example.com and report only if it is below €250.', 'Comprueba el precio de los Fjord Calm 5 en tres tiendas de example.com y avisa solo si baja de 250 €.'),
        schedule: { kind: 'cron', expr: '30 7 * * *', display: 'daily at 7:30' },
        enabled: true,
        state: 'scheduled',
        createdAt: at(now - 2 * 24 * HOUR),
        nextRunAt: at(nextAt(now, 7, [0, 1, 2, 3, 4, 5, 6]) + 30 * 60_000),
        lastRunAt: at(now - 70 * 60_000),
        lastStatus: 'ok',
      },
      {
        ...base,
        id: 'd0000000001b',
        name: L(lang, 'Angebote der Woche', 'Deals of the week', 'Ofertas de la semana'),
        prompt: L(lang, 'Fasse jeden Freitag die fünf besten Angebote meiner Wunschliste zusammen.', 'Every Friday, sum up the five best deals on my wish list.', 'Cada viernes, resume las cinco mejores ofertas de mi lista de deseos.'),
        schedule: { kind: 'cron', expr: '0 9 * * 5', display: 'every friday 9am' },
        enabled: false,
        state: 'paused',
        pausedAt: at(now - 5 * 24 * HOUR),
        createdAt: at(now - 20 * 24 * HOUR),
        nextRunAt: at(nextAt(now, 9, [5])),
        lastRunAt: at(now - 11 * 24 * HOUR),
        lastStatus: 'ok',
      },
    ];
  }
  if (bot === 'atlas') {
    return [
      {
        ...base,
        id: 'd0000000002a',
        name: L(lang, 'Erinnerung: Zug nach Wien', 'Reminder: train to Vienna', 'Recordatorio: tren a Viena'),
        prompt: L(lang, 'Erinnere mich einen Tag vor der Abfahrt nach Wien, mit Gleis und Platz.', 'Remind me one day before the departure to Vienna, with platform and seat.', 'Recuérdame un día antes de la salida a Viena, con andén y asiento.'),
        schedule: { kind: 'once', runAt: at(now - 3 * HOUR - 10 * 60_000), display: 'once' },
        enabled: false,
        state: 'completed',
        createdAt: at(now - 4 * 24 * HOUR),
        lastRunAt: at(now - 3 * HOUR - 10 * 60_000),
        lastStatus: 'ok',
        repeat: { times: 1, completed: 1 },
      },
    ];
  }
  if (bot === 'lumi') {
    return [
      {
        ...base,
        id: 'd0000000003a',
        name: L(lang, 'Morgenbriefing', 'Morning briefing', 'Resumen matutino'),
        prompt: L(lang, 'Jeden Werktag um 7: Termine, Wetter und was heute eine Entscheidung braucht, höchstens fünf Punkte.', 'Every weekday at 7: appointments, weather and what needs a decision today, five points at most.', 'Cada día laborable a las 7: citas, tiempo y lo que necesita una decisión hoy, cinco puntos como mucho.'),
        schedule: { kind: 'cron', expr: '0 7 * * 1-5', display: 'weekdays at 7am' },
        enabled: true,
        state: 'scheduled',
        createdAt: at(now - 6 * 24 * HOUR),
        nextRunAt: at(nextAt(now, 7, [1, 2, 3, 4, 5])),
        lastRunAt: at(now - 2 * HOUR),
        lastStatus: 'ok',
      },
    ];
  }
  return [];
}

/** In-memory stand-in for the jobs client, the last result and the inbox (demo connection only). `bot`: a demo bot's own. */
export function createDemoRoutines(now = Date.now(), lang?: DemoLang, bot?: string) {
  let jobs = bot ? demoBotJobs(bot, now, lang) : demoJobs(now, lang);
  let inbox = bot ? [] : sortInbox(demoInbox(now, lang));
  const find = (id: string) => {
    const j = jobs.find((x) => x.id === id);
    if (!j) throw new Error('not found');
    return j;
  };
  const update = (id: string, patch: Partial<RoutineJob>): RoutineJob => {
    const next = { ...find(id), ...patch };
    jobs = jobs.map((x) => (x.id === id ? next : x));
    return next;
  };
  const unread = () => inbox.filter((i) => !i.read).length;
  const capabilities: RoutinesCapabilities = {
    version: 1,
    hermesProfile: bot ?? 'default',
    available: true,
    rights: 'manage',
    mode: 'control',
    inbox: { available: true, durable: true, retentionDays: 30, maxItems: 300 },
    push: { available: false },
    reasons: [],
  };
  const inboxApi: InboxApi = {
    async capabilities() {
      return capabilities;
    },
    async list(p: { filter?: InboxFilter; limit?: number; before?: string } = {}): Promise<InboxPage> {
      const all = inbox.filter((i) => (p.filter === 'unread' ? !i.read : true));
      const start = p.before ? all.findIndex((i) => i.id === p.before) + 1 : 0;
      const limit = Math.max(1, Math.min(100, p.limit ?? 50));
      const slice = all.slice(start, start + limit);
      const more = start + limit < all.length;
      return { items: slice.map(summaryOf), unreadCount: unread(), nextCursor: more ? (slice[slice.length - 1]?.id ?? null) : null };
    },
    async get(id: string) {
      const i = inbox.find((x) => x.id === id);
      if (!i) throw new HermesError('bad_request', 'not found', { status: 404, code: 'item_not_found' });
      return { ...i };
    },
    async setRead(id: string, read: boolean) {
      inbox = inbox.map((x) => (x.id === id ? { ...x, read } : x));
      const i = inbox.find((x) => x.id === id);
      return { item: i ? summaryOf(i) : null, unreadCount: unread() };
    },
    async readAll() {
      const updated = unread();
      inbox = inbox.map((x) => (x.read ? x : { ...x, read: true }));
      return { updated, unreadCount: 0 };
    },
  };
  return {
    async list(): Promise<JobList> {
      return { jobs: jobs.map((j) => ({ ...j })), access: 'control', rights: 'manage' };
    },
    async get(id: string): Promise<RoutineJob> {
      return { ...find(id) };
    },
    async act(id: string, action: JobAction): Promise<RoutineJob> {
      if (action === 'pause') return update(id, { enabled: false, state: 'paused', pausedAt: at(Date.now()) });
      if (action === 'resume') return update(id, { enabled: true, state: 'scheduled', pausedAt: undefined });
      return update(id, { enabled: true, state: 'scheduled', pausedAt: undefined, nextRunAt: at(Date.now()) });
    },
    async lastResult(id: string): Promise<LastResult | null> {
      const hit = inbox.find((i) => i.jobId === id && i.text && i.status !== 'silent');
      return hit ? { sessionId: hit.sessionId ?? `cron_${id}_demo`, at: Date.parse(hit.finishedAt), text: hit.text } : null;
    },
    inbox: inboxApi,
  };
}
