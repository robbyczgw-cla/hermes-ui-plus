/**
 * Slash command palette ("/" at the very start of the composer). See registry.ts (command table),
 * plan.ts (availability per backend + what a command does), palette.ts (rows / submit rules).
 *
 *   const slash = useSlashCommands({ … });          // ChatView
 *   <Composer slash={slash.binding} … />  {slash.sheet}
 */
export { SlashPalette } from './SlashPalette';
export type { SlashPaletteHandle } from './SlashPalette';
export { useSlashCommands } from './useSlashCommands';
export type { UseSlashCommandsArgs } from './useSlashCommands';
export { completeRow, paletteState, pickRow, submitSlash } from './palette';
export type { PaletteRow, PaletteState } from './palette';
export type { ChatOptionsControl, SlashBinding } from './binding';
export type { CommandDef, CommandId } from './registry';
