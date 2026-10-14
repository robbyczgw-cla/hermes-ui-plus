/**
 * App-wide wiring of background turns (mounted once in the root layout, inside PushHost):
 *  - Android foreground service while any turn runs (keepAlive.ts + modules/stream-keepalive), setting
 *    "Antworten im Hintergrund fertigstellen"
 *  - "Antwort ist da" notices (notice.ts / noticeState.ts): local notification in the background, banner with
 *    "Öffnen" in the foreground when the answer belongs to another chat / screen, unread dot (persisted)
 *  - one notification permission prompt, at the first turn (Android 13+ / iOS), so both features can show something
 *
 * iOS: no Expo API grants extra background execution time (expo-background-task only schedules BGTaskScheduler
 * work), so a stream there survives only the few seconds iOS allows; a cut answer offers "Fortsetzen" (cut.ts).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Animated, AppRegistry, AppState, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useConversations } from '../conversations';
import { useT } from '../i18n';
import { notificationsModule } from '../push/device';
import { allPushSettings } from '../push/settingsStore';
import { useConnection } from '../settings/ConnectionProvider';
import { usePreferences } from '../settings/PreferencesProvider';
import { useTheme } from '../ui';
import { createKeepAliveController } from './keepAlive';
import { KEEPALIVE_TASK, keepAliveModule } from './keepAliveNative';
import { desktopNotify, desktopWindowFocused, isDesktopApp } from '../desktop/bridge';
import { notificationBody, type NoticeEvent } from './notice';
import { createNoticeDelivery, markRead, onAnswerReady, shellState, unreadStore } from './noticeState';
import { turnRegistry } from './turnRegistry';

const UNREAD_KEY = 'hermes.unread.v1';
const ASKED_KEY = 'hermes.answerNotify.asked.v1';
const ANSWER_CHANNEL = 'hui-answers';
const BANNER_MS = 7000;

// The service's headless task: keeps JS timers running while the app is in the background. Its body is set once
// the controller exists; until then (or without a running turn) it ends at once.
let taskBody: () => Promise<void> = () => Promise.resolve();
if (Platform.OS === 'android') AppRegistry.registerHeadlessTask(KEEPALIVE_TASK, () => () => taskBody());

type Banner = { ev: NoticeEvent; name: string; n: number };

export function BackgroundTurnHost() {
  const tr = useT();
  const router = useRouter();
  const { prefs } = usePreferences();
  const { profiles, active, setActive } = useConnection();
  const convs = useConversations();
  const [banner, setBanner] = useState<Banner | null>(null);

  const latest = useRef({ prefs, profiles, active, setActive, convs, tr });
  useLayoutEffect(() => {
    latest.current = { prefs, profiles, active, setActive, convs, tr };
  });

  // ---------- Android foreground service while a turn runs
  useEffect(() => {
    const mod = keepAliveModule();
    if (!mod) return;
    const ctl = createKeepAliveController({
      module: mod,
      registry: turnRegistry,
      enabled: () => latest.current.prefs.finishInBackground,
      texts: () => {
        const t = latest.current.tr;
        return {
          title: (v) => t('chat.background.keepAlive.title', v),
          one: () => t('chat.background.keepAlive.one'),
          many: (v) => t('chat.background.keepAlive.many', v),
          stop: t('chat.background.keepAlive.stop'),
          channel: t('chat.background.keepAlive.channel'),
        };
      },
      log: (m) => console.warn('[keepalive]', m),
    });
    taskBody = () => ctl.task();
    return () => {
      taskBody = () => Promise.resolve();
      ctl.dispose();
    };
  }, []);

  // ---------- notification permission: asked once, at the first turn (the app is in the foreground then)
  useEffect(() => {
    if (Platform.OS === 'web') return;
    let asked = false;
    return turnRegistry.subscribe(() => {
      if (asked || !turnRegistry.snapshot().length) return;
      const p = latest.current.prefs;
      if (!p.notifyWhenDone && !(Platform.OS === 'android' && p.finishInBackground)) return;
      asked = true;
      void (async () => {
        if ((await AsyncStorage.getItem(ASKED_KEY).catch(() => null)) === '1') return;
        const N = await notificationsModule();
        if (!N) return;
        try {
          await ensureAnswerChannel(latest.current.tr);
          const st = await N.getPermissionsAsync();
          if (!st.granted && st.canAskAgain) await N.requestPermissionsAsync();
        } catch {
          /* not available */
        }
        void AsyncStorage.setItem(ASKED_KEY, '1').catch(() => {});
      })();
    });
  }, []);

  // ---------- unread dots (persisted)
  useEffect(() => {
    let loaded = false;
    void AsyncStorage.getItem(UNREAD_KEY)
      .then((raw) => {
        const ids = raw ? (JSON.parse(raw) as unknown) : [];
        if (Array.isArray(ids)) {
          const cur = unreadStore.get();
          const merged = new Set([...ids.filter((x): x is string => typeof x === 'string'), ...cur]);
          if (shellState.openConversationId) merged.delete(shellState.openConversationId);
          unreadStore.set(merged);
        }
      })
      .catch(() => {})
      .finally(() => {
        loaded = true;
      });
    return unreadStore.subscribe(() => {
      if (!loaded) return;
      void AsyncStorage.setItem(UNREAD_KEY, JSON.stringify([...unreadStore.get()])).catch(() => {});
    });
  }, []);

  // back in the app with that chat open: it counts as read
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && shellState.chatFocused && shellState.openConversationId) markRead(shellState.openConversationId);
    });
    return () => sub.remove();
  }, []);

  // ---------- "Antwort ist da"
  useEffect(() => {
    const nameOf = (ev: NoticeEvent) => {
      const { convs: c, profiles: ps } = latest.current;
      const meta = c.get(ev.conversationId);
      return { meta, profile: ps.find((p) => p.id === meta?.profileId) };
    };
    const deliver = createNoticeDelivery({
      context: () => ({
        appActive: isDesktopApp()
          ? AppState.currentState !== 'background' && desktopWindowFocused()
          : AppState.currentState === 'active' || (Platform.OS === 'web' && AppState.currentState !== 'background'),
        openConversationId: shellState.openConversationId,
        chatFocused: shellState.chatFocused,
        nearBottom: shellState.openConversationId ? (shellState.nearBottom.get(shellState.openConversationId) ?? true) : true,
      }),
      enabled: () => latest.current.prefs.notifyWhenDone,
      now: () => Date.now(),
      banner: (ev) => {
        const { profile } = nameOf(ev);
        setBanner((b) => ({ ev, name: profile?.name ?? 'Hermes', n: (b?.n ?? 0) + 1 }));
      },
      notify: (ev) => {
        const { profile, meta } = nameOf(ev);
        const t = latest.current.tr;
        const preview = profile ? allPushSettings()[profile.id]?.preview !== 'off' : true;
        void presentAnswer(t, {
          title: t('chat.background.ready.notificationTitle', { name: profile?.name ?? 'Hermes' }),
          body: notificationBody(ev.message, preview, t('chat.background.ready.generic')),
          data: {
            src: 'turn',
            profileId: profile?.id ?? meta?.profileId ?? '',
            conversationId: ev.conversationId,
            messageId: ev.message.id,
          },
        });
      },
    });
    return onAnswerReady((ev) => void deliver(ev));
  }, []);

  const open = (ev: NoticeEvent) => {
    setBanner(null);
    const { convs: c, profiles: ps, active: act, setActive: setAct } = latest.current;
    const meta = c.get(ev.conversationId);
    if (!meta) return;
    const p = ps.find((x) => x.id === meta.profileId);
    if (p && p.id !== act.id) setAct(p.id);
    c.setActiveId(meta.id);
    router.navigate('/');
  };

  return banner ? <AnswerBanner key={banner.n} name={banner.name} onOpen={() => open(banner.ev)} onClose={() => setBanner(null)} /> : null;
}

