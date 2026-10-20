import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useTheme } from '../theme';
import { useHui } from '../primitives/context';
import { HText, InlineText, PressableScale } from '../primitives/basics';
import { Button } from '../primitives/Button';
import { Icon, type IconName } from '../primitives/Icon';
import { Skeleton } from '../primitives/Skeleton';
import { haptic } from '../primitives/haptics';
import { CodeSkeleton, ImageSkeleton } from '../skeletons';
import { chipMinWidth, chipTextShrinks } from '../lib/chipText';
import { useImagesAllowed, useResolvedImage, useWebImagesEnabled } from '../../images';
import { getImageSearchMode } from '../../images/web';
import { IMAGE_LOOKUP_CAP_MS, imageMissReason } from '../../images/miss';
import { AttributionLine, ImageLightbox, Photo } from './imageParts';
import { MissNote, MissTile } from './imageMiss';
import { useSlotCap } from './imageSlot';
import { useCopiedFlash } from '../lib/useCopiedFlash';
import { useCaptureBusy } from '../lib/capture';
import { asArray, asNumber, asObjects, asOptString, asString, clamp, isObject } from '../lib/format';
import type { HuiAction, HuiButtons, HuiCode, HuiImage, HuiSuggestions } from '../types';
import { CONFIRMED_ACTION_TYPES } from '../../protocol/types';
import type { NodeProps } from './content';
import { useT } from '../../i18n';
import { useOptionalActionRunner } from '../../actions/ActionRunner';
import { sendMatchesLabel } from '../../actions/describe';

/* ───────────── image ───────────── */

/**
 * `image` node: `url` (from a tool/source; through the bridge image proxy when it has one) or `query` → real photo
 * resolved via Wikipedia/Commons or the web image search (`source:"web"`).
 * Shimmer while resolving/loading, fade-in, attribution line, fullscreen on tap.
 * No photo (no image search, images off, lookup failed, nothing found, photo did not load) → a calm placeholder
 * tile with the caption and one quiet line naming the reason (imageMiss.tsx), never nothing and never a broken image.
 */
export function ImageBlock({ node }: NodeProps<HuiImage>) {
  const t = useTheme();
  const { streaming } = useHui();
  const url = asOptString(node.url);
  const query = asOptString(node.query);
  const fixedAspect = asNumber(node.aspect);
  const caption = asOptString(node.caption);
  const alt = asOptString(node.alt);
  // a partial URL/query while streaming would load the wrong thing – wait for the block to complete
  const webOnly = node.source === 'web';
  const st = useResolvedImage({ url, query, lang: asOptString(node.lang), source: webOnly ? 'web' : undefined }, { enabled: !streaming });
  const [open, setOpen] = useState(false);
  const [broken, setBroken] = useState<string | null>(null);
  const allowed = useImagesAllowed();
  const webOn = useWebImagesEnabled();
  const resolved = st.status === 'ok' ? st.image : null;
  const img = resolved && resolved.url !== broken ? resolved : null;
  // the lookup shimmers at most IMAGE_SLOT_CAP_MS, then the placeholder takes over (a late photo still replaces it)
  const expired = useSlotCap(st.status === 'loading', `${url ?? ''}|${query ?? ''}`, IMAGE_LOOKUP_CAP_MS);
  const natural = img && img.width > 0 && img.height > 0 ? img.width / img.height : undefined;
  const aspect = clamp(fixedAspect ?? natural ?? 3 / 2, 0.75, 2.4);
  // share-as-image: the lookup holds the capture; past its deadline the block is left out like a miss
  const captureExpired = useCaptureBusy(!streaming && !!(url || query) && (st.status === 'idle' || st.status === 'loading'));
  if (!url && !query) return streaming ? <ImageSkeleton aspect={aspect} /> : null;
  const pending = st.status === 'idle' || (st.status === 'loading' && !expired);
  if (pending && !captureExpired) return <ImageSkeleton aspect={aspect} />;
  if (!img) {
    const status = resolved ? 'broken' : st.status === 'error' ? 'error' : st.status === 'none' ? 'none' : 'expired';
    const reason = imageMissReason({ allowed, webOnly, webEnabled: webOn, mode: getImageSearchMode(), status, urlOnly: !query && !!url });
    const label = caption ?? alt ?? query;
    return (
      <View style={{ gap: t.spacing.xs + 2 }}>
        <MissTile query={query} label={label} height={96} />
        {label ? <InlineText variant="caption" color="muted" text={label} /> : null}
        <MissNote reason={reason} />
      </View>
    );
  }
  return (
    <View style={{ gap: t.spacing.xs + 2 }}>
      <Photo uri={img.url} aspect={aspect} label={alt ?? caption ?? img.title} onPress={() => setOpen(true)} onError={() => setBroken(img.url)} />
      {caption ? <InlineText variant="caption" color="muted" text={caption} /> : null}
      <AttributionLine image={img} />
      <ImageLightbox items={[{ image: img, caption: caption ?? alt }]} index={open ? 0 : null} onClose={() => setOpen(false)} />
    </View>
  );
}

