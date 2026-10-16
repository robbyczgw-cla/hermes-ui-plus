import type { share as de } from './share.de.ts';

// Namespace 'share' (English). Must have exactly the keys of share.de.ts.
export const share = {
  sheet: {
    title: 'Send to {appShort}',
    kinds: {
      link: 'Link',
      text: 'Text',
      image: '{count, plural, one {# image} other {# images}}',
      file: '{count, plural, one {# file} other {# files}}',
      mixed: '{count, plural, one {# attachment} other {# attachments}}',
    },
    more: '+{count} more',
    target: 'Send to',
    newChat: 'New chat',
    lastChat: 'Last chat',
    lastChatA11y: 'Last chat: {title}',
    untitled: 'Untitled chat',
    connection: 'Connection',
    intents: 'What should {appShort} do?',
    note: 'Your instruction',
    notePlaceholder: 'Own instruction (optional), e.g. only the three key points',
    refused: 'Not sent along',
    truncated: 'The text was very long and has been shortened.',
    nothing: 'None of this can be sent. Write an instruction or cancel.',
    unreadable: '"{name}" could not be opened. Share it from the app again, or save it first.',
  },
  intents: {
    summarize: 'Summarize',
    explain: 'What is this?',
    translate: 'Translate',
    save: 'Save for later',
  },
  prompts: {
    summarize: 'Summarize this briefly.',
    explain: 'What is this? Explain it to me briefly.',
    translate: 'Translate this into English.',
    save: 'Remember this for later. Just confirm briefly that you saved it.',
  },
  pair: {
    title: 'Connect to Hermes first',
    text: '{appShort} is not connected to a Hermes Agent yet. Connect the app, then you continue here with what you shared.',
    connect: 'Connect',
  },
  composer: {
    kept: 'What you shared is in the input field. Check it and tap Send.',
    noFiles: 'This connection does not take files. Only the text was added.',
  },
  intake: {
    failed: 'The shared content could not be read. Please try again.',
    missed: 'The share did not arrive. Open {appShort} once, then share again.',
  },
} satisfies typeof de;
