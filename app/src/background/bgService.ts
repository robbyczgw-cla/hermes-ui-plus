// Build-time switch for the Android keep-alive foreground service (modules/stream-keepalive).
// `EXPO_PUBLIC_BG_SERVICE=0` (store builds, docs/STORE.md): the config plugin app/plugins/withBgService.js removes
// the service + FGS permissions from the manifest, and the app treats the native module as absent (the
// "Antworten im Hintergrund fertigstellen" switch is hidden; Hermes recovers interrupted turns via the bridge).
// Default (unset): on. Static dot access → inlined by Expo.

export function parseBgService(raw: string | null | undefined): boolean {
  return (raw ?? '').trim() !== '0';
}

export const BG_SERVICE_ENABLED: boolean = parseBgService(process.env.EXPO_PUBLIC_BG_SERVICE);