/* ───────────── code ───────────── */

const COLLAPSE_LINES = 18;

export function CodeBlock({ node }: NodeProps<HuiCode>) {
  const tr = useT();
  const t = useTheme();
  const { streaming } = useHui();
  const code = asString(node.code).replace(/\s+$/, '');
  const lang = asOptString(node.language);
  const [copied, flashCopied] = useCopiedFlash();
  const [expanded, setExpanded] = useState(false);
  if (!code) return streaming ? <CodeSkeleton /> : null;
  const lines = code.split('\n');
  const collapsible = !streaming && lines.length > COLLAPSE_LINES + 4;
  const shown = collapsible && !expanded ? lines.slice(0, COLLAPSE_LINES).join('\n') : code;
  const copy = () => {
    Clipboard.setStringAsync(code).catch(() => {});
    haptic('success');
    flashCopied();
  };
  return (
    <View style={{ backgroundColor: t.colors.codeBg, borderRadius: t.radii.control, borderWidth: 1, borderColor: t.colors.border, overflow: 'hidden' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: t.spacing.m, paddingRight: 4, height: 36, borderBottomWidth: 1, borderColor: t.colors.border }}>
        <HText variant="caption" color="muted" style={{ flex: 1 }}>
          {lang ?? 'Code'}
        </HText>
        <PressableScale haptic={false} onPress={copy} disabled={streaming} accessibilityLabel={tr('ui.code.copy')} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, height: 28, borderRadius: t.radii.control }}>
          <Icon name={copied ? 'check' : 'copy'} size={14} color={copied ? t.colors.success : t.colors.muted} />
          <HText variant="caption" style={{ color: copied ? t.colors.success : t.colors.muted }}>
            {copied ? tr('actions.copied') : tr('actions.copy')}
          </HText>
        </PressableScale>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ padding: t.spacing.m }}>
        <HText variant="mono" selectable>
          {shown}
          {streaming ? <HText variant="mono" color="accent">{' ▍'}</HText> : null}
        </HText>
      </ScrollView>
      {collapsible ? (
        <PressableScale haptic="selection" scaleTo={0.99} onPress={() => setExpanded((x) => !x)} style={{ alignItems: 'center', paddingVertical: t.spacing.s, borderTopWidth: 1, borderColor: t.colors.border }}>
          <HText variant="caption" color="accent" weight="500">
            {expanded ? tr('ui.code.showLess') : tr('ui.code.moreLines', { n: lines.length - COLLAPSE_LINES })}
          </HText>
        </PressableScale>
      ) : null}
    </View>
  );
}

/* ───────────── buttons ───────────── */

function actionIcon(a: HuiAction | undefined): IconName | null {
  if (!a) return null;
  if (a.type === 'open_url') return 'external';
  if (a.type === 'copy') return 'copy';
  return null;
}

function isAction(v: unknown): v is HuiAction {
  if (!isObject(v)) return false;
  switch (v.type) {
    case 'send':
    case 'copy':
      return typeof v.text === 'string';
    case 'open_url':
      return typeof v.url === 'string';
    case 'submit':
      return true;
    case 'ask':
      return typeof v.text === 'string';
    default:
      // v2 device actions (calendar, reminder, maps, call, email, sms, timer, add_to_list): the chat
      // shell's action runner validates the fields and always confirms in a sheet
      return (CONFIRMED_ACTION_TYPES as readonly string[]).includes(String(v.type));
  }
}

