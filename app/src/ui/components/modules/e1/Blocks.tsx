/**
 * `blocks` – architecture / building-block diagram in one card: an optional title, 1–3 columns
 * (variants) each with a centred column title, a grid of boxes (small icon on top, label, optional
 * muted sub-label under a hairline; soft = filled, framed = outlined, tone tints) and an optional
 * full-width base box for the shared layer. A muted caption line sits under the card.
 *
 * Layout from the measured width (blocksModel.blocksLayout): columns side by side on tablet /
 * desktop, stacked on a phone; inside a column a 3-grid drops to 2 (and 1) when boxes would get too
 * narrow for the font scale. Every box is one accessibility element ("Agent 1, Kernel 1").
 * Display-only. While streaming, columns appear when complete and a column skeleton follows.
 */
import { useMemo, useState } from 'react';
import { StyleSheet, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import { useTheme, type Theme } from '../../../theme';
import { useHui } from '../../../primitives/context';
import { FadeIn, HText, InlineText, Surface } from '../../../primitives/basics';
import { NARROW_TEXT_PROPS } from '../../../lib/textWrap';
import { useT } from '../../../../i18n';
import type { HuiBlocks } from '../../../types';
import { BlocksColumnSkeleton, BlocksSkeleton } from '../../../skeletons';
import { ProvenanceChip } from '../ProvenanceChip';
import {
  BLOCK_COLUMN_GAP,
  BLOCK_GAP,
  boxA11yLabel,
  boxColorKeys,
  blocksLayout,
  layoutScale,
  readBlocks,
  rowsOf,
  type BlockBaseModel,
  type BlockBoxModel,
  type BlockColumnModel,
} from './blocksModel.ts';
import { PathIcon } from './icons';

export function Blocks({ node }: { node: Partial<HuiBlocks> }) {
  const t = useTheme();
  const tr = useT();
  const { streaming } = useHui();
  const { fontScale } = useWindowDimensions();
  const model = useMemo(() => readBlocks(node), [node]);
  const [w, setW] = useState(0);
  const scale = layoutScale(t.fontScale, fontScale);
  const layout = useMemo(() => blocksLayout(w, model.columns, scale), [w, model.columns, scale]);

  if (!model.columns.length) {
    return streaming ? (
      <View accessible accessibilityLabel={tr('ui.blocks.loading')}>
        <BlocksSkeleton />
      </View>
    ) : null;
  }

  const onLayout = (e: LayoutChangeEvent) => {
    const nw = Math.round(e.nativeEvent.layout.width);
    if (nw !== w) setW(nw);
  };

  return (
    <View style={{ gap: t.spacing.s }}>
      <Surface style={{ gap: t.spacing.m }}>
        {model.title ? <InlineText variant="headline" text={model.title} accessibilityRole="header" /> : null}
        <View onLayout={onLayout} style={{ flexDirection: layout.sideBySide ? 'row' : 'column', alignItems: 'stretch', gap: layout.sideBySide ? BLOCK_COLUMN_GAP : t.spacing.l }}>
          {model.columns.map((col, i) => (
            <FadeIn key={col.key} delay={streaming ? 0 : Math.min(i, 2) * 50} style={layout.sideBySide ? { flex: 1, flexBasis: 0, minWidth: 0 } : undefined}>
              <Column t={t} col={col} perRow={layout.perRow[i] ?? col.grid} boxWidth={layout.boxWidth[i] ?? 0} fill={layout.sideBySide} />
            </FadeIn>
          ))}
        </View>
        {streaming && model.columns.length < 3 ? (
          <View accessible accessibilityLabel={tr('ui.blocks.loading')}>
            <BlocksColumnSkeleton />
          </View>
        ) : null}
        <ProvenanceChip basis={model.basis} source={model.source} />
      </Surface>
      {model.caption ? (
        <HText {...NARROW_TEXT_PROPS} variant="caption" color="muted" align="center" style={{ paddingHorizontal: t.spacing.s }}>
          {model.caption}
        </HText>
      ) : null}
    </View>
  );
}

/** Column title, the grid rows (last row centred) and the base layer; `fill` = side by side (base aligns at the bottom). */
function Column({ t, col, perRow, boxWidth, fill }: { t: Theme; col: BlockColumnModel; perRow: number; boxWidth: number; fill: boolean }) {
  return (
    <View style={{ gap: t.spacing.s, flexGrow: fill ? 1 : 0 }}>
      {col.title ? (
        <HText {...NARROW_TEXT_PROPS} variant="callout" weight="600" align="center" accessibilityRole="header">
          {col.title}
        </HText>
      ) : null}
      {col.items.length ? (
        <View style={{ gap: BLOCK_GAP, flexGrow: fill ? 1 : 0 }}>
          {rowsOf(col.items, perRow).map((row, r) => (
            <View key={r} style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'stretch', gap: BLOCK_GAP }}>
              {row.map((box, i) => (
                <Box key={i} t={t} box={box} width={boxWidth} />
              ))}
            </View>
          ))}
        </View>
      ) : null}
      {col.base ? <Base t={t} base={col.base} /> : null}
    </View>
  );
}

