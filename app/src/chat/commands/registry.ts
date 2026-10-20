/**
 * Slash command table (pure, erasable TS – tested with node --test).
 *
 * Command names are the ENGLISH Hermes names (hermes_cli/commands.py), so muscle memory from Telegram/CLI works.
 * Localized words (de/es) are search aliases only: "/neu" suggests and resolves to /new. Descriptions and
 * argument hints are i18n keys (`slash.cmd.<id>.desc|arg`).
 *
 * None of these is ever sent to the model as raw text (the Hermes api_server does not interpret slash
 * commands, research notes are maintainer-private); each maps to an app action or a Hermes API call.
 * Not offered: /steer (needs the /v1/runs transport), /undo + /compress (no Hermes API), CLI/ops commands.
 */

export type CommandId =
  | 'new'
  | 'title'
  | 'model'
  | 'reasoning'
  | 'fast'
  | 'retry'
  | 'stop'
  | 'approve'
  | 'deny'
  | 'search'
  | 'skills'
  | 'memory'
  | 'branch'
  | 'usage'
  | 'status'
  | 'export'
  | 'delete'
  | 'help';

export type ArgMode = 'none' | 'optional' | 'required';

export type CommandDef = {
  id: CommandId;
  /** canonical English name without the slash */
  name: string;
  /** Hermes aliases (also English) */
  hermesAliases: readonly string[];
  /** localized search aliases (German, Spanish); English synonyms go to hermesAliases */
  aliases: readonly string[];
  arg: ArgMode;
  /** the command sends a (built) prompt to the model as text – labelled in the palette */
  sendsText?: boolean;
};

const def = (id: CommandId, arg: ArgMode, aliases: string[], hermesAliases: string[] = [], extra: Partial<CommandDef> = {}): CommandDef => ({
  id,
  name: id,
  hermesAliases,
  aliases,
  arg,
  ...extra,
});

/** palette order when nothing is typed (most used first) */
export const COMMANDS: readonly CommandDef[] = [
  def('new', 'none', ['neu', 'neuer', 'nuevo', 'nueva', 'leeren'], ['reset', 'clear']),
  def('model', 'optional', ['modell', 'modelo']),
  def('reasoning', 'optional', ['denken', 'nachdenken', 'razonamiento', 'pensar'], ['think']),
  def('fast', 'optional', ['schnell', 'rapido']),
  def('retry', 'none', ['nochmal', 'wiederholen', 'reintentar', 'repetir'], ['regenerate']),
  def('stop', 'none', ['stopp', 'abbrechen', 'parar', 'detener']),
  def('approve', 'optional', ['ok', 'erlauben', 'freigeben', 'genehmigen', 'aprobar', 'permitir']),
  def('deny', 'none', ['nein', 'ablehnen', 'verweigern', 'denegar', 'rechazar']),
  def('title', 'required', ['titel', 'umbenennen', 'titulo', 'renombrar'], ['rename']),
  def('search', 'required', ['suche', 'suchen', 'buscar', 'busqueda'], [], { sendsText: true }),
  def('skills', 'none', ['faehigkeiten', 'fertigkeiten', 'habilidades'], ['skill']),
  def('memory', 'none', ['gedaechtnis', 'erinnerung', 'erinnerungen', 'memoria', 'recuerdos'], ['memories']),
  def('branch', 'none', ['verzweigen', 'abzweigen', 'ramificar', 'bifurcar'], ['fork']),
  def('usage', 'none', ['nutzung', 'verbrauch', 'tokens', 'uso', 'consumo']),
  def('status', 'none', ['zustand', 'info', 'estado']),
  def('export', 'none', ['exportieren', 'teilen', 'exportar', 'compartir'], ['save', 'share']),
  def('delete', 'none', ['loeschen', 'entfernen', 'borrar', 'eliminar']),
  def('help', 'none', ['hilfe', 'befehle', 'ayuda', 'comandos'], ['commands']),
];

const BY_ID = new Map(COMMANDS.map((c) => [c.id, c]));

export function commandById(id: CommandId): CommandDef {
  const c = BY_ID.get(id);
  if (!c) throw new Error(`unknown command ${id}`);
  return c;
}

/** lowercase, umlauts/accents folded (ö→oe, ß→ss, á→a) so "/löschen", "/loeschen" and "/rápido" all match */
export function foldKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/** every searchable key of a command (folded): name, Hermes aliases, localized aliases */
export function commandKeys(c: CommandDef): { key: string; kind: 'name' | 'hermes' | 'alias' }[] {
  return [
    { key: foldKey(c.name), kind: 'name' as const },
    ...c.hermesAliases.map((a) => ({ key: foldKey(a), kind: 'hermes' as const })),
    ...c.aliases.map((a) => ({ key: foldKey(a), kind: 'alias' as const })),
  ];
}

/** exact (folded) match on name or any alias */
export function resolveCommand(token: string, among: readonly CommandDef[] = COMMANDS): CommandDef | undefined {
  const k = foldKey(token);
  if (!k) return undefined;
  return among.find((c) => commandKeys(c).some((x) => x.key === k));
}
