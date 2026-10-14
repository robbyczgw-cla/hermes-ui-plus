// Namespace 'approvals' (German, source of truth). Keys: <area>.<element>. See ../README.md.
export const approvals = {
  title: {
    blocked: 'Hermes wurde blockiert',
    request: 'Hermes möchte etwas ausführen',
  },
  risk: {
    flagged: 'Von Hermes als gefährlich eingestuft',
    high: 'Hohes Risiko (geschätzt)',
    elevated: 'Erhöhtes Risiko (geschätzt)',
    estimateNote: 'Risiko von der App geschätzt, nicht von Hermes',
    normal: 'Bestätigung nötig',
  },
  choice: {
    once: {
      label: 'Einmal erlauben',
      hint: 'Nur dieser eine Befehl',
      a11y: 'Diesen Befehl einmal erlauben',
    },
    session: {
      label: 'Für diesen Auftrag',
      hint: 'Gleichartige Befehle nur bis diese Antwort fertig ist – die nächste Nachricht fragt wieder',
      a11y: 'Gleichartige Befehle nur für diesen Auftrag erlauben',
    },
    always: {
      label: 'Immer erlauben (überall, auch Telegram)',
      hint: 'Globale Freigabeliste von Hermes – gilt auch für Telegram und Cron',
      a11y: 'Gleichartige Befehle dauerhaft und überall erlauben, auch in Telegram und Cron',
    },
    deny: {
      label: 'Ablehnen',
      a11y: 'Befehl ablehnen',
    },
    retry: '{label} – erneut versuchen',
  },
  confirm: {
    title: 'Wirklich immer erlauben?',
    body: 'Das Muster wird dauerhaft in die globale Freigabeliste von Hermes eingetragen. Gleichartige Befehle laufen dann ohne Nachfrage – auch in Telegram und bei Cron-Jobs.',
    yes: 'Ja, überall immer erlauben',
    back: 'Zurück',
  },
  error: {
    notPending: 'Diese Anfrage wurde schon beantwortet oder ist abgelaufen.',
    runEnded: 'Der Lauf ist bereits beendet. Die Anfrage ist nicht mehr offen.',
    auth: 'Anmeldung fehlgeschlagen. Bitte API-Key prüfen.',
    network: 'Keine Verbindung zu Hermes. Antwort wurde nicht gesendet.',
    busy: 'Hermes ist gerade ausgelastet. Bitte erneut versuchen.',
    generic: 'Antwort konnte nicht gesendet werden.',
    expired: 'Zu spät: Die Frist ist abgelaufen und Hermes hat bereits abgelehnt. Es wurde keine Antwort gesendet.',
  },
  countdown: {
    expired: 'Abgelaufen – abgelehnt',
    expiredNote: 'Hermes hat nach Ablauf der Frist automatisch abgelehnt. Eine Antwort ist nicht mehr möglich.',
    left: 'Frist ca. {time}',
    leftExact: 'Frist {time}',
    spoken: 'Verbleibende Zeit etwa {minutes, plural, =0 {} one {# Minute } other {# Minuten }}{seconds, plural, one {# Sekunde} other {# Sekunden}}',
  },
  reason: {
    label: 'Grund laut Hermes',
  },
  stack: {
    position: 'Freigabe {index} von {total}',
    prev: 'Vorherige Freigabe',
    next: 'Nächste Freigabe',
    announceNew: 'Neue Freigabe-Anfrage. {count} offen.',
    chip: '{count, plural, one {Hermes wartet auf Freigabe} other {Hermes wartet auf # Freigaben}}',
    chipA11y: '{count, plural, one {Hermes wartet auf eine Freigabe, öffnen} other {Hermes wartet auf # Freigaben, öffnen}}',
    badge: '{count} offen',
  },
  history: {
    title: 'Freigaben',
    once: 'Erlaubt (einmal)',
    session: 'Erlaubt (für diesen Auftrag)',
    always: 'Immer erlaubt (überall)',
    deny: 'Abgelehnt',
    expired: 'Abgelaufen – abgelehnt',
    cancelled: 'Nicht beantwortet – Lauf beendet',
    a11y: '{label}: {command}',
  },
  sheet: {
    announce: 'Freigabe erforderlich. {text}',
    a11y: 'Freigabe erforderlich. {risk}.',
    dismiss: 'Ausblenden. Hermes wartet weiter auf deine Antwort.',
    sent: 'Antwort gesendet',
    close: 'Schließen',
  },
  command: {
    unusual: 'Befehl enthält ungewöhnliche Zeichen',
    unusualHint: 'Unsichtbare Steuerzeichen sind als \\u…-Codes sichtbar gemacht, Nicht-ASCII-Zeichen können echten ähneln. Prüfe den Befehl genau.',
    label: '{count, plural, =1 {BEFEHL} other {BEFEHL · # Zeilen}}',
    a11y: 'Befehl: {command}',
    copy: 'Kopieren',
    copied: 'Kopiert',
    copyA11y: 'Befehl kopieren',
    copiedA11y: 'Befehl kopiert',
  },
  demo: {
    theme: {
      system: 'System',
      light: 'Hell',
      dark: 'Dunkel',
    },
    samples: {
      full: {
        title: 'Alle Optionen, normales Risiko',
        description: 'Shell-Befehl ausführen (Dateien auflisten)',
      },
      danger: {
        title: 'Gefährlich, mehrzeilig, Senden schlägt einmal fehl',
        description: 'Löscht Verzeichnisse rekursiv und führt ein heruntergeladenes Skript mit Root-Rechten aus',
      },
      smart: {
        title: 'Smart-Denied (nur Einmal / Ablehnen), Anfrage bereits weg (409)',
        description: 'Erzwingt einen Push auf den Hauptzweig',
      },
    },
    log: 'Antwort: {choice}',
    hidden: 'Ausgeblendet',
    again: 'Neu anzeigen',
  },
};
