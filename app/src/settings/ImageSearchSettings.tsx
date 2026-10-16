// Settings → Medien → Bildersuche: source selector, own provider + key (secure storage, masked, never logged), test.
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable } from 'react-native';
import { Text } from '../ui/primitives/Text';
import { useT } from '../i18n';
import { ownImageSearch, setOwnImageConfig } from '../images/web';
import type { ImageSearchMode } from '../images/mode';
import { IMAGE_PROVIDERS, type ImageProviderId } from '../images/providers';
import type { OwnTestResult } from '../images/ownCore';
import { textStyle, useTheme } from '../ui';
import { usePreferences } from './PreferencesProvider';
import { persistImageKey } from './imageKey';
import { loadImageKey, saveImageKey } from './storage';
import { Button, Field, Footnote, Group, ResultRow, Segmented } from './ui';

const PROVIDER_LABEL: Record<ImageProviderId, string> = { serper: 'Serper', brave: 'Brave' };

/** Pure: test outcome → i18n key (+ params). On web a network failure is almost always CORS. */
export function testMessage(r: OwnTestResult, web: boolean): { key: string; params?: Record<string, string | number> } {
  switch (r.kind) {
    case 'ok':
      return { key: 'settings.media.imageSearch.ok', params: { count: r.count } };
    case 'empty':
      return { key: 'settings.media.imageSearch.empty' };
    case 'auth':
      return { key: 'settings.media.imageSearch.auth', params: { status: r.status ?? 401 } };
    case 'rate':
      return { key: 'settings.media.imageSearch.rate' };
    case 'http':
      return { key: 'settings.media.imageSearch.http', params: { status: r.status ?? 0 } };
    default:
      return { key: web ? 'settings.media.imageSearch.cors' : 'settings.media.imageSearch.network' };
  }
}

export function ImageSearchSettings() {
  const tr = useT();
  const th = useTheme();
  const { prefs, set } = usePreferences();
  const provider = prefs.imageProvider;
  const [key, setKey] = useState('');
  const [show, setShow] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const loadedFor = useRef('');
  /** provider currently selected (async completions compare against it) */
  const selected = useRef<string>(provider);
  selected.current = provider;

  // key of the selected provider (secure storage) → field + active config
  useEffect(() => {
    let alive = true;
    setResult(null);
    setSaved(false);
    loadImageKey(provider).then((k) => {
      if (!alive) return;
      loadedFor.current = provider;
      setKey(k);
    });
    return () => {
      alive = false;
    };
  }, [provider]);

  const persist = async (value: string): Promise<boolean> => {
    if (loadedFor.current !== provider) return false;
    const outcome = await persistImageKey({ save: saveImageKey, setConfig: setOwnImageConfig }, provider, value, () => selected.current === provider);
    if (outcome === 'failed') {
      setSaved(false);
      setResult({ ok: false, text: tr('settings.media.imageSearch.saveFailed') });
      return false;
    }
    if (outcome === 'stale') return false;
    setSaved(outcome === 'saved');
    return true;
  };

  const test = async () => {
    const value = key.trim();
    if (!value) {
      setResult({ ok: false, text: tr('settings.media.imageSearch.missing') });
      return;
    }
    const mine = provider;
    setBusy(true);
    try {
      if (!(await persist(value))) return; // not stored → a test would only show success for a key that is gone after a restart
      const r = await ownImageSearch.test({ provider: mine, key: value });
      if (selected.current !== mine) return; // another provider was selected meanwhile
      const m = testMessage(r, Platform.OS === 'web');
      setResult({ ok: r.kind === 'ok', text: tr(m.key as never, m.params as never) });
    } finally {
      setBusy(false);
    }
  };

  const modes: { value: ImageSearchMode; label: string }[] = [
    { value: 'bridge', label: tr('settings.media.imageSearch.bridge') },
    { value: 'own', label: tr('settings.media.imageSearch.own') },
    { value: 'wikipedia', label: tr('settings.media.imageSearch.wiki') },
  ];
  const hint = prefs.imageSearch === 'bridge' ? tr('settings.media.imageSearch.hb') : prefs.imageSearch === 'own' ? tr('settings.media.imageSearch.ho') : tr('settings.media.imageSearch.hw');
  const own = prefs.imageSearch === 'own' || prefs.imageSearch === 'bridge';

  return (
    <>
      <Segmented<ImageSearchMode> label={tr('settings.media.imageSearch.label')} value={prefs.imageSearch} options={modes} onChange={(v) => set('imageSearch', v)} />
      <Footnote>{hint}</Footnote>
      {own ? (
        <>
          <Segmented<ImageProviderId>
            label={tr('settings.media.imageSearch.provider')}
            value={provider}
            options={IMAGE_PROVIDERS.map((p) => ({ value: p, label: PROVIDER_LABEL[p] }))}
            onChange={(v) => set('imageProvider', v)}
          />
          <Group>
            <Field
              label={`${PROVIDER_LABEL[provider]} · ${tr('settings.media.imageSearch.key')}`}
              value={key}
              onChangeText={(v) => {
                setKey(v);
                setSaved(false);
              }}
              onEndEditing={() => void persist(key)}
              placeholder={tr('settings.media.imageSearch.keyPh')}
              secureTextEntry={!show}
              autoComplete="off"
              last
              trailing={
                <Pressable onPress={() => setShow((v) => !v)} hitSlop={8} accessibilityRole="button">
                  <Text style={[textStyle(th, 'callout'), { color: th.colors.accentText }]}>{show ? tr('settings.media.imageSearch.hide') : tr('settings.media.imageSearch.show')}</Text>
                </Pressable>
              }
            />
          </Group>
          <Footnote>{saved ? tr('settings.media.imageSearch.keySaved') : tr('settings.media.imageSearch.keyHint')}</Footnote>
          <Button label={busy ? tr('settings.media.imageSearch.testing') : tr('settings.media.imageSearch.test')} onPress={() => void test()} loading={busy} kind="secondary" disabled={busy} />
          {result ? (
            <Group>
              <ResultRow label={tr('settings.media.imageSearch.test')} ok={result.ok} detail={result.text} last />
            </Group>
          ) : null}
        </>
      ) : null}
    </>
  );
}
