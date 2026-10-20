// Namespace 'whatsNew' (German, source of truth): the "Neu in dieser Version" sheet (whatsnew/). One entry per item
// id of whatsnew/model.ts WHATS_NEW; `prompt` of liveCards is the demo's live-list request (onboarding/demo/prompts.ts).
export const whatsNew = {
  title: 'Neu in dieser Version',
  version: 'Version {version}',
  dismiss: 'Verstanden',
  a11y: 'Neu in dieser Version, {count, plural, one {ein Eintrag} other {# Einträge}}',
  itemA11y: '{title}: {text}. Öffnen',
  items: {
    liveCards: {
      title: 'Live-Karten',
      text: 'Listen und Pläne, die Hermes im Chat aktuell hält',
      prompt: 'Führ mir eine Einkaufsliste fürs Grillen am Samstag',
    },
    skills: { title: 'Skills', text: 'Sieh nach, was Hermes kann, und lies jeden Skill nach' },
    memory: { title: 'Gedächtnis', text: 'Was Hermes sich über dich gemerkt hat, und wie es etwas vergisst' },
  },
};
