// "Share" for text (the agent setup prompt): which channel per platform, and the copy fallback. Pure – the platform
// pieces come in as deps (AgentSetupSheet.tsx wires React Native's Share, navigator.share, expo-clipboard), so the
// decision is tested in shareOrCopy.test.ts.
//
//   Android / iOS     native share sheet (RN Share)
//   web               navigator.share; missing or failing → copy (a cancelled share stays cancelled)
//   desktop (Tauri)   copy (the webview's navigator.share is unreliable / absent there)

export type ShareTarget = 'native' | 'web' | 'desktop';

export type ShareOutcome =
  /** handed to a share sheet */
  | 'shared'
  /** copied to the clipboard instead (no share sheet here, or it failed) */
  | 'copied'
  /** the user closed the share sheet */
  | 'cancelled'
  /** neither share nor copy worked */
  | 'failed';

export type ShareDeps = {
  target: ShareTarget;
  /** RN Share.share; resolves with the action ('dismissedAction' = closed on iOS) */
  nativeShare?: (text: string, title: string) => Promise<{ action?: string } | void>;
  /** navigator.share when the browser has it */
  webShare?: ((data: { text: string; title: string }) => Promise<void>) | null;
  /** clipboard write; resolves false / throws when it failed */
  copy: (text: string) => Promise<boolean>;
};

export function shareTarget(platformOS: string, desktopApp: boolean): ShareTarget {
  if (desktopApp) return 'desktop';
  return platformOS === 'web' ? 'web' : 'native';
}

async function copyOr(deps: ShareDeps, text: string): Promise<ShareOutcome> {
  try {
    return (await deps.copy(text)) ? 'copied' : 'failed';
  } catch {
    return 'failed';
  }
}

function isAbort(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as { name?: unknown }).name === 'AbortError';
}

export async function shareOrCopy(text: string, title: string, deps: ShareDeps): Promise<ShareOutcome> {
  if (deps.target === 'native' && deps.nativeShare) {
    try {
      const r = await deps.nativeShare(text, title);
      return r && r.action === 'dismissedAction' ? 'cancelled' : 'shared';
    } catch {
      return copyOr(deps, text);
    }
  }
  if (deps.target === 'web' && deps.webShare) {
    try {
      await deps.webShare({ text, title });
      return 'shared';
    } catch (e) {
      // AbortError = the user closed the sheet; anything else (NotAllowedError, no share target …) → copy
      if (isAbort(e)) return 'cancelled';
      return copyOr(deps, text);
    }
  }
  return copyOr(deps, text);
}
