// Settings: Suche · Verbindungen · Darstellung · Chat · Medien · Bedienung · Sprache & Stimme · Über. Sub-pages (kind picker, editor, QR pairing)
// replace the list in place (no nested modals), Android back walks back one level.
import Constants from 'expo-constants';
import { versionLabel } from './versionLabel.ts';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../chat/icons';
import { BulkDeleteDialog, useConversations } from '../conversations';
import { useI18n, useT, type LangSetting } from '../i18n';
import { OnboardingScreen } from '../onboarding/OnboardingScreen';
import type { OnboardingFinish } from '../onboarding/OnboardingFlow';
import { openOnboarding } from '../onboarding/hostEvents';
import { ConnectionCheckPage } from '../onboarding/guided/ConnectionCheckPage';
import { queueStarterPrompt } from '../onboarding/starterPrompt';
import { useTitlebarInset } from '../desktop/chrome';
import { useDesktopSettingsSection } from '../desktop/DesktopSettings';
import { useTheme } from '../ui';
import { useEscapeToClose } from '../ui/lib/useEscapeToClose';
import { VoiceSettingsSection, voiceConnFromProfile } from '../voice';
import { PushSettingsSection, pushSearchTexts } from '../push';
import { HAS_DEV_PROFILES, useConnection } from './ConnectionProvider';
import { ProfileEditor } from './ProfileEditor';
import { FLAVOR, pickableKinds } from '../flavor';
import { brand } from '../brand';
import { aboutLinkRows } from './flavorTexts';
import { ProfileMark, markFor } from './ProfileMark';
import { PRESET_DEMO_ID, blankProfile, maskKey, needsBaseUrl, profileTarget, type ConnectionProfile, type ProfileKind } from './profiles';
import { makeMatcher, SettingsSectionView, useCustomizationSections, visibleRows, type SettingsSection } from './sections';
import { LangRetry } from './LangRetry';
import { Button as SettingsButton, Footnote, Group, NavRow, SearchField, Segmented, SubLabel } from './ui';
import type { ProfilesStorageState } from './storage';
import { confirmAsync } from '../chat/commands/confirm';

type Page = { name: 'list' } | { name: 'pickKind' } | { name: 'edit'; profile: ConnectionProfile; isNew: boolean } | { name: 'pair' } | { name: 'check' };

/** "Neue Verbindung": own agents and accounts, then API providers, then any OpenAI-compatible URL */
const KIND_ORDER = pickableKinds() as ProfileKind[];

