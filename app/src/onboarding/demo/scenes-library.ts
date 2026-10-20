// Skills & memory in the offline demo: the questions the Skills & memory screen hands to the chat ("What have you
// remembered about me?", "Please forget …", "Which skills do you have?", "Load the skill …", "Use the skill …:") get
// a real answer with the same data the screen shows (library/demo.ts), instead of the generic fallback. Honest about
// the demo: nothing is stored, so a forgotten entry is still listed on the screen. Fully offline, en/de/es.
import { DEMO_MEMORY, DEMO_SKILLS } from '../../library/demo.ts';
import { chips } from './scenes-core.ts';
import { L, langOf, type DemoContext, type DemoScenario, type DemoStep } from './kit.ts';

type Tri = [de: string, en: string, es: string];

/** one sentence per demo skill in the chat language (a real Hermes paraphrases the English description the same way) */
export const SKILL_SUMMARY: Record<string, Tri> = {
  arxiv: ['Sucht auf arXiv und fasst Paper mit Quellenangaben zusammen.', 'Searches arXiv and summarizes papers with citations.', 'Busca en arXiv y resume artículos con citas.'],
  'web-research': ['Plant eine Suche, liest mehrere Quellen und vergleicht sie, bevor ich antworte.', 'Plans a search, reads several sources and compares them before I answer.', 'Planifica una búsqueda, lee varias fuentes y las compara antes de responder.'],
  'github-pr-review': ['Prüft einen Pull Request: Änderungen, Tests, Risiken und ein kurzes Urteil.', 'Reviews a pull request: changes, tests, risks and a short verdict.', 'Revisa un pull request: cambios, pruebas, riesgos y un veredicto breve.'],
  'release-notes': ['Macht aus gemergten Änderungen verständliche Versionshinweise (gerade ausgeschaltet).', 'Turns merged changes into readable release notes (switched off right now).', 'Convierte cambios fusionados en notas de versión legibles (desactivado ahora).'],
  'meal-planner': ['Plant fünf Abendessen aus dem, was da ist, samt Einkaufsliste nach Abteilungen.', 'Plans five dinners from what is at home, with a shopping list by aisle.', 'Planifica cinco cenas con lo que hay en casa, con lista de la compra por secciones.'],
  'pdf-extract': ['Holt Text und Tabellen aus PDFs und behält die Seitenzahlen.', 'Pulls text and tables out of PDFs and keeps the page numbers.', 'Extrae texto y tablas de PDF y conserva los números de página.'],
  'trip-planner': ['Reisepläne Tag für Tag, mit Öffnungszeiten und Wegzeiten.', 'Day-by-day travel plans with opening hours and travel times.', 'Planes de viaje día a día, con horarios y tiempos de trayecto.'],
};

const CATEGORY: Record<string, Tri> = {
  research: ['Recherche', 'Research', 'Investigación'],
  software: ['Software', 'Software', 'Software'],
  home: ['Zuhause', 'Home', 'Hogar'],
  documents: ['Dokumente', 'Documents', 'Documentos'],
  '': ['Sonstige', 'Other', 'Otros'],
};

const li = (ctx: Pick<DemoContext, 'lang'>) => (ctx.lang === 'en' ? 1 : ctx.lang === 'es' ? 2 : 0);
const tick = (s: string) => `\`${s}\``;

/** where the screen is (drawer and Settings), one closing line */
const whereLine = (ctx: DemoContext) =>
  L(
    ctx,
    'Dieselbe Liste findest du unter **Skills & Gedächtnis** im Menü links.',
    'You will find the same list under **Skills & memory** in the menu on the left.',
    'Encontrarás la misma lista en **Skills y memoria**, en el menú de la izquierda.',
  );

const memoryTool = (ctx: DemoContext, args: Record<string, unknown>, ms = 600): DemoStep => ({
  tool: { name: 'memory', label: L(ctx, 'Gedächtnis', 'memory', 'memoria'), emoji: '\u{1F9E0}', ms, result: { args, output: '{"success": true}' } },
});