function AnswerBanner({ name, onOpen, onClose }: { name: string; onOpen(): void; onClose(): void }) {
  const t = useTheme();
  const tr = useT();
  const insets = useSafeAreaInsets();
  const [anim] = useState(() => new Animated.Value(0));
  const closeRef = useRef(onClose);
  useLayoutEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    Animated.timing(anim, { toValue: 1, duration: 180, useNativeDriver: Platform.OS !== 'web' }).start();
    const id = setTimeout(() => closeRef.current(), BANNER_MS);
    return () => clearTimeout(id);
  }, [anim]);
  return (
    <Animated.View
      style={[
        styles.wrap,
        { top: insets.top + BELOW_HEADER, opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] }) }] },
      ]}
      pointerEvents="box-none"
    >
      <View
        style={[styles.banner, { backgroundColor: t.dark ? t.colors.surfaceAlt : t.colors.bg, borderColor: t.colors.borderStrong, borderRadius: t.radii.l }, t.shadows.md]}
        accessibilityLiveRegion="polite"
        accessibilityRole="alert"
      >
        <Pressable onPress={onOpen} style={styles.textWrap} accessibilityRole="button" accessibilityLabel={`${tr('chat.background.ready.banner', { name })}. ${tr('chat.background.ready.open')}`}>
          <Text style={[styles.text, { color: t.colors.text }]} numberOfLines={2}>
            {tr('chat.background.ready.banner', { name })}
          </Text>
        </Pressable>
        <Pressable onPress={onOpen} hitSlop={8} accessibilityRole="button" style={({ pressed }) => pressed && { opacity: 0.6 }}>
          <Text style={[styles.action, { color: t.colors.accent }]}>{tr('chat.background.ready.open')}</Text>
        </Pressable>
        <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel={tr('chat.background.ready.dismiss')} style={({ pressed }) => pressed && { opacity: 0.6 }}>
          <Text style={[styles.close, { color: t.colors.muted }]}>✕</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

