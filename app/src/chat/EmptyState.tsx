import { memo, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useT } from '../i18n';
import { usePreferences } from '../settings/PreferencesProvider';
import { scaledText } from '../settings/preferences';
import { FadeIn, useTheme } from '../ui';
import { lightHaptic } from './actions';
import { Icon } from './icons';
import { STARTER_ICONS, avatarInitial, chatStarters, greeting, type Starter } from './starters';

type Props = {
  onPick(prompt: string): void;
  /** connection profile name (offline hint) */
  profileName: string;
  /** assistant shown in the header ("Hermes", "Claude", …): monogram + "… ist bereit" */
  assistantName: string;
  offline: boolean;
  offlineHint?: string;
  onOpenSettings(): void;
  /** quick answers are available on this connection: "⚡ Schnellfrage" under the greeting (app/src/quick) */
  onQuick?: () => void;
};


/** columns of the starter grid: 2 on phones, 3 from small tablets on */
const WIDE = 640;
const MAX_WIDTH = 720;

/**
 * Start screen: personal greeting (time of day) under a small typographic monogram of the assistant, and a
 * grid of starter tiles near the composer. Each tile names a task and shows a stroke icon of the interactive
 * card it produces. Settings → Chat → "Vorschläge auf dem Startbildschirm" hides the grid; the greeting then
 * sits a little lower (upper half, not top third) so the screen still reads as composed.
 */
export const EmptyState = memo(function EmptyState({ onPick, profileName, assistantName, offline, offlineHint, onOpenSettings, onQuick }: Props) {
  const t = useTheme();
  const tr = useT();
  const showStarters = usePreferences().prefs.showStarters;
  const { width } = useWindowDimensions();
  const cols = width >= WIDE ? 3 : 2;
  const starters = useMemo(() => chatStarters(tr), [tr]);
  // computed once per mount (a new chat): the greeting must not change while the screen is open
  const hello = useMemo(() => greeting(tr, new Date().getHours()), [tr]);
  const fs = t.fontScale;
  // offline: just the name (the pill below explains), never "… ist bereit"
  const ready = offline ? assistantName : tr('chat.empty.ready', { name: assistantName });

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <View style={[styles.hero, showStarters ? styles.heroWithStarters : styles.heroAlone]}>
        <FadeIn style={styles.heroInner}>
          <View style={styles.identity} accessible accessibilityLabel={ready}>
            <View style={[styles.mono, { borderColor: t.colors.accent }]}>
              <Text style={[styles.monoText, { color: t.colors.accent }]} maxFontSizeMultiplier={1.4}>
                {avatarInitial(assistantName)}
              </Text>
            </View>
            <Text style={[styles.ready, { color: t.colors.muted }, scaledText(14, 18, fs)]} numberOfLines={1}>
              {ready}
            </Text>
          </View>
          <Text style={[styles.headline, { color: t.colors.text }, cols === 3 ? scaledText(36, 42, fs) : scaledText(30, 36, fs)]} accessibilityRole="header">
            {hello}
            {'\n'}
            <Text style={{ color: t.colors.subtle }}>{tr('chat.empty.lead')}</Text>
          </Text>
          {offline ? (
            <Pressable
              onPress={onOpenSettings}
              accessibilityRole="button"
              style={({ pressed }) => [styles.offline, { backgroundColor: t.colors.dangerSoft }, pressed && { opacity: 0.7 }]}
            >
              <Icon name="alert" size={16} color={t.colors.danger} />
              <Text style={[styles.offlineText, { color: t.colors.danger }, scaledText(13.5, 18, fs)]}>
                {tr('chat.empty.offline', { profile: profileName, hint: offlineHint ?? tr('chat.header.status.unreachable') })}
              </Text>
            </Pressable>
          ) : onQuick ? (
            <Pressable
              onPress={() => {
                lightHaptic();
                onQuick();
              }}
              accessibilityRole="button"
              accessibilityLabel={tr('quick.start.a11y')}
              style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                styles.quick,
                { borderColor: t.colors.border },
                (pressed || hovered) && { backgroundColor: pressed ? t.colors.surfacePressed : t.colors.surfaceAlt },
              ]}
            >
              <Icon name="boltFilled" size={14} color={t.colors.accent} strokeWidth={1.4} />
              <Text style={[styles.quickText, { color: t.colors.text }, scaledText(14, 18, fs)]} numberOfLines={1}>
                {tr('quick.start.pill')}
                <Text style={{ color: t.colors.subtle, fontWeight: '400' }}>{`  ·  ${tr('quick.start.pillSub')}`}</Text>
              </Text>
            </Pressable>
          ) : null}
        </FadeIn>
      </View>
      {showStarters ? (
        <FadeIn delay={70} style={styles.starters}>
          <Text style={[styles.label, { color: t.colors.subtle }, scaledText(12.5, 16, fs)]} accessibilityRole="header">
            {tr('chat.empty.startersLabel')}
          </Text>
          <View style={styles.grid}>
            {starters.map((s) => (
              <StarterTile key={s.key} s={s} cols={cols} onPick={onPick} />
            ))}
          </View>
        </FadeIn>
      ) : null}
    </ScrollView>
  );
});

