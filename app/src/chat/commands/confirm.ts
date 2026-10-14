import { Alert, Platform } from 'react-native';

/** Native: Alert with cancel/confirm (destructive style optional); web: window.confirm. Resolves false on dismiss. */
export function confirmAsync(title: string, message: string, ok: string, cancel: string, destructive = false): Promise<boolean> {
  if (Platform.OS === 'web') {
    const w = globalThis as { confirm?: (m: string) => boolean };
    return Promise.resolve(typeof w.confirm === 'function' ? w.confirm(`${title}\n\n${message}`) : false);
  }
  return new Promise((resolve) =>
    Alert.alert(
      title,
      message,
      [
        { text: cancel, style: 'cancel', onPress: () => resolve(false) },
        { text: ok, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    ),
  );
}
