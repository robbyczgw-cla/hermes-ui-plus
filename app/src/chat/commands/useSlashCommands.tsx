/**
 * Slash commands of one chat: builds the palette binding for the Composer and executes plans
 * (plan.ts) with the chat view's actions, the conversation store and the Hermes API. Never sends raw
 * slash text: only /search (a built, labelled prompt) and the explicit "Als Text senden" reach the model.
 *
 *   const slash = useSlashCommands({ … });
 *   <Composer slash={slash.binding} … />   {slash.sheet}
 */
import { fetch as expoFetch } from 'expo/fetch';
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { useConversations, useConversationsInternals } from '../../conversations/ConversationsProvider';
import { chatOptionsSummary, type HermesChatOptions } from '../../hermes/capabilities';
import { createJsonRequest, isNotFoundError, sessionErrorText } from '../../hermes/sessions';
import { withBot } from '../../hermes/bots';
import type { FetchLike } from '../../hermes/stream';
import { sessionsSupported } from '../../hermes/support';
import type { UseHermesChat } from '../../hermes';
import { useT, type TKey } from '../../i18n';
import { deleteConversationState } from '../../nodestate';
import type { ConnectionProfile } from '../../settings/profiles';
import { useShareText } from '../actions';
import { useChatShell } from '../ChatShellContext';
import { useToast } from '../Toast';
import { fetchSkills, fetchUsage, forkSession, skillsError } from './api';
import type { ChatOptionsControl, SlashBinding } from './binding';
import { CommandSheet, type SheetState } from './CommandSheet';
import { confirmAsync } from './confirm';
import { transcriptMarkdown } from './exportText';
import { availability, planCommand, stillPendingApproval, visibleCommands, type CommandContext, type CommandPlan } from './plan';
import { commandById, type CommandDef, type CommandId } from './registry';

const nativeFetch = expoFetch as unknown as FetchLike;

export type UseSlashCommandsArgs = {
  /** false: hidden session → no palette */
  enabled: boolean;
  chat: UseHermesChat;
  profile: ConnectionProfile;
  /** header title ("Hermes", agent name, …) */
  backendName: string;
  model: string | undefined;
  options?: ChatOptionsControl;
  newChat(): void;
  retry(): void;
  stop(): void;
  openModel(query?: string): void;
  /** put text into the composer */
  fill(text: string): void;
  /** send a user message (false = refused, a turn is running) */
  sendText(text: string): boolean;
};

export type SlashCommands = {
  binding: SlashBinding | undefined;
  sheet: ReactNode;
  /** run a command directly (chat menu: export, delete, rename via `title <name>`); same checks as the palette */
  run(id: CommandId, arg?: string): void;
};

