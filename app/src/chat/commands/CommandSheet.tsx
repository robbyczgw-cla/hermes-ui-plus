/**
 * Result sheets of slash commands: /usage (tokens only, never costs), /status, /help (tap → command in the composer).
 * /skills and /memory open the Skills & memory screen (library/). Reuses the model picker's bottom-sheet chrome.
 */
import { memo, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../../ui/primitives/Text';
import { useLocale, useT, type TKey } from '../../i18n';
import { useTheme } from '../../ui';
import { ModelSheet } from '../ModelPicker';
import type { SessionUsage } from './api';
import type { CommandDef } from './registry';
import { a11yState } from '../../ui/lib/a11yState';

export type SheetState =
  | { kind: 'usage' | 'status'; loading: boolean; error?: string; data?: SessionUsage | null; local: { backend: string; model: string; options?: string } }
  | { kind: 'help'; commands: readonly CommandDef[] };

type Props = {
  state: SheetState | null;
  onClose(): void;
  /** put text into the composer (skill prompt, command) */
  onFill(text: string): void;
};

export const CommandSheet = memo(function CommandSheet({ state, onClose, onFill }: Props) {
  const tr = useT();
  if (!state) return null;
  const title =
    state.kind === 'usage' ? tr('slash.sheet.usageTitle') : state.kind === 'status' ? tr('slash.sheet.statusTitle') : tr('slash.sheet.helpTitle');
  return (
    <ModelSheet open onClose={onClose} title={title}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {state.kind === 'help' ? (
          <Help commands={state.commands} onFill={onFill} />
        ) : (
          <Usage state={state} />
        )}
      </ScrollView>
    </ModelSheet>
  );
});

function Loading({ loading, error }: { loading: boolean; error?: string }) {
  const t = useTheme();
  const tr = useT();
  if (loading)
    return (
      <View style={styles.state}>
        <ActivityIndicator color={t.colors.muted} />
        <Text style={{ color: t.colors.muted }}>{tr('slash.sheet.loading')}</Text>
      </View>
    );
  if (error) return <Text style={[t.typography.caption, styles.note, { color: t.colors.danger }]}>{error}</Text>;
  return null;
}

function KV({ k, v, strong }: { k: string; v: ReactNode; strong?: boolean }) {
  const t = useTheme();
  return (
    <View style={[styles.kv, { borderBottomColor: t.colors.border }]}>
      <Text style={[t.typography.callout, { color: t.colors.muted }]}>{k}</Text>
      <Text style={[t.typography.callout, styles.v, { color: t.colors.text }, strong && { fontWeight: '700' }]} numberOfLines={1}>
        {v}
      </Text>
    </View>
  );
}

function Usage({ state }: { state: Extract<SheetState, { kind: 'usage' | 'status' }> }) {
  const t = useTheme();
  const tr = useT();
  const { formatNumber, formatDate } = useLocale();
  const d = state.data;
  const n = (v: number | undefined) => (v === undefined ? '–' : formatNumber(v));
  const when = (v: number | undefined) => (v ? formatDate(v, { dateStyle: 'medium', timeStyle: 'short' }) : '–');
  const tokens = d ? (
    <>
      <KV k={tr('slash.sheet.input')} v={n(d.tokens.input)} />
      <KV k={tr('slash.sheet.output')} v={n(d.tokens.output)} />
      {d.tokens.cacheRead ? <KV k={tr('slash.sheet.cacheRead')} v={n(d.tokens.cacheRead)} /> : null}
      {d.tokens.cacheWrite ? <KV k={tr('slash.sheet.cacheWrite')} v={n(d.tokens.cacheWrite)} /> : null}
      {d.tokens.reasoning ? <KV k={tr('slash.sheet.reasoningTokens')} v={n(d.tokens.reasoning)} /> : null}
      <KV k={tr('slash.sheet.total')} v={n(d.tokens.total)} strong />
    </>
  ) : null;
  if (state.kind === 'usage') {
    return (
      <>
        <Loading loading={state.loading} error={state.error} />
        {!state.loading && !state.error && !d ? <Text style={[t.typography.caption, styles.note, { color: t.colors.muted }]}>{tr('slash.sheet.noData')}</Text> : null}
        {tokens}
      </>
    );
  }
  return (
    <>
      <KV k={tr('slash.sheet.backend')} v={state.local.backend} />
      <KV k={tr('slash.sheet.model')} v={d?.model ?? state.local.model} />
      {state.local.options ? <KV k={tr('slash.sheet.options')} v={state.local.options} /> : null}
      <Loading loading={state.loading} error={state.error} />
      {d ? (
        <>
          <KV k={tr('slash.sheet.session')} v={d.title ? `${d.title} · ${d.id}` : d.id} />
          <KV k={tr('slash.sheet.messages')} v={n(d.messages)} />
          {d.toolCalls ? <KV k={tr('slash.sheet.toolCalls')} v={n(d.toolCalls)} /> : null}
          {d.apiCalls ? <KV k={tr('slash.sheet.apiCalls')} v={n(d.apiCalls)} /> : null}
          <KV k={tr('slash.sheet.started')} v={when(d.startedAt)} />
          <KV k={tr('slash.sheet.lastActive')} v={when(d.lastActive)} />
          {d.endReason ? <Text style={[t.typography.caption, styles.note, { color: t.colors.muted }]}>{tr('slash.sheet.ended', { reason: d.endReason })}</Text> : null}
          <Text style={[t.typography.caption, styles.section, { color: t.colors.muted }]}>{tr('slash.sheet.tokens')}</Text>
          {tokens}
        </>
      ) : null}
    </>
  );
}

function Help({ commands, onFill }: { commands: readonly CommandDef[]; onFill(text: string): void }) {
  const t = useTheme();
  const tr = useT();
  return (
    <>
      <Text style={[t.typography.caption, styles.note, { color: t.colors.muted }]}>{tr('slash.sheet.helpIntro')}</Text>
      {commands.map((c) => {
        const arg = tr(`slash.cmd.${c.id}.arg` as TKey);
        return (
          <Pressable
            key={c.id}
            onPress={() => onFill(`/${c.name}${c.arg === 'none' ? '' : ' '}`)}
            accessibilityRole="button"
            style={({ pressed }) => [styles.item, { borderBottomColor: t.colors.border }, pressed && { backgroundColor: t.colors.surfacePressed }]}
          >
            <Text style={[t.typography.callout, styles.itemName, { color: t.colors.text, fontFamily: t.fonts.mono }]}>
              /{c.name}
              {arg ? <Text style={{ color: t.colors.subtle }}>{` ${arg}`}</Text> : null}
            </Text>
            <Text style={[t.typography.caption, styles.itemDesc, { color: t.colors.muted }]}>
              {tr(`slash.cmd.${c.id}.desc` as TKey)}
              {c.aliases.length ? <Text style={{ color: t.colors.subtle }}>{`  ·  ${c.aliases.slice(0, 3).map((a) => `/${a}`).join(' ')}`}</Text> : null}
            </Text>
          </Pressable>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  scroll: { maxHeight: 460 },
  content: { paddingHorizontal: 8, paddingBottom: 8 },
  state: { flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 16 },
  note: { paddingVertical: 8 },
  section: { fontWeight: '600', marginTop: 14, marginBottom: 2 },
  kv: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth },
  v: { flexShrink: 1, textAlign: 'right', fontVariant: ['tabular-nums'] },
  item: { paddingVertical: 10, paddingHorizontal: 4, borderBottomWidth: StyleSheet.hairlineWidth },
  itemName: { fontWeight: '600' },
  itemDesc: { marginTop: 2 },
});
