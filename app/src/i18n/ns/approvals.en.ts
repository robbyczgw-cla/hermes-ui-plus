import type { approvals as de } from './approvals.de.ts';

// Namespace 'approvals' (English). Must have exactly the keys of approvals.de.ts.
export const approvals = {
  title: {
    blocked: 'Hermes was blocked',
    request: 'Hermes wants to run something',
  },
  risk: {
    flagged: 'Flagged as dangerous by Hermes',
    high: 'High risk (estimate)',
    elevated: 'Elevated risk (estimate)',
    estimateNote: 'Risk estimated by the app, not by Hermes',
    normal: 'Confirmation needed',
  },
  choice: {
    once: {
      label: 'Allow once',
      hint: 'This one command only',
      a11y: 'Allow this command once',
    },
    session: {
      label: 'For this task',
      hint: 'Similar commands only until this answer is done – the next message asks again',
      a11y: 'Allow similar commands for this task only',
    },
    always: {
      label: 'Always allow (everywhere, incl. Telegram)',
      hint: 'Hermes\' global allowlist – also applies to Telegram and cron',
      a11y: 'Allow similar commands permanently and everywhere, including Telegram and cron',
    },
    deny: {
      label: 'Deny',
      a11y: 'Deny this command',
    },
    retry: '{label} – try again',
  },
  confirm: {
    title: 'Really always allow?',
    body: 'The pattern is added permanently to Hermes\' global allowlist. Similar commands then run without asking – also in Telegram and cron jobs.',
    yes: 'Yes, always allow everywhere',
    back: 'Back',
  },
  error: {
    notPending: 'This request was already answered or has expired.',
    runEnded: 'The run has already ended. This request is no longer open.',
    auth: 'Sign-in failed. Please check your API key.',
    network: 'No connection to Hermes. The answer was not sent.',
    busy: 'Hermes is busy right now. Please try again.',
    generic: 'The answer could not be sent.',
    expired: 'Too late: the deadline passed and Hermes has already denied it. No answer was sent.',
  },
  countdown: {
    expired: 'Expired – denied',
    expiredNote: 'Hermes denied automatically when the deadline passed. Answering is no longer possible.',
    left: 'Deadline approx. {time}',
    leftExact: 'Deadline {time}',
    spoken: 'About {minutes, plural, =0 {} one {# minute } other {# minutes }}{seconds, plural, one {# second} other {# seconds}} remaining',
  },
  reason: {
    label: 'Reason given by Hermes',
  },
  stack: {
    position: 'Approval {index} of {total}',
    prev: 'Previous approval',
    next: 'Next approval',
    announceNew: 'New approval request. {count} open.',
    chip: '{count, plural, one {Hermes is waiting for approval} other {Hermes is waiting for # approvals}}',
    chipA11y: '{count, plural, one {Hermes is waiting for an approval, open} other {Hermes is waiting for # approvals, open}}',
    badge: '{count} open',
  },
  history: {
    title: 'Approvals',
    once: 'Allowed (once)',
    session: 'Allowed (for this task)',
    always: 'Always allowed (everywhere)',
    deny: 'Denied',
    expired: 'Expired – denied',
    cancelled: 'Not answered – run ended',
    a11y: '{label}: {command}',
  },
  sheet: {
    announce: 'Approval required. {text}',
    a11y: 'Approval required. {risk}.',
    dismiss: 'Hide. Hermes keeps waiting for your answer.',
    sent: 'Answer sent',
    close: 'Close',
  },
  command: {
    unusual: 'Command contains unusual characters',
    unusualHint: 'Invisible control characters are shown as \\u… codes; non-ASCII characters can look like normal ones. Check the command carefully.',
    label: '{count, plural, =1 {COMMAND} other {COMMAND · # lines}}',
    a11y: 'Command: {command}',
    copy: 'Copy',
    copied: 'Copied',
    copyA11y: 'Copy command',
    copiedA11y: 'Command copied',
  },
  demo: {
    theme: {
      system: 'System',
      light: 'Light',
      dark: 'Dark',
    },
    samples: {
      full: {
        title: 'All options, normal risk',
        description: 'Run shell command (list files)',
      },
      danger: {
        title: 'Dangerous, multi-line, send fails once',
        description: 'Deletes directories recursively and runs a downloaded script with root privileges',
      },
      smart: {
        title: 'Smart-denied (only Once / Deny), request already gone (409)',
        description: 'Forces a push to the main branch',
      },
    },
    log: 'Answer: {choice}',
    hidden: 'Hidden',
    again: 'Show again',
  },
} satisfies typeof de;
