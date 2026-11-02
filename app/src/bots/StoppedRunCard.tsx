/**
 * The card below a routine's delivery in a Bot Chat when that run skipped a step that needs an approval
 * (bots/stoppedRuns.ts): what the bot wanted, "Jetzt mit Freigabe nachholen" (a normal turn in this chat, so the
 * normal approval card comes), and "Oder: in „Über <Name>“ dauerhaft erlauben". Only with Routines on and an inbox the
 * device may read; otherwise the provider gives nothing and no card appears.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { bridgeRoutinesInbox } from '../hermes/client';
import { useT } from '../i18n';
import { onRoutineEvent, routineEventMatches } from '../routines/events';
import type { InboxSummary } from '../routines/inbox';
import { Button, HText, Icon, useTheme } from '../ui';
import { stoppedRunsByDelivery, stoppedWhat, type StoppedRun } from './stoppedRuns';

type Ctx = { runs: ReadonlyMap<string, StoppedRun>; name: string; onRetry(r: StoppedRun): void; onAllow(): void };
/** a delivery row of the open chat: message id, the job's name, when it arrived */
export type DeliveryRow = { key: string; name: string; at?: number };
const StoppedRunsContext = createContext<Ctx | null>(null);

type Profile = { id: string; kind: string; bridge?: boolean; baseUrl: string; apiKey: string };

/** Loads the bot's recent inbox entries (only runs with a stopped step matter) while its Bot Chat is open. */
export function StoppedRunsProvider({ profile, bot, enabled, name, deliveries, onRetry, onAllow, children }: { profile: Profile; bot: string | undefined; enabled: boolean; name: string; deliveries: readonly DeliveryRow[]; onRetry(r: StoppedRun): void; onAllow(): void; children: ReactNode }) {
  const [entries, setEntries] = useState<readonly InboxSummary[]>([]);
  const [tick, setTick] = useState(0);
  const ok = enabled && profile.kind === 'hermes' && !!profile.bridge;
  useEffect(() => {
    if (!ok) return;
    return onRoutineEvent((e) => {
      if (routineEventMatches(e, profile.id, bot)) setTick((n) => n + 1);
    });
  }, [ok, profile.id, bot]);
  useEffect(() => {
    if (!ok) {
      setEntries([]);
      return;
    }
    let live = true;
    bridgeRoutinesInbox({ baseUrl: profile.baseUrl, apiKey: profile.apiKey }, bot)
      .list({ filter: 'all', limit: 30 })
      .then((page) => {
        if (live) setEntries(page.items.filter((i) => i.stopped));
      })
      // no inbox right / routines not enabled by the owner / an older bridge: no card, never an error in the chat
      .catch(() => {
        if (live) setEntries([]);
      });
    return () => {
      live = false;
    };
  }, [ok, profile.baseUrl, profile.apiKey, bot, tick]);
  const runs = useMemo(() => stoppedRunsByDelivery(entries, deliveries), [entries, deliveries]);
  const value = useMemo(() => (ok && runs.size ? { runs, name, onRetry, onAllow } : null), [ok, runs, name, onRetry, onAllow]);
  return <StoppedRunsContext.Provider value={value}>{children}</StoppedRunsContext.Provider>;
}

export function StoppedRunCard({ id }: { id: string }) {
  const ctx = useContext(StoppedRunsContext);
  const t = useTheme();
  const tr = useT();
  const run = ctx?.runs.get(id) ?? null;
  if (!ctx || !run) return null;
  const what = stoppedWhat(run);
  return (
    <View style={[styles.card, { borderColor: t.colors.warning, backgroundColor: t.colors.warningSoft, borderRadius: t.radii.card }]} testID="bot-stopped-run" accessibilityRole="alert">
      <View style={styles.head}>
        <Icon name="alert" size={16} color={t.colors.warning} />
        <HText variant="bodyStrong" style={styles.flex}>
          {tr('bots.blocked.title')}
        </HText>
      </View>
      <HText variant="callout">{tr('bots.blocked.body', { name: ctx.name, what: what ? tr('bots.blocked.what', { what }) : tr('bots.blocked.whatUnknown') })}</HText>
      <View style={styles.actions}>
        <Button label={tr('bots.blocked.retry')} variant="primary" size="small" onPress={() => ctx.onRetry(run)} testID="bot-stopped-retry" numberOfLines={2} />
        <Button label={tr('bots.blocked.allow', { name: ctx.name })} variant="tertiary" size="small" onPress={ctx.onAllow} testID="bot-stopped-allow" numberOfLines={2} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { alignSelf: 'stretch', borderWidth: StyleSheet.hairlineWidth, padding: 12, gap: 8, marginHorizontal: 4, marginBottom: 6 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
