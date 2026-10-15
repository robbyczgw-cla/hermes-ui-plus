/**
 * Model line of the chat header (subtitle on phones, chip in the wide layout). Pure (headerDetail.test.ts).
 *
 * The lock of a Hermes model lock is shown as an icon after the model name, never as text inside it: a long model
 * name ("claude-sonnet-5-5[1m]") is ellipsised before the icon, so the lock always stays visible. The accessibility
 * label keeps the spelled-out form ("<model> · fixiert").
 */
export type HeaderDetail = {
  /** spoken detail: "<model> · fixiert · <options>" */
  a11y: string;
  /** model label (may be ellipsised); '' = server default */
  model: string;
  /** show the lock icon right after the model */
  locked: boolean;
  /** text after the model / lock ("· <options>"), never truncated before the lock */
  rest: string;
};

export function headerDetail(o: { modelLabel?: string; locked?: boolean; optionsLabel?: string; lockedLabel(model: string): string }): HeaderDetail {
  const model = o.modelLabel ?? '';
  const locked = !!(o.locked && model);
  const options = o.optionsLabel ?? '';
  const a11y = [locked ? o.lockedLabel(model) : model, options].filter(Boolean).join(' · ');
  const rest = options ? (model ? `· ${options}` : options) : '';
  return { a11y, model, locked, rest };
}
