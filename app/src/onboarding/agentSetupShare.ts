// Copy / share of the agent setup prompt on the running platform: wires shareOrCopy.ts (pure, tested) to React
// Native's Share, the Web Share API and expo-clipboard. Tested with the RN stubs in agentSetupShare.test.ts.
import * as Clipboard from 'expo-clipboard';
import { Platform, Share } from 'react-native';
import { isDesktopApp } from '../desktop/bridge';
import { shareOrCopy, shareTarget, type ShareOutcome } from './shareOrCopy';

type WebShareNavigator = { share?: (d: { text?: string; title?: string }) => Promise<void> };

/** clipboard write; false when the platform refused it (web without permission, …) */
export async function copySetupPrompt(text: string): Promise<boolean> {
  try {
    return (await Clipboard.setStringAsync(text)) !== false;
  } catch {
    return false;
  }
}

/** share sheet on Android/iOS, navigator.share on the web (copy fallback), copy in the desktop app */
export function shareSetupPrompt(text: string, title: string): Promise<ShareOutcome> {
  const nav = (typeof navigator !== 'undefined' ? navigator : undefined) as WebShareNavigator | undefined;
  const webShare = nav && typeof nav.share === 'function' ? (d: { text: string; title: string }) => nav.share!(d) : null;
  return shareOrCopy(text, title, {
    target: shareTarget(Platform.OS, isDesktopApp()),
    nativeShare: (message, t) => Share.share({ message, title: t }, { dialogTitle: t, subject: t }),
    webShare,
    copy: copySetupPrompt,
  });
}
