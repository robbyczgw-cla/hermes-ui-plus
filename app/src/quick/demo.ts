/**
 * Offline demo backend for quick answers: a few canned questions (one with an interactive `calc` card, one with a
 * `table`), replayed as the same OpenAI SSE frames the bridge sends and fed through the real parser + frame mapper
 * (hermes/sse.ts, hermes/events.ts), so the demo exercises the production rendering path. No network.
 * Pure (sleep injectable), tested in core.test.ts.
 */
import { createSseParser } from '../hermes/sse.ts';
import { mapFrame } from '../hermes/events.ts';
import type { HermesEvent } from '../hermes/types.ts';
import type { ModelOptionsCatalog } from '../hermes/capabilities.ts';
import type { QuickTurn } from './core.ts';

export type DemoLang = 'de' | 'en' | 'es';
export const DEMO_QUICK_MODEL = 'flash-mini';

const L = (lang: DemoLang | undefined, de: string, en: string, es: string) => (lang === 'en' ? en : lang === 'es' ? es : de);
const hui = (node: unknown) => '```hui\n' + JSON.stringify(node) + '\n```';

type Canned = { key: string; match: RegExp; answer: (lang: DemoLang | undefined) => string };

/** sample questions (empty thread, demo fallback): the first three hit a canned answer in every language */
export function demoQuickSamples(lang: DemoLang | undefined): string[] {
  return [
    L(lang, 'Wie viel sind 72 °F in °C?', 'What is 72 °F in °C?', '¿Cuánto son 72 °F en °C?'),
    L(lang, 'Python oder JavaScript für Einsteiger?', 'Python or JavaScript for beginners?', '¿Python o JavaScript para empezar?'),
    L(lang, 'Wie lange kocht ein weiches Ei?', 'How long does a soft-boiled egg take?', '¿Cuánto tarda un huevo pasado por agua?'),
  ];
}

const CANNED: Canned[] = [
  {
    key: 'temperature',
    match: /°\s*f|fahrenheit|grad.*celsius|celsius/i,
    answer: (lang) =>
      L(lang, '72 °F sind **22,2 °C** – angenehme Zimmertemperatur.\n\n', '72 °F is **22.2 °C** – a comfortable room temperature.\n\n', '72 °F son **22,2 °C**, una temperatura ambiente agradable.\n\n') +
      hui({
        type: 'calc',
        id: 'f2c',
        title: L(lang, 'Fahrenheit → Celsius', 'Fahrenheit → Celsius', 'Fahrenheit → Celsius'),
        basis: 'calculated',
        inputs: [{ name: 'f', label: 'Fahrenheit', kind: 'slider', min: -40, max: 120, step: 1, default: 72, unit: '°F' }],
        outputs: [{ name: 'c', label: 'Celsius', expr: '(f - 32) * 5 / 9', format: 'number', decimals: 1, emphasis: true }],
        note: L(lang, 'Formel: (°F − 32) × 5/9', 'Formula: (°F − 32) × 5/9', 'Fórmula: (°F − 32) × 5/9'),
      }),
  },
  {
    key: 'languages',
    match: /python|javascript/i,
    answer: (lang) =>
      L(lang, 'Kurz gesagt: **Python** für einen sanften Einstieg, **JavaScript** wenn du schnell etwas im Browser sehen willst.\n\n', 'In short: **Python** for a gentle start, **JavaScript** if you want to see something in the browser quickly.\n\n', 'En resumen: **Python** para empezar con calma, **JavaScript** si quieres ver algo en el navegador enseguida.\n\n') +
      hui({
        type: 'table',
        columns: [L(lang, 'Sprache', 'Language', 'Lenguaje'), L(lang, 'Gut für', 'Good for', 'Ideal para')],
        rows: [
          ['Python', L(lang, 'leichter Einstieg, Daten, kleine Skripte', 'an easy start, data, small scripts', 'empezar fácil, datos, scripts pequeños')],
          ['JavaScript', L(lang, 'sofort sichtbar im Browser, Web-Apps', 'instant results in the browser, web apps', 'resultados al instante en el navegador, apps web')],
        ],
      }),
  },
  {
    key: 'egg',
    match: /\bei\b|\begg\b|huevo/i,
    answer: (lang) =>
      L(
        lang,
        'Ein **weiches Ei** (Größe M, aus dem Kühlschrank) braucht **5–6 Minuten** in sprudelnd kochendem Wasser. Danach kurz kalt abschrecken.',
        'A **soft-boiled egg** (medium, straight from the fridge) takes **5–6 minutes** in rapidly boiling water. Rinse it briefly in cold water afterwards.',
        'Un **huevo pasado por agua** (tamaño M, recién sacado de la nevera) necesita **5–6 minutos** en agua hirviendo. Después, pásalo un momento por agua fría.',
      ),
  },
  {
    key: 'capital',
    match: /hauptstadt|capital/i,
    answer: (lang) =>
      L(lang, 'Die Hauptstadt von Australien ist **Canberra** – nicht Sydney.', 'The capital of Australia is **Canberra** – not Sydney.', 'La capital de Australia es **Canberra**, no Sídney.'),
  },
];