export function SettingsScreen() {
  const th = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // macOS app: the traffic lights sit at the left end of the header row
  const titlebarInset = useTitlebarInset();
  const t = useT();
  const { profiles, active, setActive, upsertProfile, deleteProfile, isBuiltin } = useConnection();
  const convs = useConversations();
  const [page, setPage] = useState<Page>({ name: 'list' });
  // `/settings?edit=<profileId>` (chat auth error → "Verbindung bearbeiten"): open that profile's editor once
  const { edit: editId } = useLocalSearchParams<{ edit?: string }>();
  const editOpened = useRef(false);
  useEffect(() => {
    if (editOpened.current || !editId) return;
    const target = profiles.find((x) => x.id === editId);
    if (!target) return;
    editOpened.current = true;
    setPage({ name: 'edit', profile: target, isNew: false });
  }, [editId, profiles]);

  // A chat runs on the profile it was started with: switching opens a new chat for it
  // (create() re-uses an empty draft of that profile), unless the open chat already belongs to it.
  const selectProfile = (p: Pick<ConnectionProfile, 'id' | 'kind'>) => {
    setActive(p.id);
    const open = convs.activeId ? convs.get(convs.activeId) : undefined;
    if (!open || open.profileId !== p.id) return convs.create(p as Parameters<typeof convs.create>[0]);
    return open;
  };

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const back = () => setPage((pg) => (pg.name === 'edit' && pg.isNew ? { name: 'pickKind' } : { name: 'list' }));

  // Android back: leave the sub-page first, then close the modal.
  useEffect(() => {
    if (page.name === 'list') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      back();
      return true;
    });
    return () => sub.remove();
  }, [page.name]); // eslint-disable-line react-hooks/exhaustive-deps

  // web: Esc leaves the sub-page first, then closes the settings screen (B11; sheets / dialogs opened on top
  // register later on the same stack and close first)
  useEscapeToClose(true, () => {
    if (page.name === 'list') close();
    else if (page.name === 'pair') setPage({ name: 'list' });
    else back();
  });

  const onPairFinish = (r: OnboardingFinish) => {
    if (r.path === 'other') {
      setPage({ name: 'pickKind' });
      return;
    }
    const target = r.path === 'demo' ? profiles.find((x) => x.id === PRESET_DEMO_ID) : r.profile;
    if (!target) {
      setPage({ name: 'list' });
      return;
    }
    const meta = selectProfile(target);
    if (r.starterPrompt && meta) {
      queueStarterPrompt(meta.id, r.starterPrompt);
      close();
      return;
    }
    setPage({ name: 'list' });
  };


  const title =
      page.name === 'check'
        ? t('onboarding.diag.settings.title')
      : page.name === 'edit' ? (page.isNew ? t('settings.screen.newConnection') : t('settings.screen.editConnection')) : page.name === 'pickKind' ? t('settings.screen.newConnection') : page.name === 'pair' ? t('settings.screen.addByQr') : t('settings.screen.title');

  // the pairing flow brings its own header (back arrow, progress) → only our close row on top
  if (page.name === 'pair') {
    return (
      <View style={[styles.flex, { backgroundColor: th.colors.bg }]}>
        <OnboardingScreen entry="choose" finishAfterSave onFinish={onPairFinish} />
        <Pressable
          onPress={() => setPage({ name: 'list' })}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t('actions.cancel')}
          style={({ pressed }) => [styles.pairClose, { top: (Platform.OS === 'ios' ? 6 : insets.top) + 11, backgroundColor: th.colors.surfaceAlt, opacity: pressed ? 0.6 : 1 }]}
        >
          <Icon name="close" size={16} color={th.colors.text} />
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.flex, { backgroundColor: th.dark ? th.colors.bg : th.colors.surfaceAlt }]}>
      <View style={[styles.header, { paddingTop: Platform.OS === 'ios' ? 12 : insets.top + 8, borderBottomColor: th.colors.border }, titlebarInset > 0 && { paddingLeft: titlebarInset }]}>
        {page.name !== 'list' ? (
          <Pressable onPress={back} hitSlop={10} accessibilityRole="button" style={styles.headerSide}>
            <Text style={[styles.headerBtn, { color: th.colors.accent }]} numberOfLines={1}>
              {t('settings.screen.back')}
            </Text>
          </Pressable>
        ) : (
          <View style={styles.headerSide} />
        )}
        <Text style={[styles.headerTitle, { color: th.colors.text }]} numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
        <Pressable onPress={close} hitSlop={10} accessibilityRole="button" style={[styles.headerSide, { alignItems: 'flex-end' }]}>
          <Text style={[styles.headerBtn, { color: th.colors.accent, fontWeight: '600' }]} numberOfLines={1}>
            {t('settings.screen.done')}
          </Text>
        </Pressable>
      </View>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {page.name === 'edit' ? (
          <ProfileEditor
            key={page.profile.id}
            initial={page.profile}
            isNew={page.isNew}
            bottomInset={insets.bottom}
            onCancel={() => setPage({ name: 'list' })}
            onSave={async (p, makeActive) => {
              await upsertProfile(p);
              if (makeActive) selectProfile(p);
              setPage({ name: 'list' });
            }}
            onDelete={
              page.isNew || isBuiltin(page.profile.id)
                ? undefined
                : async () => {
                    await deleteProfile(page.profile.id);
                    setPage({ name: 'list' });
                  }
            }
          />
        ) : page.name === 'check' ? (
          <ConnectionCheckPage profile={active} bottomInset={insets.bottom} onEdit={() => setPage({ name: 'edit', profile: active, isNew: false })} />
        ) : page.name === 'pickKind' ? (
          <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}>
            <Group>
              {KIND_ORDER.map((k, i) => (
                <NavRow
                  key={k}
                  title={t(`settings.kinds.${k}.title`)}
                  subtitle={t(`settings.kinds.${k}.sub`)}
                  leading={<ProfileMark mark={markFor(k)} />}
                  onPress={() => setPage({ name: 'edit', profile: blankProfile(k), isNew: true })}
                  last={i === KIND_ORDER.length - 1}
                />
              ))}
            </Group>
            <Group>
              <NavRow title={t('settings.connections.addQr')} subtitle={t('settings.connections.addQrSub')} leading={<LeadIcon name="plus" />} onPress={() => setPage({ name: 'pair' })} last />
            </Group>
          </ScrollView>
        ) : (
          <MainList
            profiles={profiles}
            activeId={active.id}
            bottomInset={insets.bottom}
            onSelect={selectProfile}
            onEdit={(p) => setPage({ name: 'edit', profile: p, isNew: false })}
            onAdd={() => setPage({ name: 'pickKind' })}
            onPair={() => setPage({ name: 'pair' })}
            onCheck={() => setPage({ name: 'check' })}
            onRestart={() => {
              close();
              // after the modal is gone, the host shows the flow from the welcome screen
              setTimeout(() => openOnboarding('welcome', { restart: true }), 350);
            }}
            onGallery={() => router.push('/gallery')}
          />
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

function MainList({
  profiles,
  activeId,
  bottomInset,
  onSelect,
  onEdit,
  onAdd,
  onPair,
  onCheck,
  onRestart,
  onGallery,
}: {
  profiles: ConnectionProfile[];
  activeId: string;
  bottomInset: number;
  onSelect(p: ConnectionProfile): void;
  onEdit(p: ConnectionProfile): void;
  onAdd(): void;
  onPair(): void;
  onCheck(): void;
  onRestart(): void;
  onGallery(): void;
}) {
  const t = useT();
  const { setting, setSetting } = useI18n();
  const { storageState, unlockProfiles } = useConnection();
  const active = profiles.find((p) => p.id === activeId);
  const voiceConn = useMemo(() => (active ? voiceConnFromProfile(active) : null), [active]);
  const version = versionLabel(Constants.expoConfig?.version, Constants.expoConfig?.extra);
  const [query, setQuery] = useState('');
  const custom = useCustomizationSections();
  const desktop = useDesktopSettingsSection(); // macOS app only
  const convs = useConversations();
  const [deleteAll, setDeleteAll] = useState(false);

  const langOpts: { value: LangSetting; label: string }[] = [
    { value: 'system', label: t('settings.appearance.system') },
    { value: 'de', label: t('language.de') },
    { value: 'en', label: t('language.en') },
    { value: 'es', label: t('language.es') },
  ];

  const connections: SettingsSection = {
    id: 'connections',
    title: t('settings.sections.connections'),
    rows: [
      {
        key: 'profiles',
        texts: [...profiles.map((p) => p.name), t('settings.connections.add'), t('settings.connections.addQr'), t('onboarding.diag.settings.row'), t('settings.connections.restart'), 'QR'],
        render: () => (
          <>
            {storageState !== 'ok' ? <StorageNotice state={storageState} onUnlock={unlockProfiles} /> : null}
            <Group>
              {profiles.map((p, i) => (
                <ProfileRow key={p.id} profile={p} selected={p.id === activeId} last={i === profiles.length - 1} onSelect={() => onSelect(p)} onEdit={() => onEdit(p)} />
              ))}
            </Group>
            <Group>
              <NavRow title={t('settings.connections.add')} leading={<LeadIcon name="plus" />} tone="accent" onPress={onAdd} chevron={false} />
              <NavRow title={t('settings.connections.addQr')} subtitle={t('settings.connections.addQrSub')} leading={<LeadIcon name="share" />} tone="accent" onPress={onPair} chevron={false} />
              {active?.kind === 'hermes' ? <NavRow title={t('onboarding.diag.settings.row')} subtitle={t('onboarding.diag.settings.rowSub')} leading={<LeadIcon name="shield" />} onPress={onCheck} /> : null}
              <NavRow title={t('settings.connections.restart')} subtitle={t('settings.connections.restartSub')} leading={<LeadIcon name="retry" />} onPress={onRestart} last chevron={false} />
            </Group>
            <Footnote>{`${t('settings.connections.footnote')} ${t('settings.connections.switchHint')}`}</Footnote>
            {HAS_DEV_PROFILES ? <Footnote tone="warning">{t('settings.connections.devWarning')}</Footnote> : null}
          </>
        ),
      },
    ],
  };

  const notifications: SettingsSection = {
    id: 'notifications',
    title: t('push.title'),
    rows: [{ key: 'push', texts: pushSearchTexts(t), render: () => <PushSettingsSection profile={active} /> }],
  };

  const language: SettingsSection = {
    id: 'language',
    title: t('settings.sections.language'),
    rows: [
      {
        key: 'lang',
        texts: [t('settings.appearance.language'), ...langOpts.map((o) => o.label)],
        render: () => (
          <>
            <SubLabel>{t('settings.appearance.language')}</SubLabel>
            <Segmented<LangSetting> label={t('settings.appearance.language')} value={setting} options={langOpts} onChange={setSetting} />
            <LangRetry />
          </>
        ),
      },
      { key: 'voice', texts: [t('settings.sections.voice')], render: () => <VoiceSettingsSection conn={voiceConn} /> },
    ],
  };

  // Daten: "Alle Chats löschen" (warning dialog with profile scope; pinned chats asked separately; undo toast)
  const data: SettingsSection = {
    id: 'data',
    title: t('conversations.bulk.section'),
    rows: [
      {
        key: 'deleteAll',
        texts: [t('conversations.bulk.deleteAll'), t('conversations.bulk.deleteAllSub')],
        render: () => (
          <Group>
            <NavRow
              title={t('conversations.bulk.deleteAll')}
              subtitle={t('conversations.bulk.deleteAllSub')}
              tone="danger"
              chevron={false}
              disabled={!convs.list.length}
              onPress={() => setDeleteAll(true)}
              last
            />
          </Group>
        ),
      },
    ],
  };

  // website / source / privacy from the brand identity (app/brand/identity.json); unset links are hidden
  const aboutLinks = aboutLinkRows(brand()).map((l) => ({ ...l, title: t(`settings.about.${l.key}`) }));
  const about: SettingsSection = {
    id: 'about',
    title: t('settings.sections.about'),
    rows: [
      {
        key: 'about',
        texts: [
          ...(FLAVOR === 'hermes' ? [brand().name, t('settings.about.tagline')] : []),
          t('settings.about.version'),
          ...aboutLinks.map((l) => l.title),
          t('settings.about.gallery'),
          t('settings.about.unofficial'),
        ],
        render: () => (
          <Group>
            {FLAVOR === 'hermes' ? <NavRow title={brand().name} subtitle={t('settings.about.tagline')} chevron={false} /> : null}
            <NavRow title={t('settings.about.version')} subtitle={version} chevron={false} />
            <NavRow title={t('settings.about.unofficial')} subtitle={t('settings.about.unofficialText')} />
            {aboutLinks.map((l) => (
              <NavRow key={l.key} title={l.title} onPress={() => void Linking.openURL(l.url)} />
            ))}
            <NavRow title={t('settings.about.gallery')} onPress={onGallery} last />
          </Group>
        ),
      },
    ],
  };

  const match = makeMatcher(query);
  const sections = [connections, notifications, ...(desktop ? [desktop] : []), ...custom, language, data, about].map((s) => ({ s, rows: visibleRows(s, match) })).filter((x) => x.rows.length > 0);

  return (
    <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset + 24 }]} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
      <SearchField value={query} onChange={setQuery} placeholder={t('settings.search.placeholder')} clearLabel={t('settings.search.clear')} />
      {sections.map(({ s, rows }) => (
        <SettingsSectionView key={s.id} section={s} rows={rows} />
      ))}
      {!sections.length ? <Footnote>{t('settings.search.empty', { query: query.trim() })}</Footnote> : null}
      {deleteAll ? (
        <BulkDeleteDialog
          mode="all"
          candidates={convs.list}
          profiles={profiles}
          onCancel={() => setDeleteAll(false)}
          onDone={() => setDeleteAll(false)}
        />
      ) : null}
    </ScrollView>
  );
}

