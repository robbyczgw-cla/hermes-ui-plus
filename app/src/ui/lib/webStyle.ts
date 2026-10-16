import { Platform } from 'react-native';

/**
 * `outlineStyle: 'none'` for text inputs that draw their own focus state: web only. React Native has no such style on
 * native – Android's style parser logs `ReactNativeJNI: Could not parse OutlineStyle:none` for every such input.
 * Spread it into a style object (`{ ...noOutline }`) or put it into a style array.
 */
export const noOutline: object | undefined = Platform.OS === 'web' ? { outlineStyle: 'none' } : undefined;

/**
 * Web only: marks a non-Modal overlay panel (the mobile conversation drawer) as a modal dialog whose Tab order is
 * trapped and whose opener gets focus back on close (ui/lib/webA11y.ts). RNW renders `dataSet` as data-* attributes.
 */
export const webOverlayPanel: object | undefined =
  Platform.OS === 'web' ? { dataSet: { huiTrap: '1' }, role: 'dialog', 'aria-modal': true } : undefined;

/**
 * Web only: keeps a dialog backdrop out of the Tab order. The backdrop is a click target for mouse users (Esc and the
 * dialog's own Close button are the keyboard routes); it stays a labelled button for screen readers.
 */
export const webNoTab: object | undefined = Platform.OS === 'web' ? { tabIndex: -1 } : undefined;
