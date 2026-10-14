/**
 * Result sheets of slash commands: /usage (tokens only, never costs), /status, /skills (tap → prompt in the
 * composer), /help (tap → command in the composer). Reuses the model picker's bottom-sheet chrome.
 */
import { memo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocale, useT, type TKey } from '../../i18n';
import { useTheme } from '../../ui';
import { ModelSheet } from '../ModelPicker';
import type { Skill, SessionUsage, SkillsError } from './api';
import type { CommandDef } from './registry';

export type SheetState =
  | { kind: 'usage' | 'status'; loading: boolean; error?: string; data?: SessionUsage | null; local: { backend: string; model: string; options?: string } }
  | { kind: 'skills'; loading: boolean; error?: SkillsError; skills?: Skill[] }
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
    state.kind === 'usage' ? tr('slash.sheet.usageTitle') : state.kind === 'status' ? tr('slash.sheet.statusTitle') : state.kind === 'skills' ? tr('slash.sheet.skillsTitle') : tr('slash.sheet.helpTitle');
  return (
    <ModelSheet open onClose={onClose} title={title}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {state.kind === 'help' ? (
          <Help commands={state.commands} onFill={onFill} />
        ) : state.kind === 'skills' ? (
          <Skills state={state} onFill={onFill} />
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
  if (error) return <Text style={[styles.note, { color: t.colors.danger }]}>{error}</Text>;
  return null;
}

/** friendly localized headline; the raw server message stays behind a "Details" toggle */
function ErrorWithDetails({ error }: { error: SkillsError }) {
  const t = useTheme();
  const tr = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Text style={[styles.note, { color: t.colors.danger }]}>{error.kind === 'auth' ? tr('backends.hermes.errors.apiKeyInvalid') : error.kind === 'hermesBug' ? tr('slash.sheet.skillsHermesBug') : tr('slash.sheet.skillsError')}</Text>
      <Pressable onPress={() => setOpen((o) => !o)} accessibilityRole="button" accessibilityState={{ expanded: open }} hitSlop={8}>
        <Text style={[styles.note, { color: t.colors.muted }]}>{open ? tr('slash.sheet.detailsHide') : tr('slash.sheet.detailsShow')}</Text>
      </Pressable>
      {open ? (
        <Text selectable style={[styles.note, { color: t.colors.muted, fontFamily: t.fonts.mono }]}>
          {error.details}
        </Text>
      ) : null}
    </>
  );
}

function KV({ k, v, strong }: { k: string; v: ReactNode; strong?: boolean }) {
  const t = useTheme();
  return (
    <View style={[styles.kv, { borderBottomColor: t.colors.border }]}>
      <Text style={[styles.k, { color: t.colors.muted }]}>{k}</Text>
      <Text style={[styles.v, { color: t.colors.text }, strong && { fontWeight: '700' }]} numberOfLines={1}>
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
        {!state.loading && !state.error && !d ? <Text style={[styles.note, { color: t.colors.muted }]}>{tr('slash.sheet.noData')}</Text> : null}
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
          {d.endReason ? <Text style={[styles.note, { color: t.colors.muted }]}>{tr('slash.sheet.ended', { reason: d.endReason })}</Text> : null}
          <Text style={[styles.section, { color: t.colors.muted }]}>{tr('slash.sheet.tokens')}</Text>
          {tokens}
        </>
      ) : null}
    </>
  );
}

function Skills({ state, onFill }: { state: Extract<SheetState, { kind: 'skills' }>; onFill(text: string): void }) {
  const t = useTheme();
  const tr = useT();
  const skills = state.skills ?? [];
  return (
    <>
      <Loading loading={state.loading} />
      {state.error ? <ErrorWithDetails error={state.error} /> : null}
      {!state.loading && !state.error ? (
        <Text style={[styles.note, { color: t.colors.muted }]}>{skills.length ? tr('slash.sheet.skillsHint') : tr('slash.sheet.skillsEmpty')}</Text>
      ) : null}
      {skills.map((s) => (
        <Pressable
          key={s.name}
          onPress={() => onFill(tr('slash.skillPrompt', { name: s.name }))}
          accessibilityRole="button"
          style={({ pressed }) => [styles.item, { borderBottomColor: t.colors.border }, pressed && { backgroundColor: t.colors.surfacePressed }]}
        >
          <Text style={[styles.itemName, { color: t.colors.text, fontFamily: t.fonts.mono }]}>
            {s.name}
            {s.category ? <Text style={{ color: t.colors.subtle, fontFamily: t.fonts.sans }}>{`  ${s.category}`}</Text> : null}
          </Text>
          {s.description ? (
            <Text style={[styles.itemDesc, { color: t.colors.muted }]} numberOfLines={2}>
              {s.description}
            </Text>
          ) : null}
        </Pressable>
      ))}
    </>
  );
}

function Help({ commands, onFill }: { commands: readonly CommandDef[]; onFill(text: string): void }) {
  const t = useTheme();
  const tr = useT();
  return (
    <>
      <Text style={[styles.note, { color: t.colors.muted }]}>{tr('slash.sheet.helpIntro')}</Text>
      {commands.map((c) => {
        const arg = tr(`slash.cmd.${c.id}.arg` as TKey);
        return (
          <Pressable
            key={c.id}
            onPress={() => onFill(`/${c.name}${c.arg === 'none' ? '' : ' '}`)}
            accessibilityRole="button"
            style={({ pressed }) => [styles.item, { borderBottomColor: t.colors.border }, pressed && { backgroundColor: t.colors.surfacePressed }]}
          >
            <Text style={[styles.itemName, { color: t.colors.text, fontFamily: t.fonts.mono }]}>
              /{c.name}
              {arg ? <Text style={{ color: t.colors.subtle }}>{` ${arg}`}</Text> : null}
            </Text>
            <Text style={[styles.itemDesc, { color: t.colors.muted }]}>
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
  note: { fontSize: 13, lineHeight: 18, paddingVertical: 8 },
  section: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', marginTop: 14, marginBottom: 2 },
  kv: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth },
  k: { fontSize: 14 },
  v: { fontSize: 14, flexShrink: 1, textAlign: 'right', fontVariant: ['tabular-nums'] },
  item: { paddingVertical: 10, paddingHorizontal: 4, borderBottomWidth: StyleSheet.hairlineWidth },
  itemName: { fontSize: 14.5, fontWeight: '600' },
  itemDesc: { fontSize: 13, marginTop: 2 },
});
