import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  Animated,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type ListRenderItem,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewToken,
} from 'react-native';
import { Text } from '../ui/primitives/Text';
import { useT } from '../i18n';
import { useTheme } from '../ui';
import { usePreferences } from '../settings/PreferencesProvider';
import { chatMaxWidth, messageGap } from '../settings/preferences';
import type { ChatMessage } from '../hermes';
import type { HuiNode } from '../protocol/types';
import type { VoiceConn } from '../voice';
import { DragScrollContext, type DragScroll } from '../ui/components/modules/c3/parts';
import { TranslationVoiceProvider } from '../ui/components/modules/c1/speech';
import { dragScrollStep } from './dragScroll';
import { Icon } from './icons';
import { MessageBoundary } from './MessageBoundary';
import { AssistantMessage, UserMessage, type ActionHandler } from './MessageItem';
import { createEvidenceDerive } from './answers/evidence';
import { isLocalMessage } from './localMessages';
import type { EvidenceView } from '../ui/components/modules/a/misc';
import { createListDerive, createReversedList } from './listDerive';
import { initialRenderCount } from './messageArea';
import { perfWrap, usePerfOpen } from '../perf/react';
import { createStick, STICK_AWAY_PX } from './stickToBottom';
import { clearPill, pillStore, setNearBottom } from '../background/noticeState';
import { flashMessage, useFlashed, useReply } from './replyContext';
import { SwipeReply } from './SwipeReply';
import { getReading, updateReading, useReadingLoaded } from './readingStore';
import { seenCandidate, unreadAfter } from './readingState';
import { restoreTarget } from './readingPosition';

export type MessageListHandle = {
  /** also pins the bottom for the next content changes (stickToBottom.ts) */
  scrollToBottom(animated?: boolean): void;
  /** a send failed: show the error card unless the user scrolled away since the send */
  revealLatest(): void;
  /** "Im Chat suchen" / a tapped quote: bring a message into the middle of the view (`flash`: mark it briefly) */
  scrollToMessage(id: string, flash?: boolean): void;
};

type Props = {
  messages: ChatMessage[];
  onAction: ActionHandler;
  onRetry(): void;
  /** node-state scope of the stored conversation */
  conversationId?: string;
  voiceConn?: VoiceConn | null;
  /** follow-up suggestions under the last answer (meta) */
  followups?: HuiNode | null;
  /** older messages of this chat were dropped by the storage cap → subtle marker at the top */
  historyTruncated?: boolean;
  /**
   * check data cards against the chat's tool calls (chat/answers/evidence.ts: no web result → a model-written source
   * shows as "Aus Modellwissen"); off for the scripted demo
   */
  checkEvidence?: boolean;
  /** the user scrolled away from the newest message / came back (the live-card tray collapses meanwhile) */
  onAwayChange?: (away: boolean) => void;
};

const SHOW_JUMP_AT = STICK_AWAY_PX;
/** how long a restored reading offset is re-applied while the rows up to it get measured */
const RESTORE_MS = 1500;

/**
 * Inverted FlatList: offset 0 == bottom, so a streaming answer stays pinned to the bottom for
 * free. When the user has scrolled up, `maintainVisibleContentPosition` (native) keeps the
 * visible content still while the newest message grows (web: browser scroll anchoring).
 */
const NO_EVIDENCE = new Map<string, EvidenceView | undefined>();

