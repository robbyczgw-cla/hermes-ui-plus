/**
 * `summary` – TL;DR head of a long answer (docs/SPEC-modules-v4.md A2): accent-left-bordered card with
 * large text, up to 4 bullet points and an optional bold verdict line. Text may contain inline markdown
 * (bold/italic/code) – rendered via InlineText, never as links/markup beyond that.
 * Settings → Antworten → "Kurzfassung oben" off → not rendered (the details follow anyway).
 */
import { View } from 'react-native';
import { useT } from '../../i18n';
import { useTheme } from '../theme';
import { useHui } from '../primitives/context';
import { HText, InlineText } from '../primitives/basics';
import { Icon } from '../primitives/Icon';
import { SummarySkeleton } from '../skeletons';
import { asOptString, asString } from '../lib/format';
import { useAnswerUiPrefs } from '../lib/answerPrefs';
import type { HuiSummary } from '../types';

export function Summary({ node }: { node: Partial<HuiSummary> }) {
  const t = useTheme();
  const tr = useT();
  const { streaming } = useHui();
  const { summary: enabled } = useAnswerUiPrefs();
  if (!enabled) return null;
  const text = asString(node.text).trim();
  const points = (Array.isArray(node.points) ? node.points : []).map((p) => asString(p).trim()).filter(Boolean).slice(0, 4);
  const verdict = asOptString(node.verdict)?.trim();
  if (!text && !points.length && !verdict) return streaming ? <SummarySkeleton /> : null;
  return (
    <View
      style={{
        borderLeftWidth: 3,
        borderLeftColor: t.colors.accent,
        backgroundColor: t.colors.accentSoft,
        borderTopRightRadius: t.radii.control,
        borderBottomRightRadius: t.radii.control,
        paddingVertical: t.spacing.m,
        paddingLeft: t.spacing.m + 2,
        paddingRight: t.spacing.m,
        gap: t.spacing.s,
      }}
      accessibilityLabel={tr('ui.summary.a11y')}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Icon name="sparkle" size={13} color={t.colors.accent} />
        <HText variant="caption" color="accent" weight="600" accessibilityRole="header">
          {tr('ui.summary.label')}
        </HText>
      </View>
      {text ? <InlineText variant="headline" weight="500" text={text} selectable /> : null}
      {points.length ? (
        <View style={{ gap: 4 }}>
          {points.map((p, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: t.colors.accent, marginTop: 9 }} />
              <InlineText variant="body" text={p} style={{ flex: 1 }} selectable />
            </View>
          ))}
        </View>
      ) : null}
      {verdict ? <InlineText variant="bodyStrong" weight="700" text={verdict} selectable /> : null}
    </View>
  );
}
