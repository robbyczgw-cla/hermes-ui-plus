import type { compliance as de } from './compliance.de.ts';

// Namespace 'compliance' (English). Must have exactly the keys of compliance.de.ts.
export const compliance = {
  consent: {
    title: 'Where your messages go',
    body: 'Your messages and attachments are sent to your Hermes server and from there to the AI providers set up in Hermes (e.g. OpenAI, Anthropic, xAI). {appShort} keeps your chats, settings and keys only on this device and does not collect anything itself.',
    providers: 'Voice: dictation and read-aloud use the bridge\'s speech services or the provider whose API key you entered yourself – the audio or text then goes directly there. The device voice and on-device recognition run on your device; depending on your system, the operating system\'s speech recognition may use its own online service. Image searches go to the configured search provider.',
    accept: 'Got it, continue',
    later: 'Later',
    privacy: 'Privacy policy',
  },
  report: {
    action: 'Report',
    title: 'Report answer',
    lead: 'What is wrong with this answer?',
    reasons: {
      offensive: 'Offensive/Harmful',
      wrong: 'Wrong/Misleading',
      legal: 'Legally questionable',
      other: 'Other',
    },
    commentLabel: 'Comment (optional)',
    commentPlaceholder: 'What did you notice?',
    submit: 'Report',
    doneTitle: 'Thanks for reporting',
    doneText: 'The answer is now hidden. The report is only stored on this device.',
    sendDev: 'Send to developer',
    sendDevHint: 'Opens your mail app with a prepared message. Nothing is sent automatically.',
    includeExcerpt: 'Include an excerpt of the answer (max. 500 characters)',
    done: 'Done',
    hidden: 'Reported – show?',
    hiddenA11y: 'Reported answer, hidden. Tap to show.',
    undo: 'Withdraw report',
    noMail: 'No mail app found. Write to {email}.',
    mail: {
      subject: 'Reported AI answer ({appShort})',
      intro: 'I am reporting an AI answer shown in {appShort}.',
      reason: 'Reason',
      version: 'App version',
      comment: 'Comment',
      excerpt: 'Excerpt of the answer',
      note: 'The answer comes from the AI provider set up in my Hermes server.',
    },
  },
} satisfies typeof de;
