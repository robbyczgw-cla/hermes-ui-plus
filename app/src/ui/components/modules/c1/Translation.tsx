import { useMemo, useState } from 'react';
import { ActivityIndicator, View, type LayoutChangeEvent, type TextStyle } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useLocale, useT } from '../../../../i18n';
import { useTheme, type Theme } from '../../../theme';
import { useHui } from '../../../primitives/context';
import { FadeIn, HText, PressableScale, Surface } from '../../../primitives/basics';
import { Icon } from '../../../primitives/Icon';
import { Skeleton } from '../../../primitives/Skeleton';
import { haptic } from '../../../primitives/haptics';
import { useCopiedFlash } from '../../../lib/useCopiedFlash';
import { useNodeState } from '../../../../nodestate';
import type { HuiTranslation } from '../../../types';
import { useModuleId } from '../a/shared';
import { C1Icon } from './icons';
import { isRtl, languageName, nativeName, parseLang, type UiLang } from './languages.ts';
import { isLongText, LONG_TEXT_LINES, orderPanes, readTranslation, speakId, textSize, type TranslationPane } from './translationModel.ts';
import { useSpeakText } from './speech';

/**
 * `translation` – bilingual (≤ 5 language) cards: localized language label + native name, large
 * selectable text, romanization, 🔊 per text in that text's language, copy, "Tauschen" (swap the
 * view order, persisted per node), long texts collapsible, side by side on wide screens.
 * Not interactive – sends nothing to the model.
 */
export function Translation({ node }: { node: Partial<HuiTranslation> }) {
  const tr = useT();
  const { lang } = useLocale();
  const ui = lang as UiLang;
  const t = useTheme();
  const { streaming } = useHui();
  const id = useModuleId('translation', node as Record<string, unknown>);
  const model = useMemo(() => readTranslation(node), [node]);
  const [swapped, setSwapped] = useNodeState<boolean>(id, false);
  const [width, setWidth] = useState(0);

  if (!model.source && !model.targets.length) return streaming ? <TranslationSkeleton /> : null;

  const panes = orderPanes(model, swapped);
  const canSwap = !!model.source && model.targets.length > 0 && !streaming;
  const sideBySide = width >= 560 && panes.length === 2;
  // compact header: "DE → ES · JA" (first pane → the others); full names for screen readers
  const codes = panes.map((p) => parseLang(p.lang).base).filter((c) => c !== 'und');
  const routeText = codes.length > 1 ? `${codes[0].toUpperCase()} → ${codes.slice(1).map((c) => c.toUpperCase()).join(' · ')}` : '';
  const headerA11y = `${tr('ui.translation.title')}: ${panes.map((p) => languageName(p.lang, ui)).join(', ')}`;

  return (
    <Surface style={{ gap: t.spacing.m }}>
      <View onLayout={(e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width))} style={{ gap: t.spacing.m }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.s, minHeight: 36 }}>
          <C1Icon name="globe" size={16} color={t.colors.muted} />
          <HText variant="caption" weight="600" color="muted" accessibilityLabel={headerA11y} style={{ flex: 1 }} numberOfLines={1}>
            {routeText || tr('ui.translation.title')}
          </HText>
          {canSwap ? (
            <PressableScale
              haptic="selection"
              onPress={() => setSwapped((s) => !s)}
              accessibilityRole="button"
              accessibilityLabel={tr('ui.translation.swapA11y')}
              accessibilityState={{ selected: swapped }}
              hitSlop={4}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                height: 36,
                paddingHorizontal: 12,
                borderRadius: t.radii.pill,
                borderWidth: 1,
                borderColor: swapped ? t.colors.accent : t.colors.borderStrong,
                backgroundColor: swapped ? t.colors.accentSoft : 'transparent',
              }}
              pressedStyle={{ backgroundColor: t.colors.surfacePressed }}
            >
              <C1Icon name="swap" size={15} color={swapped ? t.colors.accent : t.colors.text} />
              <HText variant="caption" weight="600" style={{ color: swapped ? t.colors.accentText : t.colors.text }}>
                {tr('ui.translation.swap')}
              </HText>
            </PressableScale>
          ) : null}
        </View>

        <View style={{ flexDirection: sideBySide ? 'row' : 'column', gap: t.spacing.s }}>
          {panes.map((p, i) => (
            <View key={p.key} style={sideBySide ? { flex: 1 } : undefined}>
              <FadeIn delay={streaming ? 0 : Math.min(i, 4) * 60} style={sideBySide ? { flex: 1 } : undefined}>
                <Pane t={t} ui={ui} nodeId={id} pane={p} busy={streaming && i === panes.length - 1} />
              </FadeIn>
            </View>
          ))}
          {streaming && !model.targets.length ? <PaneSkeleton t={t} /> : null}
        </View>

        {model.note ? (
          <View style={{ flexDirection: 'row', gap: t.spacing.s, alignItems: 'flex-start' }}>
            <View style={{ paddingTop: 1 }}>
              <Icon name="info" size={15} color={t.colors.muted} />
            </View>
            <HText variant="caption" color="muted" style={{ flex: 1 }}>
              {model.note}
            </HText>
          </View>
        ) : null}
      </View>
    </Surface>
  );
}

