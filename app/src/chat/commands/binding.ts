import type { HermesChatOptions } from '../../hermes/capabilities';
import type { Availability } from './plan';
import type { CommandDef, CommandId } from './registry';

/** ChatView `options` (header chip) – `value`/`onChange`/`caps` let /reasoning and /fast set options directly */
export type ChatOptionsControl = {
  label: string;
  active: boolean;
  onPress(): void;
  value?: HermesChatOptions;
  onChange?(next: HermesChatOptions | undefined): void;
  caps?: { reasoning: boolean; fast: boolean; canDisableReasoning: boolean };
};

/** What the composer needs from the chat view to show the palette and run commands. */
export type SlashBinding = {
  /** commands this chat offers (table order) */
  visible: readonly CommandDef[];
  availability(id: CommandId): Availability;
  /** localized description (weak fuzzy match) */
  describe(def: CommandDef): string;
  /** "Hermes", "Claude", … (labels of "Als Text senden") */
  backendName: string;
  /** run a picked command; the composer has already cleared its text */
  run(def: CommandDef, arg: string): void;
  /** short feedback (toast) */
  notify(text: string): void;
  /** text for a disabled / unavailable command */
  whyNot(def: CommandDef): string;
};