type Tr = ReturnType<typeof useT>;

let channelReady: Promise<void> | null = null;
function ensureAnswerChannel(t: Tr): Promise<void> {
  if (Platform.OS !== 'android') return Promise.resolve();
  if (!channelReady) {
    channelReady = notificationsModule().then(async (N) => {
      if (!N) return;
      await N.setNotificationChannelAsync(ANSWER_CHANNEL, {
        name: t('chat.background.ready.channel'),
        description: t('chat.background.ready.channelDescription'),
        importance: N.AndroidImportance.DEFAULT,
        sound: 'default',
      });
    });
    channelReady.catch(() => {
      channelReady = null;
    });
  }
  return channelReady;
}

/** local notification "Antwort fertig – <Profil>" (tap → PushHost opens the conversation, push/model parseTarget) */
async function presentAnswer(t: Tr, o: { title: string; body: string; data: Record<string, string> }): Promise<void> {
  if (isDesktopApp()) {
    await desktopNotify(o.title, o.body, { data: o.data }); // click → that chat (PushHost)
    return;
  }
  const N = await notificationsModule();
  if (!N) return;
  try {
    await ensureAnswerChannel(t);
    await N.scheduleNotificationAsync({
      content: { title: o.title, body: o.body, data: o.data, sound: 'default' },
      trigger: Platform.OS === 'android' ? { channelId: ANSWER_CHANNEL } : null,
    });
  } catch {
    /* permission missing etc. */
  }
}

/** the banner sits below the chat header row (54 px; ChatHeader) so title and buttons stay usable */
const BELOW_HEADER = 66;

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 12, right: 12, alignItems: 'center', zIndex: 1000, elevation: 12 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingHorizontal: 14, borderWidth: StyleSheet.hairlineWidth, maxWidth: 560, width: '100%' },
  textWrap: { flex: 1 },
  text: { fontSize: 14.5, fontWeight: '500' },
  action: { fontSize: 14.5, fontWeight: '700' },
  close: { fontSize: 15, paddingHorizontal: 2 },
});
