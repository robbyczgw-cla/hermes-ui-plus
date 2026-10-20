/**
 * Demo connection: a small, plausible skill set and memory so the screen can be explored offline. Fixed data; nothing is
 * stored. Skills are English like a real skill library; the memory entries follow the UI language (Hermes writes them
 * in the user's language), the same entries the demo chat lists (onboarding/demo/scenes-library.ts).
 */
import type { LibrarySkill, MemorySnapshot, SkillDoc } from './model.ts';

export type DemoLibraryLang = 'de' | 'en' | 'es';
type Triple = { de: string; en: string; es: string };

/** the demo memory: what Hermes noted for itself (`memory`) and about the user (`user`) */
export const DEMO_MEMORY: { memory: Triple[]; user: Triple[] } = {
  memory: [
    {
      de: 'Der Wochenbericht geht freitags raus; den Entwurf möchte Alice bis Donnerstagabend.',
      en: 'Weekly report goes out on Fridays; Alice wants the draft by Thursday evening.',
      es: 'El informe semanal sale los viernes; Alice quiere el borrador el jueves por la tarde.',
    },
    {
      de: 'Der Heimserver macht um 02:00 Backups. Dann keine schweren Aufgaben einplanen.',
      en: 'The home server runs backups at 02:00. Do not schedule heavy jobs then.',
      es: 'El servidor de casa hace copias a las 02:00. No programar tareas pesadas a esa hora.',
    },
    {
      de: 'Mag Antworten als kurze Listen; Tabellen nur für Vergleiche.',
      en: 'Prefers answers as short lists; tables only for comparisons.',
      es: 'Prefiere respuestas en listas cortas; tablas solo para comparaciones.',
    },
  ],
  user: [
    { de: 'Alice. Wohnt in einer Kleinstadt, fährt mit dem Rad zur Arbeit.', en: 'Alice. Lives in a small town, cycles to work.', es: 'Alice. Vive en un pueblo pequeño, va en bici al trabajo.' },
    { de: 'Vegetarisch. Mag keinen Koriander.', en: 'Vegetarian. Dislikes coriander.', es: 'Vegetariana. No le gusta el cilantro.' },
    {
      de: 'Spricht Deutsch und Englisch; antwortet gern in der Sprache der Frage.',
      en: 'Speaks German and English; answers in the language of the question.',
      es: 'Habla alemán e inglés; prefiere la respuesta en el idioma de la pregunta.',
    },
  ],
};

export const DEMO_SKILLS: LibrarySkill[] = [
  { name: 'arxiv', category: 'research', description: 'Search arXiv and summarize papers with citations.', enabled: true, source: 'bundled' },
  { name: 'web-research', category: 'research', description: 'Plan a search, read several sources and compare them before answering.', enabled: true, source: 'bundled' },
  { name: 'github-pr-review', category: 'software', description: 'Review a pull request: diff, tests, risky changes, a short verdict.', enabled: true, source: 'hub' },
  { name: 'release-notes', category: 'software', description: 'Turn merged changes into user-facing release notes.', enabled: false, source: 'local' },
  { name: 'meal-planner', category: 'home', description: 'Weekly meal plan from what is in the fridge, with a shopping list.', enabled: true, source: 'local' },
  { name: 'pdf-extract', category: 'documents', description: 'Pull text and tables out of PDFs, keep page numbers.', enabled: true, source: 'bundled' },
  { name: 'trip-planner', description: 'Day-by-day travel plans with opening hours and travel times.', enabled: true, source: 'external' },
];

const DOCS: Record<string, string> = {
  'meal-planner': `---
name: meal-planner
description: Weekly meal plan from what is in the fridge, with a shopping list.
version: 1.2.0
tags: [food, planning]
---

# Meal planner

Use this skill when the user asks what to cook this week or wants a shopping list.

## Steps

1. Ask what is already at home if the user did not say. Keep it to one question.
2. Plan **five dinners**. Reuse ingredients across days so little is left over.
3. Respect what memory says about diet and dislikes.
4. End with a shopping list grouped by aisle.

## Output

| Day | Dish | Time |
|---|---|---|
| Mon | Lentil soup | 30 min |

Keep it short. No calorie counts unless asked.
`,
};

function docFor(name: string): SkillDoc | null {
  const s = DEMO_SKILLS.find((x) => x.name === name);
  if (!s) return null;
  const raw = DOCS[name];
  if (!raw) {
    return { name, body: `# ${name}\n\n${s.description ?? ''}\n\n## When to use\n\nWhen the request matches the description above. Follow the steps in order and say which sources you used.`, meta: [{ key: 'version', value: '1.0.0' }], truncated: false };
  }
  const body = raw.replace(/^---\n[\s\S]*?\n---\n/, '').trim();
  return { name, body, meta: [{ key: 'version', value: '1.2.0' }, { key: 'tags', value: 'food, planning' }], truncated: false };
}

const DAY = 86_400_000;

export function demoLibrary(now = Date.now(), lang: DemoLibraryLang = 'en'): { skills: LibrarySkill[]; doc(name: string): SkillDoc | null; memory: MemorySnapshot } {
  const memory = DEMO_MEMORY.memory.map((e) => e[lang]);
  const user = DEMO_MEMORY.user.map((e) => e[lang]);
  const chars = (list: string[]) => list.join('\n§\n').length;
  return {
    skills: DEMO_SKILLS.map((s) => ({ ...s })),
    doc: docFor,
    memory: {
      stores: [
        { target: 'memory', enabled: true, entries: memory, chars: chars(memory), limit: 2200, updatedAt: now - 2 * DAY },
        { target: 'user', enabled: true, entries: user, chars: chars(user), limit: 1375, updatedAt: now - 9 * DAY },
      ],
    },
  };
}
