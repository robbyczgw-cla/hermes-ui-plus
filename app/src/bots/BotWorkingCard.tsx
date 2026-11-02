/**
 * "<Name> arbeitet" (Bots v2 spec 2.3, slice 5): while a turn of a bot's Bot Chat runs, a calm card at the end of the
 * history: name, time since the start, "Stopp", the steps (done = check, current = ring) and the line "Du kannst die
 * App schließen …". When the turn ends the card goes away and the answer keeps its usual tool row.
 *
 * Two sources: this device's own stream (its live answer's tool events, chat/toolTimeline.ts titles), or a turn the
 * bridge runs for another device / a lost stream (bots/activity.ts; Stop through `/bridge/chat/stop`). When the server
 * does not report steps, the card says so instead of showing an empty list.
 */
import { memo, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { ChatMessage } from '../hermes';
import { useT } from '../i18n';
import { Button, HText, Icon, useTheme } from '../ui';
import { useLiveMessage } from '../chat/useLiveMessage';
import { buildTimeline } from '../chat/toolTimeline';
import { workingElapsed, type ActivityTurn } from './activity';
import type { BotNotifyLevel } from './notify';

type Step = { key: string; title: string; sub?: string; running: boolean };

function useTick(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const h = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(h);
  }, [everyMs]);
  return now;
}

function Card({ name, since, steps, stepsKnown, remote, level, onStop, stopping, note }: { name: string; since: number; steps: Step[]; stepsKnown: boolean; remote: boolean; level: BotNotifyLevel; onStop(): void; stopping: boolean; note: string | null }) {
  const t = useTheme();
  const tr = useT();
  const [every, setEvery] = useState(1000);
  const now = useTick(every);
  const { text: elapsed, tickMs } = workingElapsed(now, since);
  useEffect(() => setEvery(tickMs), [tickMs]);
  return (
    <View style={[styles.card, { backgroundColor: t.colors.surface, borderColor: t.colors.border, borderRadius: t.radii.card }]} testID="bot-working">
      <View style={styles.head}>
        <View style={[styles.dot, { backgroundColor: t.colors.success }]} />
        <View style={styles.flex}>
          <HText variant="bodyStrong" numberOfLines={1}>
            {tr('bots.working.title', { name })}
          </HText>
          <HText variant="caption" color="subtle" tabular>
            {tr('bots.working.since', { duration: elapsed })}
          </HText>
        </View>
        <Button label={tr('bots.working.stop')} variant="secondary" size="small" onPress={onStop} loading={stopping} accessibilityLabel={tr('bots.working.stopA11y', { name })} testID="bot-working-stop" />
      </View>
      {steps.length ? (
        // the live region is the step list only: the running time changes every second and must not be read out each time
        <View style={styles.steps} accessibilityLiveRegion="polite">
          {steps.map((s) => (
            <View key={s.key} style={styles.step} accessible accessibilityLabel={tr('bots.working.stepA11y', { label: s.sub ? `${s.title}: ${s.sub}` : s.title, state: tr(s.running ? 'bots.working.stepRunning' : 'bots.working.stepDone') })}>
              <View style={styles.stepIcon}>{s.running ? <Icon name="dot" size={14} color={t.colors.accentText} /> : <Icon name="check" size={14} color={t.colors.success} />}</View>
              <HText variant="caption" color={s.running ? undefined : 'muted'} numberOfLines={1} style={styles.flex}>
                {s.sub ? `${s.title} · ${s.sub}` : s.title}
              </HText>
            </View>
          ))}
        </View>
      ) : (
        <HText variant="caption" color="subtle">
          {stepsKnown ? tr('bots.working.noSteps') : tr('bots.working.stepsUnknown')}
        </HText>
      )}
      {remote ? (
        <HText variant="caption" color="subtle">
          {tr('bots.working.remote')}
        </HText>
      ) : null}
      <HText variant="caption" color="muted">
        {tr(level === 'off' ? 'bots.working.hintQuiet' : level === 'needed' ? 'bots.working.hintNeeded' : 'bots.working.hint', { name })}
      </HText>
      {note ? (
        <HText variant="caption" color="muted" testID="bot-working-note">
          {note}
        </HText>
      ) : null}
    </View>
  );
}

/** The own stream: steps from the live answer (re-renders per stream tick on its own, not the chat view). */
export const LocalWorkingCard = memo(function LocalWorkingCard({ message, name, level, onStop }: { message: ChatMessage; name: string; level: BotNotifyLevel; onStop(): void }) {
  const live = useLiveMessage(message);
  const tr = useT();
  const steps = useMemo(
    () =>
      buildTimeline(live, tr, Date.now(), { notes: false })
        .filter((r) => r.kind === 'tool')
        .slice(-12)
        .map((r) => ({ key: r.key, title: r.title, sub: r.summary, running: r.state === 'running' })),
    [live, tr],
  );
  return <Card name={name} since={message.createdAt} steps={steps} stepsKnown remote={false} level={level} onStop={onStop} stopping={false} note={null} />;
});

export function RemoteWorkingCard({ turn, name, level, onStop }: { turn: ActivityTurn; name: string; level: BotNotifyLevel; onStop(): Promise<boolean> }) {
  const tr = useT();
  const [stopping, setStopping] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const steps = turn.steps.map((s, i) => ({ key: `${i}:${s.name}`, title: s.label ?? s.name, running: s.state === 'running' }));
  return (
    <Card
      name={name}
      since={turn.since}
      steps={steps}
      stepsKnown
      remote
      level={level}
      stopping={stopping}
      note={note}
      onStop={() => {
        setStopping(true);
        void onStop().then((ok) => {
          setStopping(false);
          setNote(ok ? tr('bots.working.stopped') : tr('bots.working.stopFailed'));
        });
      }}
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { borderWidth: StyleSheet.hairlineWidth, padding: 12, gap: 8 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  steps: { gap: 4 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 22 },
  stepIcon: { width: 16, alignItems: 'center' },
});
