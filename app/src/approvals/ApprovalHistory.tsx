import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import type { ApprovalRecord } from '../hermes/types';
import { useT } from '../i18n';
import { HText, useTheme } from '../ui';
import { historyLine } from './approvalModel';
import { useChatShell } from '../chat/ChatShellContext';
import { useConversations } from '../conversations/ConversationsProvider';
import { useConnection } from '../settings/ConnectionProvider';
import { botsNow } from '../hermes/useHermesBots';

/** a non-default bot's Bot Chat (bots/): "always" went into THAT bot's allowlist, not everywhere → its display name */
function useScopedBot(): string | null {
  const shell = useChatShell();
  const meta = useConversations().get(shell?.conversationId ?? '');
  const { profiles } = useConnection();
  if (!meta?.botChat || !meta.hermesProfile) return null;
  const p = profiles.find((x) => x.id === meta.profileId);
  return (p ? botsNow(p).find((b) => b.name === meta.hermesProfile)?.label : undefined) ?? meta.hermesProfile;
}

/**
 * Compact, persistent approval rows inside an assistant message:
 * "✓ Erlaubt (einmal): rm -rf build/" · "✕ Abgelehnt: …" · "⏱ Abgelaufen – abgelehnt: …".
 */
export const ApprovalHistory = memo(function ApprovalHistory({ log }: { log: readonly ApprovalRecord[] | undefined }) {
  const t = useTheme();
  const tr = useT();
  const bot = useScopedBot();
  if (!log?.length) return null;
  return (
    <View style={styles.wrap} accessibilityLabel={tr('approvals.history.title')}>
      {log.map((r, i) => {
        const h = historyLine(r);
        const label = bot && r.outcome === 'always' ? tr('approvals.history.alwaysBot', { name: bot }) : tr(h.labelKey);
        return (
          <View key={`${r.requestId ?? r.runId}-${i}`} style={styles.row} accessible accessibilityLabel={tr('approvals.history.a11y', { label, command: r.command })}>
            {/* the label never wraps ("Allowed\n(once):"); a command that does not fit beside it gets its own line */}
            <HText variant="caption" color={h.tone} numberOfLines={1} style={styles.label}>
              {h.icon} {label}
              {h.command ? ':' : ''}
            </HText>
            {h.command ? (
              <HText variant="caption" numberOfLines={1} style={[styles.cmd, { fontFamily: t.fonts.mono, color: t.colors.muted }]}>
                {h.command}
              </HText>
            ) : null}
          </View>
        );
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { gap: 2, marginTop: 4 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 6 },
  label: { flexShrink: 0, maxWidth: '100%' },
  cmd: { flexShrink: 1, maxWidth: '100%' },
});
