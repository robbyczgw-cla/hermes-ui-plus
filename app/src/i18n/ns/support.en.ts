import type { support as de } from './support.de.ts';

// Namespace 'support' (English): "Report a problem" and the update notice (app/src/support). Must have exactly the keys of support.de.ts.
export const support = {
  report: {
    row: 'Report a problem',
    rowSub: 'Opens a prepared GitHub issue. You see exactly what will be sent first.',
    title: 'Report a problem',
    intro: 'Only these technical details go into a new GitHub issue: no server addresses, keys or messages. You describe the problem yourself on GitHub afterwards.',
    open: 'Open on GitHub',
    copy: 'Copy instead',
    copied: 'Report copied',
    openFailed: 'Could not open the browser. The report was copied.',
    fromError: 'Report a problem',
  },
  update: {
    setting: 'Check for updates',
    settingSub: 'Asks GitHub for a new version at most once a day. No data about you is sent.',
    available: 'Update available: {version}',
    apk: 'Download the new APK from GitHub, or let Obtainium update the app automatically.',
    release: 'Open the release page on GitHub.',
    web: "Update your bridge's web bundle, then reload this page.",
    toast: '{appShort} {version} is available. More in Settings → About.',
  },
} satisfies typeof de;
