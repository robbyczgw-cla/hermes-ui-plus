/**
 * ConversationSidebar – the persistent conversation list on wide windows (≥ 900 px, see ui/lib/layout.ts):
 * the drawer's content (search, selection mode, "läuft" / unread dots, settings row) in a fixed column left
 * of the chat. Collapsible (button, ⌘/Ctrl+B) and resizable by dragging its right edge; both remembered
 * (sidebarState). Below 900 px the shell uses ConversationDrawer instead.
 */
import { useRef } from 'react';
import { Platform, Pressable, StyleSheet, View, type GestureResponderEvent } from 'react-native';
import { TranslucentSurface, useTitlebarInset, useWindowVibrancy } from '../desktop/chrome';
import { useT } from '../i18n';
import { HText, SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH, useTheme } from '../ui';
import { ConversationList, type ConversationListProps } from './ConversationList';
import { ConvIcon } from './icons';
import { setSidebarPrefs } from './sidebarState';

export type ConversationSidebarProps = ConversationListProps & {
  width: number;
  onCollapse(): void;
};

export function ConversationSidebar({ width, onCollapse, ...list }: ConversationSidebarProps) {
  const t = useTheme();
  const tr = useT();
  // macOS app: the traffic lights sit in this row (left inset), the window's sidebar material shows through
  const inset = useTitlebarInset();
  const vibrancy = useWindowVibrancy();
  const header = (
    <View style={[styles.head, inset > 0 && { paddingLeft: inset }]}>
      <HText variant="bodyStrong" style={styles.flex} numberOfLines={1}>
        {tr('conversations.sidebar.title')}
      </HText>
      <Pressable
        onPress={onCollapse}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={tr('conversations.sidebar.hide')}
        style={({ pressed }) => [styles.btn, pressed && { backgroundColor: t.colors.surfacePressed }]}
      >
        <ConvIcon name="sidebar" size={20} color={t.colors.muted} />
      </Pressable>
    </View>
  );
  return (
    <View style={[styles.panel, { width, borderRightColor: t.colors.border, backgroundColor: vibrancy ? 'transparent' : t.colors.bg }]}>
      <TranslucentSurface.Provider value={vibrancy}>
        <ConversationList {...list} header={header} />
      </TranslucentSurface.Provider>
      <ResizeHandle width={width} label={tr('conversations.sidebar.resize')} />
    </View>
  );
}

/** drag the right edge (mouse / touch; plain responder props, no PanResponder) */
function ResizeHandle({ width, label }: { width: number; label: string }) {
  const drag = useRef({ x: 0, start: width, last: width });
  const move = (e: GestureResponderEvent) => {
    const d = drag.current;
    const next = Math.round(Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, d.start + e.nativeEvent.pageX - d.x)));
    if (next === d.last) return;
    d.last = next;
    setSidebarPrefs({ width: next }, false);
  };
  const end = () => setSidebarPrefs({ width: drag.current.last });
  return (
    <View
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(e) => {
        drag.current = { x: e.nativeEvent.pageX, start: width, last: width };
      }}
      onResponderMove={move}
      onResponderRelease={end}
      onResponderTerminate={end}
      accessibilityLabel={label}
      style={[styles.handle, Platform.OS === 'web' && ({ cursor: 'col-resize' } as object)]}
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  panel: { height: '100%', borderRightWidth: StyleSheet.hairlineWidth },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 16, paddingRight: 8, minHeight: 54 },
  btn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  handle: { position: 'absolute', top: 0, bottom: 0, right: -4, width: 8, zIndex: 3 },
});
