/**
 * HermesOptionsSheet – bottom sheet for the per-chat Hermes request options (body `model_options`):
 * reasoning effort ("Denken": Standard / Aus / Minimal … Maximal) and "Schnell" (priority tier).
 * Choices the chat's model does not support are hidden (GET /api/model/options capabilities).
 *
 *   const caps = useHermesCapabilities(profile);
 *   <HermesOptionsSheet open={open} onClose={…} value={conv.meta?.modelOptions}
 *       caps={caps.modelCaps(model)} onChange={conv.setModelOptions} />
 */
import { memo } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useT, type TKey } from '../../i18n';
import { SheetGrabber, SheetModal, useTheme } from '../../ui';
import { useModalPresence } from '../../ui/lib/useModalPresence';
import { REASONING_EFFORTS, type HermesChatOptions, type HermesReasoning, type ModelCaps } from '../capabilities';

export type HermesOptionsSheetProps = {
  open: boolean;
  onClose(): void;
  /** current options of the conversation (undefined = all defaults) */
  value: HermesChatOptions | undefined;
  /** new options (undefined = back to defaults); persist via useConversation().setModelOptions */
  onChange(next: HermesChatOptions | undefined): void;
  /** capabilities of the chat's model; omitted = everything offered */
  caps?: ModelCaps;
  /** optional subtitle, e.g. model name */
  subtitle?: string;
  /** offer the per-chat web search switch (OpenAI-compatible provider presets that document it) */
  web?: boolean;
};

const REASONING_KEYS: Record<HermesReasoning, TKey> = {
  default: 'backends.hermes.reasoning.default',
  off: 'backends.hermes.reasoning.off',
  minimal: 'backends.hermes.reasoning.minimal',
  low: 'backends.hermes.reasoning.low',
  medium: 'backends.hermes.reasoning.medium',
  high: 'backends.hermes.reasoning.high',
  xhigh: 'backends.hermes.reasoning.xhigh',
  max: 'backends.hermes.reasoning.max',
};

const DESCRIPTION_KEYS: Partial<Record<HermesReasoning, TKey>> = {
  default: 'backends.hermes.options.descDefault',
  off: 'backends.hermes.options.descOff',
  low: 'backends.hermes.options.descLow',
  high: 'backends.hermes.options.descHigh',
  max: 'backends.hermes.options.descMax',
};

function normalize(o: HermesChatOptions): HermesChatOptions | undefined {
  const out: HermesChatOptions = {};
  if (o.reasoning && o.reasoning !== 'default') out.reasoning = o.reasoning;
  if (o.fast) out.fast = true;
  if (o.web) out.web = true;
  return Object.keys(out).length ? out : undefined;
}

/** memo + renders nothing while closed (its parent re-renders on every streaming update) */
export const HermesOptionsSheet = memo(function HermesOptionsSheet(props: HermesOptionsSheetProps) {
  const present = useModalPresence(props.open);
  return present ? <OptionsSheet {...props} /> : null;
});

function OptionsSheet({ open, onClose, value, onChange, caps, subtitle, web }: HermesOptionsSheetProps) {
  const t = useTheme();
  const tr = useT();
  const current: HermesReasoning = value?.reasoning ?? 'default';
  const reasoningOk = caps ? caps.reasoning : true;
  const offOk = caps ? caps.canDisableReasoning || !caps.reasoning : true;
  const fastOk = caps ? caps.fast : true;
  const choices: HermesReasoning[] = reasoningOk ? ['default', ...(offOk ? (['off'] as const) : []), ...REASONING_EFFORTS] : ['default'];

  return (
    <SheetModal visible={open} onClose={onClose} closeLabel={tr('actions.close')} label={tr('backends.hermes.options.title')} style={styles.sheet}>
      <SheetGrabber />
      <Text style={[styles.title, { color: t.colors.text }]}>{tr('backends.hermes.options.title')}</Text>
      {subtitle ? (
        <Text style={[styles.sub, { color: t.colors.muted }]} numberOfLines={1}>
          {subtitle}
        </Text>
      ) : null}
      <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ paddingVertical: 4 }}>
        {web ? (
          <>
            <Text style={[styles.section, { color: t.colors.subtle }]}>{tr('backends.hermes.options.sectionWeb')}</Text>
            <View style={[styles.row, { borderRadius: t.radii.m }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowTitle, { color: t.colors.text }]}>{tr('backends.hermes.options.web')}</Text>
                <Text style={[styles.rowDetail, { color: t.colors.muted }]}>{tr('backends.hermes.options.webDetail')}</Text>
              </View>
              <Switch value={!!value?.web} onValueChange={(on) => onChange(normalize({ ...value, web: on }))} accessibilityLabel={tr('backends.hermes.options.web')} />
            </View>
          </>
        ) : null}
        <Text style={[styles.section, { color: t.colors.subtle }]}>{tr('backends.hermes.options.sectionThinking')}</Text>
        {!reasoningOk ? (
          <Text style={[styles.note, { color: t.colors.muted }]}>{tr('backends.hermes.options.noReasoning')}</Text>
        ) : null}
        {choices.map((c) => {
          const active = c === current;
          return (
            <Pressable
              key={c}
              onPress={() => onChange(normalize({ ...value, reasoning: c }))}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={tr('backends.hermes.options.reasoningA11y', { label: tr(REASONING_KEYS[c]) })}
              style={({ pressed }) => [
                styles.row,
                { borderRadius: t.radii.m },
                (pressed || active) && { backgroundColor: active ? t.colors.surfaceAlt : t.colors.surfacePressed },
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowTitle, { color: t.colors.text }]}>{tr(REASONING_KEYS[c])}</Text>
                {DESCRIPTION_KEYS[c] ? <Text style={[styles.rowDetail, { color: t.colors.muted }]}>{tr(DESCRIPTION_KEYS[c] as TKey)}</Text> : null}
              </View>
              {active ? <View style={[styles.dot, { backgroundColor: t.colors.accent }]} /> : null}
            </Pressable>
          );
        })}
        {fastOk ? (
          <>
            <Text style={[styles.section, { color: t.colors.subtle }]}>{tr('backends.hermes.options.sectionSpeed')}</Text>
            <View style={[styles.row, { borderRadius: t.radii.m }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowTitle, { color: t.colors.text }]}>{tr('backends.hermes.options.fast')}</Text>
                <Text style={[styles.rowDetail, { color: t.colors.muted }]}>{tr('backends.hermes.options.fastDetail')}</Text>
              </View>
              <Switch
                value={!!value?.fast}
                onValueChange={(fast) => onChange(normalize({ ...value, fast }))}
                accessibilityLabel={tr('backends.hermes.options.fastA11y')}
              />
            </View>
          </>
        ) : null}
      </ScrollView>
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  sheet: { paddingHorizontal: 12 },
  title: { fontSize: 16, fontWeight: '600', paddingHorizontal: 8 },
  sub: { fontSize: 12.5, paddingHorizontal: 8, marginTop: 2 },
  section: { fontSize: 11.5, fontWeight: '600', letterSpacing: 0.6, paddingHorizontal: 12, paddingTop: 14, paddingBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10, minHeight: 48 },
  rowTitle: { fontSize: 15.5, fontWeight: '500' },
  rowDetail: { fontSize: 12.5, marginTop: 1 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  note: { fontSize: 13, paddingHorizontal: 12, paddingVertical: 6 },
});
