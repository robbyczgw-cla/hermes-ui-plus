// Namespace 'sandbox' (German, source of truth). Keys: <area>.<element>. See ../README.md.
// The shell's error texts (`shell.*`) are sent into the WebView as labels; the shell HTML itself is not translated.
export const sandbox = {
  block: {
    a11y: 'Interaktives Widget',
    loading: 'Widget wird geladen …',
    creating: 'Widget wird erstellt …',
    errorTitle: 'Fehler im Widget',
    reload: 'Neu laden',
    reloadA11y: 'Widget neu laden',
  },
  frame: {
    title: 'Widget',
    crash: 'Der Widget-Prozess wurde beendet.',
  },
  error: {
    unknown: 'Unbekannter Fehler',
  },
  shell: {
    error: 'Fehler',
    atLine: '(Zeile {line})',
    scriptFailed: 'Skript konnte nicht geladen werden: {src}',
    promiseRejected: 'Promise abgelehnt: {reason}',
  },
};
