import type { approvals as de } from './approvals.de.ts';

// Namespace 'approvals' (Spanish). Keys: <area>.<element>. See ../README.md.
export const approvals = {
  title: {
    blocked: 'Hermes ha sido bloqueado',
    request: 'Hermes quiere ejecutar algo',
  },
  risk: {
    flagged: 'Hermes lo marcó como peligroso',
    high: 'Riesgo alto (estimado)',
    elevated: 'Riesgo elevado (estimado)',
    normal: 'Se necesita confirmación',
    short: {
      high: 'Riesgo alto',
      elevated: 'Riesgo elevado',
    },
    byApp: 'estimado por la app, no por Hermes',
  },
  choice: {
    once: {
      label: 'Permitir una vez',
      hint: 'Solo este comando',
      a11y: 'Permitir este comando una vez',
    },
    session: {
      label: 'Para esta tarea',
      hint: 'Comandos similares solo hasta que termine esta respuesta – el próximo mensaje vuelve a preguntar',
      a11y: 'Permitir comandos similares solo para esta tarea',
    },
    always: {
      label: 'Permitir siempre (en todas partes, también Telegram)',
      hint: 'Lista global de permisos de Hermes: también se aplica a Telegram y cron',
      a11y: 'Permitir comandos similares de forma permanente y en todas partes, también en Telegram y cron',
    },
    deny: {
      label: 'Rechazar',
      a11y: 'Rechazar este comando',
    },
    retry: '{label} – intentar de nuevo',
    more: 'Más opciones',
    less: 'Menos opciones',
  },
  confirm: {
    title: '¿Permitir siempre de verdad?',
    body: 'El patrón se añade de forma permanente a la lista global de permisos de Hermes. Los comandos similares se ejecutarán sin preguntar, también en Telegram y en tareas cron.',
    yes: 'Sí, permitir siempre en todas partes',
    back: 'Volver',
  },
  error: {
    notPending: 'Esta solicitud ya se ha respondido o ha caducado.',
    runEnded: 'La ejecución ya ha terminado. La solicitud ya no está abierta.',
    auth: 'El inicio de sesión ha fallado. Revisa tu clave de API, por favor.',
    network: 'Sin conexión con Hermes. La respuesta no se ha enviado.',
    busy: 'Hermes está ocupado en este momento. Inténtalo de nuevo, por favor.',
    generic: 'No se pudo enviar la respuesta.',
    expired: 'Demasiado tarde: el plazo ha vencido y Hermes ya lo ha rechazado. No se ha enviado ninguna respuesta.',
  },
  countdown: {
    expired: 'Caducado – rechazado',
    expiredNote: 'Hermes lo rechazó automáticamente al vencer el plazo. Ya no se puede responder.',
    left: 'Plazo aprox. {time}',
    leftExact: 'Plazo {time}',
    spoken: 'Tiempo restante, aprox. {minutes, plural, =0 {} one {# minuto } other {# minutos }}{seconds, plural, one {# segundo} other {# segundos}}',
  },
  reason: {
    label: 'Motivo según Hermes',
  },
  stack: {
    position: 'Aprobación {index} de {total}',
    prev: 'Aprobación anterior',
    next: 'Aprobación siguiente',
    announceNew: 'Nueva solicitud de aprobación. {count} pendientes.',
    chip: '{count, plural, one {Hermes espera una aprobación} other {Hermes espera # aprobaciones}}',
    chipA11y: '{count, plural, one {Hermes espera una aprobación, abrir} other {Hermes espera # aprobaciones, abrir}}',
    badge: '{count} pendientes',
  },
  history: {
    title: 'Aprobaciones',
    once: 'Permitido (una vez)',
    session: 'Permitido (para esta tarea)',
    always: 'Siempre permitido (en todas partes)',
    deny: 'Rechazado',
    expired: 'Caducado – rechazado',
    cancelled: 'Sin respuesta – ejecución terminada',
    a11y: '{label}: {command}',
  },
  sheet: {
    announce: 'Se requiere aprobación. {text}',
    a11y: 'Se requiere aprobación. {risk}.',
    dismiss: 'Ocultar. Hermes sigue esperando tu respuesta.',
    sent: 'Respuesta enviada',
    close: 'Cerrar',
  },
  command: {
    unusual: 'El comando contiene caracteres inusuales',
    unusualHint: 'Los caracteres de control invisibles se muestran como códigos \\u…; los caracteres no ASCII pueden parecer normales. Revisa el comando con atención.',
    label: '{count, plural, =1 {Comando} other {Comando · # líneas}}',
    a11y: 'Comando: {command}',
    copy: 'Copiar',
    copied: 'Copiado',
    copyA11y: 'Copiar comando',
    copiedA11y: 'Comando copiado',
  },
  demo: {
    theme: {
      system: 'Sistema',
      light: 'Claro',
      dark: 'Oscuro',
    },
    samples: {
      full: {
        title: 'Todas las opciones, riesgo normal',
        description: 'Ejecutar comando de shell (listar archivos)',
      },
      danger: {
        title: 'Peligroso, varias líneas, el envío falla una vez',
        description: 'Borra directorios de forma recursiva y ejecuta un script descargado con privilegios de root',
      },
      smart: {
        title: 'Denegado automáticamente (solo Permitir una vez / Rechazar), solicitud ya caducada (409)',
        description: 'Fuerza un push a la rama principal',
      },
    },
    log: 'Respuesta: {choice}',
    hidden: 'Oculto',
    again: 'Mostrar de nuevo',
  },
} satisfies typeof de;
