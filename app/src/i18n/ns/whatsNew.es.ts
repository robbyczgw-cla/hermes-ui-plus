import type { whatsNew as de } from './whatsNew.de.ts';

// Namespace 'whatsNew' (Spanish). Must have exactly the keys of whatsNew.de.ts.
export const whatsNew = {
  title: 'Novedades de esta versión',
  version: 'Versión {version}',
  dismiss: 'Entendido',
  a11y: 'Novedades de esta versión, {count, plural, one {un elemento} other {# elementos}}',
  itemA11y: '{title}: {text}. Abrir',
  items: {
    liveCards: {
      title: 'Tarjetas en vivo',
      text: 'Listas y planes que Hermes mantiene al día en el chat',
      prompt: 'Llévame una lista de la compra para la barbacoa del sábado',
    },
    skills: { title: 'Skills', text: 'Mira lo que Hermes sabe hacer y lee cada skill' },
    memory: { title: 'Memoria', text: 'Lo que Hermes recuerda de ti, y cómo hacer que lo olvide' },
  },
} satisfies typeof de;