function ProfileRow({
  profile,
  selected,
  last,
  onSelect,
  onEdit,
}: {
  profile: ConnectionProfile;
  selected: boolean;
  last: boolean;
  onSelect(): void;
  onEdit(): void;
}) {
  const th = useTheme();
  const t = useT();
  const keyInfo = needsBaseUrl(profile.kind) ? (profile.apiKey ? maskKey(profile.apiKey) : t('settings.connections.noKey')) : '';
  return (
    <View style={[styles.row, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: th.colors.border }]}>
      <Pressable onPress={onSelect} style={styles.rowMain} accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={profile.name}>
        <View style={[styles.radio, { borderColor: selected ? th.colors.accent : th.colors.borderStrong }]}>
          {selected ? <View style={[styles.radioDot, { backgroundColor: th.colors.accent }]} /> : null}
        </View>
        <ProfileMark mark={markFor(profile.kind, profile)} small />
        <View style={styles.flexShrink}>
          <Text style={[styles.rowTitle, { color: th.colors.text }]} numberOfLines={1}>
            {profile.name}
          </Text>
          <Text style={[styles.rowSub, { color: th.colors.muted }]} numberOfLines={1}>
            {profileTarget(profile, t)}
            {keyInfo ? `  ·  ${keyInfo}` : ''}
          </Text>
        </View>
      </Pressable>
      <Pressable onPress={onEdit} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('settings.connections.edit', { name: profile.name })} style={styles.editBtn}>
        <Icon name="chevronRight" size={20} color={th.colors.subtle} />
      </Pressable>
    </View>
  );
}

