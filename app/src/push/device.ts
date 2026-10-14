/**
 * Device side of push: permission, Android channels, native FCM/APNs token (expo-notifications
 * `getDevicePushTokenAsync` – NOT the Expo push service), Web Push subscription (service worker).
 *
 * Native build requirements (docs/SELF-HOSTING.md "Push notifications"): Android needs `google-services.json` in the build
 * (`android.googleServicesFile`), iOS needs the Push capability (aps-environment) in the provisioning profile.
 * Without them the token call fails and the settings screen shows the error.
 */
import { Platform } from 'react-native';
import { fetch as expoFetch } from 'expo/fetch';
import type { FetchLike } from '../hermes/stream';
import type { TFn } from '../i18n/core';
import { desktopNotify, isDesktopApp } from '../desktop/bridge';
import { vapidKeyBytes, type PushPlatform } from './model';
import type { DevicePart } from './api';

export const pushFetch = expoFetch as unknown as FetchLike;

export const CHANNEL_DEFAULT = 'agent-messages';
export const CHANNEL_QUIET = 'agent-messages-quiet';

type NotificationsModule = typeof import('expo-notifications');
let modPromise: Promise<NotificationsModule | null> | null = null;
export function notificationsModule(): Promise<NotificationsModule | null> {
  if (Platform.OS === 'web') return Promise.resolve(null);
  if (!modPromise) modPromise = import('expo-notifications').then((m) => m, () => null);
  return modPromise;
}

export type DeviceResult = { ok: true; device: DevicePart; deviceKey: string } | { ok: false; reason: 'denied' | 'unsupported' | 'error'; error?: string };

/** Android channels for agent messages (normal + quiet hours without sound). */
async function ensureChannels(N: NotificationsModule, t: TFn): Promise<void> {
  if (Platform.OS !== 'android') return;
  await N.setNotificationChannelAsync(CHANNEL_DEFAULT, {
    name: t('push.channel.name'),
    description: t('push.channel.description'),
    importance: N.AndroidImportance.HIGH,
    sound: 'default',
    vibrationPattern: [0, 200, 150, 200],
  });
  await N.setNotificationChannelAsync(CHANNEL_QUIET, {
    name: t('push.channel.quietName'),
    description: t('push.channel.description'),
    importance: N.AndroidImportance.LOW,
    sound: null,
    enableVibrate: false,
  });
}

/** Platforms this runtime can register (before asking the server what it supports). */
export function devicePlatform(): PushPlatform | null {
  if (Platform.OS === 'android') return 'fcm';
  if (Platform.OS === 'ios') return 'apns';
  if (Platform.OS === 'web' && typeof navigator !== 'undefined' && 'serviceWorker' in navigator && typeof window !== 'undefined' && 'PushManager' in window) return 'webpush';
  return null;
}

/** Ask permission (user gesture on web/iOS PWA!) and obtain the device token / subscription. */
export async function acquireDevice(t: TFn, vapidPublicKey?: string): Promise<DeviceResult> {
  if (Platform.OS === 'web') return acquireWebPush(vapidPublicKey);
  const N = await notificationsModule();
  if (!N) return { ok: false, reason: 'unsupported' };
  try {
    await ensureChannels(N, t);
    let st = await N.getPermissionsAsync();
    if (!st.granted && st.canAskAgain) st = await N.requestPermissionsAsync();
    if (!st.granted) return { ok: false, reason: 'denied' };
    const tok = await N.getDevicePushTokenAsync();
    const token = typeof tok.data === 'string' ? tok.data : '';
    if (!token) return { ok: false, reason: 'error', error: 'empty token' };
    const platform = tok.type === 'ios' ? 'apns' : 'fcm';
    return { ok: true, device: { platform, token }, deviceKey: platform === 'apns' ? token.toLowerCase() : token };
  } catch (e) {
    return { ok: false, reason: 'error', error: String((e as Error)?.message ?? e).slice(0, 160) };
  }
}

async function acquireWebPush(vapidPublicKey?: string): Promise<DeviceResult> {
  if (devicePlatform() !== 'webpush' || !vapidPublicKey) return { ok: false, reason: 'unsupported' };
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return { ok: false, reason: 'denied' };
    const reg = await navigator.serviceWorker.ready;
    const key = vapidKeyBytes(vapidPublicKey);
    let sub = await reg.pushManager.getSubscription();
    // a subscription made for another server key cannot be reused
    const current = sub?.options?.applicationServerKey ? new Uint8Array(sub.options.applicationServerKey as ArrayBuffer) : null;
    if (sub && current && (current.length !== key.length || current.some((b, i) => b !== key[i]))) {
      await sub.unsubscribe();
      sub = null;
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key as unknown as BufferSource });
    const j = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    if (!j.endpoint || !j.keys?.p256dh || !j.keys.auth) return { ok: false, reason: 'error', error: 'incomplete subscription' };
    return { ok: true, device: { platform: 'webpush', subscription: { endpoint: j.endpoint, keys: { p256dh: j.keys.p256dh, auth: j.keys.auth } } }, deviceKey: j.endpoint };
  } catch (e) {
    return { ok: false, reason: 'error', error: String((e as Error)?.message ?? e).slice(0, 160) };
  }
}

/** Local notification for an inbox event that arrived while the app was in the background. */
export async function presentLocal(o: { title: string; body: string; data: Record<string, string>; tag?: string; kind?: 'approval' }): Promise<void> {
  if (Platform.OS === 'web') {
    if (isDesktopApp()) {
      // macOS app: a click opens the target (PushHost), approvals get "allow once" / "deny" buttons (desktop/notifications.ts)
      await desktopNotify(o.title, o.body, { data: o.data, tag: o.tag, kind: o.kind });
      return;
    }
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        const reg = await navigator.serviceWorker?.ready;
        await reg?.showNotification(o.title, { body: o.body, data: o.data, tag: o.data.messageId });
      }
    } catch {
      /* best effort */
    }
    return;
  }
  const N = await notificationsModule();
  if (!N) return;
  try {
    await N.scheduleNotificationAsync({ content: { title: o.title, body: o.body, data: o.data, sound: 'default' }, trigger: Platform.OS === 'android' ? { channelId: CHANNEL_DEFAULT } : null });
  } catch {
    /* permission missing etc. */
  }
}
