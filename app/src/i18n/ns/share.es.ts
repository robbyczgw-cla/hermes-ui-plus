import type { share as de } from './share.de.ts';

// Namespace 'share' (Spanish). Must have exactly the keys of share.de.ts.
export const share = {
  sheet: {
    title: 'Enviar a {appShort}',
    kinds: {
      link: 'Enlace',
      text: 'Texto',
      image: '{count, plural, one {# imagen} other {# imágenes}}',
      file: '{count, plural, one {# archivo} other {# archivos}}',
      mixed: '{count, plural, one {# adjunto} other {# adjuntos}}',
    },
    more: '+{count} más',
    target: 'Enviar a',
    newChat: 'Chat nuevo',
    lastChat: 'Último chat',
    lastChatA11y: 'Último chat: {title}',
    untitled: 'Chat sin título',
    connection: 'Conexión',
    intents: '¿Qué debe hacer {appShort}?',
    note: 'Tu instrucción',
    notePlaceholder: 'Tu instrucción (opcional), p. ej. solo los tres puntos clave',
    refused: 'No se envía',
    truncated: 'El texto era muy largo y se ha acortado.',
    nothing: 'Nada de esto se puede enviar. Escribe una instrucción o cancela.',
    unreadable: 'No se pudo abrir «{name}». Vuelve a compartirlo desde la app o guárdalo primero.',
  },
  intents: {
    summarize: 'Resumir',
    explain: '¿Qué es esto?',
    translate: 'Traducir',
    save: 'Guardar para después',
  },
  prompts: {
    summarize: 'Resume esto brevemente.',
    explain: '¿Qué es esto? Explícamelo brevemente.',
    translate: 'Tradúcelo al español.',
    save: 'Recuerda esto para después. Solo confirma brevemente que lo has guardado.',
  },
  pair: {
    title: 'Primero conecta con Hermes',
    text: '{appShort} todavía no está conectado a ningún Hermes Agent. Conecta la app y luego sigues aquí con lo que compartiste.',
    connect: 'Conectar',
  },
  composer: {
    kept: 'Lo que compartiste está en el campo de texto. Revísalo y toca Enviar.',
    noFiles: 'Esta conexión no acepta archivos. Solo se ha añadido el texto.',
  },
  intake: {
    failed: 'No se pudo leer el contenido compartido. Inténtalo de nuevo.',
    missed: 'Lo compartido no llegó. Abre {appShort} una vez y vuelve a compartir.',
  },
} satisfies typeof de;