export const MessageList = forwardRef<MessageListHandle, Props>(function MessageList({ messages, onAction, onRetry, conversationId, voiceConn = null, followups = null, historyTruncated = false, checkEvidence = false, onAwayChange }, ref) {
  const t = useTheme();
  const tr = useT();
  const list = useRef<FlatList<ChatMessage>>(null);
  const offset = useRef(0);
  const viewH = useRef(0);
  const contentH = useRef(0);
  const [showJump, setShowJump] = useState(false);
  const jumpAnim = useRef(new Animated.Value(0)).current;

  // inverted list data: a real reversed array, a new one per change (a streaming tick copies the previous one and
  // replaces index 0, listDerive.ts). FlatList wraps `renderItem` in a NEW function on every render unless `strictMode`
  // memoizes it on (renderItem, extraData) – so `strictMode` and no per-update `extraData`: otherwise every mounted row
  // gets a new `renderItem` prop and re-renders on every streaming update; this way only the row whose item changed does
  const [reverse] = useState(() => createReversedList<ChatMessage>());
  const data = useMemo(() => reverse(messages), [reverse, messages]);
  // first frame: the newest messages up to a text budget (a long transcript of big answers would otherwise parse and
  // lay out 12 of them before anything shows); the older ones follow in the list's batches right after, above the
  // visible area of the inverted list, so nothing on screen moves
  const [initialCount] = useState(() => initialRenderCount(messages));
  usePerfOpen(conversationId ?? '', messages.length); // no-op unless EXPO_PUBLIC_HUI_PERF is set
  // edit pairs / reformat sources: scanned once for the stable prefix, only the last message per tick (listDerive.ts)
  const [derive] = useState(() => createListDerive<ChatMessage>());
  const derived = useMemo(() => derive(messages), [derive, messages]);
  // "✨ Bearbeiten": answers right after an edit request get a before/after comparison
  // (stable identity while the pairs don't change → streaming ticks don't rebuild renderItem for it)
  const pairsRef = useRef<{ src: Map<string, string> | null; key: string; map: Map<string, string> }>({ src: null, key: '', map: new Map() });
  const editPairs = useMemo(() => {
    const map = derived.editPairs;
    if (map === pairsRef.current.src) return pairsRef.current.map;
    const key = [...map].map(([a, b]) => `${a}>${b}`).join('|');
    pairsRef.current = key !== pairsRef.current.key ? { src: map, key, map } : { ...pairsRef.current, src: map };
    return pairsRef.current.map;
  }, [derived]);
  // A1 "umgeformt ↓": answers a later `[reformat:…]` request refers to (stable identity like editPairs)
  const reformRef = useRef<{ src: Set<string> | null; key: string; set: Set<string> }>({ src: null, key: '', set: new Set() });
  const reformatted = useMemo(() => {
    const set = derived.reformatted;
    if (set === reformRef.current.src) return reformRef.current.set;
    const key = [...set].join('|');
    reformRef.current = key !== reformRef.current.key ? { src: set, key, set } : { ...reformRef.current, src: set };
    return reformRef.current.set;
  }, [derived]);
  // what the chat's tools back per answer (honest evidence); same map while no verdict changes
  const [deriveEvidence] = useState(createEvidenceDerive);
  const evidence = useMemo(() => (checkEvidence ? deriveEvidence(messages, historyTruncated) : NO_EVIDENCE), [checkEvidence, deriveEvidence, messages, historyTruncated]);
  // Settings: Darstellung → Dichte / Chatbreite, Chat → Auto-Scroll
  const { prefs } = usePreferences();
  const maxWidth = chatMaxWidth(prefs);
  const itemStyles = useMemo(
    () => ({
      user: [styles.userItem, { paddingTop: messageGap(20, prefs.density), maxWidth }],
      assistant: [styles.assistantItem, { paddingTop: messageGap(16, prefs.density), maxWidth }],
    }),
    [prefs.density, maxWidth],
  );
  // native: with a threshold the list follows new content while you are near the bottom; without, the view holds still
  const mvcp = useMemo(() => (prefs.autoScroll ? { minIndexForVisible: 0, autoscrollToTopThreshold: 40 } : { minIndexForVisible: 0 }), [prefs.autoScroll]);
  const lastId = messages[messages.length - 1]?.id;
  // B9: the first answer of the chat (its own compaction is a timeline note, not a divider)
  const firstAssistantId = messages.find((m) => m.role === 'assistant')?.id;

  // after a send: the new bubble / error card must not end up below the fold (E2E round 12 F2)
  const [stick] = useState(createStick);
  const scrollToBottom = useCallback(
    (animated = true) => {
      stick.arm(Date.now());
      list.current?.scrollToOffset({ offset: 0, animated });
    },
    [stick],
  );
  const revealLatest = useCallback(() => {
    if (stick.pinned()) list.current?.scrollToOffset({ offset: 0, animated: true });
  }, [stick]);
  const dataRef = useRef(data);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);
  const retryRef = useRef(0);
  const scrollToMessage = useCallback((id: string, flash = false) => {
    const index = dataRef.current.findIndex((m) => m.id === id);
    if (index < 0) return;
    stick.release();
    retryRef.current = 0;
    list.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
    if (flash) {
      flashMessage(id);
      AccessibilityInfo.announceForAccessibility(tr('chat.quote.jumped'));
    }
  }, [stick, tr]);
  // rows far away are not measured yet: jump close by the average height, then once more precisely
  const onScrollToIndexFailed = useCallback((info: { index: number; averageItemLength: number }) => {
    list.current?.scrollToOffset({ offset: Math.max(0, info.averageItemLength * info.index), animated: false });
    if (retryRef.current++ > 2) return;
    setTimeout(() => list.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: 0.5 }), 120);
  }, []);
  useImperativeHandle(ref, () => ({ scrollToBottom, revealLatest, scrollToMessage }), [scrollToBottom, revealLatest, scrollToMessage]);

  const dragScroll = useMemo<DragScroll>(
    () => ({
      scrollBy(dy) {
        const max = contentH.current > 0 ? Math.max(0, contentH.current - viewH.current) : Infinity;
        const { next, moved } = dragScrollStep(offset.current, dy, max);
        if (moved !== 0) {
          offset.current = next;
          list.current?.scrollToOffset({ offset: next, animated: false });
        }
        return moved;
      },
    }),
    [],
  );

  const jumpShown = useRef(false);
  const awayRef = useRef(onAwayChange);
  awayRef.current = onAwayChange;
  // "Antwort ist da" routing (background/noticeState): is this chat scrolled to the newest message?
  useEffect(() => {
    setNearBottom(conversationId, !jumpShown.current);
  }, [conversationId]);
  const pills = useSyncExternalStore(pillStore.subscribe, pillStore.get, pillStore.get);
  const newAnswer = !!conversationId && pills.has(conversationId);
  const setJump = useCallback(
    (v: boolean) => {
      if (jumpShown.current === v) return;
      jumpShown.current = v;
      setNearBottom(conversationId, !v);
      setShowJump(v);
      awayRef.current?.(v);
      Animated.timing(jumpAnim, { toValue: v ? 1 : 0, duration: 160, useNativeDriver: Platform.OS !== 'web' }).start();
    },
    [jumpAnim, conversationId],
  );

  // ---- reading state per chat (readingStore.ts): the newest message seen (unread count on the jump button) and the
  // reading position while scrolled up, both kept across chat switches and app restarts
  const readingLoaded = useReadingLoaded();
  const [seen, setSeen] = useState<string | undefined>(undefined);
  // the stored position is applied (or there was none): only then does "at the bottom" overwrite the stored state
  const [positioned, setPositioned] = useState(false);
  // the end of the newest message is in the lower half of the view (then it counts as seen, see below)
  const [endInView, setEndInView] = useState(true);
  const viewable = useRef<string[]>([]);
  const awayNow = useRef(false);
  const convRef = useRef(conversationId);
  useEffect(() => {
    convRef.current = conversationId;
  }, [conversationId]);
  const saveAnchor = () => {
    const ids = viewable.current;
    if (ids.length) updateReading(convRef.current, { anchor: { id: ids[Math.floor(ids.length / 2)], offset: offset.current, count: dataRef.current.length } });
  };
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken<ChatMessage>[] }) => {
    viewable.current = viewableItems.filter((v) => v.isViewable && v.item).map((v) => v.item!.id);
    if (awayNow.current) saveAnchor();
  }).current;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoreTries = useRef(0);
  const restoreOffset = useRef<{ y: number; until: number } | null>(null);
  const userMoved = useRef(false);
  useEffect(() => {
    if (positioned || !readingLoaded) return;
    const saved = getReading(conversationId);
    const target = userMoved.current ? null : restoreTarget(dataRef.current, saved);
    // the anchor is not in the list yet: the history may still arrive (remote sync); a few renders, then give up
    if (target === 'wait' && ++restoreTries.current <= 6) return;
    // nothing stored (first open): everything in the chat counts as seen
    setSeen(saved?.seen ?? seenCandidate(dataRef.current.slice().reverse()));
    if (target && target !== 'wait') {
      stick.release();
      retryRef.current = 0;
      awayNow.current = true;
      setJump(true);
      setEndInView(false);
      const { index, offset: y } = target;
      // the exact offset: the rows up to it are measured over the next frames, so it is applied again on each content
      // change for a moment (until the user scrolls); otherwise the anchor message in the middle of the view
      if (y !== undefined) restoreOffset.current = { y, until: Date.now() + RESTORE_MS };
      requestAnimationFrame(() => {
        if (userMoved.current) return;
        if (y !== undefined) list.current?.scrollToOffset({ offset: y, animated: false });
        else list.current?.scrollToIndex({ index, animated: false, viewPosition: 0.5 });
      });
    }
    setPositioned(true);
  }, [positioned, readingLoaded, data, conversationId, stick, lastId, setJump]);
  // at the newest message: it is seen once it is complete (an answer still streaming when the user scrolls up counts
  // as new until they come back down); scrolled up: the mark stays where the user left
  const seenNow = seenCandidate(messages);
  // "seen" = the end of the newest message is in the lower half of the view: a little above the bottom (the jump
  // button already shows) with the answer's last lines on screen gives no "1 new answer" for it
  useEffect(() => {
    if (!positioned || !endInView || !seenNow) return;
    setSeen(seenNow);
    updateReading(conversationId, { seen: seenNow });
  }, [positioned, endInView, seenNow, conversationId]);
  // back at the newest message: no reading position to restore
  useEffect(() => {
    if (positioned && !showJump) updateReading(conversationId, { anchor: null });
  }, [positioned, showJump, conversationId]);
  const unread = showJump ? unreadAfter(messages, seen) : 0;

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = e.nativeEvent.contentOffset.y;
      offset.current = y;
      stick.scrolled(y, Date.now());
      const away = y > SHOW_JUMP_AT;
      awayNow.current = away;
      setJump(away);
      setEndInView(y < Math.max(SHOW_JUMP_AT, viewH.current / 2));
      // the position once the scroll rests (wheel / fling: no drag-end event on web)
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = away ? setTimeout(saveAnchor, 300) : null;
    },
    [setJump, stick],
  );
  const onUserScroll = useCallback(() => {
    userMoved.current = true;
    restoreOffset.current = null;
    stick.release();
  }, [stick]);
  // leaving the chat while scrolled up: the position of this moment
  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (awayNow.current) saveAnchor();
  }, []);

  const replyCtx = useReply();
  const replyRef = useRef(replyCtx);
  useEffect(() => {
    replyRef.current = replyCtx;
  }, [replyCtx]);
  const canQuote = !!replyCtx?.canQuote;

  const renderItem = useCallback<ListRenderItem<ChatMessage>>(
    ({ item }) => (
      <FlashRow id={item.id} style={item.role === 'user' ? itemStyles.user : itemStyles.assistant}>
        <SwipeReply onReply={canQuote && quotable(item) ? () => replyRef.current?.reply(item.id) : undefined}>
        <MessageBoundary message={item}>
          {item.role === 'user' ? (
            <UserMessage message={item} />
          ) : (
            perfWrap(item.id === lastId ? 'Answer' : 'OlderAnswer', <AssistantMessage
              message={item}
              isLast={item.id === lastId}
              isFirstTurn={item.id === firstAssistantId}
              onAction={onAction}
              onRetry={onRetry}
              conversationId={conversationId}
              voiceConn={voiceConn}
              followups={item.id === lastId ? followups : null}
              compareBefore={editPairs.get(item.id)}
              reformatted={reformatted.has(item.id)}
              evidence={isLocalMessage(item) ? undefined : evidence.get(item.id)}
            />)
          )}
        </MessageBoundary>
        </SwipeReply>
      </FlashRow>
    ),
    [lastId, firstAssistantId, onAction, onRetry, conversationId, voiceConn, followups, itemStyles, editPairs, reformatted, canQuote, evidence],
  );

  // inverted list: the footer sits visually at the top, above the oldest stored message
  const historyMarker = useMemo(
    () =>
      historyTruncated ? (
        <Text style={[t.typography.caption, styles.historyMarker, { color: t.colors.subtle }]} accessibilityRole="text">
          {tr('chat.list.historyTruncated')}
        </Text>
      ) : null,
    [historyTruncated, t.colors.subtle, tr],
  );

  return (
    <TranslationVoiceProvider conn={voiceConn}>
    <DragScrollContext.Provider value={dragScroll}>
    <View style={styles.flex}>
      <FlatList
        ref={list}
        data={data}
        strictMode
        inverted
        keyExtractor={keyOf}
        renderItem={renderItem}
        ListFooterComponent={historyMarker}
        contentContainerStyle={styles.content}
        style={styles.flex}
        onScroll={onScroll}
        onLayout={(e) => {
          viewH.current = e.nativeEvent.layout.height;
        }}
        onContentSizeChange={(_w, h) => {
          contentH.current = h;
          // mvcp keeps the previously visible row still → re-pin the bottom right after a send
          if (stick.follow(Date.now())) list.current?.scrollToOffset({ offset: 0, animated: false });
          const r = restoreOffset.current;
          if (r && !userMoved.current && Date.now() < r.until && Math.abs(offset.current - r.y) > 1) list.current?.scrollToOffset({ offset: r.y, animated: false });
        }}
        onScrollBeginDrag={onUserScroll}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={VIEWABILITY}
        scrollEventThrottle={32}
        maintainVisibleContentPosition={mvcp}
        onScrollToIndexFailed={onScrollToIndexFailed}
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={initialCount}
        maxToRenderPerBatch={6}
        windowSize={11}
        removeClippedSubviews={false}
        showsVerticalScrollIndicator={Platform.OS === 'web'}
      />
      <Animated.View
        style={[
          styles.jumpWrap,
          {
            opacity: jumpAnim,
            transform: [{ scale: jumpAnim.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }],
          },
        ]}
        // a prop, not a style: react-native-web drops an inline-style 'box-none' (invalid CSS)
        pointerEvents={showJump ? 'box-none' : 'none'}
      >
        <Pressable
          onPress={() => {
            if (conversationId) clearPill(conversationId);
            scrollToBottom(true);
          }}
          accessibilityRole="button"
          accessibilityLabel={unread > 0 ? tr('chat.list.jumpLatestUnread', { count: unread }) : newAnswer ? tr('chat.list.newAnswer') : tr('chat.list.scrollToBottom')}
          testID="chat-jump-latest"
          style={({ pressed }) => [
            styles.jump,
            (newAnswer || unread > 0) && styles.jumpPill,
            { backgroundColor: t.dark ? t.colors.surfaceAlt : t.colors.bg, borderColor: t.colors.borderControl },
            t.shadows.md,
            pressed && { opacity: 0.8 },
          ]}
        >
          {unread > 0 ? (
            <Text style={[t.typography.caption, styles.pillText, { color: t.colors.text }]}>{tr('chat.list.newAnswers', { count: unread })}</Text>
          ) : newAnswer ? (
            <Text style={[t.typography.caption, styles.pillText, { color: t.colors.text }]}>{tr('chat.list.newAnswer')}</Text>
          ) : null}
          <Icon name="arrowDown" size={18} color={t.colors.text} strokeWidth={2} />
        </Pressable>
      </Animated.View>
    </View>
    </DragScrollContext.Provider>
    </TranslationVoiceProvider>
  );
});

