import type { whatsNew as de } from './whatsNew.de.ts';

// Namespace 'whatsNew' (English). Must have exactly the keys of whatsNew.de.ts.
export const whatsNew = {
  title: 'New in this version',
  version: 'Version {version}',
  dismiss: 'Got it',
  a11y: 'New in this version, {count, plural, one {one item} other {# items}}',
  itemA11y: '{title}: {text}. Open',
  itemInfoA11y: '{title}: {text}',
  items: {
    liveCards: {
      title: 'Live cards',
      text: 'Lists and plans Hermes keeps up to date in the chat',
      prompt: "Keep a shopping list for Saturday's barbecue",
    },
    skills: { title: 'Skills', text: 'See what Hermes can do, and read each skill' },
    memory: { title: 'Memory', text: 'What Hermes remembers about you, and how to make it forget' },
    botTimeline: { title: 'One timeline per bot', text: 'What Hermes delivers and your conversation with the bot, in time order' },
    replies: { title: 'Quotes, drafts, reading position', text: 'Reply to a single message. Every chat keeps its draft and your reading position' },
    botAbout: { title: 'About and background work', text: 'See what a bot does in the background, with Stop. About shows its memory, skills, routines and permissions' },
    pdfViewer: { title: 'PDFs in the web app', text: 'PDFs open in a built-in viewer, with Save' },
  },
} satisfies typeof de;
