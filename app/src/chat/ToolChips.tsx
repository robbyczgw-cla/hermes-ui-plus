import { memo, useEffect, useRef, useState } from 'react';
import { Animated, Easing, LayoutAnimation, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../ui/primitives/Text';
import { useLocale, useT } from '../i18n';
import { useTheme } from '../ui';
import { FONTS } from '../ui/theme';
import type { ToolEvent } from '../hermes';
import { formatDuration, toolEmoji } from './format';
import { describeTool, toolViewText } from './hermesTools';
import { Icon } from './icons';
import { hasWebCard } from './webCard';
import { a11yState } from '../ui/lib/a11yState';

const NATIVE = Platform.OS !== 'web';

/**
 * Compact tool status chips above an assistant answer. Collapses into a summary once all tools are done. A finished
 * web search / extract chip with a parsed result opens the web result card (`onOpenWeb`, WebResultCard.tsx).
 */
export const ToolChips = memo(function ToolChips({ tools, onOpenWeb }: { tools: ToolEvent[]; onOpenWeb?: (toolId: string) => void }) {
  const t = useTheme();
  const tr = useT();
  const running = tools.some((x) => x.status === 'running');
  const [expanded, setExpanded] = useState(false);
  if (!tools.length) return null;

  const showList = running || expanded;
  const errors = tools.filter((x) => x.status === 'error').length;
  const cancelled = tools.filter((x) => x.detail?.cancelled).length;
  const single = tools.length === 1 ? describeTool(tr, tools[0]) : null;

  const toggle = () => {
    if (Platform.OS !== 'web') LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded((e) => !e);
  };

  return (
    <View style={styles.wrap}>
      {!running ? (
        <Pressable
          onPress={toggle}
          accessibilityRole="button"
          {...a11yState({ expanded })}
          accessibilityLabel={tr('chat.toolChips.used', { count: tools.length })}
          style={({ pressed }) => [styles.summary, pressed && { opacity: 0.6 }]}
          hitSlop={6}
        >
          {single?.icon ? <Icon name={single.icon} size={14} color={t.colors.muted} /> : null}
          <Text style={[t.typography.caption, styles.summaryText, { color: t.colors.muted }]}>
            {tools.length === 1 ? `${single?.icon ? '' : `${toolEmoji(tools[0].name, tools[0].emoji)} `}${single?.title ?? ''}` : tr('chat.toolChips.used', { count: tools.length })}
            {errors ? ` · ${tr('chat.toolTimeline.errorCount', { count: errors })}` : cancelled ? ` · ${tr('chat.toolTimeline.cancelled')}` : ' ✓'}
          </Text>
          <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={14} color={t.colors.muted} />
        </Pressable>
      ) : null}
      {showList ? (
        <View style={[styles.list, !running && styles.listBelow]}>
          {tools.map((tool) => (
            <Chip key={tool.id} tool={tool} onOpen={onOpenWeb && tool.status !== 'running' && hasWebCard(tool) ? onOpenWeb : undefined} />
          ))}
        </View>
      ) : null}
    </View>
  );
});

function Chip({ tool, onOpen }: { tool: ToolEvent; onOpen?: (toolId: string) => void }) {
  const t = useTheme();
  const tr = useT();
  const { locale } = useLocale();
  const appear = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(1)).current;
  const running = tool.status === 'running';
  const cancelled = !!tool.detail?.cancelled;

  useEffect(() => {
    Animated.timing(appear, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: NATIVE }).start();
  }, [appear]);

  useEffect(() => {
    if (!running) {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.45, duration: 650, useNativeDriver: NATIVE }),
        Animated.timing(pulse, { toValue: 1, duration: 650, useNativeDriver: NATIVE }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [running, pulse]);

  const color = tool.status === 'error' ? t.colors.danger : running ? t.colors.text : t.colors.muted;
  const view = describeTool(tr, tool);
  const label = view.title;
  const preview = view.preview;
  // N7: no measured duration (call and result at the same instant) → no "0 ms"
  const dur = tool.endedAt && tool.endedAt > tool.startedAt ? formatDuration(tool.endedAt - tool.startedAt, locale) : null;
  // web search chips: "Brave · 5 Treffer" once the stored result was parsed (hermesTools webView)
  const extra = view.kind === 'web' && view.sub ? view.sub : null;
  const a11y = `${toolViewText(view)}: ${running ? tr('chat.toolChips.state.running') : tool.status === 'error' ? tr('chat.toolChips.state.error') : cancelled ? tr('chat.toolTimeline.cancelled') : tr('chat.toolChips.state.done')}`;
  const chip = (
    <Animated.View
      style={[
        styles.chip, { borderRadius: t.radii.pill },
        {
          backgroundColor: tool.status === 'error' ? t.colors.dangerSoft : t.colors.surfaceAlt,
          opacity: appear,
          transform: [{ translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [4, 0] }) }],
        },
      ]}
      accessibilityLabel={onOpen ? undefined : a11y}
    >
      {view.icon ? <Icon name={view.icon} size={14} color={color} /> : <Text style={t.typography.caption}>{toolEmoji(tool.name, tool.emoji)}</Text>}
      <Animated.Text style={[t.typography.caption, styles.chipText, { color, opacity: pulse }]} numberOfLines={1}>
        {label}
        {preview ? <Text style={{ color: t.colors.muted, fontWeight: '400' }}>{`  ${preview}`}</Text> : null}
        {extra ? <Text style={{ color: t.colors.subtle, fontWeight: '400' }}>{`  · ${extra}`}</Text> : null}
        {running ? '…' : ''}
      </Animated.Text>
      {tool.status === 'done' && !cancelled ? <Icon name="check" size={13} color={t.colors.success} strokeWidth={2.2} /> : null}
      {cancelled ? <Text style={[t.typography.micro, styles.dur, { color: t.colors.subtle }]}>{tr('chat.toolTimeline.cancelled')}</Text> : null}
      {tool.status === 'error' ? <Icon name="alert" size={13} color={t.colors.danger} /> : null}
      {dur && !running ? (
        <Text style={[t.typography.micro, styles.dur, { color: t.colors.subtle }]} numberOfLines={1}>
          {dur}
        </Text>
      ) : null}
      {onOpen ? <Icon name="chevronRight" size={13} color={t.colors.subtle} /> : null}
    </Animated.View>
  );
  if (!onOpen) return chip;
  return (
    <Pressable
      onPress={() => onOpen(tool.id)}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityHint={tr('hermesTools.webCard.chipHint')}
      hitSlop={4}
      style={({ pressed }) => [styles.press, pressed && { opacity: 0.6 }]}
    >
      {chip}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 10 },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingVertical: 2 },
  summaryText: { fontWeight: '500' },
  list: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  listBelow: { marginTop: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, maxWidth: '100%' },
  chipText: { fontFamily: FONTS.sans, fontWeight: '500', flexShrink: 1 },
  dur: { fontVariant: ['tabular-nums'], flexShrink: 0 },
  press: { maxWidth: '100%' },
});
