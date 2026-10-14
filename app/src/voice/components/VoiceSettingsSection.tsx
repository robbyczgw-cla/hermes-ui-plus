/**
 * Settings block "Sprachausgabe" + "Spracheingabe" (same look as settings/SettingsScreen groups).
 * Engine per direction (Automatisch / Gerät / UI-Bridge / Eigener API-Key), bridge voice picker
 * from /bridge/voice/config or the on-device voice list, own-key forms,
 * "Probehören", speed, auto-read toggle, STT language.
 * Drop it into the settings ScrollView: <VoiceSettingsSection conn={voiceConnFromProfile(activeProfile)} />
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { useLocale, useT } from '../../i18n';
import { useTheme } from '../../ui';
import { Segmented } from '../../settings/ui';
import { effectiveSttApi, isSttApiComplete, isTtsApiComplete, STT_API_PRESETS } from '../apiCore';
import type { AppLang } from '../apiCore';
import { useVoiceApiKeys } from '../apiKeys';
import { languageLabel, resolveVoice, sortVoices } from '../bridgeCore';
import { deviceSttAvailable, deviceSttBackendNow } from '../deviceStt';
import { bridgeVoiceSupport, resolveSttEngine, resolveTtsEngine } from '../engine';
import { formatRate, TTS_RATES } from '../format';
import { useVoiceSettings } from '../settingsStore';
import { setSpeakerRate, speak, stopSpeaking, useSpeaker } from '../speaker';
import { voiceErrorText } from '../types';
import type { SttLanguage, TtsEngine, TtsVoice, VoiceConn, VoiceEngineChoice } from '../types';
import { UNAVAILABLE_KEYS } from '../useDictation';
import { useVoiceConfig } from '../useVoiceConfig';
import { VoiceIcon } from './icons';
import { ApiSttForm, ApiTtsForm, DeviceVoicePicker, EnginePicker, ENGINE_NAME } from './VoiceEngineSettings';

export type VoiceSettingsSectionProps = {
  conn: VoiceConn | null;
};

const COLLAPSED = 6;

export function VoiceSettingsSection({ conn }: VoiceSettingsSectionProps) {
  const theme = useTheme();
  const t = useT();
  const { locale, lang } = useLocale();
  const [settings, update] = useVoiceSettings();
  const { config, loading, error, reload } = useVoiceConfig(conn);
  const [expanded, setExpanded] = useState(false);

  const voices = sortVoices(config?.tts?.voices ?? [], lang);
  const selected = resolveVoice(config, settings.ttsVoice);
  let visible = expanded ? voices : voices.slice(0, COLLAPSED);
  if (!expanded && selected && !visible.some((v) => v.id === selected)) {
    const sel = voices.find((v) => v.id === selected);
    if (sel) visible = [...visible.slice(0, COLLAPSED - 1), sel];
  }

  const keys = useVoiceApiKeys();
  const deviceStt = deviceSttAvailable();
  const ttsChoice: VoiceEngineChoice = settings.ttsEngine;
  const sttChoice: VoiceEngineChoice = settings.sttEngine;
  const tts = resolveTtsEngine({
    choice: ttsChoice,
    bridge: bridgeVoiceSupport(!!conn, config, 'tts', { configError: error }),
    apiKey: keys.tts && isTtsApiComplete(settings.ttsApi, lang as AppLang),
  });
  const stt = resolveSttEngine({
    choice: sttChoice,
    bridge: bridgeVoiceSupport(!!conn, config, 'stt', { configError: error }),
    device: deviceStt,
    apiKey: keys.stt && isSttApiComplete(settings.sttApi),
  });
  const showBridge = tts.engine === 'bridge' && !!conn;

  const preview = (id: string, engine: TtsEngine, opts: { voice?: string; deviceVoice?: string | null } = {}) => {
    void speak({
      id,
      text: t('voice.settings.previewSample'),
      plain: true,
      conn,
      engine,
      voice: opts.voice,
      deviceVoice: opts.deviceVoice,
      t,
      locale,
    });
  };
  const deviceNote = !conn ? t('voice.settings.noBridgeNote') : config && !config.tts && ttsChoice === 'auto' ? t('voice.settings.noTtsNote') : undefined;

  const langOptions: { value: SttLanguage; label: string }[] = [
    { value: 'auto', label: t('voice.settings.sttAuto') },
    { value: 'de', label: t('language.de') },
    { value: 'en', label: t('language.en') },
    { value: 'es', label: t('language.es') },
  ];

  return (
    <View style={styles.wrap}>
      <SectionTitle>{t('voice.settings.outputTitle')}</SectionTitle>
      <Group>
        <EnginePicker value={settings.ttsEngine} onChange={(v) => update({ ttsEngine: v })} hide={conn ? [] : ['bridge']} active={tts.engine} />
        {showBridge && loading && !config ? (
          <View style={[styles.row, styles.rowBorder(theme)]}>
            <ActivityIndicator size="small" color={theme.colors.muted} />
            <Text style={[styles.rowSub, { color: theme.colors.muted }]}>{t('voice.settings.loadingVoices')}</Text>
          </View>
        ) : null}
        {showBridge && error && !config ? (
          <View style={[styles.row, styles.rowBorder(theme)]}>
            <Text style={[styles.rowSub, { color: theme.colors.danger, flex: 1 }]}>{voiceErrorText(error, t)}</Text>
            <Pressable onPress={reload} accessibilityRole="button" hitSlop={8}>
              <Text style={[styles.link, { color: theme.colors.accent }]}>{t('actions.retry')}</Text>
            </Pressable>
          </View>
        ) : null}
        {showBridge && config && voices.length
          ? visible.map((v) => (
              <VoiceRow key={v.id} voice={v} selected={v.id === selected} onSelect={() => update({ ttsVoice: v.id })} onPreview={() => preview(`preview:${v.id}`, 'bridge', { voice: v.id })} />
            ))
          : null}
        {showBridge && config && voices.length > COLLAPSED ? (
          <Pressable
            onPress={() => setExpanded((e) => !e)}
            accessibilityRole="button"
            style={({ pressed }) => [styles.row, styles.rowBorder(theme), pressed && { backgroundColor: theme.colors.surfacePressed }]}
          >
            <Text style={[styles.link, { color: theme.colors.accent }]}>{expanded ? t('voice.settings.showLess') : t('voice.settings.showAll', { count: voices.length })}</Text>
          </Pressable>
        ) : null}
        {showBridge && config?.tts && !voices.length ? (
          <DeviceVoiceRow note={t('voice.settings.bridgeDefaultNote')} onPreview={() => undefined} bridgeDefault />
        ) : null}
        {tts.engine === 'device' ? (
          <DeviceVoicePicker
            note={deviceNote}
            renderPreview={(id, name) => (
              <PreviewButton id={`preview:device:${id ?? 'auto'}`} label={t('voice.settings.previewVoice', { name })} onPreview={() => preview(`preview:device:${id ?? 'auto'}`, 'device', { deviceVoice: id })} />
            )}
          />
        ) : null}
        {settings.ttsEngine === 'apikey' ? (
          <ApiTtsForm preview={<PreviewButton id="preview:apikey" label={t('voice.settings.previewVoice', { name: t(ENGINE_NAME.apikey) })} onPreview={() => preview('preview:apikey', 'apikey')} />} />
        ) : null}
        {!tts.engine && tts.reason === 'no_bridge' ? (
          <View style={[styles.row, styles.rowBorder(theme)]}>
            <Text style={[styles.rowSub, { color: theme.colors.danger, flex: 1 }]}>{t('voice.errors.ttsNoBridge')}</Text>
          </View>
        ) : null}

        <View style={[styles.block, styles.rowBorder(theme)]}>
          <Text style={[styles.rowTitle, { color: theme.colors.text }]}>{t('voice.settings.speed')}</Text>
          <View style={styles.chips} accessibilityRole="radiogroup">
            {TTS_RATES.map((r) => {
              const sel = Math.abs(settings.ttsRate - r) < 0.01;
              return (
                <Pressable
                  key={r}
                  onPress={() => {
                    update({ ttsRate: r });
                    setSpeakerRate(r);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: sel }}
                  accessibilityLabel={t('voice.settings.rateLabel', { rate: formatRate(r, locale) })}
                  style={[styles.chip, { backgroundColor: sel ? theme.colors.text : theme.colors.surfaceAlt }]}
                >
                  <Text style={{ color: sel ? theme.colors.bg : theme.colors.text, fontSize: 14, fontWeight: sel ? '600' : '500' }}>{formatRate(r, locale)}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.row}>
          <View style={styles.flex}>
            <Text style={[styles.rowTitle, { color: theme.colors.text }]}>{t('voice.settings.autoRead')}</Text>
            <Text style={[styles.rowSub, { color: theme.colors.muted }]}>{t('voice.settings.autoReadHint')}</Text>
          </View>
          <Switch
            value={settings.autoRead}
            onValueChange={(v) => {
              update({ autoRead: v });
              if (!v) stopSpeaking();
            }}
            trackColor={{ true: theme.colors.accent, false: theme.colors.borderStrong }}
            accessibilityLabel={t('voice.settings.autoRead')}
          />
        </View>
      </Group>

      <SectionTitle>{t('voice.settings.inputTitle')}</SectionTitle>
      <Group>
          <EnginePicker
            value={settings.sttEngine}
            onChange={(v) => update({ sttEngine: v })}
            hide={[...(deviceStt ? [] : (['device'] as const)), ...(conn ? [] : (['bridge'] as const))]}
            active={stt.engine}
          />
        <View style={[styles.block, settings.sttEngine === 'apikey' && styles.rowBorder(theme)]}>
          <Text style={[styles.rowTitle, { color: theme.colors.text }]}>{t('language.label')}</Text>
          {/* shared settings control: falls back to radio rows when "Automatisch" etc. would be cut (E2E round 7) */}
          <Segmented<SttLanguage> label={t('language.label')} value={settings.sttLanguage} options={langOptions} onChange={(v) => update({ sttLanguage: v })} />
        </View>
        {settings.sttEngine === 'apikey' ? <ApiSttForm /> : null}
      </Group>
      <Text style={[styles.footnote, { color: theme.colors.subtle }]}>
        {stt.engine === 'device'
            ? t(
                Platform.OS === 'web'
                  ? 'voice.settings.sttDeviceHintWeb'
                  : deviceSttBackendNow() === 'analyzer'
                    ? 'voice.settings.sttDeviceHintLong'
                    : 'voice.settings.sttDeviceHint',
              )
            : stt.engine === 'apikey'
              ? t('voice.settings.sttHintEngine', { engine: [STT_API_PRESETS[settings.sttApi.preset].label, effectiveSttApi(settings.sttApi).model].filter(Boolean).join(' · ') })
              : stt.engine === 'bridge'
                ? config?.stt
                  ? t('voice.settings.sttHintEngine', { engine: [config.stt.provider, config.stt.model].filter(Boolean).join(' · ') })
                  : config
                    ? t('voice.settings.sttNoEngine')
                    : t('voice.settings.sttHint')
                : t(stt.reason === 'no_bridge' ? 'voice.settings.sttNoBridge' : UNAVAILABLE_KEYS[stt.reason ?? 'none'])}
      </Text>
    </View>
  );
}

