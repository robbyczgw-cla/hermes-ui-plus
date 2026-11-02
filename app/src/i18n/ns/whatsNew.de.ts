// Namespace 'whatsNew' (German, source of truth): the "Neu in dieser Version" sheet (whatsnew/). One entry per item
// id of whatsnew/model.ts WHATS_NEW; `prompt` of liveCards is the demo's live-list request (onboarding/demo/prompts.ts).
export const whatsNew = {
  title: 'Neu in dieser Version',
  version: 'Version {version}',
  dismiss: 'Verstanden',
  a11y: 'Neu in dieser Version, {count, plural, one {ein Eintrag} other {# Einträge}}',
  itemA11y: '{title}: {text}. Öffnen',
  itemInfoA11y: '{title}: {text}',
  items: {
    liveCards: {
      title: 'Live-Karten',
      text: 'Listen und Pläne, die Hermes im Chat aktuell hält',
      prompt: 'Führ mir eine Einkaufsliste fürs Grillen am Samstag',
    },
    skills: { title: 'Skills', text: 'Sieh nach, was Hermes kann, und lies jeden Skill nach' },
    memory: { title: 'Gedächtnis', text: 'Was Hermes sich über dich gemerkt hat, und wie es etwas vergisst' },
    botTimeline: { title: 'Eine Zeitleiste pro Bot', text: 'Zustellungen von Hermes und dein Gespräch mit dem Bot, in zeitlicher Reihenfolge' },
    replies: { title: 'Zitieren, Entwurf, Leseposition', text: 'Auf einzelne Nachrichten antworten. Jeder Chat behält seinen Entwurf und deine Leseposition' },
    botAbout: { title: 'Über und Hintergrundarbeit', text: 'Sieh, was ein Bot im Hintergrund tut, mit Stopp. „Über“ zeigt Gedächtnis, Skills, Routinen und Berechtigungen' },
    pdfViewer: { title: 'PDFs in der Web-App', text: 'PDFs öffnen sich im eingebauten Viewer, mit Sichern' },
  },
};