const keyOf = (m: ChatMessage) => m.id;
const VIEWABILITY = { itemVisiblePercentThreshold: 10, minimumViewTime: 250 };

/** a finished message with something to quote ("Antworten" by swipe; the menus check the text themselves) */
const quotable = (m: ChatMessage) =>
  m.status !== 'streaming' && m.status !== 'error' && !m.sendPending && !m.sendQueued && !isLocalMessage(m) && !!m.text.trim();

/** a row that flashes briefly after a jump to it (a tapped quote) */
function FlashRow({ id, style, children }: { id: string; style: object; children: ReactNode }) {
  const t = useTheme();
  const on = useFlashed(id);
  const [anim] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!on) return;
    anim.setValue(1);
    Animated.timing(anim, { toValue: 0, duration: 1600, delay: 300, useNativeDriver: Platform.OS !== 'web' }).start();
  }, [on, anim]);
  return (
    <View style={style}>
      {on ? <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.flash, { backgroundColor: t.colors.accentSoft, opacity: anim }]} /> : null}
      {children}
    </View>
  );
}

// FlatList.js has `strictMode` (memoizes the item renderer, react-native/Libraries/Lists/FlatList.js), the legacy
// typings miss it
declare module 'react-native' {
  interface FlatListProps<ItemT> {
    /** memoize the item renderer: rows re-render only when their item, index or `renderItem` changes */
    strictMode?: boolean;
  }
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  // inverted: paddingTop is the visual bottom
  content: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 20 },
  // paddingTop + maxWidth come from the preferences (density, chat width)
  userItem: { paddingBottom: 4, width: '100%', alignSelf: 'center' },
  assistantItem: { paddingBottom: 6, width: '100%', alignSelf: 'center' },
  jumpWrap: { position: 'absolute', bottom: 12, left: 0, right: 0, alignItems: 'center' },
  jump: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
  // "Neue Antwort ↓": the same button, widened with a label
  jumpPill: { width: 'auto', flexDirection: 'row', gap: 6, paddingHorizontal: 14 },
  pillText: { fontWeight: '600' },
  flash: { borderRadius: 12, marginHorizontal: -8 },
  historyMarker: { textAlign: 'center', paddingTop: 14, paddingBottom: 4, paddingHorizontal: 24 },
});
