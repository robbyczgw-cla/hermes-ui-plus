/**
 * A job's delivery into a Bot Chat (bots/core.ts cronDelivery): a quiet marker "⟳ Preis-Check · 7:30" and the job's own
 * output right below it (a reminder's text lives here, not in the bot's comment), long outputs folded after a few lines.
 * Never the user's bubble: the user did not write it.
 */
import { memo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useLocale, useT } from '../i18n';
import { HText, Icon, useTheme } from '../ui';
import { cronPlainText, type CronDelivery } from './core';

const FOLD_LINES = 8;

export const CronDeliveryMarker = memo(function CronDeliveryMarker({ delivery, at }: { delivery: CronDelivery; at?: number }) {
  const t = useTheme();
  const tr = useT();
  const { formatDate } = useLocale();
  const [open, setOpen] = useState(false);
  const time = at ? formatDate(new Date(at), { hour: 'numeric', minute: '2-digit' }) : '';
  const text = delivery.silent ? tr('bots.cron.silent') : cronPlainText(delivery.output);
  const name = delivery.name || tr('bots.cron.unnamed');
  const long = text.split('\n').length > FOLD_LINES || text.length > 600;
  return (
    <View style={styles.wrap} accessible accessibilityLabel={tr('bots.cron.a11y', { name, time, text })}>
      <View style={[styles.pill, { backgroundColor: t.colors.surfaceAlt, borderRadius: t.radii.pill }]}>
        <Icon name="reset" size={13} color={t.colors.muted} />
        <HText variant="caption" color="muted" numberOfLines={1} style={styles.shrink}>
          {time ? `${name} · ${time}` : name}
        </HText>
      </View>
      {text ? (
        <View style={[styles.card, { borderColor: t.colors.border, borderRadius: t.radii.control, backgroundColor: t.colors.surface }]}>
          <HText variant="body" color={delivery.silent ? 'muted' : undefined} numberOfLines={long && !open ? FOLD_LINES : undefined} selectable>
            {text}
          </HText>
          {long ? (
            <Pressable onPress={() => setOpen((o) => !o)} hitSlop={8} accessibilityRole="button" style={styles.more}>
              <HText variant="caption" weight="600" color="accent">
                {open ? tr('bots.cron.less') : tr('bots.cron.more')}
              </HText>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 8, marginVertical: 6, paddingHorizontal: 4 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 4, maxWidth: '100%' },
  shrink: { flexShrink: 1 },
  card: { alignSelf: 'stretch', borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, paddingVertical: 10, gap: 6 },
  more: { alignSelf: 'flex-start', minHeight: 32, justifyContent: 'center' },
});
