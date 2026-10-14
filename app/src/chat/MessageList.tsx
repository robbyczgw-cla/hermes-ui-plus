import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  Animated,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ListRenderItem,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
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
import { createListDerive, createReversedList } from './listDerive';
import { initialRenderCount } from './messageArea';
import { clearPill, pillStore, setNearBottom } from '../background/noticeState';

export type MessageListHandle = {
  scrollToBottom(animated?: boolean): void;
  /** "Im Chat suchen": bring a message into the middle of the view */
  scrollToMessage(id: string): void;
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
};

const SHOW_JUMP_AT = 180;

/**
 * Inverted FlatList: offset 0 == bottom, so a streaming answer stays pinned to the bottom for
 * free. When the user has scrolled up, `maintainVisibleContentPosition` (native) keeps the
 * visible content still while the newest message grows (web: browser scroll anchoring).
 */
export const MessageList = forwardRef<MessageListHandle, Props>(function MessageList({ messages, onAction, onRetry, conversationId, voiceConn = null, followups = null, historyTruncated = false }, ref) {
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

  const scrollToBottom = useCallback((animated = true) => {
    list.current?.scrollToOffset({ offset: 0, animated });
  }, []);
  const dataRef = useRef(data);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);
  const retryRef = useRef(0);
  const scrollToMessage = useCallback((id: string) => {
    const index = dataRef.current.findIndex((m) => m.id === id);
    if (index < 0) return;
    retryRef.current = 0;
    list.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
  }, []);
  // rows far away are not measured yet: jump close by the average height, then once more precisely
  const onScrollToIndexFailed = useCallback((info: { index: number; averageItemLength: number }) => {
    list.current?.scrollToOffset({ offset: Math.max(0, info.averageItemLength * info.index), animated: false });
    if (retryRef.current++ > 2) return;
    setTimeout(() => list.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: 0.5 }), 120);
  }, []);
  useImperativeHandle(ref, () => ({ scrollToBottom, scrollToMessage }), [scrollToBottom, scrollToMessage]);

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
      Animated.timing(jumpAnim, { toValue: v ? 1 : 0, duration: 160, useNativeDriver: Platform.OS !== 'web' }).start();
    },
    [jumpAnim, conversationId],
  );

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = e.nativeEvent.contentOffset.y;
      offset.current = y;
      setJump(y > SHOW_JUMP_AT);
    },
    [setJump],
  );

  const renderItem = useCallback<ListRenderItem<ChatMessage>>(
    ({ item }) => (
      <View style={item.role === 'user' ? itemStyles.user : itemStyles.assistant}>
        <MessageBoundary message={item}>
          {item.role === 'user' ? (
            <UserMessage message={item} />
          ) : (
            <AssistantMessage
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
            />
          )}
        </MessageBoundary>
      </View>
    ),
    [lastId, firstAssistantId, onAction, onRetry, conversationId, voiceConn, followups, itemStyles, editPairs, reformatted],
  );

  // inverted list: the footer sits visually at the top, above the oldest stored message
  const historyMarker = useMemo(
    () =>
      historyTruncated ? (
        <Text style={[styles.historyMarker, { color: t.colors.subtle }]} accessibilityRole="text">
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
        }}
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
            pointerEvents: showJump ? 'box-none' : 'none',
          },
        ]}
      >
        <Pressable
          onPress={() => {
            if (conversationId) clearPill(conversationId);
            scrollToBottom(true);
          }}
          accessibilityRole="button"
          accessibilityLabel={newAnswer ? tr('chat.list.newAnswer') : tr('chat.list.scrollToBottom')}
          style={({ pressed }) => [
            styles.jump,
            newAnswer && styles.jumpPill,
            { backgroundColor: t.dark ? t.colors.surfaceAlt : t.colors.bg, borderColor: t.colors.borderStrong },
            t.shadows.md,
            pressed && { opacity: 0.8 },
          ]}
        >
          {newAnswer ? <Text style={[styles.pillText, { color: t.colors.text }]}>{tr('chat.list.newAnswer')}</Text> : null}
          <Icon name="arrowDown" size={18} color={t.colors.text} strokeWidth={2} />
        </Pressable>
      </Animated.View>
    </View>
    </DragScrollContext.Provider>
    </TranslationVoiceProvider>
  );
});

const keyOf = (m: ChatMessage) => m.id;

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
  pillText: { fontSize: 13.5, fontWeight: '600' },
  historyMarker: { fontSize: 12.5, lineHeight: 17, textAlign: 'center', paddingTop: 14, paddingBottom: 4, paddingHorizontal: 24 },
});
