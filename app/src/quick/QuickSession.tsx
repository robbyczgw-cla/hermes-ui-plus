/**
 * The quick thread of one connection (lazy chunk, mounted by ChatScreen once ⚡ was opened). Same ChatView as every
 * chat – renderer, hui cards, actions, voice – with the quick chat hook, its own header / empty state and
 * "Mit Hermes weitermachen": a new Hermes chat on the same connection (server default model) that starts with the
 * question and the quick answer as copied turns; the user's next message carries them as a marked context block.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { ChatView } from '../chat/ChatView';
import { useToast } from '../chat/Toast';
import { useConversationsInternals } from '../conversations/ConversationsProvider';
import { requestComposerFocus } from '../desktop/bridge';
import type { ChatMessage } from '../hermes/types';
import { useLocale, useT } from '../i18n';
import { deleteConversationState, deleteMessageState } from '../nodestate';
import type { ConnectionProfile } from '../settings/profiles';
import { useTheme } from '../ui';
import { handOffMessages, handOffTitle, quickConversationId, shortModel, type QuickBackend, type QuickConfig } from './core';
import { availability, useQuickAvailability } from './hooks';
import { closeQuick } from './nav';
import { clearThread, loadThread, useQuickSettings } from './store';
import { useQuickChat } from './useQuickChat';

export default function QuickSession({ profile }: { profile: ConnectionProfile }) {
  const t = useTheme();
  const avail = useQuickAvailability(profile);
  const [initial, setInitial] = useState<{ id: string; messages: ChatMessage[] } | null>(null);
  useEffect(() => {
    let alive = true;
    void loadThread(profile.id).then((messages) => {
      if (alive) setInitial({ id: profile.id, messages });
    });
    return () => {
      alive = false;
    };
  }, [profile.id]);
  if (!initial || initial.id !== profile.id || !avail.backend || !avail.key) return <View style={{ flex: 1, backgroundColor: t.colors.bg }} />;
  return <QuickSessionInner key={profile.id} profile={profile} backend={avail.backend} config={avail.config} availKey={avail.key} initial={initial.messages} />;
}

function QuickSessionInner({
  profile,
  backend,
  config,
  availKey,
  initial,
}: {
  profile: ConnectionProfile;
  backend: QuickBackend;
  config: QuickConfig | null;
  availKey: string;
  initial: ChatMessage[];
}) {
  const tr = useT();
  const toast = useToast();
  const { lang } = useLocale();
  const settings = useQuickSettings();
  const { controller } = useConversationsInternals();
  const picked = settings.models[profile.id];
  const convId = quickConversationId(profile.id);

  const onFeatureOff = useCallback(
    (question: string) => {
      // the plugin went away: ⚡ disappears quietly, the question goes back into the chat's composer
      availability.markOff(availKey);
      toast(tr('quick.errors.off'));
      closeQuick({ text: question });
    },
    [availKey, toast, tr],
  );
  const chat = useQuickChat({
    profileId: profile.id,
    backend,
    initialMessages: initial,
    model: config?.allowModelOverride || backend.kind === 'demo' ? picked : undefined,
    fallbackModel: config?.model,
    lang,
    onFeatureOff,
  });

  // expired / cleared answers take their card state (checklists, sliders …) with them
  const ids = useRef(new Set(initial.map((m) => m.id)));
  useEffect(() => {
    const now = new Set(chat.messages.map((m) => m.id));
    for (const id of ids.current) if (!now.has(id)) deleteMessageState(convId, id);
    ids.current = now;
  }, [chat.messages, convId]);

  const messagesRef = useRef(chat.messages);
  useEffect(() => {
    messagesRef.current = chat.messages;
  }, [chat.messages]);
  const handOff = useCallback(
    (answerId: string) => {
      const seed = handOffMessages(messagesRef.current, answerId);
      if (!seed) return;
      try {
        // a NEW Hermes chat on this connection with the server's default model; the copied turns go along as context
        controller.createBranch({ id: profile.id, kind: profile.kind }, { messages: seed, seed: seed.length, title: handOffTitle(seed[0].text) });
        closeQuick();
        toast(tr('quick.handOff.done'));
        setTimeout(requestComposerFocus, 150);
      } catch (e) {
        toast(tr('quick.handOff.failed', { message: e instanceof Error ? e.message : String(e) }));
      }
    },
    [controller, profile.id, profile.kind, toast, tr],
  );
  const onClear = useCallback(() => {
    chat.stop();
    clearThread(profile.id);
    void deleteConversationState(convId);
    toast(tr('quick.thread.cleared'));
  }, [chat, profile.id, convId, toast, tr]);
  // stable binding for ChatView (the answer rows are memoized); the latest callbacks are read at call time
  const quick = useRef({ handOff, onClear });
  useEffect(() => {
    quick.current = { handOff, onClear };
  }, [handOff, onClear]);
  const handOffStable = useCallback((id: string) => quick.current.handOff(id), []);
  const onClearStable = useCallback(() => quick.current.onClear(), []);
  const modelName = shortModel(picked?.model ?? config?.model ?? undefined);
  const binding = useMemo(() => ({ handOff: handOffStable, onClear: onClearStable, model: modelName }), [handOffStable, onClearStable, modelName]);

  return (
    <ChatView
      chat={chat}
      profile={profile}
      health="online"
      model={undefined}
      onPickModel={noop}
      onNewChat={noop}
      onOpenDrawer={noop}
      quick={binding}
    />
  );
}

const noop = () => {};
