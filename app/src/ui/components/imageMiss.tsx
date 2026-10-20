/**
 * What an `image` / `gallery` block shows for items without a photo (images/miss.ts): a calm tile per item (photo
 * glyph on the surface colour; a tap opens a web image search for its query in the browser) and ONE quiet line under
 * the block that names the reason, with a link to the setting where the user can change it.
 */
import { Pressable, StyleSheet, View } from 'react-native';
import { useTheme } from '../theme';
import { useHui } from '../primitives/context';
import { HText } from '../primitives/basics';
import { useT, type TKey } from '../../i18n';
import { useCaptureMode } from '../lib/capture';
import { browserImageSearchUrl, missNoteAction, type ImageMissReason } from '../../images/miss';
import { useImageSettingsOpener } from '../../images/settingsLink';
import { ImageGlyph } from './imageParts';

const REASON_KEY: Record<ImageMissReason, TKey> = {
  off: 'ui.image.missOff',
  noSearch: 'ui.image.missNoSearch',
  wikiOnly: 'ui.image.missWikiOnly',
  error: 'ui.image.missError',
  notFound: 'ui.image.missNotFound',
};

/** Placeholder for one item: same box as a photo (aspect or height), glyph only; the caption stays below it. */
export function MissTile({ query, label, aspect, height }: { query?: string; label?: string; aspect?: number; height?: number }) {
  const tr = useT();
  const t = useTheme();
  const { onAction } = useHui();
  const capture = useCaptureMode();
  const url = capture ? undefined : browserImageSearchUrl(query);
  const box = [
    { width: '100%' as const, borderRadius: t.radii.card, backgroundColor: t.colors.surfaceAlt, borderWidth: StyleSheet.hairlineWidth, borderColor: t.colors.border, alignItems: 'center' as const, justifyContent: 'center' as const },
    height !== undefined ? { height } : { aspectRatio: aspect ?? 4 / 3 },
  ];
  const name = label || query || '';
  if (!url) {
    return (
      <View style={box} accessible accessibilityRole="image" accessibilityLabel={name ? tr('ui.image.missTile', { label: name }) : tr('ui.image.missTileNoLabel')}>
        <ImageGlyph color={t.colors.subtle} size={22} />
      </View>
    );
  }
  return (
    <Pressable
      onPress={() => onAction({ type: 'open_url', url })}
      accessibilityRole="link"
      accessibilityLabel={name ? tr('ui.image.missTile', { label: name }) : tr('ui.image.missTileNoLabel')}
      accessibilityHint={tr('ui.image.missTileHint')}
      style={({ pressed }) => [...box, pressed ? { backgroundColor: t.colors.surfacePressed } : null]}
    >
      <ImageGlyph color={t.colors.subtle} size={22} />
    </Pressable>
  );
}

/**
 * The one quiet line under a block with missing photos (+ "Einstellungen" where the user can change the cause, or a
 * sentence when this app has no such setting).
 */
export function MissNote({ reason }: { reason: ImageMissReason }) {
  const tr = useT();
  const t = useTheme();
  const open = useImageSettingsOpener();
  const capture = useCaptureMode();
  const action = missNoteAction(reason, capture || !open ? null : open === 'none' ? 'none' : 'settings');
  const link = action?.kind === 'link' && typeof open === 'function' ? () => open(action.target) : null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 6 }}>
      <HText variant="caption" color="muted">
        {tr(REASON_KEY[reason])}
      </HText>
      {action?.kind === 'hint' ? (
        <HText variant="caption" color="muted">
          {tr('ui.image.missNoSettingsHint')}
        </HText>
      ) : null}
      {link ? (
        <Pressable onPress={link} hitSlop={{ top: 12, bottom: 12, left: 6, right: 6 }} accessibilityRole="link" accessibilityLabel={tr('ui.image.missSettingsA11y')}>
          {({ pressed }) => (
            <HText variant="caption" color="accent" weight="500" style={{ opacity: pressed ? 0.6 : 1 }}>
              {tr('ui.image.missSettings')}
            </HText>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}
