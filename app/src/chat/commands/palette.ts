/**
 * Palette model (pure, tested): rows for the current composer text, what picking a row does, and what
 * pressing "send" with slash text does. Raw slash text only ever reaches the model through the explicit
 * "Als Text senden" row (`sendRaw`).
 */
import { rankCommands } from './fuzzy.ts';
import { parseSlash, type SlashInput } from './parse.ts';
import { COMMANDS, resolveCommand, type CommandDef } from './registry.ts';

export type PaletteRow =
  | { kind: 'command'; def: CommandDef; via?: string }
  /** explicit "send this text to the model as typed" (unknown command / a message that starts with "/") */
  | { kind: 'sendRaw'; text: string };

export type PaletteState = { input: SlashInput; rows: PaletteRow[]; exact?: CommandDef };

const MAX_ROWS = 8;

/** null = ordinary text (no palette) */
export function paletteState(text: string, visible: readonly CommandDef[], describe?: (c: CommandDef) => string): PaletteState | null {
  const input = parseSlash(text);
  if (!input) return null;
  const exact = input.token ? resolveCommand(input.token, visible) : undefined;
  if (input.hasArgPart) {
    if (exact) return { input, rows: [{ kind: 'command', def: exact }], exact };
    const suggestions = rankCommands(input.token, visible, describe).slice(0, 3);
    return { input, rows: [...suggestions.map(toRow), { kind: 'sendRaw', text: text.trim() }] };
  }
  const ranked = rankCommands(input.token, visible, describe).slice(0, MAX_ROWS);
  const rows: PaletteRow[] = ranked.map(toRow);
  if (input.token && !exact) rows.push({ kind: 'sendRaw', text: text.trim() });
  return { input, rows, exact };
}

const toRow = (r: { def: CommandDef; via?: string }): PaletteRow => (r.via ? { kind: 'command', def: r.def, via: r.via } : { kind: 'command', def: r.def });

export type PickResult =
  /** replace the composer text (complete the command, argument follows) */
  | { action: 'fill'; text: string }
  /** run the command with this argument */
  | { action: 'run'; def: CommandDef; arg: string }
  /** the user explicitly chose to send the text as a normal message */
  | { action: 'sendRaw'; text: string };

/** Enter / tap on a row */
export function pickRow(row: PaletteRow, input: SlashInput): PickResult {
  if (row.kind === 'sendRaw') return { action: 'sendRaw', text: row.text };
  const { def } = row;
  if (def.arg === 'required' && !input.arg) return { action: 'fill', text: `/${def.name} ` };
  return { action: 'run', def, arg: def.arg === 'none' ? '' : input.arg };
}

/** Tab: complete the highlighted command name ("/neu" → "/new", "/mod" → "/model ") */
export function completeRow(row: PaletteRow, input: SlashInput): string | null {
  if (row.kind !== 'command') return null;
  const head = `/${row.def.name}`;
  if (input.hasArgPart) return input.arg ? `${head} ${input.arg}` : `${head} `;
  return row.def.arg === 'none' ? head : `${head} `;
}

export type SubmitResult =
  /** ordinary text: send as usual */
  | { action: 'send' }
  | { action: 'run'; def: CommandDef; arg: string }
  | { action: 'fill'; text: string }
  /** a command this chat does not offer (e.g. /branch on a bridge profile): explain, never send */
  | { action: 'unavailable'; def: CommandDef }
  /** unknown "/xyz": keep the text, open the palette so the user picks a command or "Als Text senden" */
  | { action: 'choose' };

/** The composer's send button / Enter with the palette closed. Slash text is never sent from here. */
export function submitSlash(text: string, visible: readonly CommandDef[]): SubmitResult {
  const input = parseSlash(text);
  if (!input) return { action: 'send' };
  const def = input.token ? resolveCommand(input.token, visible) : undefined;
  if (!def) {
    const known = input.token ? resolveCommand(input.token, COMMANDS) : undefined;
    return known ? { action: 'unavailable', def: known } : { action: 'choose' };
  }
  if (def.arg === 'required' && !input.arg) return { action: 'fill', text: `/${def.name} ` };
  return { action: 'run', def, arg: def.arg === 'none' ? '' : input.arg };
}
