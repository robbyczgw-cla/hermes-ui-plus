/**
 * A bot group's chat (spec 2.6, route /group?id=). The bridge runs the rounds (bridge/src/groups.mjs); this screen
 * polls the room log while a round runs and shows:
 *   - your messages right, each bot's message left with its avatar and name;
 *   - hand-overs ("Hermes an Scout: …") and notes as calm grey lines; an approval only as "<Bot> wartet auf eine
 *     Freigabe in seinem Chat · Öffnen" (the card itself is in the bot's own chat);
 *   - while a round runs: who writes now, "3 von 8 Beiträgen in dieser Runde · Anhalten";
 *   - the composer with @-autocomplete and the honest hint "N Bots antworten = N Modellaufrufe".
 * Missing data never leaves a blank screen: loading, off, gone, no bridge and errors each say so.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View, type NativeSyntheticEvent, type TextInput as RNTextInput, type TextInputSelectionChangeEventData } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BotAvatar } from '../bots/BotAvatar';
import { useConversations } from '../conversations/ConversationsProvider';
import { confirmAsync } from '../chat/commands/confirm';
import { Markdown } from '../chat/Markdown';
import { useTitlebarInset } from '../desktop/chrome';
import { botOf, withBot } from '../hermes/bots';
import { hermesJsonRequest } from '../hermes/client';
import { useT } from '../i18n';
import { useActiveProfile } from '../settings/ConnectionProvider';
import { Button, HText, Icon, SheetLayer, TextInput, useTheme } from '../ui';
import { Loader } from '../ui/loaders';
import { useEscapeToClose } from '../ui/lib/useEscapeToClose';
import { deleteGroup, fetchGroup, patchGroup, sendGroupMessage, stopGroup } from './api';
import { addressedBy, GROUP_ID_RE, insertMention, mentionOptions, mentionQuery, mergeEntries, type GroupEntry, type GroupFailure, type GroupInfo, type GroupRound } from './core';
import { AvatarStack, useMemberBots } from './GroupsSection';
import { failureText, noteText } from './text';
import { requestCloseDrawer } from './drawer';
import { openBotChatOf } from './openBotChat';
import { fetchImpl, groupsUsable, refreshGroups } from './useGroups';

const POLL_LIVE_MS = 1200;
const POLL_IDLE_MS = 15_000;

type Load = { kind: 'loading' } | { kind: 'ready' } | { kind: 'off' } | { kind: 'gone' } | { kind: 'error'; failure: GroupFailure } | { kind: 'nobridge' };

export function GroupChatScreen() {
  const t = useTheme();
  const tr = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const titlebarInset = useTitlebarInset();
  const params = useLocalSearchParams<{ id?: string }>();
  const id = typeof params.id === 'string' && GROUP_ID_RE.test(params.id) ? params.id : '';
  const profile = useActiveProfile() ?? undefined;
  const usable = groupsUsable(profile);
  const baseUrl = profile?.baseUrl ?? '';
  const apiKey = profile?.apiKey ?? '';
  const conn = useMemo(() => (usable ? { baseUrl, apiKey } : null), [usable, baseUrl, apiKey]);
  const convs = useConversations();
  const members = useMemberBots();
  const byKey = useMemo(() => new Map(members.map((m) => [m.key, m])), [members]);
  const nameOf = useCallback((k: string) => byKey.get(k)?.label ?? (k === 'default' ? tr('bots.roster.defaultName') : k), [byKey, tr]);

  const [loaded, setLoad] = useState<Load>({ kind: 'loading' });
  const [info, setInfo] = useState<GroupInfo | null>(null);
  const [entries, setEntries] = useState<GroupEntry[]>([]);
  const [round, setRound] = useState<GroupRound | null>(null);
  const [sendError, setSendError] = useState<GroupFailure | null>(null);
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [menu, setMenu] = useState(false);
  const seqRef = useRef(0);
  const liveRef = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);

  const close = useCallback(() => (router.canGoBack() ? router.back() : router.replace('/')), [router]);
  useEscapeToClose(!menu, close);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });
    return () => sub.remove();
  }, [close]);

  const poll = useCallback(async () => {
    if (!conn || !id) return;
    const r = await fetchGroup(fetchImpl, conn, id, seqRef.current);
    if (!alive.current) return;
    if (!r.ok) {
      if (r.failure === 'unknown') setLoad({ kind: 'gone' });
      else if (r.failure === 'off') setLoad({ kind: 'off' });
      else if (seqRef.current === 0) setLoad({ kind: 'error', failure: r.failure });
      return; // a failed poll of a loaded group keeps what we have; the next poll tries again
    }
    const st = r.value;
    setInfo(st.group);
    if (st.entries.length) setEntries((prev) => mergeEntries(prev, st.entries));
    seqRef.current = Math.max(seqRef.current, st.seq);
    setRound(st.round);
    const wasLive = liveRef.current;
    liveRef.current = !!st.round;
    if (wasLive && !st.round) void refreshGroups(conn); // the Bots tab row: last line, no "antwortet …"
    setLoad({ kind: 'ready' });
  }, [conn, id]);

  // one timer: fast while a round runs, slow otherwise (other devices may write into the group)
  const tick = useRef<() => Promise<void>>(async () => {});
  const schedule = useCallback((ms: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void tick.current(), ms);
  }, []);
  useEffect(() => {
    tick.current = async () => {
      await poll();
      if (alive.current) schedule(liveRef.current ? POLL_LIVE_MS : POLL_IDLE_MS);
    };
  }, [poll, schedule]);

  useEffect(() => {
    alive.current = true;
    if (!conn || !id) return;
    seqRef.current = 0;
    void poll().then(() => alive.current && schedule(liveRef.current ? POLL_LIVE_MS : POLL_IDLE_MS));
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [conn, id, poll, schedule]);

  const groupMembers = useMemo(() => (info?.members ?? []).map((k) => ({ key: k, label: nameOf(k), color: byKey.get(k)?.color })), [info, nameOf, byKey]);

  const send = useCallback(
    async (text: string): Promise<boolean> => {
      if (!conn || !id || sending) return false;
      setSending(true);
      setSendError(null);
      const r = await sendGroupMessage(fetchImpl, conn, id, text);
      setSending(false);
      if (!r.ok) {
        setSendError(r.failure);
        return false;
      }
      liveRef.current = true;
      await poll();
      schedule(POLL_LIVE_MS);
      return true;
    },
    [conn, id, sending, poll, schedule],
  );

  const stop = useCallback(async () => {
    if (!conn || !id || stopping) return;
    setStopping(true);
    await stopGroup(fetchImpl, conn, id);
    await poll();
    setStopping(false);
  }, [conn, id, stopping, poll]);

  /** "Öffnen" on an approval line: the bot's own chat, where the card is */
  const openBot = useCallback(
    async (bot: string) => {
      if (!profile || profile.kind !== 'hermes') return;
      const b = botOf(bot);
      const meta = await openBotChatOf({ list: () => convs.list, openBotChat: convs.openBotChat }, profile, b, hermesJsonRequest(withBot({ baseUrl: profile.baseUrl, apiKey: profile.apiKey }, b))).catch(() => null);
      if (!meta) return;
      // the bot's chat may be open already under this screen (same connection, no remount): without a fresh list its
      // useGroupApprovals keeps the copy from before this approval and the card never shows
      if (conn) await refreshGroups(conn);
      requestCloseDrawer();
      convs.setActiveId(meta.id);
      if (router.canDismiss?.()) router.dismissTo('/');
      else router.replace('/');
    },
    [profile, convs, router, conn],
  );

  const rename = useCallback(
    async (name: string) => {
      if (!conn || !id) return;
      const r = await patchGroup(fetchImpl, conn, id, { name });
      if (r.ok) {
        setInfo(r.value);
        void refreshGroups(conn);
      }
    },
    [conn, id],
  );
  const remove = useCallback(async () => {
    if (!conn || !id || !info) return;
    const ok = await confirmAsync(tr('groups.chat.deleteTitle', { name: info.name }), tr('groups.chat.deleteBody'), tr('groups.chat.delete'), tr('groups.chat.cancel'), true);
    if (!ok) return;
    if (await deleteGroup(fetchImpl, conn, id)) {
      void refreshGroups(conn);
      close();
    }
  }, [conn, id, info, tr, close]);

  const waitingNow = useMemo(() => new Set((round?.waiting ?? []).map((w) => w.requestId)), [round]);
  const title = info?.name ?? '';

  // ---------------------------------------------------------------- render
  const load: Load = !conn ? { kind: 'nobridge' } : !id ? { kind: 'gone' } : loaded;
  let body: React.ReactNode;
  if (load.kind !== 'ready') {
    const text =
      load.kind === 'loading' ? tr('groups.chat.loading')
      : load.kind === 'off' ? tr('groups.chat.off')
      : load.kind === 'gone' ? tr('groups.chat.gone')
      : load.kind === 'nobridge' ? tr('groups.chat.noConnection')
      : failureText(load.failure, tr);
    body = (
      <View style={styles.center} testID={`group-state-${load.kind}`}>
        {load.kind === 'loading' ? <Loader kind="dots" size={18} /> : <Icon name="info" size={22} color={t.colors.muted} />}
        <HText variant="body" color="muted" style={styles.centerText} accessibilityLiveRegion="polite">
          {text}
        </HText>
        {load.kind === 'error' ? <Button label={tr('groups.chat.retry')} variant="secondary" size="small" onPress={() => void poll()} /> : null}
        {load.kind !== 'loading' && load.kind !== 'error' ? <Button label={tr('groups.chat.backToChats')} variant="secondary" size="small" onPress={close} /> : null}
      </View>
    );
  } else {
    body = (
      // "padding" on Android too, like the chat (ChatView): edge-to-edge Android does not resize the window for the keyboard
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <RoomLog
          entries={entries}
          round={round}
          nameOf={nameOf}
          byKey={byKey}
          waitingNow={waitingNow}
          leader={groupMembers[0]?.label ?? ''}
          onOpenBot={openBot}
        />
        {round ? <RoundBar round={round} stopping={stopping} onStop={stop} /> : null}
        <GroupComposer members={groupMembers} name={title} disabled={!!round || sending} sending={sending} onSend={send} error={sendError ? failureText(sendError, tr) : null} bottomInset={insets.bottom} />
      </KeyboardAvoidingView>
    );
  }

  return (
    <View style={[styles.flex, { backgroundColor: t.colors.bg }]} testID="group-screen">
      <View style={[styles.header, { paddingTop: insets.top + 6, borderBottomColor: t.colors.border }, titlebarInset > 0 && { paddingLeft: titlebarInset }]}>
        <Pressable onPress={close} hitSlop={8} accessibilityRole="button" accessibilityLabel={tr('groups.back')} testID="group-back" style={styles.headerBtn}>
          <Icon name="chevronLeft" size={22} color={t.colors.text} />
        </Pressable>
        {info ? <AvatarStack keys={info.members} byKey={byKey} size={24} /> : null}
        <View style={styles.headerText}>
          <View style={styles.titleRow}>
            <HText variant="headline" numberOfLines={1} accessibilityRole="header" style={styles.shrink} testID="group-title">
              {title || tr('groups.button')}
            </HText>
            <View style={[styles.beta, { borderColor: t.colors.border, borderRadius: t.radii.inline }]}>
              <HText variant="micro" color="muted">
                {tr('groups.beta')}
              </HText>
            </View>
          </View>
          {info ? (
            <HText variant="caption" color="muted" numberOfLines={1}>
              {tr('groups.chat.membersLine', { names: info.members.map(nameOf).join(', ') })}
            </HText>
          ) : null}
        </View>
        {info ? (
          <Pressable onPress={() => setMenu(true)} hitSlop={8} accessibilityRole="button" accessibilityLabel={tr('groups.chat.menu')} testID="group-menu" style={styles.headerBtn}>
            <HText variant="headline" color="muted">
              {'···'}
            </HText>
          </Pressable>
        ) : (
          <View style={styles.headerBtn} />
        )}
      </View>
      {body}
      {info ? <GroupMenu key={menu ? 'open' : 'closed'} visible={menu} name={info.name} onClose={() => setMenu(false)} onRename={rename} onDelete={() => { setMenu(false); void remove(); }} /> : null}
    </View>
  );
}

