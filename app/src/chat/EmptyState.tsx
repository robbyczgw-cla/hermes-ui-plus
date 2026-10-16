import { memo, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Text } from '../ui/primitives/Text';
import { useT } from '../i18n';
import { usePreferences } from '../settings/PreferencesProvider';
import { FLAVOR } from '../flavor';
import { FadeIn, scaleFont, textStyle, useTheme } from '../ui';
import { PetasosMark } from '../ui/primitives/PetasosMark';
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
/** left/right edge of greeting and tiles: the tile border lines up with the greeting text */
const EDGE = 20;

/**
 * Start screen: the app's Petasos mark (official build; the personal flavor has its own icon and keeps the assistant
 * monogram) with "… is ready", a one-colour greeting (time of day) set in the display face (Gloock, the one place
 * besides onboarding and empty states where it appears) and right below it the grid of starter tiles, the
 * whole group optically centred a little above the middle. Each tile names a task and shows a stroke icon of the
 * interactive card it produces; tiles align with the greeting's left edge. Settings → Chat → "Vorschläge auf dem
 * Startbildschirm" hides the grid.
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
      <View style={styles.spacerTop} />
      <View style={styles.hero}>
        <FadeIn style={styles.heroInner}>
          <View style={styles.identity} accessible accessibilityLabel={ready}>
            {FLAVOR === 'hermes' ? (
              <PetasosMark width={36} />
            ) : (
              <View style={[styles.mono, { borderColor: t.colors.accent }]}>
                <Text style={[styles.monoText, { color: t.colors.accentText }]} maxFontSizeMultiplier={1.4}>
                  {avatarInitial(assistantName)}
                </Text>
              </View>
            )}
            <Text style={[textStyle(t, 'callout'), styles.ready, { color: t.colors.muted }]} numberOfLines={1}>
              {ready}
            </Text>
          </View>
          <Text style={[textStyle(t, 'hero'), { color: t.colors.text }, cols === 3 ? scaleFont(40, 46, fs) : null]} accessibilityRole="header">
            {`${hello}\n${tr('chat.empty.lead')}`}
          </Text>
          {offline ? (
            <Pressable
              onPress={onOpenSettings}
              accessibilityRole="button"
              style={({ pressed }) => [styles.offline, { backgroundColor: t.colors.dangerSoft }, pressed && { opacity: 0.7 }]}
            >
              <Icon name="alert" size={16} color={t.colors.danger} />
              <Text style={[textStyle(t, 'caption'), styles.offlineText, { color: t.colors.danger }]}>
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
              <Text style={[textStyle(t, 'callout'), styles.quickText, { color: t.colors.text }]} numberOfLines={1}>
                {tr('quick.start.pill')}
                <Text style={{ color: t.colors.subtle, fontWeight: '400' }}>{`  ·  ${tr('quick.start.pillSub')}`}</Text>
              </Text>
            </Pressable>
          ) : null}
        </FadeIn>
      </View>
      {showStarters ? (
        <FadeIn delay={70} style={styles.starters}>
          <Text style={[textStyle(t, 'caption'), styles.label, { color: t.colors.muted }]} accessibilityRole="header">
            {tr('chat.empty.startersLabel')}
          </Text>
          <View style={styles.grid}>
            {starters.map((s) => (
              <StarterTile key={s.key} s={s} cols={cols} onPick={onPick} />
            ))}
          </View>
        </FadeIn>
      ) : null}
      <View style={showStarters ? styles.spacerBottom : styles.spacerBottomAlone} />
    </ScrollView>
  );
});

const StarterTile = memo(function StarterTile({ s, cols, onPick }: { s: Starter; cols: number; onPick(prompt: string): void }) {
  const t = useTheme();
  const tr = useT();
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
        <Text style={[textStyle(t, 'bodyStrong'), { color: t.colors.text }]} numberOfLines={2}>
          {s.title}
        </Text>
        <Text style={[textStyle(t, 'caption'), { color: t.colors.muted }]} numberOfLines={2}>
          {s.subtitle}
        </Text>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { flexGrow: 1, width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center', paddingBottom: 10 },
  // greeting + tiles are one group; the spacers put it a bit above the middle (more room below than above)
  spacerTop: { flexGrow: 2, minHeight: 16 },
  spacerBottom: { flexGrow: 3, minHeight: 8 },
  spacerBottomAlone: { flexGrow: 4 },
  hero: { paddingHorizontal: EDGE, paddingBottom: 28 },
  heroInner: { gap: 14 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  mono: { width: 30, height: 30, borderRadius: 10, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  monoText: { fontSize: 15, lineHeight: 18, fontWeight: '700', letterSpacing: -0.2 },
  ready: { fontWeight: '500', flexShrink: 1 },
  offline: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 8, paddingHorizontal: 12, paddingVertical: 9, minHeight: 44, borderRadius: 10 },
  offlineText: { fontWeight: '500', flexShrink: 1 },
  // maxWidth: with large text the one-line pill must end in "…" inside the column, not run off-screen (web)
  quick: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', maxWidth: '100%', gap: 7, minHeight: 40, paddingLeft: 12, paddingRight: 15, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth },
  quickText: { fontWeight: '600', flexShrink: 1 },
  starters: { paddingHorizontal: EDGE, gap: 10 },
  label: { fontWeight: '600' },
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
});
