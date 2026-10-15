import type { de } from './de.ts';
import { settings as settingsNS } from './ns/settings.es.ts';
import { onboarding as onboardingNS } from './ns/onboarding.es.ts';
import { chat as chatNS } from './ns/chat.es.ts';
import { voice as voiceNS } from './ns/voice.es.ts';
import { approvals as approvalsNS } from './ns/approvals.es.ts';
import { attachments as attachmentsNS } from './ns/attachments.es.ts';
import { sandbox as sandboxNS } from './ns/sandbox.es.ts';
import { conversations as conversationsNS } from './ns/conversations.es.ts';
import { actions as actionsNS } from './ns/actions.es.ts';
import { backends as backendsNS } from './ns/backends.es.ts';
import { ui as uiNS } from './ns/ui.es.ts';
import { waiting as waitingNS } from './ns/waiting.es.ts';
import { imageEdit as imageEditNS } from './ns/imageEdit.es.ts';
import { push as pushNS } from './ns/push.es.ts';
import { hermesTools as hermesToolsNS } from './ns/hermesTools.es.ts';
import { slash as slashNS } from './ns/slash.es.ts';
import { compliance as complianceNS } from './ns/compliance.es.ts';
import { menus as menusNS } from './ns/menus.es.ts';
import { desktop as desktopNS } from './ns/desktop.es.ts';
import { bots as botsNS } from './ns/bots.es.ts';
import { quick as quickNS } from './ns/quick.es.ts';

type Dict = typeof de;

export const es = {
  settings: settingsNS,
  onboarding: onboardingNS,
  chat: chatNS,
  voice: voiceNS,
  approvals: approvalsNS,
  attachments: attachmentsNS,
  sandbox: sandboxNS,
  conversations: conversationsNS,
  actionRunner: actionsNS,
  backends: backendsNS,
  ui: uiNS,
  waiting: waitingNS,
  imageEdit: imageEditNS,
  push: pushNS,
  hermesTools: hermesToolsNS,
  slash: slashNS,
  compliance: complianceNS,
  menus: menusNS,
  desktop: desktopNS,
  bots: botsNS,
  quick: quickNS,
  actions: {
    send: 'Enviar',
    cancel: 'Cancelar',
    copy: 'Copiar',
    copied: 'Copiado',
    share: 'Compartir',
    retry: 'Intentar de nuevo',
    close: 'Cerrar',
    ok: 'OK',
    save: 'Guardar',
    delete: 'Eliminar',
  },
  errors: {
    network: 'Error de red. Comprueba tu conexión.',
    auth: 'Error de autenticación. Revisa tu clave de API.',
    timeout: 'Se agotó el tiempo de espera. El servidor no responde.',
    unknown: 'Error desconocido: {message}',
  },
  time: {
    now: 'justo ahora',
    seconds: '{count, plural, one {# segundo} other {# segundos}}',
    minutes: '{count, plural, one {# minuto} other {# minutos}}',
    hours: '{count, plural, one {# hora} other {# horas}}',
    days: '{count, plural, one {# día} other {# días}}',
    ago: 'hace {value}',
  },
  language: {
    label: 'Idioma',
    system: 'Idioma del sistema',
    de: 'Deutsch',
    en: 'English',
    es: 'Español',
  },
} satisfies Dict;
