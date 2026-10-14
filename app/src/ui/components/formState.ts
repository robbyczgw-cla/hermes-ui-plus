/**
 * Persisted state of a `form` node (nodestate, like Choice/Slots): the submitted values and whether
 * the form was sent. After a reload / chat switch / virtualisation the form shows the locked
 * "Gesendet" view with the sent values instead of an empty, open form (bugs review 2026-10-11 P2-2).
 * Unsent edits stay local (React state) until submit.
 */
export type FormFieldValue = string | number | boolean | null;

export type FormNodeState = {
  sent: boolean;
  /** values of the last submit (also pre-fill the form after "Ändern") */
  values: Record<string, FormFieldValue>;
};

export const FORM_STATE_VERSION = 1;
export const INITIAL_FORM_STATE: FormNodeState = { sent: false, values: {} };

/**
 * Shown value of a field: local edit → last submitted value → the field's default. A sent (locked) form
 * always shows what was sent: stray edits (keyboard / assistive adjustments on a locked control) never win.
 */
export function formFieldValue(
  name: string,
  edits: Readonly<Record<string, FormFieldValue>>,
  state: FormNodeState,
  fallback: () => FormFieldValue,
): FormFieldValue {
  if (!state.sent && Object.prototype.hasOwnProperty.call(edits, name)) return edits[name];
  if (state.values && Object.prototype.hasOwnProperty.call(state.values, name)) return state.values[name];
  return fallback();
}

export function submittedFormState(values: Record<string, FormFieldValue>): FormNodeState {
  return { sent: true, values: { ...values } };
}

/** "Ändern": open again, keep the sent values as the starting point. */
export function reopenedFormState(s: FormNodeState): FormNodeState {
  return { ...s, sent: false };
}

/** Defensive read of stored data (older/invalid records → initial state). */
export function asFormState(x: unknown): FormNodeState {
  if (typeof x !== 'object' || x === null) return INITIAL_FORM_STATE;
  const o = x as { sent?: unknown; values?: unknown };
  const values = typeof o.values === 'object' && o.values !== null && !Array.isArray(o.values) ? (o.values as Record<string, FormFieldValue>) : {};
  return { sent: o.sent === true, values };
}

/**
 * Submit dictionary: own data properties only (a field named `__proto__` must be a real key, not invoke
 * the inherited setter and vanish from the JSON), first field wins for a duplicated name.
 */
export function submitValues(fields: readonly { name: string }[], valueOf: (i: number) => FormFieldValue): Record<string, FormFieldValue> {
  const entries: [string, FormFieldValue][] = [];
  const seen = new Set<string>();
  fields.forEach((f, i) => {
    if (seen.has(f.name)) return;
    seen.add(f.name);
    entries.push([f.name, valueOf(i)]);
  });
  return Object.fromEntries(entries);
}

/** Fields with unique names (React keys / edit slots); later duplicates are dropped. */
export function uniqueFields<T extends { name: string }>(fields: readonly T[]): T[] {
  const seen = new Set<string>();
  return fields.filter((f) => !seen.has(f.name) && !!seen.add(f.name));
}