export function useSlashCommands(a: UseSlashCommandsArgs): SlashCommands {
  const tr = useT();
  const toast = useToast();
  const shareText = useShareText();
  const shell = useChatShell();
  const convs = useConversations();
  const { controller } = useConversationsInternals();
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const { chat, profile, options } = a;
  const conversationId = shell?.conversationId;
  const meta = conversationId ? convs.get(conversationId) : undefined;
  const hermes = profile.kind === 'hermes';
  const streaming = chat.status === 'streaming';
  const messages = chat.messages;
  const hasUser = messages.some((m) => m.role === 'user');
  const sessionId = hermes ? (meta?.hermesSessionId ?? chat.sessionId) : undefined;
  // /approve, /deny answer the oldest approval that has not expired (Team A's queue; head-only fallback)
  const pendingAll = chat.approvals ?? (chat.approval ? [chat.approval] : []);
  const pending = pendingAll.find((x) => !x.expired) ?? null;

  const ctx: CommandContext = {
    kind: profile.kind,
    bridge: hermes && !!profile.bridge,
    noPalette: !a.enabled,
    sessionsApi: hermes ? sessionsSupported(withBot({ baseUrl: profile.baseUrl, apiKey: profile.apiKey }, meta?.hermesProfile)) : false,
    hasRemoteSession: hermes && hasUser && !!sessionId,
    streaming,
    messageCount: messages.length,
    canRetry: hasUser && messages[messages.length - 1]?.role === 'assistant',
    approval: pending ? { choices: pending.choices.length ? pending.choices : ['once', 'deny'] } : null,
    options: options?.caps && options.onChange ? options.caps : null,
    fast: !!options?.value?.fast,
  };
  // the binding's callbacks read the latest state at call time (the composer is memo'd)
  const live = useRef({ ctx, a, meta, sessionId, pending, pendingAll });
  live.current = { ctx, a, meta, sessionId, pending, pendingAll };

  // the chat's Hermes bot (/p/<bot>/api/…): usage, skills, fork of THIS chat's session
  const bot = meta?.hermesProfile;
  const request = useMemo(() => createJsonRequest(nativeFetch, withBot({ baseUrl: profile.baseUrl, apiKey: profile.apiKey }, bot)), [profile.baseUrl, profile.apiKey, bot]);

  const reasonText = useCallback(
    (def: CommandDef, key: string): string => {
      if (key === 'unavailable') return tr('slash.reason.unavailable', { name: def.name });
      if (key === 'badArg') return tr('slash.reason.badArg', { hint: tr(`slash.cmd.${def.id}.arg` as TKey) });
      return tr(`slash.reason.${key}` as TKey);
    },
    [tr],
  );

  const errText = useCallback((e: unknown) => tr('slash.done.failed', { message: e instanceof Error ? sessionErrorText(e, tr) : String(e) }), [tr]);

  const setOptions = useCallback((patch: Partial<HermesChatOptions>) => {
    const o = live.current.a.options;
    if (!o?.onChange) return;
    const next: HermesChatOptions = { ...(o.value ?? {}), ...patch };
    if (!next.reasoning || next.reasoning === 'default') delete next.reasoning;
    if (!next.fast) delete next.fast;
    o.onChange(Object.keys(next).length ? next : undefined);
  }, []);

  const loadSession = useCallback(
    (kind: 'usage' | 'status') => {
      const { a: cur, sessionId: sid, ctx: c } = live.current;
      const local = {
        backend: `${cur.backendName} · ${cur.profile.name}`,
        model: cur.model ?? tr('slash.sheet.modelDefault'),
        options: chatOptionsSummary(cur.options?.value) || undefined,
      };
      if (!sid || !c.hasRemoteSession) {
        setSheet({ kind, loading: false, data: null, local });
        return;
      }
      setSheet({ kind, loading: true, local });
      fetchUsage(request, sid).then(
        (data) => setSheet((s) => (s?.kind === kind ? { kind, loading: false, data, local } : s)),
        (e: unknown) =>
          setSheet((s) => (s?.kind === kind ? (isNotFoundError(e) ? { kind, loading: false, data: null, local } : { kind, loading: false, error: errText(e), local }) : s)),
      );
    },
    [request, tr, errText],
  );

  const execute = useCallback(
    async (def: CommandDef, plan: CommandPlan) => {
      const { a: cur, meta: m, sessionId: sid } = live.current;
      switch (plan.type) {
        case 'error':
          toast(reasonText(def, plan.key));
          return;
        case 'newChat':
          cur.newChat();
          return;
        case 'fill':
          cur.fill(plan.text);
          return;
        case 'rename': {
          if (!m) return;
          convs.rename(m.id, plan.title);
          const remote = shell?.remote;
          if (remote?.isSynced(m)) {
            try {
              await remote.rename(m, plan.title);
            } catch (e) {
              toast(tr('slash.done.renameLocalOnly', { message: e instanceof Error ? e.message : String(e) }));
              return;
            }
          }
          toast(tr('slash.done.renamed', { title: plan.title }));
          return;
        }
        case 'openModel':
          cur.openModel(plan.query);
          return;
        case 'openOptions':
          cur.options?.onPress();
          return;
        case 'setReasoning':
          setOptions({ reasoning: plan.value });
          toast(tr('slash.done.reasoning', { value: tr(`backends.hermes.reasoning.${plan.value}` as TKey) }));
          return;
        case 'setFast':
          setOptions({ fast: plan.value });
          toast(plan.value ? tr('slash.done.fastOn') : tr('slash.done.fastOff'));
          return;
        case 'retry':
          cur.retry();
          return;
        case 'stop':
          cur.stop();
          return;
        case 'approve':
        case 'deny': {
          const choice = plan.type === 'deny' ? 'deny' : plan.choice;
          // the request the command was planned for: captured before any await (M6)
          let target = live.current.pending;
          if (!target) return;
          if (plan.type === 'approve' && plan.confirm) {
            const ok = await confirmAsync(tr('slash.approveAlways.title'), tr('slash.approveAlways.text'), tr('slash.approveAlways.confirm'), tr('actions.cancel'));
            if (!ok) return;
            // expired / resolved elsewhere meanwhile: never apply the choice to the next request in the queue
            target = stillPendingApproval(live.current.pendingAll, target);
            if (!target) {
              toast(tr('approvals.error.notPending'));
              return;
            }
          }
          try {
            await (cur.chat.respondApprovalFor ? cur.chat.respondApprovalFor(target, choice) : cur.chat.respondApproval(choice));
            toast(choice === 'deny' ? tr('slash.done.denied') : tr('slash.done.approved'));
          } catch (e) {
            toast(errText(e));
          }
          return;
        }
        case 'sendText':
          if (cur.sendText(plan.text)) toast(tr('slash.done.searchSent', { name: cur.backendName }));
          else toast(tr('chat.busy'));
          return;
        case 'skills':
          setSheet({ kind: 'skills', loading: true });
          fetchSkills(request).then(
            (skills) => setSheet((s) => (s?.kind === 'skills' ? { kind: 'skills', loading: false, skills } : s)),
            (e: unknown) => setSheet((s) => (s?.kind === 'skills' ? { kind: 'skills', loading: false, error: skillsError(e) } : s)),
          );
          return;
        case 'usage':
        case 'status':
          loadSession(plan.type);
          return;
        case 'help':
          setSheet({ kind: 'help', commands: visibleCommands(live.current.ctx) });
          return;
        case 'export': {
          const title = m?.title || cur.backendName;
          await shareText(
            transcriptMarkdown(cur.chat.messages, { title, user: tr('slash.export.user'), assistant: cur.backendName, attachment: tr('slash.export.attachment') }),
          );
          return;
        }
        case 'delete': {
          if (!m) return;
          const remote = shell?.remote;
          const synced = !!remote?.isSynced(m);
          const inHermes = synced && !!remote?.canDeleteRemote(m);
          const text = inHermes ? tr('slash.del.textRemote') : synced ? tr('slash.del.textHide') : tr('slash.del.textLocal');
          if (!(await confirmAsync(tr('slash.del.title'), text, tr('slash.del.confirm'), tr('actions.cancel'), true))) return;
          if (cur.chat.status === 'streaming') cur.stop();
          try {
            if (inHermes && remote) await remote.deleteRemote(m); // hides locally on success
            else if (synced) convs.hideRemote(m.id);
            else convs.remove(m.id);
          } catch (e) {
            toast(e instanceof Error ? e.message : String(e));
            return;
          }
          void deleteConversationState(m.id).catch(() => {}); // the shell opens a fresh chat for the deleted one
          return;
        }
        case 'branch': {
          if (!m || !sid) return;
          if (!(await confirmAsync(tr('slash.branch.title'), tr('slash.branch.text'), tr('slash.branch.confirm'), tr('actions.cancel')))) return;
          try {
            const fork = await forkSession(request, sid);
            if (!fork) throw new Error(tr('backends.hermes.errors.invalidSession'));
            const msgs = cur.chat.messages;
            const title = fork.title ?? m.title;
            // a NEW, fully initialised conversation that then becomes the open chat (never a mounted draft, M5)
            controller.createBranch(
              { id: cur.profile.id, kind: cur.profile.kind },
              { messages: msgs, sessionId: fork.id, model: m.model, modelOptions: m.modelOptions, title, bot: m.hermesProfile }
            );
            toast(tr('slash.branch.done', { title: title || fork.id }));
          } catch (e) {
            toast(errText(e));
          }
          return;
        }
      }
    },
    [convs, controller, shell?.remote, request, toast, tr, reasonText, errText, setOptions, loadSession, shareText],
  );

  const visible = useMemo(() => visibleCommands(ctx), [
    // eslint-disable-next-line react-hooks/exhaustive-deps
    ctx.kind, ctx.bridge, ctx.noPalette, ctx.sessionsApi, ctx.options?.reasoning, ctx.options?.fast,
  ]);

  const binding = useMemo<SlashBinding>(
    () => ({
      visible,
      availability: (id) => availability(id, live.current.ctx),
      describe: (def) => tr(`slash.cmd.${def.id}.desc` as TKey),
      backendName: a.backendName,
      run: (def, arg) => {
        const plan = planCommand(def, arg, live.current.ctx, {
          searchPrompt: (query) => tr('slash.searchPrompt', { query }),
          title: live.current.meta?.title,
        });
        void execute(def, plan);
      },
      notify: toast,
      whyNot: (def) => {
        const av = availability(def.id, live.current.ctx);
        return reasonText(def, av.visible ? (av.enabled ? 'unavailable' : av.reason) : 'unavailable');
      },
    }),
    [visible, tr, a.backendName, execute, toast, reasonText],
  );

  const closeSheet = useCallback(() => setSheet(null), []);
  const fillFromSheet = useCallback((text: string) => {
    setSheet(null);
    live.current.a.fill(text);
  }, []);

  const run = useCallback(
    (id: CommandId, arg = '') => {
      const def = commandById(id);
      const plan = planCommand(def, arg, live.current.ctx, {
        searchPrompt: (query) => tr('slash.searchPrompt', { query }),
        title: live.current.meta?.title,
      });
      void execute(def, plan);
    },
    [execute, tr],
  );

  return {
    binding: a.enabled && visible.length ? binding : undefined,
    sheet: <CommandSheet state={sheet} onClose={closeSheet} onFill={fillFromSheet} />,
    run,
  };
}
