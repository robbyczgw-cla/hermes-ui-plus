import type { bots as de } from './bots.de.ts';

// Namespace 'bots' (Spanish). Must have exactly the keys of bots.de.ts.
export const bots = {
  picker: {
    section: 'Bot',
    default: 'Predeterminado',
    a11y: '{name}, modelo {model}',
    newChat: 'Nuevo chat con {name}',
  },
  settings: {
    title: 'Perfiles de Hermes (bots)',
    field: 'Bots',
    placeholder: 'p. ej. research, trabajo',
    footnote:
      'Los bots son perfiles de Hermes: modelo, memoria y habilidades propios. Nombres como en «hermes profile create», separados por comas. A través del UI bridge aparecen solos. El bot se elige en el chat desde el menú de modelos.',
    invalid: 'Se ignora (solo minúsculas, dígitos, - y _): {names}',
  },
  drawer: {
    badgeA11y: 'Bot {name}',
  },
} satisfies typeof de;
