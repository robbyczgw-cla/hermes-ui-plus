import { createContext, useContext } from 'react';
import { Linking } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import type { HuiAction } from '../types';

export type HuiFieldValue = string | number | boolean | null;

/**
 * Extra info passed with an action (set by app code, never by the model). `formId` is set for `{type:'submit'}`.
 * For `send` / `ask` the chat shell decides from `label` / `source` / `composed` whether the text goes out with one tap
 * or after the confirmation sheet (chat/sendGate.ts).
 */
export type HuiActionMeta = {
  formId?: string;
  nodeId?: string;
  /** visible label of the tapped button / chip */
  label?: string;
  /** `html`: from a sandboxed hui-html widget */
  source?: 'html';
  /** the app composed the text from the user's own input in a module */
  composed?: boolean;
  /**
   * `submit` only: the handler returned false because the text waits in the confirmation sheet; called once the
   * sheet really sent it (the form then locks like after a direct submit)
   */
  onSent?: () => void;
};

/**
 * Action callback used by every interactive component.
 *  - buttons            → onAction(item.action, undefined, { nodeId, label })
 *  - suggestions chip   → onAction({ type: 'send', text: chip }, undefined, { label: chip })
 *  - inline links       → onAction({ type: 'open_url', url })
 *  - form submit        → onAction({ type: 'submit' }, values, { formId: form.id, nodeId })
 *                         values: Record<fieldName, string|number|boolean|null>
 *                         (chat-shell then sends `[form:<formId>] <JSON.stringify(values)>`)
 *  - code "Kopieren"    → handled internally (clipboard), not forwarded.
 * When `onAction` is omitted, `defaultActionHandler` is used (copy + open_url only).
 *
 * Return value (chat shell): `false` = the action was NOT performed (e.g. `send`/`submit`/`ask`
 * while a turn is still running – the shell shows a toast). Interactive nodes must then stay open
 * instead of locking. `true`/`undefined` = performed (or fire-and-forget).
 */
export type HuiActionHandler = (action: HuiAction, values?: Record<string, HuiFieldValue>, meta?: HuiActionMeta) => boolean | void;

/** Handles the side-effect-only actions locally: `copy` (clipboard) and `open_url` (Linking). Ignores send/submit. */
export const defaultActionHandler: HuiActionHandler = (action) => {
  if (action.type === 'copy') Clipboard.setStringAsync(action.text).catch(() => {});
  else if (action.type === 'open_url') Linking.openURL(action.url).catch(() => {});
};

export type HuiRenderContext = {
  onAction: HuiActionHandler;
  /** The enclosing block is still streaming (node may be partial / growing). */
  streaming: boolean;
  /** Nesting depth (cards inside cards render flatter). */
  depth: number;
};

export const HuiContext = createContext<HuiRenderContext>({
  onAction: defaultActionHandler,
  streaming: false,
  depth: 0,
});

export function useHui(): HuiRenderContext {
  return useContext(HuiContext);
}
