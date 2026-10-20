import type { compliance as de } from './compliance.de.ts';

// Namespace 'compliance' (Spanish). Must have exactly the keys of compliance.de.ts.
export const compliance = {
  consent: {
    title: 'A dónde van tus mensajes',
    body: 'Tus mensajes y archivos adjuntos se envían a tu servidor Hermes y, desde allí, a los proveedores de IA configurados en Hermes (p. ej. OpenAI, Anthropic, xAI). Hermes también guarda las conversaciones en tu servidor para que el agente pueda continuarlas y recordar cosas. {appShort} guarda su copia de tus chats, además de ajustes y claves, en este dispositivo y no recopila nada por sí misma.',
    providers: 'Voz: el dictado y la lectura en voz alta usan los servicios de voz del bridge o el proveedor cuya clave API introdujiste tú; el audio o el texto van entonces directamente allí. La voz del dispositivo y el reconocimiento local se ejecutan en tu dispositivo; según el sistema, el reconocimiento de voz del sistema operativo puede usar su propio servicio en línea. Las búsquedas de imágenes van al proveedor de búsqueda configurado.',
    accept: 'Entendido, continuar',
    later: 'Más tarde',
    privacy: 'Política de privacidad',
  },
  report: {
    action: 'Denunciar',
    title: 'Denunciar respuesta',
    lead: '¿Qué problema tiene esta respuesta?',
    reasons: {
      offensive: 'Ofensiva/Peligrosa',
      wrong: 'Incorrecta/Engañosa',
      legal: 'Problema legal',
      other: 'Otro',
    },
    commentLabel: 'Comentario (opcional)',
    commentPlaceholder: '¿Qué has notado?',
    submit: 'Denunciar',
    doneTitle: 'Gracias por avisar',
    doneText: 'La respuesta está oculta. La denuncia solo se guarda en este dispositivo.',
    sendDev: 'Enviar al desarrollador',
    sendDevHint: 'Abre tu app de correo con un mensaje preparado. No se envía nada automáticamente.',
    includeExcerpt: 'Incluir un extracto de la respuesta (máx. 500 caracteres)',
    done: 'Listo',
    hidden: 'Denunciada – ¿mostrar?',
    hiddenA11y: 'Respuesta denunciada, oculta. Toca para mostrarla.',
    undo: 'Retirar denuncia',
    noMail: 'No se encontró ninguna app de correo. Escribe a {email}.',
    mail: {
      subject: 'Respuesta de IA denunciada ({appShort})',
      intro: 'Denuncio una respuesta de IA mostrada en {appShort}.',
      reason: 'Motivo',
      version: 'Versión de la app',
      comment: 'Comentario',
      excerpt: 'Extracto de la respuesta',
      note: 'La respuesta procede del proveedor de IA configurado en mi servidor Hermes.',
    },
  },
} satisfies typeof de;
