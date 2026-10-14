// Pure core of the chat's HuiAction handler (actions.ts wraps it in a hook). Tested in actionHandler.test.ts.
import type { TFn } from '../i18n/core.ts';
import type { HuiAction } from '../protocol/types.ts';
import type { HuiActionMeta, HuiFieldValue } from '../ui/primitives/context.ts';
import { formMessage } from './format.ts';
import { askGate, sendGate, type SendGate, type SendOrigin } from './sendGate.ts';

export type ChatActionDeps = {
  /** sends a user message; false = refused (a turn is running) */
  send: (text: string) => boolean;
  /** a turn is running right now (read at call time) */
  isBusy: () => boolean;
  /**
   * device / pass-through actions (actions/ActionRunner: confirm sheet, validation, toasts); `confirm` forces the
   * sheet. Resolves with the runner's ActionResult (`{ ok: true, status: 'done' }` = really executed / sent).
   */
  run: (action: HuiAction, options?: { confirm?: boolean; hint?: string }) => unknown;
  /** builds the `ask` message (text + current node values); async because node state may still load */
  buildAsk: (action: Extract<HuiAction, { type: 'ask' }>, messageId: string | undefined) => Promise<string>;
};

export type ChatActionUi = {
  toast: (message: string) => void;
  tr: TFn;
  /** light tap feedback before a direct send */
  tapHaptic: () => void;
};

/** the runner really executed the action (not cancelled, not refused) */
export function runnerSent(result: unknown): boolean {
  const r = result as { ok?: unknown; status?: unknown } | null | undefined;
  return r?.ok === true && r.status === 'done';
}

const originOf = (meta: HuiActionMeta | undefined): SendOrigin => ({ label: meta?.label, source: meta?.source, composed: meta?.composed });

/**
 * send → user message · submit → `[form:<id>] {json}` · ask → text + current node values ·
 * everything else (calendar, reminder, maps, call, email, sms, timer, add_to_list, copy, open_url) → `run`.
 * Model-provided text the user did not see verbatim (hui-html, label ≠ text, hidden form ids, `ask` with attached
 * values) goes through the confirmation sheet with the FULL text first (sendGate.ts); a chip whose label is its text
 * stays one tap. Returns false when a message could not be sent (turn running) or a form waits for the sheet, so
 * interactive nodes stay open; a form confirmed in the sheet is marked sent via `meta.onSent`.
 */
export function handleChatAction(
  { send, isBusy, run, buildAsk }: ChatActionDeps,
  { toast, tr, tapHaptic }: ChatActionUi,
  action: HuiAction,
  values?: Record<string, HuiFieldValue>,
  meta?: HuiActionMeta,
  messageId?: string,
): boolean {
  const hintFor = (gate: Extract<SendGate, { confirm: true }>): string => {
    const label = meta?.label?.trim() ?? '';
    if (gate.reason === 'html') return tr('actionRunner.describe.send.htmlHint');
    if (gate.reason === 'hiddenForm') return tr('actionRunner.describe.send.formHint');
    if (gate.reason === 'askValues') return tr('actionRunner.describe.send.askValuesHint');
    if (gate.reason === 'label' && label) return tr('actionRunner.describe.send.hiddenHint', { label });
    return tr('actionRunner.describe.send.unlabeledHint');
  };
  switch (action.type) {
    case 'send':
    case 'submit': {
      const text = action.type === 'send' ? (typeof action.text === 'string' ? action.text.trim() : '') : formMessage(meta?.formId ?? 'form', values ?? {});
      if (!text) return false;
      if (isBusy()) {
        toast(tr('chat.busy'));
        return false;
      }
      const gate =
        action.type === 'send'
          ? sendGate('send', text, originOf(meta))
          : sendGate('submit', text, {}, { formId: meta?.formId ?? '', fieldNames: Object.keys(values ?? {}) });
      if (gate.confirm) {
        // the runner sends through the chat's send path after "Senden" (busy → toast there)
        const pending = run({ type: 'send', text }, { confirm: true, hint: hintFor(gate) });
        // a form stays editable until it really went out, then it is locked like a direct submit
        if (action.type === 'submit') {
          const onSent = meta?.onSent;
          void Promise.resolve(pending)
            .then((r) => {
              if (runnerSent(r)) onSent?.();
            })
            .catch(() => {});
        }
        // buttons / chips don't care
        return action.type === 'send';
      }
      tapHaptic();
      const ok = send(text);
      if (!ok) toast(tr('chat.busy'));
      return ok;
    }
    case 'ask': {
      if (typeof action.text !== 'string' || !action.text.trim()) return false;
      if (isBusy()) {
        toast(tr('chat.busy'));
        return false;
      }
      tapHaptic();
      const question = action.text.trim();
      void buildAsk(action, messageId)
        .catch(() => question)
        .then((text) => {
          // gate on the FINAL text: attached node values are text the button label never showed
          const gate = askGate(question, text, originOf(meta), action.include);
          if (gate.confirm) void run({ type: 'send', text }, { confirm: true, hint: hintFor(gate) });
          else if (!send(text)) toast(tr('chat.busy'));
        });
      return true;
    }
    case 'open_url': {
      // bare "www.…" links from the model → https (the runner itself only accepts http/https)
      const url = typeof action.url === 'string' && /^www\./i.test(action.url.trim()) ? `https://${action.url.trim()}` : action.url;
      void run({ ...action, url });
      return true;
    }
    default:
      void run(action);
      return true;
  }
}
