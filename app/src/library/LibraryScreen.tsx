// Skills & memory of one bot (docs/SKILLS-MEMORY.md). Read-only: the skill list (Hermes' /v1/skills, or the
// hermes-ui-plus plugin through the bridge with on/off state, source and SKILL.md) and, when the plugin shares it, what
// Hermes keeps in MEMORY.md / USER.md. Every change goes through the agent as a normal chat message (useAskHermes).
import { fetch as expoFetch } from 'expo/fetch';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../ui/primitives/Text';
import { textStyle, useTheme } from '../ui';
import { useEscapeToClose } from '../ui/lib/useEscapeToClose';
import { useTitlebarInset } from '../desktop/chrome';
import { useLocale, useT } from '../i18n';
import { describeError } from '../hermes/stream';
import type { FetchLike } from '../hermes/stream';
import { botOf, DEFAULT_BOT } from '../hermes/bots';
import { useHermesBots } from '../hermes/useHermesBots';
import { useActiveProfile } from '../settings/ConnectionProvider';
import { Segmented } from '../settings/ui';
import { skillsFailure, type LibraryFeatures, type MemorySnapshot, type SkillsFailure } from './model';
import { librarySource, type LibrarySource, type SkillList } from './source';
import { useAskHermes } from './useAskHermes';
import { SkillDetail, SkillsPane } from './SkillsPane';
import { MemoryPane } from './MemoryPane';

const nativeFetch = expoFetch as unknown as FetchLike;

export type Tab = 'skills' | 'memory';

export type SkillsLoad = { kind: 'loading' } | { kind: 'ready'; list: SkillList } | { kind: 'failed'; why: SkillsFailure; message: string };
export type MemoryLoad = { kind: 'loading' } | { kind: 'ready'; memory: MemorySnapshot } | { kind: 'unavailable'; reason?: string } | { kind: 'failed'; message: string };

