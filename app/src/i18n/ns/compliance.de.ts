// Namespace 'compliance' (German, source of truth): AI data-sharing consent (Apple 5.1.2(i)) and
// "Antwort melden" (Google Play AI-generated content policy). See src/compliance/ and docs/STORE.md.
// Changing any consent.* text below → bump AI_CONSENT_VERSION + CONSENT_TEXT_FINGERPRINT (src/compliance/consent.ts).
export const compliance = {
  consent: {
    title: 'Wohin deine Nachrichten gehen',
    body: 'Deine Nachrichten und Anhänge werden an deinen Hermes-Server gesendet und von dort an die KI-Anbieter, die in Hermes eingerichtet sind (z. B. OpenAI, Anthropic, xAI). {appShort} speichert deine Chats, Einstellungen und Schlüssel nur auf diesem Gerät und sammelt selbst nichts.',
    providers: 'Sprache: Diktat und Vorlesen laufen über die Sprachdienste der Bridge oder über den Anbieter, dessen API-Schlüssel du selbst eingetragen hast – Audio bzw. Text gehen dann direkt dorthin. Gerätestimme und Geräte-Erkennung laufen auf deinem Gerät; je nach System kann die Spracherkennung des Betriebssystems einen eigenen Online-Dienst nutzen. Bildersuchen gehen an den eingestellten Suchanbieter.',
    accept: 'Verstanden & weiter',
    later: 'Später',
    privacy: 'Datenschutzerklärung',
    needed: 'Bitte zuerst den Hinweis zur Datenweitergabe bestätigen.',
  },
  report: {
    more: 'Weitere Aktionen',
    action: 'Melden',
    actionA11y: 'Antwort melden',
    title: 'Antwort melden',
    lead: 'Was stimmt mit dieser Antwort nicht?',
    reasons: {
      offensive: 'Anstößig/Gefährlich',
      wrong: 'Falsch/Irreführend',
      legal: 'Rechtlich bedenklich',
      other: 'Sonstiges',
    },
    commentLabel: 'Kommentar (optional)',
    commentPlaceholder: 'Was ist dir aufgefallen?',
    submit: 'Melden',
    doneTitle: 'Danke für die Meldung',
    doneText: 'Die Antwort ist jetzt ausgeblendet. Die Meldung ist nur auf diesem Gerät gespeichert.',
    sendDev: 'An Entwickler senden',
    sendDevHint: 'Öffnet deine Mail-App mit einer vorbereiteten Nachricht. Es wird nichts automatisch gesendet.',
    includeExcerpt: 'Auszug der Antwort mitsenden (max. 500 Zeichen)',
    done: 'Fertig',
    hidden: 'Gemeldet – anzeigen?',
    hiddenA11y: 'Gemeldete Antwort, ausgeblendet. Tippen zum Anzeigen.',
    undo: 'Meldung zurücknehmen',
    noMail: 'Keine Mail-App gefunden. Schreib an {email}.',
    mail: {
      subject: 'Gemeldete KI-Antwort ({appShort})',
      intro: 'Ich melde eine KI-Antwort, die in {appShort} angezeigt wurde.',
      reason: 'Grund',
      version: 'App-Version',
      comment: 'Kommentar',
      excerpt: 'Auszug der Antwort',
      note: 'Die Antwort stammt vom KI-Anbieter, der in meinem Hermes-Server eingerichtet ist.',
    },
  },
};
