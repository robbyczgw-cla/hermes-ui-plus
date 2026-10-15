/**
 * Voice: dictation (speech → composer text via /bridge/stt) and "Vorlesen" (assistant reply →
 * /bridge/tts or on-device expo-speech). Integration guide: ./INTEGRATION.md
 *
 * UI         <MicButton dictation/>, <RecordingBar dictation/>, <DictationNotice dictation/>,
 *            <SpeakButton message conn/>, <VoiceSettingsSection conn/>
 * Dictation  useDictation({ conn, onText }) · insertDictation(text, dictated, selection?)
 * Speaker    speak / toggleSpeaking / pauseSpeaking / resumeSpeaking / stopSpeaking,
 *            useSpeaker(id), useSpeakerState(), useAutoRead(messages, conn), useStopSpeakingOn(key)
 * Settings   useVoiceSettings(), getVoiceSettings(), updateVoiceSettings(), loadVoiceSettings()
 * Bridge     voiceConnFromProfile(profile), useVoiceConfig(conn), fetchVoiceConfig, transcribe, fetchTtsAudio
 * Pure       toSpeechText(md, t), chunkText, splitSentences, parseVoiceConfig, voiceHttpError, voiceErrorText(e, t), …
 * i18n       all texts come from the `voice.*` dictionary keys; pass `t` from useT() into non-React helpers.
 */
export type { SttLanguage, SttResult, TtsVoice, VoiceConfig, VoiceConn, VoiceErrorCode, VoiceErrorKey, VoiceOp, VoiceSettings } from './types';
export { isVoiceError, VOICE_LIMITS, VoiceError, voiceErrorText } from './types';

export { MicButton } from './components/MicButton';
export type { MicButtonProps } from './components/MicButton';
export { RecordingBar } from './components/RecordingBar';
export type { RecordingBarProps } from './components/RecordingBar';
export { DictationNotice } from './components/DictationNotice';
export { SpeakButton } from './components/SpeakButton';
export type { SpeakButtonProps } from './components/SpeakButton';
export { VoiceSettingsSection } from './components/VoiceSettingsSection';
export type { VoiceSettingsSectionProps } from './components/VoiceSettingsSection';
export { voiceSearchTexts } from './searchTexts';
export { VoiceIcon } from './components/icons';
export type { VoiceIconName } from './components/icons';

export { NO_BRIDGE_KEY, SPEECH_RECORDING_OPTIONS, useDictation, useDictationMeter } from './useDictation';
export type { Dictation, DictationMeter, DictationMode, DictationPhase, UseDictationOptions } from './useDictation';

export {
  IDLE_SPEAKER,
  getSpeakerState,
  pauseSpeaking,
  resumeSpeaking,
  setSpeakerRate,
  speak,
  stopSpeaking,
  subscribeSpeaker,
  toggleSpeaking,
  useSpeaker,
  useSpeakerState,
} from './speaker';
export type { SpeakRequest, SpeakerEngine, SpeakerState, SpeakerStatus } from './speaker';
export { useAutoRead, useStopSpeakingOn } from './useAutoRead';
export type { SpeakableMessage } from './useAutoRead';

export { getVoiceSettings, loadVoiceSettings, subscribeVoiceSettings, updateVoiceSettings, useVoiceSettings } from './settingsStore';
export { useVoiceConfig } from './useVoiceConfig';
export type { VoiceConfigState } from './useVoiceConfig';
export { cachedVoiceConfig, clearTtsCache, fetchTtsAudio, fetchVoiceConfig, transcribe } from './bridge';
export type { TtsAudio, TranscribeOptions } from './bridge';
export { ensureMicPermission, openAppSettings } from './permissions';

export { languageLabel, parseSttResponse, parseVoiceConfig, resolveVoice, sortVoices, voiceConnFromProfile, voiceHttpError } from './bridgeCore';
export type { ProfileLike } from './bridgeCore';
export { chunkText, splitSentences } from './chunking';
export { toSpeechText, summarizeHuiNode } from './speechText';
export { DEFAULT_VOICE_SETTINGS, formatElapsed, insertDictation, meteringToLevel, TTS_RATES } from './format';
