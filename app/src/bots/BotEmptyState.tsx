/**
 * Start screen of a bot's empty Bot Chat (bots/): the bot's avatar and name, its one line (Desktop description, else a
 * hint for the default bot), "Eigener Chat, eigenes Gedächtnis" and three plain starters in one column. No grid, no
 * greeting: this is a contact, not the app's home screen.
 */
import { memo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useT, type TKey } from '../i18n';
import { FadeIn, HText, Icon, useTheme } from '../ui';
import { BotAvatar } from './BotAvatar';
import { isTemplateId, WITH_STARTERS } from './create/core';

type Props = {
  name: string;
  /** profile name; undefined = the default bot */
  bot?: string;
  color?: string;
  description?: string;
  /** role template of a bot made in the app: "<Name> ist bereit" and that template's three starters */
  template?: string;
  offline: boolean;
  offlineHint?: string;
  /** the offline demo: "Nur auf diesem Gerät · Demo" instead of the server's own chat and memory */
  demo?: boolean;
  onPick(text: string): void;
};

export const BotEmptyState = memo(function BotEmptyState({ name, bot, color, description, template, offline, offlineHint, demo, onPick }: Props) {
  const t = useTheme();
  const tr = useT();
  const line = description ?? (bot ? undefined : tr('bots.roster.defaultHint'));
  const own = bot && isTemplateId(template) && WITH_STARTERS.includes(template) ? template : null;
  const starters = own
    ? ([1, 2, 3] as const).map((n) => tr(`botCreate.templates.${own}.s${n}` as TKey))
    : [tr('bots.chat.starterWhat'), tr('bots.chat.starterLast'), tr('bots.chat.starterKnow')];
  const heading = bot && isTemplateId(template) ? tr('botCreate.ready', { name }) : name;
  const memoryLine = demo ? tr('bots.chat.demoNote') : tr('bots.chat.ownMemory');
  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <FadeIn style={styles.inner}>
        <View style={styles.identity} accessible accessibilityLabel={[heading, line, memoryLine].filter(Boolean).join('. ')}>
          <BotAvatar name={name} bot={bot} color={color} size={60} />
          <HText variant="display" numberOfLines={2} testID="bot-empty-heading">
            {heading}
          </HText>
          {line ? (
            <HText variant="body" color="muted">
              {line}
            </HText>
          ) : null}
          <HText variant="caption" color="subtle" testID="bot-empty-memory">
            {memoryLine}
          </HText>
        </View>
        {offline ? (
          <View style={[styles.offline, { backgroundColor: t.colors.surfaceAlt, borderRadius: t.radii.control }]} accessibilityRole="alert">
            <Icon name="alert" size={16} color={t.colors.muted} />
            <HText variant="caption" color="muted" style={styles.flex}>
              {offlineHint ?? tr('chat.header.status.unreachable')}
            </HText>
          </View>
        ) : null}
        <View style={styles.starters}>
          <HText variant="caption" weight="600" color="subtle">
            {tr('bots.chat.starters')}
          </HText>
          {starters.map((s) => (
            <Pressable
              key={s}
              onPress={() => onPick(s)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.starter, { borderColor: t.colors.border, borderRadius: t.radii.control, backgroundColor: pressed ? t.colors.surfacePressed : t.colors.surface }]}
            >
              <HText variant="callout" style={styles.flex}>
                {s}
              </HText>
              <Icon name="arrowRight" size={14} color={t.colors.subtle} />
            </Pressable>
          ))}
        </View>
      </FadeIn>
    </ScrollView>
  );
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 20, paddingVertical: 24 },
  inner: { width: '100%', maxWidth: 560, alignSelf: 'center', gap: 22 },
  identity: { gap: 8, alignItems: 'flex-start' },
  offline: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10 },
  starters: { gap: 8 },
  starter: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingHorizontal: 14, paddingVertical: 10, borderWidth: StyleSheet.hairlineWidth },
});
