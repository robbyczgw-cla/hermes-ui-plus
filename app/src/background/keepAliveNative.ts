/**
 * JS side of the local Expo module `modules/stream-keepalive` (Android only). null on iOS / web and in builds
 * made before the module existed (no crash: the feature is simply off until the next APK).
 */
import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';
import { BG_SERVICE_ENABLED } from './bgService';

type Subscription = { remove(): void };

export type StreamKeepAliveModule = {
  start(title: string, text: string, stopLabel: string, channelName: string): Promise<boolean>;
  update(title: string, text: string): Promise<boolean>;
  stop(): Promise<boolean>;
  isRunning(): boolean;
  /** onStartFailed: start() resolved true, but the service could not enter the foreground / start its task */
  addListener(event: 'onStopRequested' | 'onTimeout' | 'onStartFailed', fn: () => void): Subscription;
};

let cached: StreamKeepAliveModule | null | undefined;

export function keepAliveModule(): StreamKeepAliveModule | null {
  if (cached !== undefined) return cached;
  // store builds with EXPO_PUBLIC_BG_SERVICE=0 have no service in the manifest (bgService.ts)
  cached = Platform.OS === 'android' && BG_SERVICE_ENABLED ? requireOptionalNativeModule<StreamKeepAliveModule>('StreamKeepAlive') : null;
  return cached;
}

/** headless JS task key (StreamKeepAliveService.TASK_KEY) */
export const KEEPALIVE_TASK = 'HermesStreamKeepAlive';
