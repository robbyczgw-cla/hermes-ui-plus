// Texts the settings search matches for the voice block (settings/SettingsScreen.tsx, row "voice"): the visible
// labels of VoiceSettingsSection plus keywords for words that are not on screen (Diktat, Mikrofon, vorlesen …).
import type { TFn } from '../i18n/core.ts';

export function voiceSearchTexts(t: TFn): string[] {
  return [
    t('settings.sections.voice'),
    t('voice.settings.outputTitle'),
    t('voice.settings.inputTitle'),
    t('voice.settings.autoRead'),
    t('voice.settings.autoReadHint'),
    t('voice.settings.speed'),
    t('voice.settings.engine'),
    t('voice.settings.defaultVoice'),
    t('voice.settings.deviceVoice'),
    t('voice.settings.preview'),
    t('voice.speak.read'),
    t('voice.settings.searchKeywords'),
  ];
}
