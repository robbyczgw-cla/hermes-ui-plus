// Side effects behind the guided onboarding / diagnostics buttons: copy, share ("In Telegram öffnen"),
// open the Tailscale app, open docs. Every call swallows its own errors (a button never crashes the flow).
import * as Clipboard from 'expo-clipboard';
import * as WebBrowser from 'expo-web-browser';
import { Linking, Platform, Share } from 'react-native';
import { brand } from '../../brand';
import { haptic } from '../../ui';
import type { Lang } from '../../i18n';
import { getAgentPrompts, type AgentPrompts } from '../agentPrompts';

export const BRIDGE_SETUP_COMMAND = 'npx hermes-ui-plus-bridge setup';
/** Hermes Agent project (upstream, Nous Research) */
export const HERMES_AGENT_URL = 'https://github.com/NousResearch/hermes-agent';

/** bridge setup guide: the bridge README of the published repo (null → button hidden) */
export function bridgeDocsUrl(): string | null {
  const repo = brand().repoUrl;
  return repo ? `${repo}/blob/main/docs/SELF-HOSTING.md` : null;
}

/** The setup / troubleshoot / update prompts (agentPrompts.ts, owned by the bridge-setup workstream). */
export function promptsFor(lang: Lang): AgentPrompts {
  return getAgentPrompts(lang);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await Clipboard.setStringAsync(text);
    haptic('success');
    return true;
  } catch {
    return false;
  }
}

/**
 * Share sheet with the prompt (Telegram is one tap away there). Web without the Web Share API: Telegram's
 * share page. Resolves false if nothing could be opened.
 */
export async function sharePrompt(text: string, title: string): Promise<boolean> {
  try {
    if (Platform.OS !== 'web') {
      await Share.share({ message: text, title }, { dialogTitle: title, subject: title });
      return true;
    }
    const nav = (typeof navigator !== 'undefined' ? navigator : undefined) as (Navigator & { share?: (d: { text?: string; title?: string }) => Promise<void> }) | undefined;
    if (nav?.share) {
      await nav.share({ text, title }).catch(() => {});
      return true;
    }
    if (typeof window !== 'undefined') {
      window.open(`https://t.me/share/url?url=${encodeURIComponent(title)}&text=${encodeURIComponent(text)}`, '_blank', 'noopener');
      return true;
    }
  } catch {
    // cancelled / no share target
  }
  return false;
}

/**
 * Opens Tailscale. Android/iOS can't launch another app by id from JS without a native module, so this opens
 * its store page – which shows "Öffnen" when the app is installed (and "Installieren" otherwise).
 */
export async function openTailscale(): Promise<void> {
  const urls =
    Platform.OS === 'android'
      ? ['market://details?id=com.tailscale.ipn', 'https://play.google.com/store/apps/details?id=com.tailscale.ipn']
      : Platform.OS === 'ios'
        ? ['https://apps.apple.com/app/tailscale/id1470499037']
        : ['https://tailscale.com/download'];
  for (const u of urls) {
    try {
      await Linking.openURL(u);
      return;
    } catch {
      // next candidate
    }
  }
}

export function openDocs(url: string): void {
  void WebBrowser.openBrowserAsync(url).catch(() => Linking.openURL(url).catch(() => {}));
}
