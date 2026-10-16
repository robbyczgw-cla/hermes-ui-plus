import { memo, useEffect, useRef, useState } from 'react';
import { Animated, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../ui/primitives/Text';
import { useTitlebarInset } from '../desktop/chrome';
import { useT } from '../i18n';
import { chatMaxWidth } from '../settings/preferences';
import { usePreferences } from '../settings/PreferencesProvider';
import { useTheme } from '../ui';
import { useChatLayout } from './ChatLayoutContext';
import { headerDetail, type HeaderDetail } from './headerDetail';
import { Icon } from './icons';
import type { Health } from './useConnectionHealth';

type Props = {
  topInset: number;
  title: string;
  /** conversation title (wide layout: shown left of the content column, next to the model chip) */
  chatTitle?: string;
  profileName: string;
  /** label when health is offline (default: chat.header.status.unreachable) */
  offlineLabel?: string;
  health: Health;
  streaming: boolean;
  canReset: boolean;
  /** short model label next to the title ('' = server default, only the title is shown) */
  modelLabel?: string;
  /** Hermes v0.22: the model is locked on the chat's Hermes session → lock icon after the model label */
  modelLocked?: boolean;
  onNewChat(): void;
  onSettings(): void;
  /** opens the conversation drawer */
  onMenu(): void;
  /** opens the model picker (title tap) */
  onModel?(): void;
  /** per-chat model options (Hermes: reasoning / "Schnell"): quiet icon button, accent dot + subtitle when active; label = chatOptionsSummary or 'Optionen' */
  options?: { label: string; active: boolean; onPress(): void };
  /** offline demo profile: "DEMO · Vorbereitete Antworten · Verbindung einrichten" strip under the title */
  demo?: { onConnect(): void };
  /** chat menu (phones: ⋯ button, wide: tap on the chat title); undefined = none */
  onChatMenu?(): void;
};

const NATIVE = Platform.OS !== 'web';

// memo: the chat view re-renders on every streaming update; header props only change on status changes
export const ChatHeader = memo(function ChatHeader({
  topInset,
  title,
  chatTitle,
  profileName,
  offlineLabel,
  health,
  streaming,
  canReset,
  modelLabel,
  modelLocked,
  onNewChat,
  onSettings,
  onMenu,
  onModel,
  options,
  demo,
  onChatMenu,
}: Props) {
  const t = useTheme();
  const tr = useT();
  const layout = useChatLayout();
  // macOS app: the traffic lights sit at the left end of this row (desktop/chrome.ts)
  const titlebarInset = useTitlebarInset();
  // calm header (design review P3): healthy → just the title, plus the model / active options as a quiet
  // subtitle; the status (dot + text) appears only when the backend is not reachable.
  const offline = health === 'offline';
  const offlineText = offlineLabel ?? tr('chat.header.status.unreachable');
  const line = headerDetail({
    modelLabel,
    locked: modelLocked,
    optionsLabel: options?.active ? options.label : '',
    lockedLabel: (model) => tr('chat.header.modelLocked', { model }),
  });
  const detail = line.a11y;
  if (layout.wide) {
    return (
      <WideHeader
        topInset={topInset}
        title={title}
        chatTitle={chatTitle}
        profileName={profileName}
        offlineText={offline ? offlineText : null}
        line={line}
        sidebarOpen={layout.sidebarOpen}
        onNewChat={onNewChat}
        onSettings={onSettings}
        onMenu={onMenu}
        onModel={onModel}
        options={options}
        canReset={canReset}
        demo={demo}
        onChatMenu={onChatMenu}
      />
    );
  }
  // right side: [options] [new chat] [⋯]; the left side gets spacers so the title stays centred
  const rightCount = 1 + (options ? 1 : 0) + (onChatMenu ? 1 : 0);
  return (
    <View style={{ paddingTop: topInset, backgroundColor: t.colors.bg }}>
      <View style={[styles.row, titlebarInset > 0 && { paddingLeft: titlebarInset - 8 }]}>
        <HeaderButton icon="menu" label={tr('chat.header.chats')} onPress={onMenu} testID="header-chats" />
        {/* keeps the title centred when more buttons sit on the right */}
        {Array.from({ length: rightCount - 1 }, (_, i) => (
          <View key={i} style={styles.btn} />
        ))}
        <View style={styles.center}>
          <Pressable
            onPress={onModel ?? onSettings}
            testID="header-model"
            hitSlop={{ top: 6, bottom: detail ? 0 : 6, left: 8, right: 8 }}
            style={({ pressed }) => [styles.titleBtn, { borderRadius: t.radii.control }, pressed && { backgroundColor: t.colors.surfacePressed }]}
            accessibilityRole="button"
            accessibilityLabel={tr('chat.header.pickModel.a11y', { title: `${title}${detail ? ` ${detail}` : ''}` })}
          >
            <View style={styles.titleRow}>
              <Text style={[t.typography.headline, styles.title, { color: t.colors.text }]} numberOfLines={1} maxFontSizeMultiplier={1.6}>
                {title}
              </Text>
              {onModel ? <Icon name="chevronDown" size={14} color={t.colors.muted} strokeWidth={2.2} /> : null}
            </View>
            {detail && !offline ? (
              <View style={styles.detailRow}>
                {line.model ? (
                  <Text style={[t.typography.caption, styles.subtitle, { color: t.colors.subtle }]} numberOfLines={1} maxFontSizeMultiplier={1.6}>
                    {line.model}
                  </Text>
                ) : null}
                {line.locked ? <LockMark size={11 * Math.min(t.fontScale, 1.6)} color={t.colors.subtle} /> : null}
                {line.rest ? (
                  <Text style={[t.typography.caption, styles.subtitle, styles.noShrink, { color: t.colors.subtle }]} numberOfLines={1} maxFontSizeMultiplier={1.6}>
                    {line.rest}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </Pressable>
          {offline ? (
            <Pressable
              onPress={onSettings}
              hitSlop={{ top: 2, bottom: 8, left: 8, right: 8 }}
              style={({ pressed }) => [styles.subRow, pressed && { opacity: 0.6 }]}
              accessibilityRole="button"
              accessibilityLabel={tr('chat.header.settings.a11y', { profile: profileName, status: offlineText })}
            >
              <View style={[styles.dot, { backgroundColor: t.colors.danger }]} />
              <Text style={[t.typography.caption, styles.subtitle, { color: t.colors.danger }]} numberOfLines={1} maxFontSizeMultiplier={1.6}>
                {offlineText}
              </Text>
            </Pressable>
          ) : null}
        </View>
        {options ? <HeaderButton icon="settings" label={tr('chat.header.options.a11y', { label: options.label })} onPress={options.onPress} badge={options.active} /> : null}
        <HeaderButton icon="newChat" label={tr('chat.header.newChat')} onPress={onNewChat} disabled={!canReset} testID="header-new-chat" />
        {onChatMenu ? <HeaderButton icon="more" label={tr('menus.chat.open')} onPress={onChatMenu} disabled={!canReset} /> : null}
      </View>
      {demo ? <DemoStrip onConnect={demo.onConnect} /> : null}
    </View>
  );
});

/**
 * Wide layout (≥ 900 px): conversation title + model chip at the left edge of the message column (same centring
 * and max width as the messages, Settings → Chatbreite), sidebar toggle (only while the sidebar is hidden) and
 * options / new chat at the window edges. The column gives way to the buttons when the window is narrow.
 */
function WideHeader({
  topInset,
  title,
  chatTitle,
  profileName,
  offlineText,
  line,
  sidebarOpen,
  onNewChat,
  onSettings,
  onMenu,
  onModel,
  options,
  canReset,
  demo,
  onChatMenu,
}: Pick<Props, 'topInset' | 'title' | 'chatTitle' | 'profileName' | 'onNewChat' | 'onSettings' | 'onMenu' | 'onModel' | 'options' | 'canReset' | 'demo' | 'onChatMenu'> & {
  offlineText: string | null;
  line: HeaderDetail;
  sidebarOpen: boolean;
}) {
  const t = useTheme();
  const tr = useT();
  const { prefs } = usePreferences();
  const [barW, setBarW] = useState(0);
  // the message list pads 16 px and caps its items at the chat width → same column here
  const colMax = chatMaxWidth(prefs);
  const colW = Math.max(0, Math.min(colMax ?? Infinity, barW - 32));
  const colLeft = (barW - colW) / 2;
  // macOS app with the sidebar hidden: the traffic lights take the left end of the row
  const inset = useTitlebarInset();
  const titlebarInset = sidebarOpen ? 0 : inset;
  const sideLeft = titlebarInset > 0 ? titlebarInset - 8 : 8;
  const leftReserve = sidebarOpen ? 16 : sideLeft + 42 + 8;
  const rightReserve = 8 + (options ? 2 : 1) * 42 + 8;
  const detail = line.a11y;
  // no model label (server default): the backend title stands in for it
  const chipRest = line.model ? line.rest : options?.active ? `· ${options.label}` : '';
  return (
    <View style={{ paddingTop: topInset, backgroundColor: t.colors.bg }}>
      <View style={styles.wideRow} onLayout={(e) => setBarW(Math.round(e.nativeEvent.layout.width))}>
        {sidebarOpen ? null : (
          <View style={[styles.wideSide, { left: sideLeft }]}>
            <HeaderButton icon="sidebar" label={tr('conversations.sidebar.show')} onPress={onMenu} />
          </View>
        )}
        <View style={[styles.wideColumn, { marginLeft: Math.max(colLeft, leftReserve), marginRight: Math.max(colLeft, rightReserve) }]}>
          {onChatMenu && canReset ? (
            // title menu (ChatGPT desktop): tap the chat title → chat menu
            <Pressable
              onPress={onChatMenu}
              hitSlop={4}
              style={({ pressed }) => [styles.wideTitleBtn, { borderRadius: t.radii.control }, pressed && { backgroundColor: t.colors.surfacePressed }]}
              accessibilityRole="button"
              accessibilityLabel={tr('menus.chat.titleA11y', { title: chatTitle || title })}
            >
              <Text style={[t.typography.headline, styles.wideTitle, { color: t.colors.text }]} numberOfLines={1} maxFontSizeMultiplier={1.4}>
                {chatTitle || title}
              </Text>
              <Icon name="chevronDown" size={14} color={t.colors.muted} strokeWidth={2.2} />
            </Pressable>
          ) : (
            <Text style={[t.typography.headline, styles.wideTitle, { color: t.colors.text }]} numberOfLines={1} maxFontSizeMultiplier={1.4} accessibilityRole="header">
              {chatTitle || title}
            </Text>
          )}
          <Pressable
            onPress={onModel ?? onSettings}
            testID="header-model"
            hitSlop={6}
            style={({ pressed }) => [styles.chip, { borderRadius: t.radii.pill }, { borderColor: t.colors.border, backgroundColor: pressed ? t.colors.surfacePressed : t.colors.surfaceAlt }]}
            accessibilityRole="button"
            accessibilityLabel={tr('chat.header.pickModel.a11y', { title: `${title}${detail ? ` ${detail}` : ''}` })}
          >
            <Text style={[t.typography.caption, styles.chipText, { color: t.colors.muted }]} numberOfLines={1}>
              {line.model || title}
            </Text>
            {line.locked ? <LockMark size={12} color={t.colors.muted} /> : null}
            {chipRest ? (
              <Text style={[t.typography.caption, styles.chipText, styles.noShrink, { color: t.colors.muted }]} numberOfLines={1}>
                {chipRest}
              </Text>
            ) : null}
            {onModel ? <Icon name="chevronDown" size={13} color={t.colors.muted} strokeWidth={2.2} /> : null}
          </Pressable>
          {offlineText ? (
            <Pressable
              onPress={onSettings}
              hitSlop={6}
              style={({ pressed }) => [styles.subRow, pressed && { opacity: 0.6 }]}
              accessibilityRole="button"
              accessibilityLabel={tr('chat.header.settings.a11y', { profile: profileName, status: offlineText })}
            >
              <View style={[styles.dot, { backgroundColor: t.colors.danger }]} />
              <Text style={[styles.subtitle, { color: t.colors.danger }]} numberOfLines={1}>
                {offlineText}
              </Text>
            </Pressable>
          ) : null}
        </View>
        <View style={[styles.wideSide, { right: 8 }]}>
          {options ? <HeaderButton icon="settings" label={tr('chat.header.options.a11y', { label: options.label })} onPress={options.onPress} badge={options.active} /> : null}
          <HeaderButton icon="newChat" label={tr('chat.header.newChat')} onPress={onNewChat} disabled={!canReset} testID="header-new-chat" />
        </View>
      </View>
      {demo ? <DemoStrip onConnect={demo.onConnect} /> : null}
    </View>
  );
}


function DemoStrip({ onConnect }: { onConnect(): void }) {
  const t = useTheme();
  const tr = useT();
  return (
    <View style={styles.demoRow}>
      <View style={[styles.demo, { borderRadius: t.radii.pill }, { backgroundColor: t.colors.surfaceAlt }]}>
        <View style={[styles.demoBadge, { borderRadius: t.radii.pill }, { backgroundColor: t.colors.accentSoft }]}>
          <Text style={[t.typography.micro, styles.demoBadgeText, { color: t.colors.accentText }]}>{tr('chat.header.demo.badge')}</Text>
        </View>
        <Text style={[t.typography.caption, styles.demoText, { color: t.colors.muted }]} numberOfLines={1}>
          {tr('chat.header.demo.text')}
        </Text>
        <Pressable onPress={onConnect} hitSlop={8} accessibilityRole="button" style={({ pressed }) => pressed && { opacity: 0.6 }}>
          <Text style={[t.typography.caption, styles.demoCta, { color: t.colors.accentText }]} numberOfLines={1}>
            {tr('chat.header.demo.connect')}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

/** lock of a locked model: fixed size, never shrinks, so a long model name is ellipsised before it */
function LockMark({ size, color }: { size: number; color: string }) {
  return (
    <View style={styles.noShrink} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Icon name="lock" size={size} color={color} strokeWidth={2.2} />
    </View>
  );
}

function HeaderButton({ icon, label, onPress, disabled, badge, testID }: { icon: 'settings' | 'newChat' | 'menu' | 'sidebar' | 'more'; label: string; onPress(): void; disabled?: boolean; badge?: boolean; testID?: string }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.btn, pressed && { backgroundColor: t.colors.surfacePressed }, disabled && { opacity: 0.35 }]}
    >
      <Icon name={icon} size={22} color={t.colors.text} />
      {badge ? <View style={[styles.badge, { backgroundColor: t.colors.accent, borderColor: t.colors.bg }]} /> : null}
    </Pressable>
  );
}

function StatusDot({ health, streaming }: { health: Health; streaming: boolean }) {
  const t = useTheme();
  const v = useRef(new Animated.Value(1)).current;
  const pulsing = streaming || health === 'checking';
  useEffect(() => {
    if (!pulsing) {
      v.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 0.3, duration: 600, useNativeDriver: NATIVE }),
        Animated.timing(v, { toValue: 1, duration: 600, useNativeDriver: NATIVE }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulsing, v]);
  const color = health === 'offline' ? t.colors.danger : health === 'online' || streaming ? t.colors.success : t.colors.subtle;
  return <Animated.View style={[styles.dot, { backgroundColor: color, opacity: v }]} />;
}

// the header bar takes no zIndex / elevation: its menus are SheetModals (their own layer), and a raised bar
// competes with the conversation drawer in Android's flattened z-order (Fabric hoists the bar next to the
// drawer layer) – the header icons stayed bright over the dimmed chat (conversations/drawerLayer.test.ts)
const styles = StyleSheet.create({
  row: { minHeight: 54, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 },
  btn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 5, maxWidth: '100%' },
  titleBtn: { alignItems: 'center', maxWidth: '100%', minHeight: 36, justifyContent: 'center', paddingHorizontal: 10, paddingVertical: 3 },
  title: { fontWeight: '600', letterSpacing: -0.2, flexShrink: 1 },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 5, maxWidth: '100%', paddingHorizontal: 8 },
  subtitle: { flexShrink: 1 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 3, maxWidth: '100%' },
  noShrink: { flexShrink: 0 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  badge: { position: 'absolute', top: 9, right: 8, width: 9, height: 9, borderRadius: 5, borderWidth: 1.5 },
  // wide layout
  wideRow: { minHeight: 54, flexDirection: 'row', alignItems: 'center' },
  wideSide: { position: 'absolute', top: 0, bottom: 0, flexDirection: 'row', alignItems: 'center' },
  wideColumn: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 },
  wideTitle: { fontWeight: '600', letterSpacing: -0.2, flexShrink: 1 },
  wideTitleBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1, minWidth: 0, minHeight: 44, paddingHorizontal: 8, marginLeft: -8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0, maxWidth: 260, minHeight: 30, paddingHorizontal: 11, borderWidth: StyleSheet.hairlineWidth },
  chipText: { fontWeight: '500', flexShrink: 1 },
  demoRow: { alignItems: 'center', paddingHorizontal: 12, paddingBottom: 6 },
  demo: { flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: '100%', paddingLeft: 5, paddingRight: 12, paddingVertical: 4 },
  demoBadge: { paddingHorizontal: 7, paddingVertical: 2 },
  demoBadgeText: { fontWeight: '700' },
  demoText: { flexShrink: 1 },
  demoCta: { fontWeight: '600' },
});
