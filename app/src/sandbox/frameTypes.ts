import type { Ref } from 'react';
import type { HostMessage } from './messages';

/** Imperative handle shared by the native (WebView) and web (iframe) frame implementations. */
export type HtmlFrameHandle = {
  post(msg: HostMessage): void;
};

export type TouchPhase = 'start' | 'move' | 'end' | 'cancel';

export type HtmlFrameProps = {
  ref?: Ref<HtmlFrameHandle>;
  /** Shell document; must stay referentially stable for the frame's lifetime (changing it reloads). */
  shellHtml: string;
  /** Inner scrolling (only when content exceeds the height cap). */
  scrollEnabled: boolean;
  /** Raw, unvalidated message from the sandbox. */
  onMessage(raw: unknown): void;
  /** Document finished loading (backup for the shell's `ready` message). */
  onLoaded(): void;
  /** Web content process crashed / was killed. */
  onCrash(reason: string): void;
  /** Native: raw touches on the view around the WebView (page coordinates), observed outside the sandbox.
   *  actionGate.ts turns them into taps (small movement, short) – scrolls and drags never count. */
  onTouch?(phase: TouchPhase, x: number, y: number): void;
  /** Web: the shell classified trusted pointer events (or a keyboard activation) as a tap and reported it over the
   *  private MessagePort. Hover and focus never count (GPT security M1 / Astra F15). */
  onTap?(): void;
  /** Color scheme of the shell (web: iframe `color-scheme` must match to stay transparent). */
  scheme: 'light' | 'dark';
  accessibilityLabel?: string;
};