function Box({ t, box, width }: { t: Theme; box: BlockBoxModel; width: number }) {
  const c = boxColorKeys(box.style, box.tone, t.dark);
  return (
    <View
      accessible
      accessibilityLabel={boxA11yLabel(box)}
      style={{
        ...(width > 0 ? { width } : { flex: 1, flexBasis: 0 }),
        minWidth: 0,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        paddingVertical: 10,
        paddingHorizontal: 8,
        borderRadius: t.radii.control,
        borderWidth: 1,
        borderColor: c.border ? t.colors[c.border] : c.bg ? t.colors[c.bg] : 'transparent',
        backgroundColor: c.bg ? t.colors[c.bg] : 'transparent',
      }}
    >
      {box.icon ? <PathIcon name={box.icon} size={18} color={t.colors[c.icon]} /> : null}
      <HText {...NARROW_TEXT_PROPS} variant="caption" weight="600" align="center" style={{ alignSelf: 'stretch' }}>
        {box.label}
      </HText>
      {box.sub ? <Sub t={t} text={box.sub} /> : null}
    </View>
  );
}

/** Hairline + muted sub-label ("Kernel 1"). */
function Sub({ t, text }: { t: Theme; text: string }) {
  return (
    <>
      <View style={{ alignSelf: 'stretch', height: StyleSheet.hairlineWidth, backgroundColor: t.colors.borderStrong, marginHorizontal: 6 }} />
      <HText {...NARROW_TEXT_PROPS} variant="micro" color="muted" align="center" style={{ alignSelf: 'stretch' }}>
        {text}
      </HText>
    </>
  );
}

/** Full-width shared layer under the grid ("1 Linux-Kernel" / "Gemeinsam genutzt"): icon beside the label. */
function Base({ t, base }: { t: Theme; base: BlockBaseModel }) {
  return (
    <View
      accessible
      accessibilityLabel={boxA11yLabel(base)}
      style={{
        alignItems: 'center',
        gap: 4,
        paddingVertical: 10,
        paddingHorizontal: t.spacing.m,
        borderRadius: t.radii.control,
        borderWidth: 1,
        borderColor: t.colors.borderControl,
        backgroundColor: t.colors.surfacePressed,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, maxWidth: '100%' }}>
        {base.icon ? <PathIcon name={base.icon} size={18} color={t.colors.muted} /> : null}
        <HText {...NARROW_TEXT_PROPS} variant="caption" weight="600" align="center" style={{ flexShrink: 1 }}>
          {base.label}
        </HText>
      </View>
      {base.sub ? <Sub t={t} text={base.sub} /> : null}
    </View>
  );
}