export const memoryWhat: DemoScenario = {
  format: 'text',
  steps: (ctx) => {
    const lang = langOf(ctx);
    const list = (xs: { de: string; en: string; es: string }[]) => xs.map((e) => `- ${e[lang]}`).join('\n');
    return [
      {
        text:
          L(ctx, '**Über dich** habe ich mir gemerkt:\n\n', 'This is what I noted **about you**:\n\n', 'Esto es lo que anoté **sobre ti**:\n\n') +
          list(DEMO_MEMORY.user) +
          L(ctx, '\n\n**Für meine Arbeit** habe ich notiert:\n\n', '\n\nAnd **for my own work**:\n\n', '\n\nY **para mi trabajo**:\n\n') +
          list(DEMO_MEMORY.memory) +
          '\n\n' +
          L(
            ctx,
            'Soll ich etwas davon vergessen? Sag einfach, was weg soll. ' + whereLine(ctx) + '\n\n',
            'Should I forget any of it? Just say what should go. ' + whereLine(ctx) + '\n\n',
            '¿Quieres que olvide algo? Dime qué debo borrar. ' + whereLine(ctx) + '\n\n',
          ) +
          chips(ctx, 'memoryForget', 'skillsList', 'tour'),
      },
    ];
  },
};

/**
 * The entry a forget request names: the quoted entry of the screen's prompt, a stored entry the request mentions
 * ("Forget that I dislike coriander" → the coriander entry), or what follows the colon / the verb.
 */
export function forgetTarget(text: string, lang: 'de' | 'en' | 'es'): string {
  const quoted = /[„“"«]([^“”"»]{2,})[“”"»]/.exec(text)?.[1];
  if (quoted) return quoted.trim();
  const t = text.toLowerCase();
  // any language: "Forget that I dislike coriander" in a German chat still means the stored coriander entry
  for (const e of [...DEMO_MEMORY.user, ...DEMO_MEMORY.memory]) {
    const words = [e.de, e.en, e.es].flatMap((v) => v.toLowerCase().match(/[\p{L}]{6,}/gu) ?? []);
    if (words.some((w) => t.includes(w))) return e[lang];
  }
  const after = /:\s*(.+)$/s.exec(text)?.[1]?.trim();
  if (after) return after;
  return text.replace(/^\s*(please\s+)?(forget|vergiss|olvida)\b[,:]?\s*/i, '').trim() || text.trim();
}

export const memoryForget: DemoScenario = {
  format: 'text',
  steps: (ctx) => {
    const target = forgetTarget(ctx.userText, langOf(ctx)).slice(0, 140);
    return [
      memoryTool(ctx, { action: 'remove', target: 'user', old_text: target }),
      {
        text: L(
          ctx,
          `Erledigt, das habe ich aus meinem Gedächtnis gelöscht: „${target}“.\n\nIn der Demo wird nichts gespeichert, deshalb steht der Eintrag unter Skills & Gedächtnis weiter da. Mit deinem eigenen Hermes ist er danach wirklich weg.\n\n`,
          `Done, I deleted this from my memory: “${target}”.\n\nThe demo stores nothing, so the entry is still listed under Skills & memory. With your own Hermes it is really gone afterwards.\n\n`,
          `Hecho, lo he borrado de mi memoria: «${target}».\n\nLa demo no guarda nada, así que la entrada sigue en Skills y memoria. Con tu propio Hermes desaparece de verdad.\n\n`,
        ) + chips(ctx, 'skillsList', 'tour'),
      },
    ];
  },
};

export const skillsList: DemoScenario = {
  format: 'text',
  steps: (ctx) => {
    const groups = new Map<string, string[]>();
    for (const s of DEMO_SKILLS) {
      const cat = s.category && CATEGORY[s.category] ? s.category : '';
      const line = `- ${tick(s.name)}: ${SKILL_SUMMARY[s.name]?.[li(ctx)] ?? ''}`;
      groups.set(cat, [...(groups.get(cat) ?? []), line]);
    }
    const body = [...groups.entries()].map(([cat, lines]) => `**${CATEGORY[cat][li(ctx)]}**\n${lines.join('\n')}`).join('\n\n');
    return [
      { tool: { name: 'skills_list', label: 'skills_list', emoji: '\u{1F4DA}', ms: 600, result: { args: {}, output: JSON.stringify({ success: true, count: DEMO_SKILLS.length }) } } },
      {
        text:
          L(ctx, 'Das sind meine Skills:\n\n', 'These are my skills:\n\n', 'Estos son mis skills:\n\n') +
          body +
          '\n\n' +
          L(
            ctx,
            'Ein Skill ist eine Anleitung, die ich lade, wenn eine Aufgabe dazu passt. Unter **Skills & Gedächtnis** im Menü links kannst du jeden aufklappen und nachlesen.\n\n',
            'A skill is a set of instructions I load when a task fits it. Under **Skills & memory** in the menu on the left you can open each one and read it.\n\n',
            'Un skill es un conjunto de instrucciones que cargo cuando una tarea encaja. En **Skills y memoria**, en el menú de la izquierda, puedes abrir cada uno y leerlo.\n\n',
          ) +
          chips(ctx, 'skillDoc', 'memoryWhat', 'tour'),
      },
    ];
  },
};

