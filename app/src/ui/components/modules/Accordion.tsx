import { useEffect, useState } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { useTheme, type Theme } from '../../theme';
import { useHui } from '../../primitives/context';
import { HText, InlineText, PressableScale, Surface } from '../../primitives/basics';
import { Icon } from '../../primitives/Icon';
import { SkeletonLines } from '../../primitives/Skeleton';
import { asArray, asNumber, asObjects, asString } from '../../lib/format';
import type { HuiAccordion } from '../../types';
import { useChildRenderer } from './a/shared';
import { useS } from './useS';
import { AccordionSkeleton } from '../../skeletons';

/** `accordion` – independent collapsible sections; `open` = initially expanded item. */
export function Accordion({ node }: { node: Partial<HuiAccordion> }) {
  const S = useS();
  const t = useTheme();
  const { streaming, depth } = useHui();
  const render = useChildRenderer();
  const items = asObjects(node.items).slice(0, 20);
  const initial = asNumber(node.open);
  const [open, setOpen] = useState<Set<number>>(() => new Set(initial !== undefined ? [initial] : []));
  // `open` may name an item that hasn't streamed in yet – it simply opens when it arrives.

  if (!items.length) {
    return streaming ? <AccordionSkeleton depth={depth} /> : null;
  }

  return (
    <Surface depth={depth} padded={false}>
      {items.map((it, i) => {
        const isOpen = open.has(i);
        const last = i === items.length - 1;
        const children = asArray(it.children);
        return (
          <View key={i} style={{ borderTopWidth: i ? 1 : 0, borderColor: t.colors.border }}>
            <PressableScale
              haptic="selection"
              scaleTo={0.995}
              onPress={() =>
                setOpen((s) => {
                  const n = new Set(s);
                  if (n.has(i)) n.delete(i);
                  else n.add(i);
                  return n;
                })
              }
              accessibilityRole="button"
              accessibilityState={{ expanded: isOpen }}
              accessibilityHint={isOpen ? S.accordion.collapse : S.accordion.expand}
              style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.m, minHeight: 48, paddingHorizontal: t.spacing.l, paddingVertical: t.spacing.m }}
              pressedStyle={{ backgroundColor: t.colors.surfacePressed }}
            >
              <InlineText variant="bodyStrong" text={asString(it.title) || '…'} style={{ flex: 1 }} />
              <Chevron t={t} open={isOpen} />
            </PressableScale>
            {isOpen ? (
              <View style={{ paddingHorizontal: t.spacing.l, paddingBottom: t.spacing.l, gap: t.spacing.l }}>
                {children.map((c, ci) => render(c, { key: ci, last: last && ci === children.length - 1 }))}
                {!children.length ? (streaming && last ? <SkeletonLines lines={2} /> : <HText variant="callout" color="muted">{S.accordion.empty}</HText>) : null}
              </View>
            ) : null}
          </View>
        );
      })}
    </Surface>
  );
}

function Chevron({ t, open }: { t: Theme; open: boolean }) {
  const reduced = useReducedMotion();
  const r = useSharedValue(open ? 1 : 0);
  useEffect(() => {
    r.value = reduced ? (open ? 1 : 0) : withTiming(open ? 1 : 0, { duration: 200 });
  }, [open, reduced, r]);
  const anim = useAnimatedStyle(() => ({ transform: [{ rotate: `${r.value * 180}deg` }] }));
  return (
    <Animated.View style={anim}>
      <Icon name="chevronDown" size={18} color={t.colors.muted} />
    </Animated.View>
  );
}
