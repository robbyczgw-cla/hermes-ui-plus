/**
 * Warning before chats are removed in bulk: "n Chats löschen? Das kann nicht rückgängig gemacht werden."
 *
 * - `mode="selection"` (drawer selection mode): exactly the ticked chats (pinned ones were ticked on purpose)
 * - `mode="all"` (Settings → "Alle Chats löschen"): every chat, optionally of one profile; pinned chats only
 *   when "Auch angeheftete löschen" is switched on
 *
 * Chats with a running turn are skipped. App-own Hermes chats offer "Nur in der App löschen" (default) /
 * "Auch auf Hermes löschen"; foreign sessions (Telegram/CLI/cron/other clients) and non-Hermes chats
 * (other backends, demo) are only ever removed on this device. The actual deletion runs
 * through the deleter (bulkDelete.ts): undo toast first, Hermes deletes only after the undo window.
 */
import { useMemo, useState, useSyncExternalStore } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { turnRegistry } from '../background/turnRegistry';
import { useT } from '../i18n';
import { bestOn, haptic, HText, Icon, PressableScale, useTheme } from '../ui';
import { planDelete } from './bulkDelete';
import { useBulkDelete } from './ConversationsProvider';
import type { RemoteActions } from './hermesSync';
import type { ConversationMeta } from './types';
import { useEscapeToClose } from '../ui/lib/useEscapeToClose';

/** ids of conversations with a running turn (re-renders when a turn starts/ends) */
export function useRunningIds(): ReadonlySet<string> {
  const turns = useSyncExternalStore(turnRegistry.subscribe, turnRegistry.snapshot, turnRegistry.snapshot);
  return useMemo(() => new Set(turns.map((x) => x.conversationId)), [turns]);
}

export type BulkDeleteDialogProps = {
  mode: 'selection' | 'all';
  /** selection: the ticked chats; all: every chat (the dialog applies the profile scope itself) */
  candidates: readonly ConversationMeta[];
  /** Hermes session actions (drawer prop); default: the mounted session sync's */
  remote?: RemoteActions | null;
  /** all: profile scope options (only profiles that have chats are shown) */
  profiles?: readonly { id: string; name: string }[];
  onCancel: () => void;
  /** the deletion started (undo toast is showing) */
  onDone: (count: number) => void;
};

export function BulkDeleteDialog({ mode, candidates, remote, profiles, onCancel, onDone }: BulkDeleteDialogProps) {
  useEscapeToClose(true, onCancel); // web: Esc cancels (before the drawer underneath)
  const t = useTheme();
  const tr = useT();
  const bulk = useBulkDelete();
  const running = useRunningIds();
  const actions = remote ?? bulk.remote();
  const [scope, setScope] = useState<string | undefined>(undefined);
  const [includePinned, setIncludePinned] = useState(false);
  const [alsoRemote, setAlsoRemote] = useState(false);

  const scoped = useMemo(() => (mode === 'all' && scope ? candidates.filter((c) => c.profileId === scope) : candidates), [mode, scope, candidates]);
  const plan = useMemo(
    () =>
      planDelete(scoped, {
        isRunning: (id) => running.has(id),
        includePinned: mode === 'selection' || includePinned,
        isSynced: actions ? (m) => actions.isSynced(m) : undefined,
        canDeleteRemote: actions ? (m) => actions.canDeleteRemote(m) : undefined,
      }),
    [scoped, running, mode, includePinned, actions],
  );
  const pinnedInScope = useMemo(() => (mode === 'all' ? scoped.filter((c) => c.pinned && !running.has(c.id)).length : 0), [mode, scoped, running]);
  const scopeOptions = useMemo(() => {
    if (mode !== 'all' || !profiles) return [];
    const used = new Set(candidates.map((c) => c.profileId));
    return profiles.filter((p) => used.has(p.id));
  }, [mode, profiles, candidates]);

  const count = plan.metas.length;
  const withRemote = alsoRemote && plan.remote.length > 0;

  const confirm = () => {
    if (!count) return;
    const deleteRemote = withRemote && actions ? (m: ConversationMeta) => actions.deleteRemote(m) : undefined;
    bulk.deleter.start(plan, deleteRemote);
    haptic('warning');
    onDone(count);
  };

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onCancel} statusBarTranslucent>
      <Pressable style={[styles.scrim, { backgroundColor: t.colors.overlay }]} onPress={onCancel} accessibilityLabel={tr('actions.close')}>
        <Pressable onPress={() => {}} style={[styles.dialog, { backgroundColor: t.colors.surface, borderColor: t.colors.border, borderRadius: t.radii.l }, t.shadows.lg]}>
          <ScrollView bounces={false} contentContainerStyle={styles.content}>
            <HText variant="headline" style={styles.pad} accessibilityRole="header">
              {tr('conversations.bulk.title', { count })}
            </HText>
            <HText variant="callout" color="muted" style={styles.pad}>
              {count ? tr('conversations.bulk.irreversible') : tr('conversations.bulk.nothing')}
            </HText>

            {scopeOptions.length > 1 ? (
              <View style={styles.section}>
                <HText variant="micro" color="subtle" style={styles.pad}>
                  {tr('conversations.bulk.scope').toUpperCase()}
                </HText>
                <Choice label={tr('conversations.bulk.scopeAll')} checked={!scope} onPress={() => setScope(undefined)} />
                {scopeOptions.map((p) => (
                  <Choice key={p.id} label={p.name} checked={scope === p.id} onPress={() => setScope(p.id)} />
                ))}
              </View>
            ) : null}

            {mode === 'all' && pinnedInScope > 0 ? (
              <Choice kind="checkbox" label={tr('conversations.bulk.includePinned', { count: pinnedInScope })} checked={includePinned} onPress={() => setIncludePinned((v) => !v)} />
            ) : null}

            {plan.remote.length > 0 ? (
              <View style={styles.section}>
                <Choice label={tr('conversations.bulk.localOnly')} checked={!alsoRemote} onPress={() => setAlsoRemote(false)} />
                <Choice
                  label={tr('conversations.bulk.alsoHermes', { count: plan.remote.length })}
                  sub={tr('conversations.bulk.alsoHermesSub')}
                  checked={alsoRemote}
                  danger
                  onPress={() => setAlsoRemote(true)}
                />
              </View>
            ) : null}

            {plan.foreign > 0 ? <Note text={tr('conversations.bulk.foreignNote', { count: plan.foreign })} /> : null}
            {plan.skippedRunning > 0 ? <Note text={tr('conversations.bulk.runningNote', { count: plan.skippedRunning })} /> : null}
          </ScrollView>

          <View style={styles.btnRow}>
            <Btn label={tr('actions.cancel')} onPress={onCancel} />
            <Btn label={tr('conversations.bulk.confirm', { count })} danger disabled={!count} onPress={confirm} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Note({ text }: { text: string }) {
  const t = useTheme();
  return (
    <View style={[styles.note, styles.pad]}>
      <Icon name="info" size={15} color={t.colors.subtle} />
      <HText variant="caption" color="muted" style={styles.flex}>
        {text}
      </HText>
    </View>
  );
}

