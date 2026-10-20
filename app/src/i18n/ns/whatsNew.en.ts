import type { whatsNew as de } from './whatsNew.de.ts';

// Namespace 'whatsNew' (English). Must have exactly the keys of whatsNew.de.ts.
export const whatsNew = {
  title: 'New in this version',
  version: 'Version {version}',
  dismiss: 'Got it',
  a11y: 'New in this version, {count, plural, one {one item} other {# items}}',
  itemA11y: '{title}: {text}. Open',
  items: {
    liveCards: {
      title: 'Live cards',
      text: 'Lists and plans Hermes keeps up to date in the chat',
      prompt: "Keep a shopping list for Saturday's barbecue",
    },
    skills: { title: 'Skills', text: 'See what Hermes can do, and read each skill' },
    memory: { title: 'Memory', text: 'What Hermes remembers about you, and how to make it forget' },
  },
} satisfies typeof de;
