// Central rule for messages that go out "in the user's name" from model-provided UI (review: hidden send text).
// The chat action handler (actions.ts) asks `sendGate` before a `send` / `ask` / `submit` leaves the device:
//  - one tap when the user saw exactly what is sent: a chip / button whose visible label IS the text, or a module that
//    composed the text from the user's own input (`composed`, e.g. quiz answers, calculator results);
//  - otherwise the confirmation sheet (actions/ActionRunner) shows the FULL text first: hui-html widgets
//    (`hermes.send()` – the visible tap says nothing about the text), buttons whose label differs from their text,
//    `ask` texts behind a different label or with attached node values (askGate), and forms whose id / field names
//    carry text the user never saw (only the values are shown in the form).
// Pure, tested in sendGate.test.ts.
import { sendMatchesLabel } from '../actions/describe.ts';

/** Where a send-type action came from (set by app code – never by the model). */
export type SendOrigin = {
  /** visible label of the tapped control (button / chip) */
  label?: string;
  /** `html`: a sandboxed hui-html widget (window.hermes.send) */
  source?: 'html';
  /** the text was composed by app code from what the user entered / picked in a module */
  composed?: boolean;
};

export type SendGateReason = 'html' | 'label' | 'unlabeled' | 'hiddenForm' | 'askValues';
export type SendGate = { confirm: false } | { confirm: true; reason: SendGateReason };

const DIRECT: SendGate = { confirm: false };

/** A form id / field name the user may not see but that ends up in the message: short identifiers only (no spaces – a
 *  sentence there is text the user never saw). */
const PLAIN_IDENT = /^[\p{L}\p{N}_.-]{1,32}$/u;

/** true when the form's `[form:<id>] {json}` message carries id / field-name text beyond plain short identifiers */
export function formHasHiddenText(formId: string, fieldNames: readonly string[]): boolean {
  if (formId && !PLAIN_IDENT.test(formId)) return true;
  return fieldNames.some((n) => !PLAIN_IDENT.test(n));
}

/**
 * Decide whether a message needs the confirmation sheet.
 * @param kind   action type
 * @param text   the model-provided text (`send`: what is sent; `ask`: the question before node values are attached).
 *               Ignored for `submit`.
 * @param origin where it came from
 * @param form   `submit` only: form id + field names
 */
export function sendGate(
  kind: 'send' | 'ask' | 'submit',
  text: string,
  origin: SendOrigin = {},
  form?: { formId: string; fieldNames: readonly string[] },
): SendGate {
  if (kind === 'submit') {
    // the user typed / picked the values; only text they never saw needs a look first
    return form && formHasHiddenText(form.formId, form.fieldNames) ? { confirm: true, reason: 'hiddenForm' } : DIRECT;
  }
  if (origin.source === 'html') return { confirm: true, reason: 'html' };
  if (kind === 'send' && origin.composed) return DIRECT;
  if (origin.label !== undefined) return sendMatchesLabel(origin.label, text) ? DIRECT : { confirm: true, reason: 'label' };
  return { confirm: true, reason: 'unlabeled' };
}

/**
 * `ask`: gate on the FINAL text (buildAsk appends the values of the `include`d nodes). One tap only when the question
 * itself passes `sendGate` AND nothing was attached: an `include` list (even if no node was found) or a built text
 * that differs from the question always confirms – the label never showed those values.
 */
export function askGate(question: string, built: string, origin: SendOrigin = {}, include?: readonly unknown[]): SendGate {
  const base = sendGate('ask', question, origin);
  if (base.confirm) return base;
  const attaches = Array.isArray(include) && include.some((x) => typeof x === 'string' && x.trim() !== '');
  return attaches || built.trim() !== question.trim() ? { confirm: true, reason: 'askValues' } : DIRECT;
}