/** Settings → Verbindungen: what loading the stored profile list found (settings/storage.ts) + the explicit unlock. */
function StorageNotice({ state, onUnlock }: { state: Exclude<ProfilesStorageState, 'ok'>; onUnlock(): Promise<void> }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const unlock = async () => {
    const ok = await confirmAsync(t('settings.storage.unlockTitle'), t('settings.storage.unlockText'), t('settings.storage.unlockConfirm'), t('settings.storage.cancel'), true);
    if (!ok) return;
    setBusy(true);
    await onUnlock().catch(() => {});
    setBusy(false);
  };
  return (
    <View style={styles.storageNotice} accessibilityRole="alert">
      <Footnote tone="warning">{t(`settings.storage.${state}`)}</Footnote>
      {state !== 'recovered' ? <SettingsButton kind="secondary" label={t('settings.storage.unlock')} loading={busy} onPress={() => void unlock()} /> : null}
    </View>
  );
}

function LeadIcon({ name }: { name: 'plus' | 'share' | 'retry' | 'shield' }) {
  const th = useTheme();
  return (
    <View style={{ width: 28, alignItems: 'center' }}>
      <Icon name={name} size={19} color={name === 'retry' || name === 'shield' ? th.colors.muted : th.colors.accent} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  storageNotice: { gap: 8, marginBottom: 12 },
  flexShrink: { flex: 1, minWidth: 0 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  headerSide: { width: 76 },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '600' },
  headerBtn: { fontSize: 17 },
  scroll: { padding: 16, gap: 8, width: '100%', maxWidth: 640, alignSelf: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 14, paddingRight: 8, minHeight: 58, paddingVertical: 8 },
  rowMain: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowTitle: { fontSize: 16 },
  rowSub: { fontSize: 13, marginTop: 2 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  editBtn: { padding: 8 },
  pairClose: { position: 'absolute', right: 14, width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
});