/** radio (default) or checkbox row, ≥ 44 pt */
function Choice({ label, sub, checked, onPress, kind = 'radio', danger }: { label: string; sub?: string; checked: boolean; onPress: () => void; kind?: 'radio' | 'checkbox'; danger?: boolean }) {
  const t = useTheme();
  const on = danger && checked ? t.colors.danger : t.colors.accent;
  return (
    <Pressable
      onPress={() => {
        haptic('selection');
        onPress();
      }}
      accessibilityRole={kind}
      accessibilityState={{ checked }}
      accessibilityLabel={sub ? `${label}. ${sub}` : label}
      style={({ pressed }) => [styles.choice, pressed && { backgroundColor: t.colors.surfacePressed }]}
    >
      {kind === 'radio' ? (
        <View style={[styles.radio, { borderColor: checked ? on : t.colors.borderStrong }]}>{checked ? <View style={[styles.radioDot, { backgroundColor: on }]} /> : null}</View>
      ) : (
        <SelectionBox checked={checked} />
      )}
      <View style={styles.flex}>
        <HText variant="body" style={danger && checked ? { color: t.colors.danger } : undefined}>
          {label}
        </HText>
        {sub ? (
          <HText variant="caption" color="muted">
            {sub}
          </HText>
        ) : null}
      </View>
    </Pressable>
  );
}

/** the tick box of selection mode (visual only; the row carries role + state) */
export function SelectionBox({ checked, disabled }: { checked: boolean; disabled?: boolean }) {
  const t = useTheme();
  return (
    <View
      style={[
        styles.box,
        { borderColor: checked ? t.colors.accent : t.colors.borderStrong, backgroundColor: checked ? t.colors.accent : 'transparent', opacity: disabled ? 0.4 : 1 },
      ]}
    >
      {checked ? <Icon name="check" size={14} color={t.colors.onAccent} strokeWidth={2.6} /> : null}
    </View>
  );
}

function Btn({ label, onPress, danger, disabled }: { label: string; onPress: () => void; danger?: boolean; disabled?: boolean }) {
  const t = useTheme();
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      style={[styles.btn, { backgroundColor: danger ? t.colors.danger : t.colors.surfaceAlt, borderRadius: t.radii.pill, opacity: disabled ? 0.45 : 1 }]}
    >
      <HText variant="callout" weight="600" style={{ color: danger ? bestOn(t.colors.danger, ['#FFFFFF', t.colors.bg]) : t.colors.text }}>
        {label}
      </HText>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scrim: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  dialog: { width: '100%', maxWidth: 380, maxHeight: '90%', paddingVertical: 8, borderWidth: StyleSheet.hairlineWidth },
  content: { paddingTop: 12, paddingBottom: 4, gap: 8 },
  pad: { paddingHorizontal: 18 },
  section: { gap: 0 },
  note: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, minHeight: 48, paddingVertical: 6 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  btnRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingTop: 8, paddingBottom: 10, justifyContent: 'flex-end' },
  btn: { minHeight: 44, paddingHorizontal: 18, justifyContent: 'center', alignItems: 'center' },
});
