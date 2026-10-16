// Follow-ups for what the user does with an answer: ticking a checklist, finishing a quiz, picking a path or
// a product, a reshape chip (`[reformat:…]`), or any other interactive block that sends a `[kind:id] …` reply.
// The reply text is protocol (see ui/components/modules/a/replies.ts, chat/reformat.ts); every one of them gets a
// sensible, scripted continuation in the chat language. Pure data like the other scenario files.
import { FACTS, FACTS_OF_SCENARIO, type FactsId } from './facts.ts';
import { L, hui, langOf, tool, type DemoLang, type DemoScenario } from './kit.ts';
import { BACKUP_STEPS, chips, factsText, pickedRoute } from './scenes-core.ts';

/** `[kind:id] rest` / `[kind] rest` → parts (first line) */
export function parseReply(text: string): { kind: string; id: string; rest: string } | null {
  const m = /^\[([a-z]+)(?::([^\]\n]*))?\]\s*([\s\S]*)$/.exec(text.trim());
  return m ? { kind: m[1], id: m[2] ?? '', rest: m[3] } : null;
}

const none = (s: string) => !s.trim() || s.trim() === '–';
const list = (s: string) => (none(s) ? [] : s.split(/,\s*/).filter(Boolean));

// ── checklist ──────────────────────────────────────────────────────────────────────────────────────────────────

export const checklistReply: DemoScenario = {
  format: 'interactive',
  steps: (ctx) => {
    const m = /erledigt:\s*(.*?)\s*·\s*offen:\s*(.*)$/s.exec(ctx.userText);
    const done = list(m?.[1] ?? '');
    const open = list(m?.[2] ?? '');
    const total = done.length + open.length;
    const head = L(
      ctx,
      `Danke! **${done.length} von ${total}** Einträgen sind abgehakt.`,
      `Thanks! **${done.length} of ${total}** items are ticked off.`,
      `¡Gracias! **${done.length} de ${total}** elementos están marcados.`,
    );
    return [
      { tool: { name: 'todo', label: L(ctx, 'Einkaufsliste aktualisieren', 'update shopping list', 'actualizar lista de la compra'), emoji: '✅', ms: 700 } },
      {
        text:
          head +
          '\n\n' +
          (open.length
            ? L(ctx, `Noch offen: ${open.join(', ')}.\n\nSoll ich daraus den Einkaufsweg nach Abteilungen ordnen? Das mache ich mit deinem eigenen Hermes automatisch. Hier in der Demo geht es so weiter – gekocht wird ja auch noch:\n\n`, `Still open: ${open.join(', ')}.\n\nShall I order the open items into a shopping route by aisle? With your own Hermes that happens automatically. In the demo, carry on like this – there is cooking to do as well:\n\n`, `Aún falta: ${open.join(', ')}.\n\n¿Ordeno lo pendiente en una ruta de compra por secciones? Con tu propio Hermes eso ocurre solo. En la demo sigue así: también hay que cocinar:\n\n`)
            : L(ctx, 'Alles erledigt – die Liste ist komplett. Dann kann gekocht werden:\n\n', 'Everything is done – the list is complete. Time to cook:\n\n', 'Todo listo: la lista está completa. Toca cocinar:\n\n')) +
          hui({ type: 'progress', label: L(ctx, 'Einkauf erledigt', 'Shopping done', 'Compra hecha'), value: done.length, max: Math.max(total, 1) }) +
          '\n' +
          chips(ctx, 'recipe', 'products', 'tour'),
      },
    ];
  },
};

// ── quiz ───────────────────────────────────────────────────────────────────────────────────────────────────────

export const quizResult: DemoScenario = {
  format: 'interactive',
  steps: (ctx) => {
    const m = /(\d+)\s*\/\s*(\d+)/.exec(ctx.userText);
    const correct = Number(m?.[1] ?? 0);
    const total = Math.max(Number(m?.[2] ?? 3), 1);
    const all = correct >= total;
    const verdict = all
      ? L(ctx, 'Alles richtig – stark!', 'All correct – well done!', '¡Todo correcto, muy bien!')
      : correct * 2 >= total
        ? L(ctx, 'Ordentlich! Ein bisschen Übung noch.', 'Solid! A little more practice.', '¡Bien! Un poco más de práctica.')
        : L(ctx, 'Guter Start – so lernt man.', 'A good start – that is how you learn.', 'Buen comienzo: así se aprende.');
    return [
      {
        text:
          L(ctx, `Dein Ergebnis: **${correct} von ${total}** richtig. ${verdict}\n\n`, `Your score: **${correct} of ${total}** correct. ${verdict}\n\n`, `Tu resultado: **${correct} de ${total}** correctas. ${verdict}\n\n`) +
          hui({ type: 'progress', label: L(ctx, 'Richtig beantwortet', 'Answered correctly', 'Respondidas bien'), value: correct, max: total }) +
          '\n' +
          (all
            ? L(ctx, 'Wie wäre es mit etwas Neuem?\n\n', 'How about something new?\n\n', '¿Qué tal algo nuevo?\n\n') + chips(ctx, 'flashcards', 'explain', 'tour')
            : L(ctx, 'Zum Üben bieten sich Karteikarten an – oder du erfährst, wie die Antworten zustande kamen:\n\n', 'Flashcards are good for practice – or find out how the answers come about:\n\n', 'Las tarjetas sirven para practicar, o descubre cómo se llega a las respuestas:\n\n') + chips(ctx, 'flashcards', 'quiz', 'tour')),
      },
    ];
  },
};

