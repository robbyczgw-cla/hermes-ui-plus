/**
 * Inline pieces of the answer polish inside markdown text runs (docs/SPEC-modules-v4.md A3/A4):
 * footnote pills `[^n]` and entity chips (`hui:` links + auto-detected phone/e-mail/date).
 * Rendered as inline Views inside <Text>; the sheet they open is hosted by the answer's AnswerScope.
 */
import { createContext, useContext } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../../ui/primitives/Text';
import { useT } from '../../i18n';
import { useTheme } from '../../ui';
import { AnswerIcon } from './answerIcons';
import { entityIcon, useSheetOpener } from './AnswerScope';
import type { HuiEntity } from './entities';

/**
 * Markdown feature switches (Settings → Antworten), provided once per Markdown root. `cites`: highest
 * numeric `[n]` citation of the answer (answers/citations.ts), 0 = plain "[1]" stays text.
 */
export type MdFeatures = { footnotes: boolean; entities: boolean; cites: number };
export const MdFeaturesContext = createContext<MdFeatures>({ footnotes: false, entities: false, cites: 0 });
export const useMdFeatures = () => useContext(MdFeaturesContext);

export function FootnotePill({ n, raw }: { n: number; raw: string }) {
  const t = useTheme();
  const tr = useT();
  const { open, host, targets } = useSheetOpener();
  // while the answer streams the targets are unknown: inert pill
  const ready = targets !== null;
  return (
    <View style={styles.pillWrap}>
      <Pressable
        onPress={ready ? () => open({ kind: 'footnote', n }) : undefined}
        disabled={!ready}
        hitSlop={{ top: 14, bottom: 14, left: 10, right: 10 }}
        accessibilityRole="button"
        accessibilityLabel={tr('chat.answers.footnoteA11y', { n })}
        style={({ pressed }) => [styles.pill, { borderRadius: t.radii.pill }, { backgroundColor: pressed ? t.colors.accent : t.colors.accentSoft }]}
      >
        {({ pressed }) => (
          <Text style={[t.typography.micro, styles.pillText, { color: pressed ? t.colors.onAccent : t.colors.accentText }]} accessibilityLabel={raw}>
            {n}
          </Text>
        )}
      </Pressable>
      {host}
    </View>
  );
}

export function EntityChip({ entity, fontSize }: { entity: HuiEntity; fontSize: number }) {
  const t = useTheme();
  const tr = useT();
  const { open, host } = useSheetOpener();
  return (
    <View style={styles.chipWrap}>
      <Pressable
        onPress={() => open({ kind: 'entity', entity })}
        hitSlop={{ top: 10, bottom: 10, left: 2, right: 2 }}
        accessibilityRole="button"
        accessibilityLabel={`${tr(`chat.answers.kind.${entity.kind}`)}: ${entity.label}`}
        accessibilityHint={tr('chat.answers.entityHint')}
        style={({ pressed }) => [styles.chip, { backgroundColor: pressed ? t.colors.surfacePressed : t.colors.accentSoft, borderRadius: t.radii.inline }]}
      >
        <AnswerIcon name={entityIcon(entity.kind)} size={Math.round(fontSize * 0.85)} color={t.colors.accent} strokeWidth={2} />
        <Text style={{ color: t.colors.accentText, fontSize: fontSize - 1, lineHeight: Math.round(fontSize * 1.3), fontWeight: '500' }} numberOfLines={1}>
          {entity.label}
        </Text>
      </Pressable>
      {host}
    </View>
  );
}

const styles = StyleSheet.create({
  pillWrap: { marginHorizontal: 1, transform: [{ translateY: -3 }] },
  pill: { minWidth: 17, height: 17, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
  pillText: { fontWeight: '700', fontVariant: ['tabular-nums'] },
  chipWrap: { transform: [{ translateY: 3 }] },
  // no vertical padding: the chip must not grow the line it sits in (B6)
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 6, paddingVertical: 0, maxWidth: 280 },
});
