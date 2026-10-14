import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ActionRunnerProvider } from '../actions';
import { BackgroundTurnHost } from '../background/BackgroundTurnHost';
import { ToastProvider, useToast } from '../chat/Toast';
import { ConversationsProvider, useStorageFullToast } from '../conversations';
import { APP_TITLE } from '../brand';
import { ConsentHost } from '../compliance/ConsentHost';
import { DesktopHost } from '../desktop/DesktopHost';
import { useStackHeaderInset, useWindowVibrancy } from '../desktop/chrome';
import { I18nProvider, useT } from '../i18n';
import { NodeStateProvider } from '../nodestate';
import { RouteMemory } from '../navigation/RouteMemory';
import { OnboardingHost } from '../onboarding/OnboardingHost';
import { PushHost } from '../push';
import { AppearanceProvider } from '../settings/Appearance';
import { ConnectionProvider } from '../settings/ConnectionProvider';
import { useTheme } from '../ui';

/** header + web document title (browser tab); build-time override for the PWA, see brand.ts / scripts/build-web.sh */
const APP_NAME = APP_TITLE;

export default function RootLayout() {
  // web: the React app has mounted -> drop the inline boot splash from public/index.html (#boot)
  useEffect(() => {
    if (Platform.OS === 'web') document.getElementById('boot')?.remove();
  }, []);
  return (
    <AppearanceProvider>
      <I18nProvider>
        <ThemedRoot />
      </I18nProvider>
    </AppearanceProvider>
  );
}

function ThemedRoot() {
  const t = useTheme();
  const tr = useT();
  // macOS app with the sidebar material behind a transparent window: the root paints nothing, the chat screen
  // paints its own column (desktop/chrome.ts)
  const vibrancy = useWindowVibrancy();
  // macOS app: the gallery's back button sits right of the traffic lights (like the chat header)
  const headerInset = useStackHeaderInset();
  const rootBg = vibrancy ? 'transparent' : t.colors.bg;
  const navTheme = useMemo(() => {
    const base = t.dark ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: t.colors.accent,
        background: rootBg,
        card: t.colors.bg,
        text: t.colors.text,
        border: t.colors.border,
      },
    };
  }, [t, rootBg]);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: rootBg }}>
      <SafeAreaProvider>
        <ThemeProvider value={navTheme}>
          <NodeStateProvider>
            <ConnectionProvider>
              <ConversationsProvider>
                <ToastProvider>
                  <RootActions>
                    <StatusBar style={t.dark ? 'light' : 'dark'} />
                    <PushHost>
                    {/* running answers: Android foreground service, "Antwort ist da" notices (background/) */}
                    <BackgroundTurnHost />
                    {/* macOS desktop app: menus, keys, dock, notification actions, files, lock (no-op elsewhere) */}
                    <DesktopHost />
                    {/* reopens Settings & co. after an Android activity recreation (system font size change) */}
                    <RouteMemory />
                    <OnboardingHost>
                      <Stack
                        screenOptions={{
                          headerShown: false,
                          contentStyle: { backgroundColor: t.colors.bg },
                          gestureEnabled: true,
                        }}
                      >
                        <Stack.Screen name="index" options={{ title: APP_NAME, ...(vibrancy ? { contentStyle: { backgroundColor: 'transparent' } } : null) }} />
                        <Stack.Screen name="settings" options={{ presentation: 'modal', title: APP_NAME }} />
                        <Stack.Screen
                          name="gallery"
                          options={{ headerShown: true, title: tr('settings.about.gallery'), headerShadowVisible: false, ...headerInset }}
                        />
                      </Stack>
                    </OnboardingHost>
                    {/* consent requested outside the chat composer: remote voice (voice/consentGate.ts) */}
                    <ConsentHost />
                    </PushHost>
                  </RootActions>
                </ToastProvider>
              </ConversationsProvider>
            </ConnectionProvider>
          </NodeStateProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/**
 * App-wide action runner (confirm sheet + toasts) for screens outside a chat (gallery, settings
 * previews). The chat view mounts its own provider with `conversationId` + `onSend`, which wins there.
 */
function RootActions({ children }: { children: ReactNode }) {
  const toast = useToast();
  useStorageFullToast(toast); // non-blocking notice when chats cannot be saved (storage full)
  return <ActionRunnerProvider onToast={toast}>{children}</ActionRunnerProvider>;
}