const StarterTile = memo(function StarterTile({ s, cols, onPick }: { s: Starter; cols: number; onPick(prompt: string): void }) {
  const t = useTheme();
  const tr = useT();
  const fs = t.fontScale;
  return (
    <Pressable
      onPress={() => {
        lightHaptic();
        onPick(s.prompt);
      }}
      accessibilityRole="button"
      accessibilityLabel={tr('chat.empty.starterA11y', { title: s.title, subtitle: s.subtitle })}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.tile,
        cols === 3 ? styles.tile3 : styles.tile2,
        {
          borderColor: t.colors.border,
          backgroundColor: pressed ? t.colors.surfacePressed : hovered ? t.colors.surfaceAlt : t.dark ? t.colors.surface : t.colors.bg,
        },
      ]}
    >
      <Icon name={STARTER_ICONS[s.key]} size={20} color={t.colors.accent} strokeWidth={1.7} />
      <View style={styles.tileText}>
        <Text style={[styles.tileTitle, { color: t.colors.text }, scaledText(15, 20, fs)]} numberOfLines={2}>
          {s.title}
        </Text>
        <Text style={[styles.tileSub, { color: t.colors.muted }, scaledText(13, 17, fs)]} numberOfLines={2}>
          {s.subtitle}
        </Text>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { flexGrow: 1, width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center', paddingBottom: 10 },
  hero: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, minHeight: 200 },
  // optical centre: a bit above the middle with tiles below; lower (but still upper half) without them
  heroWithStarters: { paddingTop: 8, paddingBottom: 24 },
  heroAlone: { paddingBottom: 72 },
  heroInner: { gap: 14 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  mono: { width: 30, height: 30, borderRadius: 9, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  monoText: { fontSize: 15, lineHeight: 18, fontWeight: '700', letterSpacing: -0.2 },
  ready: { fontSize: 14, fontWeight: '500', flexShrink: 1 },
  headline: { fontSize: 30, lineHeight: 36, fontWeight: '600', letterSpacing: -0.8 },
  offline: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 8, paddingHorizontal: 12, paddingVertical: 9, minHeight: 44, borderRadius: 12 },
  offlineText: { fontSize: 13.5, fontWeight: '500', flexShrink: 1 },
  quick: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 7, minHeight: 40, paddingLeft: 12, paddingRight: 15, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth },
  quickText: { fontSize: 14, fontWeight: '600', flexShrink: 1 },
  starters: { paddingHorizontal: 12, gap: 10 },
  label: { fontSize: 12.5, fontWeight: '600', letterSpacing: 0.2, paddingHorizontal: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: {
    flexGrow: 1,
    minHeight: 80,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    paddingHorizontal: 13,
    paddingTop: 12,
    paddingBottom: 11,
    gap: 8,
  },
  tile2: { flexBasis: '46%' },
  tile3: { flexBasis: '30%' },
  tileText: { gap: 1 },
  tileTitle: { fontSize: 15, fontWeight: '600', letterSpacing: -0.2 },
  tileSub: { fontSize: 13 },
});
