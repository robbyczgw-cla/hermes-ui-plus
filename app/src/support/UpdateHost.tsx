// Starts the daily update check (support/updateStore.ts) on app start and whenever the app returns to the
// foreground, and shows the chat toast once per new version. Renders nothing; never delays startup: the first
// check waits until after the first screens are up.
import { usePathname } from 'expo-router';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useToast } from '../chat/Toast';
import { useT } from '../i18n';
import { checkForUpdate, markUpdateToastShown, usePendingUpdate } from './updateStore';

const FIRST_CHECK_DELAY_MS = 4000;

export function UpdateHost() {
  const t = useT();
  const toast = useToast();
  const pending = usePendingUpdate();
  const pathname = usePathname();

  useEffect(() => {
    const first = setTimeout(() => void checkForUpdate(), FIRST_CHECK_DELAY_MS);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void checkForUpdate();
    });
    return () => {
      clearTimeout(first);
      sub.remove();
    };
  }, []);

  // one toast per version, only on the chat screen (Settings shows the row instead)
  const version = pending && !pending.toastShown ? pending.release.version : null;
  const onChat = pathname === '/';
  useEffect(() => {
    if (!version || !onChat) return;
    markUpdateToastShown(version);
    toast(t('support.update.toast', { version }));
  }, [version, onChat, toast, t]);

  return null;
}
