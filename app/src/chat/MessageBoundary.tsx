import { Component, type ErrorInfo, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../ui/primitives/Text';
import type { ChatMessage } from '../hermes';
import { useT } from '../i18n';
import { useTheme } from '../ui';
import { Icon } from './icons';

const MAX_TEXT = 1200;

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return typeof error === 'string' ? error : '';
}

/** Inline card shown instead of a message that crashed while rendering (plain Text only). */
function MessageErrorCard({ message, error }: { message: ChatMessage; error: unknown }) {
  const t = useTheme();
  const tr = useT();
  const raw = typeof message.text === 'string' ? message.text.trim() : '';
  const text = raw.length > MAX_TEXT ? `${raw.slice(0, MAX_TEXT)}…` : raw;
  const err = errorText(error);
  return (
    <View
      style={[styles.card, { borderRadius: t.radii.card }, { borderColor: t.colors.border, backgroundColor: t.colors.surfaceAlt }]}
      accessible
      accessibilityLabel={tr('chat.messageError.a11y')}
    >
      <View style={styles.head}>
        <Icon name="alert" size={16} color={t.colors.danger} />
        <Text style={[t.typography.bodyStrong, styles.title, { color: t.colors.text }]}>{tr('chat.messageError.title')}</Text>
      </View>
      {text ? (
        <Text style={[t.typography.callout, { color: t.colors.muted }]} selectable numberOfLines={12}>
          {text}
        </Text>
      ) : null}
      {err ? (
        <Text style={[t.typography.caption, { color: t.colors.muted }]} numberOfLines={2} selectable>
          {err}
        </Text>
      ) : null}
    </View>
  );
}

type Props = { message: ChatMessage; children: ReactNode };
type State = { failed: boolean; error: unknown };

/**
 * Per-message error boundary: a render crash in one message (markdown, tool footer, a hui node whose
 * own NodeBoundary failed, …) shows an inline card and never takes down the chat. Resets when the
 * message changes (streaming updates, edits).
 * (Deliberate class component: React has no hook equivalent for error boundaries.)
 */
export class MessageBoundary extends Component<Props, State> {
  state: State = { failed: false, error: null };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { failed: true, error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('[chat] message render error', this.props.message?.id, error, info?.componentStack ?? '');
  }

  componentDidUpdate(prev: Props) {
    if (this.state.failed && prev.message !== this.props.message) this.setState({ failed: false, error: null });
  }

  render() {
    return this.state.failed ? <MessageErrorCard message={this.props.message} error={this.state.error} /> : this.props.children;
  }
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, padding: 12, gap: 6 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontWeight: '600' },
});
