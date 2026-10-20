/**
 * A complete node of a type the app does not know (`{"type":"remind","time":"09:00","title":"Buy tea"}`): its content
 * as readable text (protocol readableFallback: title + "Field: value" lines), a note that the app did not set
 * anything up for it, and the raw JSON only behind a toggle. Normal users never get a JSON dump as the answer, and a
 * made-up action type never looks like something that happened.
 */
import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useTheme } from '../theme';
import { HText, PressableScale } from '../primitives/basics';
import { Icon } from '../primitives/Icon';
import { useT } from '../../i18n';
import { readableFallback } from '../../protocol/validate.ts';
import { asString } from '../lib/format';
import { useChildRenderer } from './modules/a/shared';

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2) ?? String(v);
  } catch {
    return String(v);
  }
}

export function UnknownNode({ node }: { node: Record<string, unknown> }) {
  const t = useTheme();
  const tr = useT();
  const renderChild = useChildRenderer();
  const [open, setOpen] = useState(false);
  const type = asString(node.type);
  const readable = useMemo(() => readableFallback(node, { path: `unknown-${type}` }), [node, type]);
  return (
    <View style={{ gap: t.spacing.s }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: t.spacing.s }}>
        <Icon name="alert" size={16} color={t.colors.muted} />
        <HText variant="caption" color="muted" style={{ flex: 1 }}>
          {tr('ui.content.unsupportedReadable', { type })}
        </HText>
      </View>
      {readable ? renderChild(readable, { key: 'readable', last: true }) : null}
      <PressableScale haptic="selection" scaleTo={0.99} onPress={() => setOpen((o) => !o)} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <HText variant="caption" color="muted">
            {open ? tr('chat.message.hideRaw') : tr('chat.message.showRaw')}
          </HText>
          <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} color={t.colors.muted} />
        </View>
      </PressableScale>
      {open ? (
        <ScrollView horizontal style={{ backgroundColor: t.colors.codeBg, borderRadius: t.radii.control }} contentContainerStyle={{ padding: t.spacing.m }}>
          <HText variant="mono" color="muted" selectable>
            {safeJson(node)}
          </HText>
        </ScrollView>
      ) : null}
    </View>
  );
}