export function LibraryScreen() {
  const th = useTheme();
  const t = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const titlebarInset = useTitlebarInset();
  const profile = useActiveProfile();
  const params = useLocalSearchParams<{ bot?: string; tab?: string }>();
  const bot = botOf(params.bot);
  const { bots } = useHermesBots(profile ?? undefined, bot);
  const botEntry = bots.find((b) => (bot ? b.name === bot : b.default || b.name === DEFAULT_BOT));
  const botName = botEntry?.label ?? (bot ?? t('bots.picker.default'));
  // in running text the default bot is just "Hermes" ("in the chat with Default" reads oddly)
  const botInText = bot ? botName : 'Hermes';
  const ask = useAskHermes(profile, bot);

  const [tab, setTab] = useState<Tab>(params.tab === 'memory' ? 'memory' : 'skills');
  const [openSkill, setOpenSkill] = useState<string | null>(null);
  const { lang } = useLocale();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuilt only when the connection, bot or demo language changes
  const src: LibrarySource | null = useMemo(() => librarySource(profile, bot, nativeFetch, lang), [profile?.id, profile?.kind, profile?.baseUrl, profile?.apiKey, profile?.bridge, bot, lang]);

  const [features, setFeatures] = useState<LibraryFeatures | null>(null);
  const [skills, setSkills] = useState<SkillsLoad>({ kind: 'loading' });
  const [memory, setMemory] = useState<MemoryLoad>({ kind: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  const reqRef = useRef(0);

  const load = useCallback(
    async (pull = false) => {
      if (!src) return;
      const req = ++reqRef.current;
      const stale = () => req !== reqRef.current;
      try {
        let f: LibraryFeatures;
        try {
          f = await src.features();
        } catch (e) {
          if (stale()) return;
          const message = describeError(e, t);
          setSkills({ kind: 'failed', why: skillsFailure(e), message });
          setMemory({ kind: 'failed', message });
          return;
        }
        if (stale()) return;
        setFeatures(f);
        await Promise.all([
          src.skills(f).then(
            (list) => !stale() && setSkills({ kind: 'ready', list }),
            (e: unknown) => !stale() && setSkills((cur) => (pull && cur.kind === 'ready' ? cur : { kind: 'failed', why: skillsFailure(e), message: describeError(e, t) })),
          ),
          f.memory.available
            ? src.memory(f).then(
                (m) => !stale() && setMemory(m ? { kind: 'ready', memory: m } : { kind: 'unavailable' }),
                (e: unknown) => !stale() && setMemory((cur) => (pull && cur.kind === 'ready' ? cur : { kind: 'failed', message: describeError(e, t) })),
              )
            : Promise.resolve().then(() => !stale() && setMemory({ kind: 'unavailable', reason: f.memory.reason })),
        ]);
      } finally {
        if (pull && !stale()) setRefreshing(false);
      }
    },
    [src, t],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const pullRefresh = useCallback(() => {
    setRefreshing(true);
    void load(true);
  }, [load]);

  const close = useCallback(() => (router.canGoBack() ? router.back() : router.replace('/')), [router]);
  const back = useCallback(() => setOpenSkill(null), []);
  useEscapeToClose(true, openSkill ? back : close);
  useEffect(() => {
    if (!openSkill) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      back();
      return true;
    });
    return () => sub.remove();
  }, [openSkill, back]);

  // not a Hermes connection (or no key yet): nothing to load, the panes explain
  const skillsShown: SkillsLoad = src ? skills : { kind: 'failed', why: 'unsupported', message: '' };
  const memoryShown: MemoryLoad = src ? memory : { kind: 'unavailable' };
  const list = skillsShown.kind === 'ready' ? skillsShown.list : null;
  const open = openSkill && list ? list.skills.find((s) => s.name === openSkill) : undefined;

  return (
    <View style={[styles.flex, { backgroundColor: th.colors.bg }]}>
      <View style={[styles.header, { paddingTop: Platform.OS === 'ios' ? 12 : insets.top + 8, borderBottomColor: th.colors.border }, titlebarInset > 0 && { paddingLeft: titlebarInset }]}>
        {open ? (
          <Pressable onPress={back} hitSlop={10} accessibilityRole="button" style={styles.headerSide} testID="library-back">
            <Text style={[textStyle(th, 'headline'), { color: th.colors.accentText, fontWeight: '400' }]} numberOfLines={1}>
              {t('library.back')}
            </Text>
          </Pressable>
        ) : (
          <View style={styles.headerSide} />
        )}
        <View style={styles.headerTitle}>
          <Text style={[textStyle(th, 'headline'), styles.center, { color: th.colors.text }]} numberOfLines={1} accessibilityRole="header">
            {open ? open.name : t('library.title')}
          </Text>
          {!open ? (
            <Text style={[textStyle(th, 'caption'), styles.center, { color: th.colors.muted }]} numberOfLines={1}>
              {botName}
            </Text>
          ) : null}
        </View>
        <Pressable onPress={close} hitSlop={10} accessibilityRole="button" style={[styles.headerSide, { alignItems: 'flex-end' }]} testID="library-done">
          <Text style={[textStyle(th, 'headline'), { color: th.colors.accentText }]} numberOfLines={1}>
            {t('settings.screen.done')}
          </Text>
        </Pressable>
      </View>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        refreshControl={src && !open ? <RefreshControl refreshing={refreshing} onRefresh={pullRefresh} /> : undefined}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <View style={styles.column}>
          {open && src && features ? (
            <SkillDetail key={open.name} skill={open} via={list?.via ?? 'api'} src={src} features={features} onAsk={ask} />
          ) : (
            <>
              <Segmented<Tab>
                value={tab}
                onChange={setTab}
                label={t('library.tabs.a11y')}
                options={[
                  { value: 'skills', label: t('library.tabs.skills') },
                  { value: 'memory', label: t('library.tabs.memory') },
                ]}
              />
              {tab === 'skills' ? (
                <SkillsPane load={skillsShown} onOpen={setOpenSkill} onRetry={pullRefresh} onAsk={ask} />
              ) : (
                <MemoryPane load={memoryShown} botName={botInText} onRetry={pullRefresh} onAsk={ask} />
              )}
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  headerSide: { minWidth: 76 },
  headerTitle: { flex: 1, minWidth: 0 },
  center: { textAlign: 'center' },
  content: { paddingHorizontal: 16, paddingTop: 12 },
  column: { width: '100%', maxWidth: 720, alignSelf: 'center', gap: 8 },
});