function VoiceRow({ voice, selected, onSelect, onPreview }: { voice: TtsVoice; selected: boolean; onSelect(): void; onPreview(): void }) {
  const theme = useTheme();
  const t = useT();
  const sub = [voice.lang ? languageLabel(voice.lang, t) : '', voice.provider].filter(Boolean).join(' · ');
  return (
    <View style={[styles.row, styles.rowBorder(theme)]}>
      <Pressable
        onPress={onSelect}
        accessibilityRole="radio"
        accessibilityState={{ selected }}
        accessibilityLabel={`${voice.name}${sub ? `, ${sub}` : ''}`}
        style={styles.rowMain}
      >
        <View style={[styles.radio, { borderColor: selected ? theme.colors.accent : theme.colors.borderStrong }]}>
          {selected ? <View style={[styles.radioDot, { backgroundColor: theme.colors.accent }]} /> : null}
        </View>
        <View style={styles.flex}>
          <Text style={[styles.rowTitle, { color: theme.colors.text }]} numberOfLines={1}>
            {voice.name}
          </Text>
          {sub ? (
            <Text style={[styles.rowSub, { color: theme.colors.muted }]} numberOfLines={1}>
              {sub}
            </Text>
          ) : null}
        </View>
      </Pressable>
      <PreviewButton id={`preview:${voice.id}`} label={t('voice.settings.previewVoice', { name: voice.name })} onPreview={onPreview} />
    </View>
  );
}

