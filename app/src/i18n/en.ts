import type { de } from './de.ts';
import { settings as settingsNS } from './ns/settings.en.ts';
import { onboarding as onboardingNS } from './ns/onboarding.en.ts';
import { chat as chatNS } from './ns/chat.en.ts';
import { voice as voiceNS } from './ns/voice.en.ts';
import { approvals as approvalsNS } from './ns/approvals.en.ts';
import { attachments as attachmentsNS } from './ns/attachments.en.ts';
import { sandbox as sandboxNS } from './ns/sandbox.en.ts';
import { conversations as conversationsNS } from './ns/conversations.en.ts';
import { actions as actionsNS } from './ns/actions.en.ts';
import { backends as backendsNS } from './ns/backends.en.ts';
import { ui as uiNS } from './ns/ui.en.ts';
import { waiting as waitingNS } from './ns/waiting.en.ts';
import { imageEdit as imageEditNS } from './ns/imageEdit.en.ts';
import { push as pushNS } from './ns/push.en.ts';
import { hermesTools as hermesToolsNS } from './ns/hermesTools.en.ts';
import { slash as slashNS } from './ns/slash.en.ts';
import { compliance as complianceNS } from './ns/compliance.en.ts';
import { menus as menusNS } from './ns/menus.en.ts';
import { desktop as desktopNS } from './ns/desktop.en.ts';
import { bots as botsNS } from './ns/bots.en.ts';
import { quick as quickNS } from './ns/quick.en.ts';
import { support as supportNS } from './ns/support.en.ts';
import { share as shareNS } from './ns/share.en.ts';

type Dict = typeof de;

export const en = {
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
    send: 'Send',
    cancel: 'Cancel',
    copy: 'Copy',
    copied: 'Copied',
    share: 'Share',
    retry: 'Try again',
    close: 'Close',
    ok: 'OK',
    save: 'Save',
    delete: 'Delete',
  },
  errors: {
    network: 'Network error. Please check your connection.',
    auth: 'Authentication failed. Please check your API key.',
    timeout: 'Timed out. The server is not responding.',
    unknown: 'Unknown error: {message}',
  },
  language: {
    label: 'Language',
    de: 'Deutsch',
    en: 'English',
    es: 'Español',
  },
} satisfies Dict;
