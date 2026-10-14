/**
 * react-native-web does not translate the `accessibilityState` object into DOM attributes, so
 * checkboxes/toggles had no aria-checked. This maps the state to aria-* props (web only).
 */
export type A11yStateLike = { checked?: boolean | 'mixed'; selected?: boolean; expanded?: boolean; disabled?: boolean; busy?: boolean };

export function webAriaState(s: A11yStateLike | undefined): Record<string, boolean | 'mixed'> {
  const out: Record<string, boolean | 'mixed'> = {};
  if (!s) return out;
  if (s.checked !== undefined) out['aria-checked'] = s.checked;
  if (s.selected !== undefined) out['aria-selected'] = s.selected;
  if (s.expanded !== undefined) out['aria-expanded'] = s.expanded;
  if (s.disabled) out['aria-disabled'] = true;
  if (s.busy) out['aria-busy'] = true;
  return out;
}

/**
 * Accessible name for a react-native-web `Modal`: RNW renders the `role="dialog"` element itself from the
 * Modal's own props, so a label on an inner View never names the dialog (GPT review #21). Web only.
 */
export function webDialogName(label: string | undefined, os: string): Record<string, string> {
  return os === 'web' && label ? { 'aria-label': label } : {};
}