// ── paths ──────────────────────────────────────────────────────────────────────────────────────────────────────

export const pathsPick: DemoScenario = {
  format: 'steps',
  steps: (ctx) => {
    const lang = langOf(ctx);
    const route = pickedRoute(ctx.userText) ?? 'home';
    const b = BACKUP_STEPS[route][lang];
    return [
      { reasoning: L(ctx, 'Der Nutzer hat einen Weg gewählt. Ich mache daraus einen kurzen Plan mit drei Schritten und nenne den wichtigsten Kompromiss.', 'The user picked a route. I turn it into a short three-step plan and name the main trade-off.', 'El usuario eligió una ruta. La convierto en un plan corto de tres pasos y nombro el compromiso principal.') },
      { text: b.intro + '\n\n' },
      { text: hui({ type: 'steps', current: 1, items: b.steps.map(([title, detail]) => ({ title, detail })) }) },
      { text: `\n${b.note}\n\n` + chips(ctx, 'checklist', 'travel', 'tour') },
    ];
  },
};

// ── reformat chips ─────────────────────────────────────────────────────────────────────────────────────────────

const LANG_NAMES: Record<DemoLang, Record<'en' | 'de' | 'es' | 'fr' | 'it', string>> = {
  en: { en: 'English', de: 'German', es: 'Spanish', fr: 'French', it: 'Italian' },
  de: { en: 'Englisch', de: 'Deutsch', es: 'Spanisch', fr: 'Französisch', it: 'Italienisch' },
  es: { en: 'inglés', de: 'alemán', es: 'español', fr: 'francés', it: 'italiano' },
};

/** `[reformat:table] …` → 'table', `[reformat:translate:fr] …` → 'translate:fr' */
export function reformatKind(text: string): string | undefined {
  return /^\[reformat:([a-z]+(?::[a-z]{2,3})?)\]/.exec(text.trim())?.[1];
}

export function reformatSteps(id: FactsId, kind: string, lang: DemoLang): string {
  const f = FACTS[id];
  const ctx = { lang };
  const say = (de: string, en: string, es: string) => L(ctx, de, en, es);
  const t = /^translate:(en|de|es|fr|it)$/.exec(kind);
  if (t) {
    const to = t[1] as 'en' | 'de' | 'es' | 'fr' | 'it';
    return say(`Übersetzung (${LANG_NAMES.de[to]}):`, `Translated into ${LANG_NAMES.en[to]}:`, `Traducción (${LANG_NAMES.es[to]}):`) + `\n\n${f.translated[to]}`;
  }
  switch (kind) {
    case 'shorter':
      return say('Hier die Kurzfassung:', 'Here is the short version:', 'Aquí va la versión corta:') + `\n\n${f.short[lang]}`;
    case 'longer':
      return say('Ausführlicher:', 'In more detail:', 'Con más detalle:') + `\n\n${factsText(id, lang)}\n\n${f.more[lang]}`;
    case 'list':
      return say('Als Liste:', 'As a list:', 'En forma de lista:') + `\n\n${f.points[lang].map(([label, detail]) => `- **${label}:** ${detail}`).join('\n')}\n\n${f.outro[lang]}`;
    case 'table':
      return (
        say('Als Tabelle:', 'As a table:', 'Como tabla:') +
        '\n\n' +
        hui({ type: 'table', columns: [...f.head[lang]], rows: f.points[lang].map(([label, detail, tag]) => [label, detail, tag]) }) +
        `\n${f.outro[lang]}`
      );
    case 'simpler':
      return say('Einfacher gesagt:', 'In simpler words:', 'Dicho más sencillo:') + `\n\n${f.simple[lang]}`;
    case 'expert':
      return say('Für Fachleute:', 'For experts:', 'Para expertos:') + `\n\n${f.expert[lang]}`;
    default:
      return say('Hier die umgeformte Fassung:', 'Here is the reshaped version:', 'Aquí está la versión reformateada:') + `\n\n${f.short[lang]}`;
  }
}

