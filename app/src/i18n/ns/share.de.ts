// Namespace 'share' (German, source of truth): "Teilen an HUI+" – the sheet for content shared from other apps
// (share/ShareSheet.tsx), the hand-off to the composer and intake notices.
export const share = {
  sheet: {
    title: 'An {appShort} senden',
    kinds: {
      link: 'Link',
      text: 'Text',
      image: '{count, plural, one {# Bild} other {# Bilder}}',
      file: '{count, plural, one {# Datei} other {# Dateien}}',
      mixed: '{count, plural, one {# Anhang} other {# Anhänge}}',
    },
    more: '+{count} weitere',
    target: 'Senden an',
    newChat: 'Neuer Chat',
    lastChat: 'Letzter Chat',
    lastChatA11y: 'Letzter Chat: {title}',
    untitled: 'Chat ohne Titel',
    connection: 'Verbindung',
    intents: 'Was soll {appShort} tun?',
    note: 'Eigene Anweisung',
    notePlaceholder: 'Eigene Anweisung (optional), z. B. nur die drei wichtigsten Punkte',
    refused: 'Wird nicht mitgesendet',
    truncated: 'Der Text war sehr lang und wurde gekürzt.',
    nothing: 'Davon kann nichts gesendet werden. Schreib eine Anweisung oder brich ab.',
    unreadable: '„{name}“ ließ sich nicht öffnen. Teile es aus der App noch einmal oder speichere es zuerst.',
  },
  intents: {
    summarize: 'Zusammenfassen',
    explain: 'Was ist das?',
    translate: 'Übersetzen',
    save: 'Für später merken',
  },
  prompts: {
    summarize: 'Fasse das kurz zusammen.',
    explain: 'Was ist das? Erklär es mir kurz.',
    translate: 'Übersetze das ins Deutsche.',
    save: 'Merk dir das für später. Bestätige nur kurz, dass du es gespeichert hast.',
  },
  pair: {
    title: 'Erst mit Hermes verbinden',
    text: '{appShort} ist noch mit keinem Hermes Agent verbunden. Verbinde die App, danach geht es hier mit deinem geteilten Inhalt weiter.',
    connect: 'Verbinden',
  },
  composer: {
    kept: 'Der geteilte Inhalt steht im Eingabefeld. Prüf ihn und tippe auf Senden.',
    noFiles: 'Diese Verbindung nimmt keine Dateien an. Nur der Text wurde übernommen.',
  },
  intake: {
    failed: 'Der geteilte Inhalt konnte nicht gelesen werden. Versuch es noch einmal.',
    missed: 'Das Teilen ist nicht angekommen. Öffne {appShort} einmal und teile dann erneut.',
  },
};
