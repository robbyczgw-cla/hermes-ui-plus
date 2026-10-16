import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useTheme } from '../../theme';
import { useHui } from '../../primitives/context';
import { HText, PressableScale } from '../../primitives/basics';
import { SkeletonLines } from '../../primitives/Skeleton';
import { asArray, asObjects, asString } from '../../lib/format';
import type { HuiTabs } from '../../types';
import { useChildRenderer } from './a/shared';
import { useS } from './useS';
import { TabsSkeleton } from '../../skeletons';

/**
 * `tabs` – segmented tab bar (real tab semantics: role tablist/tab + selected state) and the
 * active tab's children. While streaming only the last tab's last child can still be partial.
 */
export function Tabs({ node }: { node: Partial<HuiTabs> }) {
  const S = useS();
  const t = useTheme();
  const { streaming } = useHui();
  const render = useChildRenderer();
  const tabs = asObjects(node.tabs).slice(0, 6);
  const [active, setActive] = useState(0);
  const idx = Math.min(active, Math.max(0, tabs.length - 1));

  if (!tabs.length) {
    return streaming ? <TabsSkeleton /> : null;
  }

  const tab = tabs[idx];
  const children = asArray(tab.children);
  const isLastTab = idx === tabs.length - 1;
  const fits = tabs.length <= 3;

  const bar = (
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', backgroundColor: t.colors.surfaceAlt, borderRadius: t.radii.control, padding: 3, gap: 3, ...(fits ? {} : { alignSelf: 'flex-start' }) }}>
      {tabs.map((tb, i) => {
        const on = i === idx;
        const label = asString(tb.label) || `${i + 1}`;
        return (
          <PressableScale
            key={i}
            haptic="selection"
            scaleTo={0.98}
            onPress={() => setActive(i)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={S.tabs.a11yTab(label, i, tabs.length)}
            style={{
              ...(fits ? { flex: 1 } : {}),
              minHeight: 36,
              paddingHorizontal: 14,
              borderRadius: t.radii.control,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: on ? t.colors.surface : 'transparent',
              ...(on ? t.shadows.sm : {}),
            }}
          >
            <HText variant="callout" weight={on ? '600' : '500'} color={on ? 'text' : 'muted'} numberOfLines={1}>
              {label}
            </HText>
          </PressableScale>
        );
      })}
    </View>
  );

  return (
    <View style={{ gap: t.spacing.m }}>
      {fits ? bar : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingRight: t.spacing.s }}>
          {bar}
        </ScrollView>
      )}
      <View key={idx} style={{ gap: t.spacing.l }}>
        {children.map((c, i) => render(c, { key: i, last: isLastTab && i === children.length - 1 }))}
        {!children.length ? (
          streaming && isLastTab ? <SkeletonLines lines={3} /> : <HText variant="callout" color="muted">{S.tabs.emptyTab}</HText>
        ) : null}
      </View>
    </View>
  );
}