// ------------------------------------------------------------------ the room

function RoomLog({ entries, round, nameOf, byKey, waitingNow, leader, onOpenBot }: {
  entries: GroupEntry[];
  round: GroupRound | null;
  nameOf(k: string): string;
  byKey: Map<string, { key: string; label: string; color?: string }>;
  waitingNow: Set<string>;
  leader: string;
  onOpenBot(bot: string): void;
}) {
  const tr = useT();
  const list = useRef<FlatList<GroupEntry>>(null);
  const count = entries.length;
  const partialLen = round?.partial.length ?? 0;
  useEffect(() => {
    const h = setTimeout(() => list.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(h);
  }, [count, partialLen, round?.speaker]);

  if (!entries.length && !round) {
    return (
      <View style={styles.center} testID="group-empty">
        <HText variant="headline">{tr('groups.chat.emptyTitle')}</HText>
        <HText variant="body" color="muted" style={styles.centerText}>
          {tr('groups.chat.emptyBody', { leader })}
        </HText>
      </View>
    );
  }
  return (
    <FlatList
      ref={list}
      data={entries}
      keyExtractor={(e) => String(e.seq)}
      style={styles.flex}
      contentContainerStyle={styles.log}
      keyboardShouldPersistTaps="handled"
      renderItem={({ item }) => <EntryView e={item} nameOf={nameOf} byKey={byKey} waitingNow={waitingNow} onOpenBot={onOpenBot} />}
      // a speaker that waits for an approval is not writing: the approval line above says what it waits for
      ListFooterComponent={round?.speaker && !round.waiting.some((w) => w.bot === round.speaker) ? <Speaking round={round} nameOf={nameOf} byKey={byKey} /> : null}
      onContentSizeChange={() => list.current?.scrollToEnd({ animated: false })}
      testID="group-log"
      accessibilityLabel={tr('groups.section')}
    />
  );
}

function EntryView({ e, nameOf, byKey, waitingNow, onOpenBot }: { e: GroupEntry; nameOf(k: string): string; byKey: Map<string, { key: string; label: string; color?: string }>; waitingNow: Set<string>; onOpenBot(bot: string): void }) {
  const t = useTheme();
  const tr = useT();
  if (e.kind === 'user') {
    return (
      <View style={styles.userRow} testID={`group-entry-user-${e.seq}`}>
        <View style={[styles.userBubble, { backgroundColor: t.colors.accentSoft, borderRadius: t.radii.card }]}>
          <HText variant="body" selectable>
            {e.text}
          </HText>
        </View>
      </View>
    );
  }
  if (e.kind === 'bot') {
    const m = byKey.get(e.bot);
    return (
      <View style={styles.botRow} testID={`group-entry-bot-${e.seq}`}>
        <BotAvatar name={nameOf(e.bot)} bot={e.bot === 'default' ? undefined : e.bot} color={m?.color} size={30} />
        <View style={styles.botBody}>
          <HText variant="caption" weight="600" color="muted">
            {nameOf(e.bot)}
            {e.partial ? ` · ${tr('groups.chat.partial')}` : ''}
          </HText>
          <Markdown text={e.text} />
        </View>
      </View>
    );
  }
  const waiting = e.kind === 'note' && e.note === 'approval' && !!e.requestId && waitingNow.has(e.requestId);
  const text = noteText(e, nameOf, tr, { waitingNow: waiting });
  if (!text) return null;
  const warn = waiting;
  return (
    <View style={styles.noteRow} testID={`group-entry-${e.kind === 'note' ? `note-${e.note}` : 'handoff'}-${e.seq}`}>
      {e.kind === 'handoff' ? <Icon name="arrowRight" size={14} color={t.colors.subtle} /> : warn ? <View style={[styles.dot, { backgroundColor: t.colors.warning }]} /> : null}
      <HText variant="caption" color={warn ? undefined : 'subtle'} style={[styles.noteText, warn && { color: t.colors.warning }]}>
        {text}
      </HText>
      {waiting && e.kind === 'note' && e.bot ? (
        <Pressable onPress={() => onOpenBot(e.bot!)} hitSlop={8} accessibilityRole="button" testID={`group-approval-open-${e.bot}`}>
          <HText variant="caption" weight="600" style={{ color: t.colors.accentText }}>
            {tr('groups.note.open')}
          </HText>
        </Pressable>
      ) : null}
    </View>
  );
}

function Speaking({ round, nameOf, byKey }: { round: GroupRound; nameOf(k: string): string; byKey: Map<string, { key: string; label: string; color?: string }> }) {
  const t = useTheme();
  const tr = useT();
  const bot = round.speaker!;
  const name = nameOf(bot);
  return (
    <View style={styles.botRow} testID="group-speaking" accessibilityLiveRegion="polite">
      <BotAvatar name={name} bot={bot === 'default' ? undefined : bot} color={byKey.get(bot)?.color} size={30} />
      <View style={styles.botBody}>
        <View style={styles.speakingHead}>
          <View style={[styles.dot, { backgroundColor: t.colors.success }]} />
          <HText variant="caption" weight="600" color="muted" numberOfLines={1} style={styles.shrink}>
            {round.step ? tr('groups.chat.step', { name, step: round.step }) : tr('groups.chat.writing', { name })}
          </HText>
        </View>
        {round.partial ? <Markdown text={round.partial} streaming /> : <Loader kind="dots" size={14} />}
      </View>
    </View>
  );
}

function RoundBar({ round, stopping, onStop }: { round: GroupRound; stopping: boolean; onStop(): void }) {
  const t = useTheme();
  const tr = useT();
  return (
    <View style={[styles.roundBar, { borderTopColor: t.colors.border, backgroundColor: t.colors.surface }]} testID="group-round">
      <HText variant="caption" color="muted" tabular style={styles.flex} accessibilityLiveRegion="polite">
        {tr('groups.chat.round', { n: Math.min(round.turns + 1, round.max), max: round.max })}
      </HText>
      <Button label={stopping ? tr('groups.chat.stopping') : tr('groups.chat.stop')} variant="secondary" size="small" onPress={onStop} disabled={stopping} testID="group-stop" />
    </View>
  );
}

// ------------------------------------------------------------------ composer with @-autocomplete

function GroupComposer({ members, name, disabled, sending, onSend, error, bottomInset }: {
  members: { key: string; label: string; color?: string }[];
  name: string;
  disabled: boolean;
  sending: boolean;
  onSend(text: string): Promise<boolean>;
  error: string | null;
  bottomInset: number;
}) {
  const t = useTheme();
  const tr = useT();
  const [text, setText] = useState('');
  const [sel, setSel] = useState({ start: 0, end: 0 });
  const [forced, setForced] = useState<{ start: number; end: number } | undefined>(undefined);
  const inputRef = useRef<RNTextInput>(null);
  const q = mentionQuery(text, sel.start);
  const options = q ? mentionOptions(q.query, members, tr('groups.chat.everyone')) : [];
  const who = addressedBy(text, members);
  const answering = who.everyone ? members.length : who.keys.length || (members.length ? 1 : 0);
  const hint = who.everyone
    ? tr('groups.chat.hintEveryone', { count: members.length })
    : who.keys.length
      ? tr('groups.chat.hintNamed', { names: who.keys.map((k) => members.find((m) => m.key === k)?.label ?? k).join(', ') })
      : tr('groups.chat.hintLeader', { name: members[0]?.label ?? '' });
  const canSend = !!text.trim() && !disabled;

  const pick = (tag: string) => {
    if (!q) return;
    const r = insertMention(text, q.start, sel.start, tag);
    setText(r.text);
    setSel({ start: r.caret, end: r.caret });
    setForced({ start: r.caret, end: r.caret });
    // the tap moved the focus to the option: back into the field, so the next words land after the name
    requestAnimationFrame(() => inputRef.current?.focus());
  };
  const submit = async () => {
    if (!canSend) return;
    const v = text.trim();
    if (await onSend(v)) {
      setText('');
      setSel({ start: 0, end: 0 });
    }
  };

  return (
    <View style={[styles.composerWrap, { borderTopColor: t.colors.border, paddingBottom: Math.max(bottomInset, 8) }]}>
      {options.length ? (
        <View style={[styles.mentions, { backgroundColor: t.colors.surface, borderColor: t.colors.border, borderRadius: t.radii.control }]} testID="group-mentions">
          {options.map((o) => (
            <Pressable
              key={o.key}
              onPress={() => pick(o.tag)}
              accessibilityRole="button"
              accessibilityLabel={tr('groups.chat.mentionA11y', { name: o.label })}
              testID={`group-mention-${o.tag}`}
              style={({ pressed }) => [styles.mention, pressed && { backgroundColor: t.colors.surfacePressed }]}
            >
              {o.key === '*' ? <View style={styles.mentionIcon}><HText variant="bodyStrong" color="muted">@</HText></View> : <BotAvatar name={o.label} bot={o.key === 'default' ? undefined : o.key} color={members.find((m) => m.key === o.key)?.color} size={24} />}
              <HText variant="body" numberOfLines={1} style={styles.flex}>
                {o.label}
              </HText>
              <HText variant="caption" color="subtle">{`@${o.tag}`}</HText>
            </Pressable>
          ))}
        </View>
      ) : null}
      {error ? (
        <HText variant="caption" style={{ color: t.colors.danger }} accessibilityRole="alert" testID="group-send-error">
          {error}
        </HText>
      ) : null}
      <View style={styles.composerRow}>
        <TextInput
          ref={inputRef}
          value={text}
          onChangeText={(v) => {
            setText(v);
            setForced(undefined);
          }}
          selection={forced}
          onSelectionChange={(ev: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
            setSel(ev.nativeEvent.selection);
            setForced(undefined);
          }}
          placeholder={tr('groups.chat.placeholder', { name })}
          multiline
          maxLength={8000}
          testID="group-input"
          accessibilityLabel={tr('groups.chat.placeholder', { name })}
          style={[styles.input, { borderColor: t.colors.border, borderRadius: t.radii.card, backgroundColor: t.colors.surface, color: t.colors.text }]}
          onKeyPress={(ev) => {
            const ne = ev.nativeEvent as { key?: string; shiftKey?: boolean };
            if (Platform.OS === 'web' && ne.key === 'Enter' && !ne.shiftKey) {
              (ev as unknown as { preventDefault?: () => void }).preventDefault?.();
              void submit();
            }
          }}
        />
        <Pressable
          onPress={() => void submit()}
          disabled={!canSend}
          accessibilityRole="button"
          accessibilityLabel={tr('groups.chat.send')}
          testID="group-send"
          style={[styles.sendBtn, { backgroundColor: canSend ? t.colors.accent : t.colors.surfaceAlt, borderRadius: t.radii.pill }]}
        >
          {sending ? <Loader kind="dots" size={12} /> : <Icon name="send" size={18} color={canSend ? t.colors.onAccent : t.colors.subtle} />}
        </Pressable>
      </View>
      <HText variant="caption" color="subtle" numberOfLines={2} testID="group-hint">
        {`${hint} · ${tr('groups.chat.cost', { count: answering })}`}
      </HText>
    </View>
  );
}

// ------------------------------------------------------------------ menu: rename, delete

function GroupMenu({ visible, name, onClose, onRename, onDelete }: { visible: boolean; name: string; onClose(): void; onRename(name: string): Promise<void>; onDelete(): void }) {
  const t = useTheme();
  const tr = useT();
  // the parent mounts a fresh menu each time it opens (key): no reset effect needed
  const [renaming, setRenaming] = useState(false);
  const [value, setValue] = useState(name);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <SheetLayer onClose={onClose} closeLabel={tr('groups.close')} maxWidth={420} label={tr('groups.chat.menu')} style={styles.menu}>
        {renaming ? (
          <View style={styles.menuBody}>
            <HText variant="headline">{tr('groups.chat.renameTitle')}</HText>
            <TextInput value={value} onChangeText={setValue} maxLength={60} autoFocus testID="group-rename-input" accessibilityLabel={tr('groups.create.name')} style={[styles.renameInput, { borderColor: t.colors.border, borderRadius: t.radii.control, color: t.colors.text, backgroundColor: t.colors.surface }]} />
            <View style={styles.menuButtons}>
              <Button label={tr('groups.chat.cancel')} variant="secondary" size="small" onPress={onClose} />
              <Button
                label={tr('groups.chat.save')}
                variant="primary"
                size="small"
                disabled={!value.trim()}
                onPress={() => {
                  void onRename(value.trim()).then(onClose);
                }}
                testID="group-rename-save"
              />
            </View>
          </View>
        ) : (
          <View style={styles.menuBody}>
            <HText variant="headline" numberOfLines={1}>
              {name}
            </HText>
            <Button label={tr('groups.chat.rename')} variant="secondary" onPress={() => setRenaming(true)} testID="group-rename" />
            <Button label={tr('groups.chat.delete')} variant="secondary" onPress={onDelete} testID="group-delete" />
          </View>
        )}
      </SheetLayer>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  shrink: { flexShrink: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerText: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  beta: { borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 5 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 },
  centerText: { textAlign: 'center', maxWidth: 420 },
  log: { paddingHorizontal: 14, paddingVertical: 14, gap: 12, width: '100%', maxWidth: 820, alignSelf: 'center' },
  userRow: { alignItems: 'flex-end' },
  userBubble: { maxWidth: '86%', paddingHorizontal: 14, paddingVertical: 10 },
  botRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  botBody: { flex: 1, minWidth: 0, gap: 2 },
  speakingHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  noteRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 16 },
  noteText: { textAlign: 'center', flexShrink: 1 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  roundBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth },
  composerWrap: { paddingHorizontal: 12, paddingTop: 8, gap: 6, borderTopWidth: StyleSheet.hairlineWidth, width: '100%', maxWidth: 820, alignSelf: 'center' },
  mentions: { borderWidth: StyleSheet.hairlineWidth, paddingVertical: 4, overflow: 'hidden' },
  mention: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, minHeight: 44 },
  mentionIcon: { width: 24, alignItems: 'center' },
  composerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  input: { flex: 1, borderWidth: 1, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10, minHeight: 44, maxHeight: 160 },
  sendBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  menu: { padding: 0 },
  menuBody: { padding: 20, gap: 12 },
  menuButtons: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end' },
  renameInput: { borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, minHeight: 46 },
});