function DeviceVoiceRow({ note, onPreview, bridgeDefault }: { note: string; onPreview(): void; bridgeDefault: boolean }) {
  const theme = useTheme();
  const t = useT();
  return (
    <View style={[styles.row, styles.rowBorder(theme)]}>
      <View style={styles.flex}>
        <Text style={[styles.rowTitle, { color: theme.colors.text }]}>{bridgeDefault ? t('voice.settings.defaultVoice') : t('voice.settings.deviceVoice')}</Text>
        <Text style={[styles.rowSub, { color: theme.colors.muted }]}>{note}</Text>
      </View>
      {bridgeDefault ? null : <PreviewButton id="preview:device" label={t('voice.settings.previewDevice')} onPreview={onPreview} />}
    </View>
  );
}

function PreviewButton({ id, label, onPreview }: { id: string; label: string; onPreview(): void }) {
  const theme = useTheme();
  const t = useT();
  const s = useSpeaker(id);
  const active = s.status === 'playing' || s.status === 'loading' || s.status === 'paused';
  return (
    <Pressable
      onPress={() => (active ? stopSpeaking() : onPreview())}
      accessibilityRole="button"
      accessibilityLabel={active ? t('voice.settings.previewStopLabel') : label}
      hitSlop={6}
      style={({ pressed }) => [styles.preview, { backgroundColor: pressed ? theme.colors.surfacePressed : theme.colors.surfaceAlt }]}
    >
      {s.status === 'loading' ? (
        <ActivityIndicator size="small" color={theme.colors.text} style={{ transform: [{ scale: 0.75 }] }} />
      ) : (
        <VoiceIcon name={active ? 'stop' : s.status === 'error' ? 'alert' : 'play'} size={14} color={s.status === 'error' ? theme.colors.danger : theme.colors.text} />
      )}
      <Text style={[styles.previewText, { color: theme.colors.text }]}>{active ? t('voice.settings.previewStop') : t('voice.settings.preview')}</Text>
    </Pressable>
  );
}

function SectionTitle({ children }: { children: string }) {
  const theme = useTheme();
  return <Text style={[styles.sectionTitle, { color: theme.colors.muted }]}>{children.toUpperCase()}</Text>;
}

function Group({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return <View style={[styles.group, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>{children}</View>;
}

const base = StyleSheet.create({
  wrap: { gap: 8 },
  flex: { flex: 1 },
  sectionTitle: { fontSize: 12.5, fontWeight: '500', letterSpacing: 0.4, marginTop: 12, marginLeft: 14 },
  group: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, minHeight: 52, paddingVertical: 8 },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  block: { paddingHorizontal: 14, paddingVertical: 12, gap: 10 },
  rowTitle: { fontSize: 16 },
  rowSub: { fontSize: 13, marginTop: 2 },
  link: { fontSize: 15, fontWeight: '500' },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, minWidth: 48, alignItems: 'center' },
  preview: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 10, height: 30 },
  previewText: { fontSize: 13, fontWeight: '500' },
  footnote: { fontSize: 13, lineHeight: 18, marginHorizontal: 14, marginBottom: 4 },
});

const styles = {
  ...base,
  rowBorder: (theme: ReturnType<typeof useTheme>) => ({ borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border }),
};