function sizeStyle(size: ReturnType<typeof textSize>, t: Theme): TextStyle {
  const ty = t.typography;
  if (size === 'large') return { fontSize: ty.title.fontSize, lineHeight: ty.title.lineHeight, fontWeight: '500', letterSpacing: ty.title.letterSpacing };
  if (size === 'medium') return { fontSize: ty.headline.fontSize, lineHeight: ty.headline.lineHeight, fontWeight: '400', letterSpacing: ty.headline.letterSpacing };
  return { fontSize: ty.reading.fontSize, lineHeight: ty.reading.lineHeight, fontWeight: '400' };
}

function Pane({ t, ui, nodeId, pane, busy }: { t: Theme; ui: UiLang; nodeId: string; pane: TranslationPane; busy: boolean }) {
  const tr = useT();
  const [open, setOpen] = useState(false);
  const [copied, flashCopied] = useCopiedFlash();
  // the original in an unnamed language (models write "language":"English" for the target only): just "Original"
  const unnamedSource = pane.isSource && parseLang(pane.lang).base === 'und';
  const name = unnamedSource ? tr('ui.translation.original') : languageName(pane.lang, ui);
  const native = nativeName(pane.lang, ui);
  const rtl = isRtl(pane.lang);
  const long = isLongText(pane.text);
  const collapsed = long && !open && !busy;
  const tint = pane.isSource ? t.colors.muted : t.colors.accent;
  const speech = useSpeakText(speakId(nodeId, pane.key), pane.text, pane.lang);

  const copy = () => {
    void Clipboard.setStringAsync(pane.text).catch(() => undefined);
    haptic('success');
    flashCopied();
  };

  const playing = speech.status === 'playing';
  const active = playing || speech.status === 'paused' || speech.status === 'loading';
  const speakLabel =
    speech.status === 'playing'
      ? tr('ui.translation.pause')
      : speech.status === 'paused'
        ? tr('ui.translation.resume')
        : speech.status === 'loading'
          ? tr('ui.translation.preparing')
          : speech.status === 'error'
            ? tr('ui.translation.speakFailed')
            : tr('ui.translation.speakA11y', { lang: name });

  return (
    <View
      style={{
        borderRadius: t.radii.control,
        backgroundColor: pane.isSource ? t.colors.surfaceAlt : t.colors.accentSoft,
        paddingVertical: t.spacing.m,
        paddingLeft: t.spacing.m,
        paddingRight: t.spacing.s,
        gap: t.spacing.s,
        flex: 1,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 6 }}>
          <HText variant="caption" weight="600" style={{ color: tint }} numberOfLines={1}>
            {name}
          </HText>
          {native ? (
            <HText variant="micro" color="muted" numberOfLines={1}>
              {native}
            </HText>
          ) : null}
          {pane.isSource && !unnamedSource ? (
            <HText variant="micro" color="subtle" numberOfLines={1}>
              · {tr('ui.translation.original')}
            </HText>
          ) : null}
        </View>
        <PressableScale
          haptic="selection"
          disabled={busy}
          onPress={speech.toggle}
          accessibilityRole="button"
          accessibilityLabel={speakLabel}
          accessibilityState={{ busy: speech.status === 'loading' }}
          hitSlop={4}
          style={{ width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? t.colors.accent : 'transparent' }}
          pressedStyle={{ backgroundColor: active ? t.colors.accent : t.colors.surfacePressed }}
        >
          {speech.status === 'loading' ? (
            <ActivityIndicator size="small" color={t.colors.onAccent} />
          ) : speech.status === 'error' ? (
            <Icon name="alert" size={17} color={t.colors.danger} />
          ) : (
            <C1Icon name={playing ? 'pause' : 'speaker'} size={18} color={active ? t.colors.onAccent : tint} />
          )}
        </PressableScale>
        <PressableScale
          haptic={false}
          disabled={busy}
          onPress={copy}
          accessibilityRole="button"
          accessibilityLabel={copied ? tr('ui.translation.copied') : tr('ui.translation.copyA11y', { lang: name })}
          hitSlop={4}
          style={{ width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' }}
          pressedStyle={{ backgroundColor: t.colors.surfacePressed }}
        >
          <Icon name={copied ? 'check' : 'copy'} size={17} color={copied ? t.colors.success : tint} strokeWidth={copied ? 2.4 : 1.75} />
        </PressableScale>
      </View>

      <View style={{ paddingRight: t.spacing.s, gap: 4 }}>
        <HText
          selectable
          accessibilityLanguage={pane.lang !== 'und' ? pane.lang : undefined}
          numberOfLines={collapsed ? LONG_TEXT_LINES : undefined}
          style={[sizeStyle(textSize(pane.text), t), { color: t.colors.text }, rtl ? { writingDirection: 'rtl', textAlign: 'right' } : null]}
        >
          {pane.text}
        </HText>
        {pane.romanization ? (
          <HText variant="callout" color="muted" selectable accessibilityLabel={tr('ui.translation.romanizationA11y', { text: pane.romanization })} style={{ fontStyle: 'italic' }}>
            {pane.romanization}
          </HText>
        ) : null}
        {copied ? (
          <HText variant="micro" color="success" accessibilityLiveRegion="polite">
            {tr('ui.translation.copied')}
          </HText>
        ) : null}
        {long && !busy ? (
          <PressableScale
            haptic="selection"
            onPress={() => setOpen((o) => !o)}
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
            style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 36 }}
          >
            <HText variant="caption" weight="600" color="accent">
              {open ? tr('ui.translation.less') : tr('ui.translation.more')}
            </HText>
            <View style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}>
              <Icon name="chevronDown" size={14} color={t.colors.accent} />
            </View>
          </PressableScale>
        ) : null}
      </View>
    </View>
  );
}

function PaneSkeleton({ t }: { t: Theme }) {
  return (
    <View style={{ borderRadius: t.radii.control, backgroundColor: t.colors.accentSoft, padding: t.spacing.m, gap: t.spacing.s }}>
      <Skeleton width={72} height={10} />
      <Skeleton width="85%" height={18} />
      <Skeleton width="55%" height={18} />
    </View>
  );
}

function TranslationSkeleton() {
  const t = useTheme();
  const tr = useT();
  return (
    <Surface style={{ gap: t.spacing.m }}>
      <View accessible accessibilityLabel={tr('ui.translation.loading')} style={{ gap: t.spacing.s }}>
        <Skeleton width={110} height={10} />
        <View style={{ borderRadius: t.radii.control, backgroundColor: t.colors.surfaceAlt, padding: t.spacing.m, gap: t.spacing.s }}>
          <Skeleton width={64} height={10} />
          <Skeleton width="70%" height={18} />
        </View>
        <PaneSkeleton t={t} />
      </View>
    </Surface>
  );
}