/** the skill a "Load the skill X" / "Use the skill X:" request names (a demo skill, else the first word after "skill") */
function skillOf(text: string): string {
  const t = text.toLowerCase();
  const known = DEMO_SKILLS.find((s) => t.includes(s.name));
  if (known) return known.name;
  return /skill\s+([\w.-]+)/i.exec(text)?.[1] ?? 'skill';
}

const viewTool = (name: string): DemoStep => ({ tool: { name: 'skill_view', label: name, emoji: '\u{1F4DA}', ms: 600, result: { args: { name }, output: JSON.stringify({ success: true, name }) } } });

export const skillDoc: DemoScenario = {
  format: 'text',
  steps: (ctx) => {
    const name = skillOf(ctx.userText);
    const summary = SKILL_SUMMARY[name]?.[li(ctx)];
    return [
      viewTool(name),
      {
        text:
          (summary
            ? L(ctx, `${tick(name)} ist geladen. ${summary}`, `${tick(name)} is loaded. ${summary}`, `${tick(name)} está cargado. ${summary}`)
            : L(ctx, `Einen Skill ${tick(name)} habe ich in der Demo nicht.`, `There is no skill ${tick(name)} in the demo.`, `En la demo no hay ningún skill ${tick(name)}.`)) +
          (name === 'meal-planner'
            ? L(
                ctx,
                '\n\nSo gehe ich vor: Ich frage einmal kurz, was schon da ist, plane fünf Abendessen mit Zutaten, die sich überschneiden, halte mich an das, was ich über dich weiß (vegetarisch, kein Koriander), und ende mit der Einkaufsliste.',
                '\n\nHow I go about it: I ask once what is already at home, plan five dinners that share ingredients, stick to what I know about you (vegetarian, no coriander) and end with the shopping list.',
                '\n\nCómo lo hago: pregunto una vez qué hay en casa, planifico cinco cenas que comparten ingredientes, respeto lo que sé de ti (vegetariana, sin cilantro) y termino con la lista de la compra.',
              )
            : '') +
          '\n\n' +
          chips(ctx, 'liveList', 'memoryWhat', 'tour'),
      },
    ];
  },
};

export const skillUse: DemoScenario = {
  format: 'text',
  steps: (ctx) => {
    const name = skillOf(ctx.userText);
    const task = /:\s*(.+)$/s.exec(ctx.userText)?.[1]?.trim();
    return [
      viewTool(name),
      {
        text:
          L(
            ctx,
            task ? `Ich habe ${tick(name)} geladen. Die Aufgabe „${task.slice(0, 120)}“ kann die Demo aber nicht wirklich ausführen, sie kennt nur vorbereitete Antworten. Dein eigenes Hermes würde jetzt mit dem Skill loslegen.` : `Ich habe ${tick(name)} geladen. Schreib hinter den Doppelpunkt, was ich damit tun soll.`,
            task ? `I loaded ${tick(name)}. The demo cannot really run the task “${task.slice(0, 120)}” though, it only knows prepared answers. Your own Hermes would get to work with the skill now.` : `I loaded ${tick(name)}. Write after the colon what I should do with it.`,
            task ? `He cargado ${tick(name)}. Pero la demo no puede ejecutar de verdad la tarea «${task.slice(0, 120)}»: solo conoce respuestas preparadas. Tu propio Hermes empezaría ahora con el skill.` : `He cargado ${tick(name)}. Escribe después de los dos puntos qué debo hacer con él.`,
          ) +
          '\n\n' +
          chips(ctx, 'skillsList', 'tour'),
      },
    ];
  },
};

export const LIBRARY_SCENES: Record<string, DemoScenario> = { memoryWhat, memoryForget, skillsList, skillDoc, skillUse };
