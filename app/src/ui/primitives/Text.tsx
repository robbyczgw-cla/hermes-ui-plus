import { createContext, useContext, type ComponentPropsWithRef } from 'react';
import { Text as RNText, TextInput as RNTextInput } from 'react-native';
import { FONTS } from '../theme';

// React Native has no app-wide default font: an unstyled <Text> renders in Roboto / SF / the browser's stack. These
// drop-ins give every text the app's text face (Atkinson Hyperlegible Next) unless the style names another family.
// Only the outermost Text sets it, so nested spans keep inheriting their parent's face (mono, display) as in RN.
// Import Text / TextInput from here, not from 'react-native' (textImports.test.ts).

const InText = createContext(false);
const BASE = { fontFamily: FONTS.sans };

/** instance type, as with the RN component (`useRef<Text>(null)`) */
export type Text = RNText;
export type TextInput = RNTextInput;

// eslint-disable-next-line @typescript-eslint/no-redeclare -- type + value pair, like react-native's own export
export function Text(props: ComponentPropsWithRef<typeof RNText>) {
  const nested = useContext(InText);
  if (nested) return <RNText {...props} />;
  return (
    <InText.Provider value>
      <RNText {...props} style={[BASE, props.style]} />
    </InText.Provider>
  );
}

// eslint-disable-next-line @typescript-eslint/no-redeclare
export function TextInput(props: ComponentPropsWithRef<typeof RNTextInput>) {
  return <RNTextInput {...props} style={[BASE, props.style]} />;
}