export const reformat: DemoScenario = {
  format: 'text',
  steps: (ctx) => {
    const lang = langOf(ctx);
    const kind = reformatKind(ctx.userText) ?? 'shorter';
    const id = ctx.previousScenario ? FACTS_OF_SCENARIO[ctx.previousScenario] : undefined;
    if (!id) {
      return [
        {
          text: L(
            ctx,
            'Umformen zeige ich dir in der Demo an den Beispieltexten, die sich dafür eignen. Probier es mit einer dieser Antworten und tippe dann auf einen Chip:\n\n',
            'In the demo I reshape the sample texts that suit it. Try it with one of these answers, then tap a chip:\n\n',
            'En la demo reformo los textos de ejemplo que sirven para ello. Pruébalo con una de estas respuestas y toca después un chip:\n\n',
          ) + chips(ctx, 'explain', 'status', 'connect'),
        },
      ];
    }
    return [{ reasoning: L(ctx, 'Die letzte Antwort in die gewünschte Form bringen, ohne Inhalt zu erfinden.', 'Reshape the last answer into the requested form without inventing content.', 'Reformar la última respuesta a la forma pedida sin inventar contenido.') }, { text: reformatSteps(id, kind, lang) }];
  },
};

// ── anything else an interactive block sends ──────────────────────────────────────────────────────────────────

const READ: Record<string, [de: string, en: string, es: string]> = {
  choice: ['deine Auswahl', 'your choice', 'tu elección'],
  slot: ['deinen Terminwunsch', 'your time slot', 'tu horario'],
  confirm: ['deine Entscheidung', 'your decision', 'tu decisión'],
  poll: ['deine Stimme', 'your vote', 'tu voto'],
  decision: ['deine Gewichtung', 'your weighting', 'tu ponderación'],
  rank: ['deine Rangfolge', 'your ranking', 'tu clasificación'],
  scale: ['deine Bewertung', 'your rating', 'tu valoración'],
  calc: ['deine Rechnung', 'your calculation', 'tu cálculo'],
  agenda: ['deinen Tagesplan', 'your day plan', 'tu plan del día'],
  vocab: ['dein Lernergebnis', 'your study result', 'tu resultado de estudio'],
  guide: ['deinen Fortschritt', 'your progress', 'tu progreso'],
  workout: ['dein Training', 'your workout', 'tu entrenamiento'],
  studyplan: ['deinen Lernplan', 'your study plan', 'tu plan de estudio'],
  mindmap: ['deine Nachfrage', 'your follow-up', 'tu pregunta'],
  reaction: ['dein Feedback', 'your feedback', 'tu opinión'],
  ask: ['deine Frage', 'your question', 'tu pregunta'],
  node: ['deine Auswahl', 'your selection', 'tu selección'],
};

/** readable part of a protocol reply (after the tag and an optional "question →") */
export function readableReply(text: string): string {
  const p = parseReply(text);
  const rest = (p?.rest ?? text).split('\n')[0].trim();
  const i = rest.lastIndexOf('→');
  return (i >= 0 ? rest.slice(i + 1) : rest).trim().slice(0, 160);
}

/** every other `[kind:id] …` reply of an interactive block: acknowledge what arrived and offer the next step */
export const interaction: DemoScenario = {
  format: 'text',
  steps: (ctx) => {
    const p = parseReply(ctx.userText);
    const what = READ[p?.kind ?? ''] ?? ['deine Eingabe', 'your input', 'tu entrada'];
    const shown = readableReply(ctx.userText) || '–';
    return [
      {
        text:
          L(
            ctx,
            `Das ist bei mir angekommen – ${what[0]}: **${shown}**.\n\nBei einem echten Hermes baut die nächste Antwort darauf auf; jeder Baustein schickt sein Ergebnis als normale Nachricht mit Kennzeichen, damit der Agent weiß, worauf es sich bezieht. In der Demo geht es hier weiter:\n\n`,
            `That reached me – ${what[1]}: **${shown}**.\n\nWith a real Hermes the next answer builds on it; every block sends its result as a normal message with a tag, so the agent knows what it refers to. In the demo, carry on here:\n\n`,
            `Me ha llegado: ${what[2]}: **${shown}**.\n\nCon un Hermes real la siguiente respuesta se apoya en ello; cada bloque envía su resultado como un mensaje normal con una etiqueta para que el agente sepa a qué se refiere. En la demo, sigue por aquí:\n\n`,
          ) + chips(ctx, 'approval', 'checklist', 'tour'),
      },
    ];
  },
};

export const formResult: DemoScenario = {
  format: 'text',
  steps: (ctx) => [
    tool.terminal('calc --annuity', 600),
    {
      text:
        L(ctx, 'Danke, ich habe deine Eingaben erhalten:\n\n', 'Thanks, I received your input:\n\n', 'Gracias, he recibido tus datos:\n\n') +
        '```json\n' +
        ctx.userText.replace(/^\[form:[^\]]*\]\s*/, '') +
        '\n```\n\n' +
        L(ctx, 'Monatliche Rate: **ca. 372 €** (Demo-Wert).\n\n', 'Monthly payment: **about €372** (demo value).\n\n', 'Cuota mensual: **unos 372 €** (valor de demostración).\n\n') +
        chips(ctx, 'loan', 'tour'),
    },
  ],
};

export const REPLIES: Record<string, DemoScenario> = { checklistReply, quizResult, pathsPick, reformat, interaction, formResult };
