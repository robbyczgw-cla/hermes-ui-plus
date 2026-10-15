import type { bots as de } from './bots.de.ts';

// Namespace 'bots' (English). Must have exactly the keys of bots.de.ts.
export const bots = {
  picker: {
    section: 'Bot',
    default: 'Default',
    a11y: '{name}, model {model}',
    newChat: 'New chat with {name}',
  },
  settings: {
    title: 'Hermes profiles (bots)',
    field: 'Bots',
    placeholder: 'e.g. research, work',
    footnote:
      'Bots are Hermes profiles: own model, memory and skills. Names as in "hermes profile create", separated by commas. Through the UI bridge they appear by themselves. Pick the bot in a chat from the model menu.',
    invalid: 'Ignored (lowercase letters, digits, - and _ only): {names}',
  },
  drawer: {
    badgeA11y: 'Bot {name}',
  },
} satisfies typeof de;
