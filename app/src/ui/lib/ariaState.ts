/**
 * react-native-web does not translate the `accessibilityState` object into DOM attributes, so
 * checkboxes/toggles had no aria-checked. This maps the state to aria-* props (web only).
 */
export type A11yStateLike = { checked?: boolean | 'mixed'; selected?: boolean; expanded?: boolean; disabled?: boolean; busy?: boolean };

export function webAriaState(s: A11yStateLike | undefined, role?: string): Record<string, boolean | 'mixed'> {
  const out: Record<string, boolean | 'mixed'> = {};
  if (!s) return out;
  if (role === 'button') {
    // browsers ignore aria-checked / aria-selected on a button: a toggle chip (selected, favourite star) is aria-pressed
    const pressed = s.checked ?? s.selected;
    if (pressed !== undefined) out['aria-pressed'] = pressed;
  } else {
    if (s.checked !== undefined) out['aria-checked'] = s.checked;
    if (s.selected !== undefined) out['aria-selected'] = s.selected;
  }
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

/**
 * `accessibilityState` plus its web aria-* mirror for raw elements (Pressable, View): spread it instead of the plain
 * prop, `<Pressable {...a11yStateProps({ expanded: open }, Platform.OS)} />`. Pass the `role` of a `button` that carries
 * `selected` / `checked` (toggle chip): the web mirror is then `aria-pressed`. PressableScale already does this itself.
 * React Native keeps reading `accessibilityState`; on web the aria-* attributes carry checked / selected / expanded / busy.
 */
export type WebAria = { 'aria-checked'?: boolean | 'mixed'; 'aria-pressed'?: boolean | 'mixed'; 'aria-selected'?: boolean; 'aria-expanded'?: boolean; 'aria-disabled'?: boolean; 'aria-busy'?: boolean };

export function a11yStateProps<S extends A11yStateLike | undefined>(s: S, os: string, role?: string): { accessibilityState: S } & WebAria {
  return { accessibilityState: s, ...(os === 'web' ? (webAriaState(s, role) as WebAria) : null) };
}
