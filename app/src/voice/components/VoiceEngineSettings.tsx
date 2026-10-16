/**
 * Engine pickers + on-device voice list + own-API-key forms for <VoiceSettingsSection/>.
 * The API key is never shown: only "saved" + change / remove.
 */
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../../ui/primitives/Text';
import { useLocale, useT } from '../../i18n';
import type { TKey } from '../../i18n/core.ts';
import { Chips, Field } from '../../settings/ui';
import { Button, useTheme } from '../../ui';
import { DEEPGRAM_VOICES, effectiveSttApi, effectiveTtsApi, OPENAI_TTS_VOICES, STT_API_PRESETS, TTS_API_PRESETS } from '../apiCore';
import type { AppLang } from '../apiCore';
import { setVoiceApiKey, useVoiceApiKeys } from '../apiKeys';
import type { VoiceKeySlot } from '../apiKeys';
import { listDeviceVoices } from '../deviceTts';
import type { DeviceVoice } from '../deviceTts';
import { useVoiceSettings } from '../settingsStore';
import type { SttApiPreset, SttEngine, TtsApiPreset, TtsEngine, VoiceEngineChoice } from '../types';
import { a11yState } from '../../ui/lib/a11yState';

export const ENGINE_LABEL: Record<VoiceEngineChoice, TKey> = {
  auto: 'voice.settings.engines.auto',
  device: 'voice.settings.engines.device',
  bridge: 'voice.settings.engines.bridge',
  apikey: 'voice.settings.engines.apikey',
};

export const ENGINE_NAME: Record<SttEngine | TtsEngine, TKey> = {
  bridge: 'voice.settings.engineNames.bridge',
  device: 'voice.settings.engineNames.device',
  apikey: 'voice.settings.engineNames.apikey',
};

/** "Automatisch | Gerät | UI-Bridge | Eigener API-Key" (hidden options stay visible while selected). */
export function EnginePicker({
  value,
  onChange,
  hide,
  active,
}: {
  value: VoiceEngineChoice;
  onChange(v: VoiceEngineChoice): void;
  hide: VoiceEngineChoice[];
  /** resolved engine shown under "Automatisch" */
  active: SttEngine | TtsEngine | null;
}) {
  const theme = useTheme();
  const t = useT();
  const items = (['auto', 'device', 'bridge', 'apikey'] as const)
    .filter((c) => c === value || !hide.includes(c))
    .map((c) => ({ id: c, label: t(ENGINE_LABEL[c]) }));
  return (
    <View style={[styles.block, rowBorder(theme)]}>
      <Text style={[theme.typography.body, { color: theme.colors.text }]}>{t('voice.settings.engine')}</Text>
      <Chips items={items} selected={value} onPick={(id) => onChange(id as VoiceEngineChoice)} />
      {value === 'auto' && active ? (
        <Text style={[theme.typography.caption, styles.rowSub, { color: theme.colors.muted }]}>{t('voice.settings.activeEngine', { engine: t(ENGINE_NAME[active]) })}</Text>
      ) : null}
    </View>
  );
}


const COLLAPSED = 6;

/** Installed voices for the app language + "Automatisch (beste Stimme)". */
export function DeviceVoicePicker({ note, renderPreview }: { note?: string; renderPreview(id: string | null, label: string): ReactNode }) {
  const theme = useTheme();
  const t = useT();
  const { locale } = useLocale();
  const [settings, update] = useVoiceSettings();
  const [loaded, setLoaded] = useState<{ locale: string; voices: DeviceVoice[] } | null>(null);
  const voices = loaded?.locale === locale ? loaded.voices : null;
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    let alive = true;
    listDeviceVoices(locale).then((v) => alive && setLoaded({ locale, voices: v }));
    return () => {
      alive = false;
    };
  }, [locale]);

  const selected = voices?.some((v) => v.id === settings.deviceVoice) ? settings.deviceVoice : null;
  let visible = voices ? (expanded ? voices : voices.slice(0, COLLAPSED)) : [];
  if (!expanded && selected && voices && !visible.some((v) => v.id === selected)) {
    const sel = voices.find((v) => v.id === selected);
    if (sel) visible = [...visible.slice(0, COLLAPSED - 1), sel];
  }
  const row = (id: string | null, title: string, sub: string) => (
    <View key={id ?? 'auto'} style={[styles.row, rowBorder(theme)]}>
      <Pressable onPress={() => update({ deviceVoice: id })} accessibilityRole="radio" {...a11yState({ selected: selected === id, checked: selected === id })} accessibilityLabel={sub ? `${title}, ${sub}` : title} style={styles.rowMain}>
        <View style={[styles.radio, { borderColor: selected === id ? theme.colors.accent : theme.colors.borderStrong }]}>
          {selected === id ? <View style={[styles.radioDot, { backgroundColor: theme.colors.accent }]} /> : null}
        </View>
        <View style={styles.flex}>
          <Text style={[theme.typography.body, { color: theme.colors.text }]} numberOfLines={2}>
            {title}
          </Text>
          {sub ? (
            <Text style={[theme.typography.caption, styles.rowSub, { color: theme.colors.muted }]} numberOfLines={2}>
              {sub}
            </Text>
          ) : null}
        </View>
      </Pressable>
      {renderPreview(id, title)}
    </View>
  );
  return (
    <>
      {row(null, t('voice.settings.deviceVoiceAuto'), note ?? '')}
      {voices === null ? (
        <View style={[styles.row, rowBorder(theme)]}>
          <ActivityIndicator size="small" color={theme.colors.muted} />
        </View>
      ) : voices.length === 0 ? (
        <View style={[styles.row, rowBorder(theme)]}>
          <Text style={[theme.typography.caption, styles.rowSub, { color: theme.colors.muted }]}>{t('voice.settings.noDeviceVoices')}</Text>
        </View>
      ) : (
        visible.map((v) =>
          row(v.id, v.name, [v.lang, v.quality === 'premium' ? t('voice.settings.premium') : v.quality === 'enhanced' ? t('voice.settings.enhanced') : ''].filter(Boolean).join(' · ')),
        )
      )}
      {voices && voices.length > COLLAPSED ? (
        <View style={[styles.row, rowBorder(theme)]}>
          <Button
            label={expanded ? t('voice.settings.showLess') : t('voice.settings.showAll', { count: voices.length })}
            variant="tertiary"
            size="small"
            accessibilityState={{ expanded }}
            onPress={() => setExpanded((e) => !e)}
          />
        </View>
      ) : null}
      {Platform.OS === 'web' ? null : (
        <View style={[styles.row, rowBorder(theme)]}>
          <Text style={[theme.typography.caption, styles.rowSub, styles.flex, { color: theme.colors.muted }]}>
            {t(Platform.OS === 'ios' ? 'voice.settings.betterVoicesIos' : 'voice.settings.betterVoicesAndroid')}
          </Text>
        </View>
      )}
    </>
  );
}