function fallback(lang: DemoLang | undefined): string {
  return (
    L(
      lang,
      'Im Demo-Modus kenne ich nur ein paar vorbereitete Schnellfragen. Probier eine davon:\n\n',
      'In demo mode I only know a few prepared quick questions. Try one of these:\n\n',
      'En el modo demo solo conozco algunas preguntas rápidas preparadas. Prueba una de estas:\n\n',
    ) + hui({ type: 'suggestions', items: demoQuickSamples(lang) })
  );
}

/** canned answer for the last question (follow-ups re-use the topic of the thread when nothing matches) */
export function pickDemoAnswer(history: readonly QuickTurn[], lang?: DemoLang): { key: string; text: string } {
  const q = history[history.length - 1]?.content ?? '';
  const hit = CANNED.find((c) => c.match.test(q));
  if (hit) return { key: hit.key, text: hit.answer(lang) };
  return { key: 'fallback', text: fallback(lang) };
}

export type DemoQuickParams = {
  history: readonly QuickTurn[];
  lang?: DemoLang;
  signal?: AbortSignal;
  onEvent: (ev: HermesEvent) => void;
  /** (ms, signal) → resolves after ms; rejects with AbortError on abort */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** 0 = instant (tests) */
  speed?: number;
};

function abortError(): Error {
  const e = new Error('Abgebrochen');
  e.name = 'AbortError';
  return e;
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError());
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Replay one canned quick answer. Resolves `{aborted}`; never throws for an abort. */
export async function runDemoQuick(p: DemoQuickParams): Promise<{ aborted: boolean; key: string }> {
  const sleep = p.sleep ?? defaultSleep;
  const speed = p.speed ?? 1;
  const { key, text } = pickDemoAnswer(p.history, p.lang);
  const parser = createSseParser();
  const write = (data: unknown) => {
    for (const f of parser.push(`data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`)) for (const ev of mapFrame(f)) p.onEvent(ev);
  };
  const id = `chatcmpl-hq-demo${Date.now().toString(36)}`;
  const created = Math.floor(Date.now() / 1000);
  const chunk = (delta: Record<string, unknown>, finish: string | null = null, extra: Record<string, unknown> = {}) => ({
    id, object: 'chat.completion.chunk', created, model: DEMO_QUICK_MODEL, choices: [{ index: 0, delta, finish_reason: finish }], ...extra,
  });
  try {
    // a fast model still needs a moment: ~1.2–1.6 s to the first token, like the measured plugin
    await sleep(Math.round((1150 + Math.random() * 450) * speed), p.signal);
    write(chunk({ role: 'assistant', content: '' }));
    // prose in small pieces, the hui block in bigger slices (a fast model streams quickly)
    const parts = text.split(/(```[\s\S]*?```)/).filter(Boolean);
    for (const part of parts) {
      const block = part.startsWith('```');
      const size = block ? 48 : 6;
      for (let i = 0; i < part.length; i += size) {
        write(chunk({ content: part.slice(i, i + size) }));
        await sleep(Math.round((block ? 8 : 14) * speed), p.signal);
      }
    }
    const prompt = 620 + p.history.reduce((n, t) => n + Math.ceil(t.content.length / 4), 0);
    const completion = Math.ceil(text.length / 4);
    write(chunk({}, 'stop', { usage: { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion }, provider: 'demo' }));
    write('[DONE]');
    for (const f of parser.flush()) for (const ev of mapFrame(f)) p.onEvent(ev);
    return { aborted: false, key };
  } catch (e) {
    if (p.signal?.aborted || (e instanceof Error && e.name === 'AbortError')) return { aborted: true, key };
    throw e;
  }
}

/**
 * Hermes model catalog of the demo (Settings → Schnellfrage → Modell): a small fictional inventory in the shape of
 * GET /api/model/options, so the picker can be shown without a server.
 */
export const DEMO_MODEL_CATALOG: ModelOptionsCatalog = {
  currentModel: DEMO_QUICK_MODEL,
  currentProvider: 'demo',
  providers: [
    { slug: 'demo', name: 'Demo', current: true, models: [DEMO_QUICK_MODEL, 'flash-pro'], caps: { [DEMO_QUICK_MODEL]: { reasoning: false, canDisableReasoning: true, fast: true } } },
    { slug: 'example-cloud', name: 'Example Cloud', current: false, models: ['swift-small', 'swift-medium'], caps: {} },
  ],
};
