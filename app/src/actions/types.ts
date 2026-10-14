/**
 * Types of the action executor. `ValidAction` is the normalised, validated form of a HuiAction
 * (dates are `Date`s, phone numbers normalised, lists trimmed). Inputs are plain JSON from the
 * model, so everything entering `validateAction` is `unknown`.
 */
import type { TFn } from '../i18n/core.ts';

/** Translator + BCP47 locale for user-facing action text (`useT()` / `useLocale()` in React). */
export type ActionI18n = { t: TFn; locale: string };

export type MapMode = 'driving' | 'walking' | 'transit';

export type ValidAction =
  | { type: 'calendar'; title: string; start: Date; end: Date; allDay: boolean; location?: string; notes?: string }
  | { type: 'reminder'; title: string; at: Date }
  | { type: 'maps'; query?: string; lat?: number; lng?: number; mode?: MapMode }
  | { type: 'call'; phone: string }
  | { type: 'email'; to: string[]; subject?: string; body?: string }
  | { type: 'sms'; to: string[]; body?: string }
  | { type: 'timer'; seconds: number; label: string }
  | { type: 'add_to_list'; items: string[]; listTitle?: string }
  | { type: 'copy'; text: string }
  | { type: 'open_url'; url: string }
  | { type: 'send'; text: string };

export type ValidationResult = { ok: true; action: ValidAction } | { ok: false; error: string };

export type ActionResult =
  | { ok: true; status: 'done' | 'cancelled'; message?: string }
  | { ok: false; error: string };

/** What the confirmation sheet shows. */
export type ActionDescription = {
  /** short headline, e.g. "Termin eintragen" / "Add event" */
  title: string;
  /** one-line summary, e.g. "Termin eintragen: Zahnarzt · Di 14. Okt, 10:00–11:00 · Praxis Müller" (de) */
  summary: string;
  /** label/value rows for the sheet */
  rows: { label: string; value: string }[];
  /** optional clarification, e.g. "Der Anruf startet erst, wenn du in der Telefon-App wählst." */
  hint?: string;
  /** primary button label */
  confirmLabel: string;
  icon: 'calendar' | 'external' | 'send' | 'copy' | 'info' | 'check';
};