type CommitFieldProps = { label: string; value: string; placeholder: string; onCommit(v: string): void; last?: boolean; keyboardType?: 'url' | 'default' };

/** Text field that commits on blur / submit (settings are normalised, so no write per keystroke). A new saved value resets the draft. */
function CommitField(props: CommitFieldProps) {
  return <CommitFieldInner key={props.value} {...props} />;
}

function CommitFieldInner({ label, value, placeholder, onCommit, last, keyboardType }: CommitFieldProps) {
  const [draft, setDraft] = useState(value);
  const commit = () => {
    if (draft.trim() !== value) onCommit(draft.trim());
  };
  return <Field label={label} value={draft} onChangeText={setDraft} onBlur={commit} onSubmitEditing={commit} placeholder={placeholder} keyboardType={keyboardType} last={last} />;
}

/** Saved → "gespeichert" + Ändern / Entfernen; otherwise a masked input + Speichern. */
function ApiKeyField({ slot }: { slot: VoiceKeySlot }) {
  const theme = useTheme();
  const t = useT();
  const saved = useVoiceApiKeys()[slot];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  const save = async (value: string) => {
    setBusy(true);
    setErr(false);
    try {
      await setVoiceApiKey(slot, value);
      setDraft('');
      setEditing(false);
    } catch {
      setErr(true);
    } finally {
      setBusy(false);
    }
  };
  if (saved && !editing) {
    return (
      <View style={[styles.row, rowBorder(theme)]}>
        <View style={styles.flex}>
          <Text style={[theme.typography.body, { color: theme.colors.text }]}>{t('voice.settings.api.key')}</Text>
          <Text style={[theme.typography.caption, styles.rowSub, { color: theme.colors.muted }]}>{t('voice.settings.api.keySaved')}</Text>
        </View>
        <Button label={t('voice.settings.api.change')} variant="tertiary" size="small" onPress={() => setEditing(true)} />
        <Button label={t('voice.settings.api.remove')} variant="tertiary" tone="seal" size="small" disabled={busy} onPress={() => void save('')} />
      </View>
    );
  }
  return (
    <View style={rowBorder(theme)}>
      <Field
        label={t('voice.settings.api.key')}
        value={draft}
        onChangeText={setDraft}
        onSubmitEditing={() => draft.trim() && void save(draft)}
        placeholder={t('voice.settings.api.keyPlaceholder')}
        secureTextEntry
        last
        hint={err ? t('voice.settings.api.keySaveFailed') : Platform.OS === 'web' ? t('voice.settings.api.keyHintWeb') : t('voice.settings.api.keyHint')}
        trailing={
          busy ? (
            <ActivityIndicator size="small" color={theme.colors.muted} />
          ) : (
            <Button label={t('voice.settings.api.save')} variant="secondary" size="small" disabled={!draft.trim()} onPress={() => draft.trim() && void save(draft)} />
          )
        }
      />
    </View>
  );
}

