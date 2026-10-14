/**
 * Per-language "🔊" for the translation cards, on top of the global voice speaker (one text plays
 * at a time app-wide; starting here stops any message being read).
 *
 * Engine choice per text:
 *  - a UI bridge connection is provided via <TranslationVoiceProvider conn> AND the bridge offers a
 *    TTS voice in the text's language → bridge TTS with that voice;
 *  - otherwise → on-device TTS (expo-speech) with the text's BCP47 locale ("es-ES", "pt-BR").
 * HuiView does not know the active profile, so without the provider the device voice is used —
 * the right default for mixed-language cards (the user's saved bridge voice is single-language).
 */
import { createContext, useCallback, useContext, type ReactNode } from 'react';
import { useT } from '../../../../i18n';
import { cachedVoiceConfig } from '../../../../voice/bridge';
import { toggleSpeaking, useSpeaker, type SpeakerStatus } from '../../../../voice/speaker';
import type { VoiceConn } from '../../../../voice/types';
import { sameLanguage, speechLocale } from './languages.ts';

const VoiceConnContext = createContext<VoiceConn | null>(null);

/** Optional: lets translation cards use bridge voices that match each text's language. */
export function TranslationVoiceProvider({ conn, children }: { conn: VoiceConn | null; children?: ReactNode }) {
  return <VoiceConnContext.Provider value={conn}>{children}</VoiceConnContext.Provider>;
}

/** Bridge voice id for `lang`, or null → device voice. */
export function bridgeVoiceFor(conn: VoiceConn | null, lang: string): string | null {
  if (!conn) return null;
  const voices = cachedVoiceConfig(conn)?.tts?.voices ?? [];
  return voices.find((v) => v.lang && sameLanguage(v.lang, lang))?.id ?? null;
}

export function useSpeakText(id: string, text: string, lang: string): { status: SpeakerStatus; toggle: () => void } {
  const t = useT();
  const conn = useContext(VoiceConnContext);
  const s = useSpeaker(id);
  const toggle = useCallback(() => {
    const locale = speechLocale(lang) || 'en-US';
    const voice = bridgeVoiceFor(conn, lang);
    toggleSpeaking({ id, text, plain: true, conn: voice ? conn : null, ...(voice ? { voice } : {}), t, locale });
  }, [id, text, lang, conn, t]);
  return { status: s.status, toggle };
}