export function Buttons({ node }: NodeProps<HuiButtons>) {
  const t = useTheme();
  const { onAction, streaming } = useHui();
  const runner = useOptionalActionRunner();
  const tr = useT();
  const items = asObjects(node.items);
  // which copy button shows its "Kopiert" state (shared timing: useCopiedFlash)
  const [copied, flashCopied] = useCopiedFlash();
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const done = copied ? copiedIdx : null;
  if (!items.length) return streaming ? <Skeleton width={160} height={40} radius={t.radii.pill} /> : null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.s }}>
      {items.map((b, i) => {
        const action = isAction(b.action) ? b.action : undefined;
        // never auto-promote: only an explicit `style:'primary'` is filled, and only the first one (≤ 1 primary)
        const primary = b.style === 'primary' && items.findIndex((x) => x.style === 'primary') === i;
        const icon = done === i && action?.type === 'copy' ? 'check' : actionIcon(action);
        return (
          <Button
            key={i}
            label={done === i && action?.type === 'copy' ? tr('actions.copied') : asString(b.label)}
            variant={primary ? 'primary' : 'secondary'}
            icon={icon ?? undefined}
            numberOfLines={2}
            disabled={!action || streaming}
            haptic={action?.type === 'copy' ? 'success' : undefined}
            onPress={() => {
              if (!action) return;
              // M2: a hidden `send` text (label "Weiter", text "<instructions for the agent>") is never sent blind: the
              // chat shell confirms it with the full text (chat/sendGate.ts, label passed along); outside a chat (no
              // runner, e.g. the gallery) only the visible label is sent
              const label = asString(b.label);
              if (action.type === 'send' && !runner && !sendMatchesLabel(label, action.text)) {
                if (label.trim()) onAction({ type: 'send', text: label }, undefined, { nodeId: asOptString(node.id), label });
                return;
              }
              onAction(action, undefined, { nodeId: asOptString(node.id), label });
              if (action.type === 'copy') {
                setCopiedIdx(i);
                flashCopied();
              }
            }}
          />
        );
      })}
    </View>
  );
}

/* ───────────── suggestions ───────────── */

/** A chip's label: short ones keep one line at full size (chipText.ts chipMinWidth: Android's 0.1 dp rounding loss). */
function ChipLabel({ text, row }: { text: string; row: boolean }) {
  const [minWidth, setMinWidth] = useState<number | null>(null);
  const shrinks = chipTextShrinks(text);
  return (
    <HText
      variant="callout"
      numberOfLines={row ? 3 : 2}
      style={shrinks ? { flexShrink: 1 } : minWidth ? { minWidth } : undefined}
      onTextLayout={shrinks ? undefined : (e) => {
        const w = chipMinWidth(text, e.nativeEvent.lines);
        if (w !== null && w !== minWidth) setMinWidth(w);
      }}
    >
      {text}
    </HText>
  );
}

export function Suggestions({ node }: NodeProps<HuiSuggestions>) {
  const tr = useT();
  const t = useTheme();
  const { onAction, streaming } = useHui();
  const items = asArray(node.items).map((s) => asString(s)).filter(Boolean);
  if (!items.length)
    return streaming ? (
      <View style={{ flexDirection: 'row', gap: t.spacing.s }}>
        <Skeleton width={140} height={36} radius={t.radii.pill} />
        <Skeleton width={110} height={36} radius={t.radii.pill} />
      </View>
    ) : null;
  // `layout:'row'` (chat follow-ups): a vertical list of full questions (up to 3 lines each, never cut to one line)
  const row = (node as { layout?: unknown }).layout === 'row';
  const chips = items.map((s, i) => {
        const partial = streaming && i === items.length - 1;
        return (
          <PressableScale
            key={i}
            disabled={partial}
            haptic="light"
            onPress={() => onAction({ type: 'send', text: s }, undefined, { label: s })}
            accessibilityLabel={tr('ui.media.suggestion', { text: s })}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              minHeight: 36,
              paddingHorizontal: 14,
              paddingVertical: 7,
              borderRadius: row ? t.radii.control : t.radii.pill,
              borderWidth: 1,
              borderColor: t.colors.border,
              backgroundColor: t.colors.surface,
              maxWidth: '100%',
              ...(row ? { alignSelf: 'flex-start' as const } : {}),
            }}
            pressedStyle={{ backgroundColor: t.colors.surfacePressed }}
          >
            <ChipLabel text={s} row={row} />
            <Icon name="arrowRight" size={13} color={t.colors.subtle} />
          </PressableScale>
        );
  });
  if (row) return <View style={{ gap: t.spacing.s }}>{chips}</View>;
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.s }}>{chips}</View>;
}