function PresetChips<P extends string>({ presets, value, onPick, labels }: { presets: readonly P[]; value: P; onPick(p: P): void; labels: Record<P, string> }) {
  const theme = useTheme();
  const t = useT();
  return (
    <View style={[styles.block, rowBorder(theme)]}>
      <Text style={[theme.typography.body, { color: theme.colors.text }]}>{t('voice.settings.api.provider')}</Text>
      <Chips items={presets.map((p) => ({ id: p, label: labels[p] }))} selected={value} onPick={(id) => onPick(id as P)} />
    </View>
  );
}

/** Own key for dictation: Groq / OpenAI / any OpenAI-compatible `/audio/transcriptions`. */
export function ApiSttForm() {
  const t = useT();
  const [settings, update] = useVoiceSettings();
  const api = settings.sttApi;
  const eff = effectiveSttApi(api);
  const preset = STT_API_PRESETS[api.preset];
  const labels: Record<SttApiPreset, string> = { groq: 'Groq', openai: 'OpenAI', custom: t('voice.settings.api.custom') };
  return (
    <>
      <PresetChips presets={['groq', 'openai', 'custom'] as const} value={api.preset} labels={labels} onPick={(p) => update({ sttApi: { preset: p, baseUrl: '', model: '' } })} />
      <CommitField label={t('voice.settings.api.baseUrl')} value={api.baseUrl} placeholder={preset.baseUrl || 'https://host/v1'} keyboardType="url" onCommit={(v) => update({ sttApi: { ...api, baseUrl: v } })} />
      <CommitField label={t('voice.settings.api.model')} value={api.model} placeholder={preset.model || 'whisper-1'} onCommit={(v) => update({ sttApi: { ...api, model: v } })} />
      <ApiKeyField slot="stt" />
      {!eff.baseUrl || !eff.model ? <Incomplete /> : null}
    </>
  );
}

/** Own key for read-aloud: OpenAI `/audio/speech` / Deepgram Aura-2 / any OpenAI-compatible `/audio/speech`. */
export function ApiTtsForm({ preview }: { preview: ReactNode }) {
  const theme = useTheme();
  const t = useT();
  const { lang } = useLocale();
  const [settings, update] = useVoiceSettings();
  const api = settings.ttsApi;
  const eff = effectiveTtsApi(api, lang as AppLang);
  const preset = TTS_API_PRESETS[api.preset];
  const labels: Record<TtsApiPreset, string> = { openai: 'OpenAI', deepgram: 'Deepgram', custom: t('voice.settings.api.custom') };
  const voiceList: readonly string[] = api.preset === 'openai' ? OPENAI_TTS_VOICES : api.preset === 'deepgram' ? DEEPGRAM_VOICES[lang as AppLang] ?? DEEPGRAM_VOICES.de : [];
  return (
    <>
      <PresetChips presets={['openai', 'deepgram', 'custom'] as const} value={api.preset} labels={labels} onPick={(p) => update({ ttsApi: { preset: p, baseUrl: '', model: '', voice: '' } })} />
      {api.preset === 'custom' ? (
        <CommitField label={t('voice.settings.api.baseUrl')} value={api.baseUrl} placeholder="https://host/v1" keyboardType="url" onCommit={(v) => update({ ttsApi: { ...api, baseUrl: v } })} />
      ) : null}
      {api.preset !== 'deepgram' ? (
        <CommitField label={t('voice.settings.api.model')} value={api.model} placeholder={preset.model || 'tts-1'} onCommit={(v) => update({ ttsApi: { ...api, model: v } })} />
      ) : null}
      {voiceList.length ? (
        <View style={[styles.block, rowBorder(theme)]}>
          <Text style={[theme.typography.body, { color: theme.colors.text }]}>{t('voice.settings.api.voice')}</Text>
          <Chips items={voiceList.map((v) => ({ id: v, label: v.replace(/^aura-2-/, '').replace(/-(de|en|es)$/, '') }))} selected={eff.voice} onPick={(id) => update({ ttsApi: { ...api, voice: id } })} />
        </View>
      ) : (
        <CommitField label={t('voice.settings.api.voice')} value={api.voice} placeholder="alloy" onCommit={(v) => update({ ttsApi: { ...api, voice: v } })} />
      )}
      <ApiKeyField slot="tts" />
      <View style={[styles.row, rowBorder(theme)]}>
        <Text style={[theme.typography.caption, styles.rowSub, styles.flex, { color: theme.colors.muted }]}>{t('voice.settings.api.ttsNote')}</Text>
        {preview}
      </View>
      {!eff.baseUrl || !eff.voice ? <Incomplete /> : null}
    </>
  );
}

function Incomplete() {
  const theme = useTheme();
  const t = useT();
  return (
    <View style={[styles.row, rowBorder(theme)]}>
      <Text style={[theme.typography.caption, styles.rowSub, { color: theme.colors.warning }]}>{t('voice.settings.api.incomplete')}</Text>
    </View>
  );
}

const rowBorder = (theme: ReturnType<typeof useTheme>) => ({ borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border });

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, minHeight: 52, paddingVertical: 8 },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  block: { paddingHorizontal: 14, paddingVertical: 12, gap: 10 },
  rowSub: { marginTop: 2 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
});
