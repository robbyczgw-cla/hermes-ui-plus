import { settings as settingsNS } from './ns/settings.de.ts';
import { onboarding as onboardingNS } from './ns/onboarding.de.ts';
import { chat as chatNS } from './ns/chat.de.ts';
import { voice as voiceNS } from './ns/voice.de.ts';
import { approvals as approvalsNS } from './ns/approvals.de.ts';
import { attachments as attachmentsNS } from './ns/attachments.de.ts';
import { sandbox as sandboxNS } from './ns/sandbox.de.ts';
import { conversations as conversationsNS } from './ns/conversations.de.ts';
import { actions as actionsNS } from './ns/actions.de.ts';
import { backends as backendsNS } from './ns/backends.de.ts';
import { ui as uiNS } from './ns/ui.de.ts';
import { waiting as waitingNS } from './ns/waiting.de.ts';
import { imageEdit as imageEditNS } from './ns/imageEdit.de.ts';
import { push as pushNS } from './ns/push.de.ts';
import { hermesTools as hermesToolsNS } from './ns/hermesTools.de.ts';
import { slash as slashNS } from './ns/slash.de.ts';
import { compliance as complianceNS } from './ns/compliance.de.ts';
import { menus as menusNS } from './ns/menus.de.ts';
import { desktop as desktopNS } from './ns/desktop.de.ts';
import { bots as botsNS } from './ns/bots.de.ts';
import { quick as quickNS } from './ns/quick.de.ts';
import { support as supportNS } from './ns/support.de.ts';
import { share as shareNS } from './ns/share.de.ts';

// German dictionary = source of truth for keys. en.ts must satisfy `typeof de`.
// Plural syntax inside values: {count, plural, one {# Minute} other {# Minuten}}  (see README).
export const de = {
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
  support: supportNS,
  share: shareNS,
  actions: {
    send: 'Senden',
    cancel: 'Abbrechen',
    copy: 'Kopieren',
    copied: 'Kopiert',
    share: 'Teilen',
    retry: 'Erneut versuchen',
    close: 'Schließen',
    ok: 'OK',
    save: 'Speichern',
    delete: 'Löschen',
  },
  errors: {
    network: 'Netzwerkfehler. Bitte Verbindung prüfen.',
    auth: 'Authentifizierung fehlgeschlagen. Bitte API-Schlüssel prüfen.',
    timeout: 'Zeitüberschreitung. Der Server antwortet nicht.',
    unknown: 'Unbekannter Fehler: {message}',
  },
  language: {
    label: 'Sprache',
    de: 'Deutsch',
    en: 'English',
    es: 'Español',
  },
};
