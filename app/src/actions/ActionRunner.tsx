import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocale, useT } from '../i18n';
import { ActionConfirmSheet } from './ActionConfirmSheet';
import { describeAction, needsConfirmation } from './describe.ts';
import { createNativeEnv } from './env';
import { executeAction, type ExecEnv } from './executor.ts';
import { setActionI18n } from './i18nState.ts';
import type { ActionDescription, ActionI18n, ActionResult, ValidAction } from './types.ts';
import { validateAction } from './validate.ts';

export type RunOptions = {
  /** overrides the provider's conversationId (add_to_list) */
  conversationId?: string;
  /** always show the confirmation sheet, even for send/copy/open_url (e.g. a button whose label ≠ its send text, review M2) */
  confirm?: boolean;
  /** extra hint line in the sheet (replaces the default hint) */
  hint?: string;
};

export type RunAction = (action: unknown, options?: RunOptions) => Promise<ActionResult>;

export type ActionRunnerProviderProps = {
  children?: ReactNode;
  /** conversation the actions belong to (add_to_list target) */
  conversationId?: string;
  /** Result / error messages in the active language ("Termin eingetragen", "Added to the list", …). Wire to the chat `useToast()`. */
  onToast?: (message: string) => void;
  /**
   * pass-through for `{type:'send'}` – the chat shell's send-message function. `false` = refused (a turn is
   * running): the runner reports it (toast) and the action is not "done"
   */
  onSend?: (text: string) => void | boolean;
  /** replace platform side effects (tests / gallery) */
  env?: ExecEnv;
};

type Pending = { valid: ValidAction; description: ActionDescription; conversationId?: string; resolve: (r: ActionResult) => void };

const RunnerContext = createContext<RunAction | null>(null);

/** The runner of the surrounding chat, or null outside an <ActionRunnerProvider> (gallery, previews). */
export function useOptionalActionRunner(): RunAction | null {
  return useContext(RunnerContext);
}

/** `run(action)` – validates, ALWAYS asks (except copy/send/http(s) open_url), executes, toasts. Never rejects. */
export function useActionRunner(): RunAction {
  const tr = useT();
  const unavailable = useMemo<RunAction>(
    () => async () => {
      console.warn('[actions] useActionRunner() called outside <ActionRunnerProvider>');
      return { ok: false, error: tr('actionRunner.runner.unavailable') };
    },
    [tr],
  );
  return useContext(RunnerContext) ?? unavailable;
}

/**
 * Mount inside the chat screen (needs the theme + safe-area providers). Renders the confirmation
 * sheet; concurrent `run` calls are queued and shown one after the other.
 */
export function ActionRunnerProvider({ children, conversationId, onToast, onSend, env }: ActionRunnerProviderProps) {
  const [current, setCurrent] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const queue = useRef<Pending[]>([]);
  const currentRef = useRef<Pending | null>(null);
  const baseEnv = useMemo(() => env ?? createNativeEnv(), [env]);
  const t = useT();
  const { locale } = useLocale();
  const i18n = useMemo<ActionI18n>(() => ({ t, locale }), [t, locale]);
  useEffect(() => setActionI18n(i18n), [i18n]);
  const live = useRef({ conversationId, onToast, onSend, baseEnv, i18n });
  useEffect(() => {
    live.current = { conversationId, onToast, onSend, baseEnv, i18n };
  });
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const show = useCallback((p: Pending | null) => {
    currentRef.current = p;
    if (mounted.current) setCurrent(p);
  }, []);

  const next = useCallback(() => {
    show(queue.current.shift() ?? null);
  }, [show]);

  const execute = useCallback(async (valid: ValidAction, conv?: string): Promise<ActionResult> => {
    const l = live.current;
    const result = await executeAction(valid, { ...l.baseEnv, conversationId: conv ?? l.conversationId, send: l.baseEnv.send ?? l.onSend }, l.i18n);
    const message = result.ok ? result.message : result.error;
    if (message) l.onToast?.(message);
    return result;
  }, []);

  const run = useCallback<RunAction>(
    (raw, options) =>
      new Promise<ActionResult>((resolve) => {
        const l = live.current;
        const v = validateAction(raw, l.i18n);
        if (!v.ok) {
          l.onToast?.(v.error);
          resolve({ ok: false, error: v.error });
          return;
        }
        if (!options?.confirm && !needsConfirmation(v.action)) {
          void execute(v.action, options?.conversationId).then(resolve);
          return;
        }
        const description = describeAction(v.action, l.i18n, new Date());
        const p: Pending = { valid: v.action, description: options?.hint ? { ...description, hint: options.hint } : description, conversationId: options?.conversationId, resolve };
        if (currentRef.current) queue.current.push(p);
        else show(p);
      }),
    [execute, show],
  );

  const onConfirm = useCallback(async () => {
    const p = current;
    if (!p || busy) return;
    setBusy(true);
    let result: ActionResult;
    try {
      result = await execute(p.valid, p.conversationId);
    } catch {
      result = { ok: false, error: live.current.i18n.t('actionRunner.common.failed') };
    }
    if (mounted.current) setBusy(false);
    p.resolve(result);
    next();
  }, [current, busy, execute, next]);

  const onCancel = useCallback(() => {
    const p = current;
    if (!p || busy) return;
    p.resolve({ ok: true, status: 'cancelled' });
    next();
  }, [current, busy, next]);

  // unmount: release waiting callers
  useEffect(
    () => () => {
      const rest = [currentRef.current, ...queue.current].filter((x): x is Pending => x !== null);
      queue.current = [];
      currentRef.current = null;
      for (const p of rest) p.resolve({ ok: true, status: 'cancelled' });
    },
    [],
  );

  // `run` reads refs only inside the promise executor (event time), never while rendering.
  /* eslint-disable react-hooks/refs */
  return createElement(
    RunnerContext.Provider,
    { value: run },
    children,
    createElement(ActionConfirmSheet, { description: current?.description ?? null, busy, onConfirm: () => void onConfirm(), onCancel }),
  );
  /* eslint-enable react-hooks/refs */
}
