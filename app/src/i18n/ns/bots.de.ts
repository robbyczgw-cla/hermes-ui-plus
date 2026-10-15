// Namespace 'bots' (German, source of truth): Hermes profiles ("Bots") – picker section, connection editor, drawer.
export const bots = {
  picker: {
    section: 'Bot',
    default: 'Standard',
    a11y: '{name}, Modell {model}',
    newChat: 'Neuer Chat mit {name}',
  },
  settings: {
    title: 'Hermes-Profile (Bots)',
    field: 'Bots',
    placeholder: 'z. B. recherche, arbeit',
    footnote:
      'Bots sind Hermes-Profile: eigenes Modell, eigenes Gedächtnis und eigene Skills. Namen wie bei „hermes profile create“, durch Kommas getrennt. Über die UI-Bridge erscheinen sie von selbst. Den Bot wählst du im Chat über das Modell-Menü.',
    invalid: 'Wird ignoriert (nur Kleinbuchstaben, Ziffern, - und _): {names}',
  },
  drawer: {
    badgeA11y: 'Bot {name}',
  },
};
