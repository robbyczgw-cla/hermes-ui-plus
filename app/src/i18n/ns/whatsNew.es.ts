import type { whatsNew as de } from './whatsNew.de.ts';

// Namespace 'whatsNew' (Spanish). Must have exactly the keys of whatsNew.de.ts.
export const whatsNew = {
  title: 'Novedades de esta versión',
  version: 'Versión {version}',
  dismiss: 'Entendido',
  a11y: 'Novedades de esta versión, {count, plural, one {un elemento} other {# elementos}}',
  itemA11y: '{title}: {text}. Abrir',
  itemInfoA11y: '{title}: {text}',
  items: {
    liveCards: {
      title: 'Tarjetas en vivo',
      text: 'Listas y planes que Hermes mantiene al día en el chat',
      prompt: 'Llévame una lista de la compra para la barbacoa del sábado',
    },
    skills: { title: 'Skills', text: 'Mira lo que Hermes sabe hacer y lee cada skill' },
    memory: { title: 'Memoria', text: 'Lo que Hermes recuerda de ti, y cómo hacer que lo olvide' },
    botTimeline: { title: 'Una línea de tiempo por bot', text: 'Lo que Hermes entrega y tu conversación con el bot, en orden cronológico' },
    replies: { title: 'Citas, borradores, posición de lectura', text: 'Responde a un mensaje concreto. Cada chat conserva su borrador y tu posición de lectura' },
    botAbout: { title: 'Acerca de y trabajo en segundo plano', text: 'Mira qué hace un bot en segundo plano, con Detener. Acerca de muestra su memoria, skills, rutinas y permisos' },
    pdfViewer: { title: 'PDF en la app web', text: 'Los PDF se abren en un visor integrado, con Guardar' },
  },
} satisfies typeof de;
