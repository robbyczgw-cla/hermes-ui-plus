// Connection editor for all profile kinds (hermes · demo).
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, View } from 'react-native';
import { Text } from '../ui/primitives/Text';
import { Icon } from '../chat/icons';
import { Loader, PERSONA_LOADER_KINDS, personaLoader, textStyle, useMotionReduced, useTheme } from '../ui';
import { cleanBaseUrl, validateProfile, type ConnectionProfile } from './profiles';
import { useT, type TKey } from '../i18n';
import { personaHintKey } from './flavorTexts';
import { saveDecision } from './saveGuard';
import { runConnectionTest, type TestView } from './testConnection';
import { createLatestRun } from './latestRun';
import { Button, Chips, Field, Footnote, Group, ResultRow, Segmented, SectionTitle, SwitchRow } from './ui';
import { isProfilesReadOnlyError } from './storage';
import { formatBotList, invalidBotNames, parseBotList } from '../hermes/bots';


type Props = {
  initial: ConnectionProfile;
  isNew: boolean;
  bottomInset: number;
  onSave(p: ConnectionProfile, makeActive: boolean): Promise<void>;
  onCancel(): void;
  onDelete?: () => Promise<void>;
};

export function ProfileEditor({ initial, isNew, bottomInset, onSave, onCancel, onDelete }: Props) {
  const th = useTheme();
  const t = useT();
  const reducedMotion = useMotionReduced();
  const [p, setP] = useState<ConnectionProfile>(initial);
  // hermes: "Hermes-Profile (Bots)" as typed (parsed on save, hermes/bots.ts parseBotList)
  const [botsText, setBotsText] = useState(() => formatBotList(initial.hermesBots));
  const [showKey, setShowKey] = useState(false);
  const [makeActive, setMakeActive] = useState(isNew);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // a test that finishes after the user edited the profile (or left the editor) must not publish its result
  const testRun = useRef(createLatestRun());
  useEffect(() => {
    const run = testRun.current;
    return () => run.invalidate();
  }, []);

  const update = (patch: Partial<ConnectionProfile>) => {
    testRun.current.invalidate();
    setTesting(false);
    setP((x) => ({ ...x, ...patch }));
    setResult(null);
    setError(null);
    setConfirmSave(false);
  };
  const set = (k: 'name' | 'baseUrl' | 'apiKey' | 'model' | 'sessionKey') => (v: string) => update({ [k]: v });

  /** profile as it will be saved (hermes: normalized URL) */
  const effective = useCallback((): ConnectionProfile => {
    if (p.kind === 'hermes') {
      const bots = parseBotList(botsText);
      return { ...p, baseUrl: cleanBaseUrl('hermes', p.baseUrl), hermesBots: bots.length ? bots : undefined };
    }
    return p;
  }, [p, botsText]);

  const check = (q: ConnectionProfile): string | null => {
    const e = validateProfile(q);
    if (e) return t(`settings.errors.${e}`);
    return null;
  };

  const runTest = async () => {
    const q = effective();
    // the test also serves "Modelle laden": name/model may still be empty
    const err = check({ ...q, name: q.name || 'x', model: q.model || 'x' });
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setConfirmSave(false);
    setTesting(true);
    setResult(null);
    const run = testRun.current.begin();
    try {
      const view = await runConnectionTest(q, t);
      if (run.current()) setResult(view);
    } catch {
      if (run.current()) setResult({ rows: [{ label: t('settings.editor.test'), ok: false, detail: t('settings.editor.testFailed') }], models: [] });
    } finally {
      if (run.current()) setTesting(false);
    }
  };

  // the last test rejected the key / token → "Trotzdem speichern" first (saveGuard.ts)
  const [confirmSave, setConfirmSave] = useState(false);
  const save = async (confirmed = false) => {
    const q = effective();
    const err = check(q);
    if (err) {
      setError(err);
      return;
    }
    if (saveDecision(result, confirmed) === 'confirm') {
      setConfirmSave(true);
      return;
    }
    setConfirmSave(false);
    setSaving(true);
    try {
      await onSave(q, makeActive);
    } catch (e) {
      setError(isProfilesReadOnlyError(e) ? t('settings.storage.readOnlySave') : t('settings.editor.saveFailed'));
      setSaving(false);
    }
  };

  const confirmDelete = () => {
    if (!onDelete) return;
    if (Platform.OS === 'web') {
      void onDelete();
      return;
    }
    Alert.alert(t('settings.editor.deleteTitle'), t('settings.editor.deleteText', { name: p.name }), [
      { text: t('actions.cancel'), style: 'cancel' },
      { text: t('settings.editor.delete'), style: 'destructive', onPress: () => void onDelete() },
    ]);
  };

  const keyToggle = (
    <Pressable
      onPress={() => setShowKey((v) => !v)}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={`${showKey ? t('settings.editor.hide') : t('settings.editor.show')}: ${p.bridge ? t('settings.editor.bridgeToken') : t('settings.editor.apiKey')}`}
    >
      <Text style={[textStyle(th, 'callout'), { color: th.colors.accentText }]}>{showKey ? t('settings.editor.hide') : t('settings.editor.show')}</Text>
    </Pressable>
  );
  const nameField = (last = false) => (
    <Field label={t('settings.editor.name')} value={p.name} onChangeText={set('name')} placeholder={t('settings.editor.namePh')} autoCapitalize="sentences" last={last} />
  );

  let body: React.ReactNode;
  switch (p.kind) {
    case 'demo':
      body = (
        <>
          <Group>{nameField(true)}</Group>
          <Footnote>{t('settings.editor.demoInfo')}</Footnote>
        </>
      );
      break;
    case 'hermes':
    default:
      body = (
        <>
          <Group>
            {nameField()}
            <Field label={t('settings.editor.baseUrl')} value={p.baseUrl} onChangeText={set('baseUrl')} placeholder="http://host:8642/v1" keyboardType="url" />
            <Field
              label={p.bridge ? t('settings.editor.bridgeToken') : t('settings.editor.apiKey')}
              value={p.apiKey}
              onChangeText={set('apiKey')}
              placeholder={p.bridge ? 'BRIDGE_TOKEN' : 'Bearer-Token'}
              secureTextEntry={!showKey}
              trailing={keyToggle}
            />
            <Field label={t('settings.editor.model')} value={p.model ?? ''} onChangeText={set('model')} placeholder={t('settings.editor.modelOptional')} />
            <Field label={t('settings.editor.sessionKey')} value={p.sessionKey ?? ''} onChangeText={set('sessionKey')} placeholder={t('settings.editor.sessionKeyPh')} last />
          </Group>
          {cleanBaseUrl('hermes', p.baseUrl) !== p.baseUrl.trim() && validateProfile({ ...p, name: 'x' }) === null ? (
            <Footnote>{t('settings.editor.savedAs', { url: cleanBaseUrl('hermes', p.baseUrl) })}</Footnote>
          ) : null}
          <Footnote>{t('settings.editor.hermesFootnote')}</Footnote>
          <SectionTitle>{t('settings.editor.advanced')}</SectionTitle>
          <Group>
            <SwitchRow title={t('settings.editor.bridge')} subtitle={t('settings.editor.bridgeSub')} value={!!p.bridge} onChange={(bridge) => update({ bridge: bridge || undefined })} />
            <SwitchRow
              title={t('settings.editor.sync')}
              subtitle={t('settings.editor.syncSub')}
              value={p.syncSessions !== false}
              onChange={(on) => update({ syncSessions: on ? undefined : false })}
            />
            <SwitchRow
              title={t('settings.editor.showForeign')}
              subtitle={t('settings.editor.showForeignSub')}
              value={p.showForeignChats === true}
              onChange={(on) => update({ showForeignChats: on || undefined })}
            />
            <SwitchRow
              title={t('settings.editor.showCron')}
              subtitle={t('settings.editor.showCronSub')}
              value={p.showCronReports === true}
              onChange={(on) => update({ showCronReports: on || undefined })}
              last
            />
          </Group>
          {/* Hermes profiles ("bots"): own model, memory, skills; picked per chat in the model menu */}
          <SectionTitle>{t('bots.settings.title')}</SectionTitle>
          <Group>
            <Field
              label={t('bots.settings.field')}
              value={botsText}
              onChangeText={(v) => {
                setBotsText(v);
                update({});
              }}
              placeholder={t('bots.settings.placeholder')}
              hint={invalidBotNames(botsText).length ? t('bots.settings.invalid', { names: invalidBotNames(botsText).join(', ') }) : undefined}
              last
            />
          </Group>
          <Footnote>{t('bots.settings.footnote')}</Footnote>
        </>
      );
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: bottomInset + 24, width: '100%', maxWidth: 640, alignSelf: 'center' }} keyboardShouldPersistTaps="handled">
      {body}

      {/* persona waiting animation (e.g. a chameleon persona); 'auto' = heuristic on name/model */}
      <SectionTitle>{t('waiting.persona.title')}</SectionTitle>
      <Group>
        <Chips
          items={[{ id: 'auto', label: t('waiting.persona.auto') }, ...PERSONA_LOADER_KINDS.map((k) => ({ id: k, label: t(`waiting.loaders.${k}` as TKey) }))]}
          selected={p.loaderStyle ?? 'auto'}
          onPick={(id) => update({ loaderStyle: id === 'auto' ? undefined : id })}
        />
      </Group>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: 14 }}>
        <Loader kind={personaLoader(p) ?? 'sparkle'} size={24} animate={!reducedMotion} />
        <View style={{ flex: 1 }}>
          <Footnote>{t(personaHintKey())}</Footnote>
        </View>
      </View>

      <Group>
        <SwitchRow title={t('settings.editor.makeActive')} value={makeActive} onChange={setMakeActive} last />
      </Group>

      {error ? <Text style={[textStyle(th, 'callout'), { color: th.colors.danger, marginHorizontal: 14 }]}>{error}</Text> : null}

      <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
        {p.kind !== 'demo' ? <Button label={t('settings.editor.test')} onPress={() => void runTest()} loading={testing} kind="secondary" grow /> : null}
        <Button label={t('settings.editor.save')} onPress={() => void save()} loading={saving} kind="primary" grow />
      </View>

      {confirmSave ? (
        <View style={{ gap: 8, marginHorizontal: 14 }} accessibilityLiveRegion="polite">
          <Text style={[textStyle(th, 'callout'), { color: th.colors.danger }]}>{t('settings.editor.authFailedWarning')}</Text>
          <View style={{ flexDirection: 'row' }}>
            <Button label={t('settings.editor.saveAnyway')} onPress={() => void save(true)} loading={saving} kind="secondary" />
          </View>
        </View>
      ) : null}

      {result ? (
        <Group>
          {result.rows.map((r, i) => (
            <ResultRow key={r.label} label={r.label} ok={r.ok} detail={r.detail} last={i === result.rows.length - 1 && !result.models.length} />
          ))}
          {result.models.length ? (
            <Chips items={result.models.slice(0, 12).map((id) => ({ id, label: id }))} selected={p.model} onPick={(model) => setP((x) => ({ ...x, model }))} />
          ) : null}
        </Group>
      ) : null}

      {onDelete ? (
        <Button label={t('settings.editor.delete')} onPress={confirmDelete} kind="secondary" tone="seal" icon={(c, s) => <Icon name="trash" size={s} color={c} />} style={{ marginTop: 8 }} />
      ) : (
        <Button label={t('actions.cancel')} onPress={onCancel} kind="tertiary" style={{ marginTop: 8 }} />
      )}
    </ScrollView>
  );
}

