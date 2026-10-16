// Darstellung widgets: theme family cards (each a live mini preview), accent swatches + custom hex,
// and a live preview card of the current theme (bubble style, font size, accent, chart + code colors).
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../ui/primitives/Text';
import { Icon } from '../chat/icons';
import { useT } from '../i18n';
import {
  ACCENT_SWATCHES,
  checkCustomAccent,
  familySchemes,
  normalizeHex,
  pickerFamilies,
  resolveTheme,
  textStyle,
  useTheme,
  useThemeConfig,
  type AccentPref,
  type Theme,
  type ThemeFamilyId,
} from '../ui';
import type { BubbleStylePref } from './preferences';
import { Button, Field, Group } from './ui';
import { useDesktopChrome } from '../desktop/chrome';
import { a11yState } from '../ui/lib/a11yState';

// ---------------------------------------------------------------- family cards

/** Five featured families up front (Standard, OLED, Papier, Nord, Rosé); the rest behind "Mehr Designs". */
export function ThemeFamilyGrid({ value, onChange }: { value: ThemeFamilyId; onChange(id: ThemeFamilyId): void }) {
  const t = useTheme();
  const cfg = useThemeConfig();
  const tr = useT();
  const [expanded, setExpanded] = useState(false);
  const { shown, hiddenCount } = pickerFamilies(value, expanded);
  return (
    <View style={styles.gridWrap}>
      <View style={styles.grid} accessibilityRole="radiogroup" accessibilityLabel={tr('settings.look.family')}>
      {shown.map((id) => {
        // preview in the scheme currently shown, with the user's accent, so the card looks like the result
        const th = resolveTheme({ family: id, scheme: t.scheme, accent: cfg.accent });
        const sel = id === value;
        const name = tr(`settings.themes.${id}`);
        const darkOnly = familySchemes(id).length === 1 && familySchemes(id)[0] === 'dark';
        return (
          <Pressable
            key={id}
            onPress={() => onChange(id)}
            accessibilityRole="radio"
            {...a11yState({ selected: sel, checked: sel })}
            accessibilityLabel={tr('settings.themes.a11y', { name })}
            style={({ pressed }) => [
              styles.card,
              { borderColor: sel ? t.colors.accent : t.colors.border, backgroundColor: t.colors.surface, borderRadius: t.radii.card, opacity: pressed ? 0.8 : 1 },
              sel && styles.cardSel,
            ]}
          >
            <MiniPreview th={darkOnly && !t.dark ? resolveTheme({ family: id, scheme: 'dark', accent: cfg.accent }) : th} />
            <View style={styles.cardFoot}>
              <Text style={[styles.cardName, textStyle(t, 'caption'), { color: t.colors.text, fontWeight: '600' }]} numberOfLines={1}>
                {name}
              </Text>
              {sel ? <Icon name="check" size={14} color={t.colors.accent} strokeWidth={2.4} /> : null}
            </View>
            {darkOnly ? (
              <Text style={[styles.cardSub, textStyle(t, 'micro'), { color: t.colors.muted }]} numberOfLines={1}>
                {tr('settings.themes.darkOnly')}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
      </View>
      {hiddenCount > 0 || expanded ? (
        <Pressable
          onPress={() => setExpanded((e) => !e)}
          accessibilityRole="button"
          {...a11yState({ expanded })}
          hitSlop={6}
          style={({ pressed }) => [styles.moreBtn, pressed && { opacity: 0.6 }]}
        >
          <Text style={[textStyle(t, 'callout'), { color: t.colors.accentText, fontWeight: '600' }]}>{expanded ? tr('settings.themes.less') : tr('settings.themes.more', { count: hiddenCount })}</Text>
          <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={14} color={t.colors.accent} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** Tiny chat mock in the colors of `th`. Purely decorative (hidden from screen readers). */
function MiniPreview({ th }: { th: Theme }) {
  const c = th.colors;
  return (
    <View style={[styles.mini, { backgroundColor: c.bg, borderColor: c.border, borderRadius: th.radii.control }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[styles.miniBubble, { backgroundColor: c.surfaceAlt }]} />
      <View style={[styles.miniLine, { backgroundColor: c.text, width: '78%' }]} />
      <View style={[styles.miniLine, { backgroundColor: c.muted, width: '56%' }]} />
      <View style={styles.miniRow}>
        <View style={[styles.miniBtn, { backgroundColor: c.accent }]} />
        {c.chart.slice(0, 4).map((col, i) => (
          <View key={col} style={[styles.miniBar, { backgroundColor: col, height: 6 + ((i * 5) % 11) }]} />
        ))}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------- accent

export function AccentPicker({ value, family, onChange }: { value: AccentPref; family: ThemeFamilyId; onChange(a: AccentPref): void }) {
  const t = useTheme();
  const tr = useT();
  const isCustom = value.startsWith('#');
  // macOS app: "Wie macOS" follows the system accent color (desktop/chrome.ts)
  const chrome = useDesktopChrome();
  const [customOpen, setCustomOpen] = useState(isCustom);
  const [draft, setDraft] = useState(isCustom ? value.toUpperCase() : '');
  const familyAccent = useMemo(() => resolveTheme({ family, scheme: t.scheme }).colors.accent, [family, t.scheme]);
  const check = draft ? checkCustomAccent(draft, family) : null;
  const shownCheck = isCustom ? checkCustomAccent(value, family) : null;

  const swatch = (key: string, color: string, selected: boolean, label: string, onPress: () => void, glyph?: 'plus') => (
    <Pressable
      key={key}
      onPress={onPress}
      accessibilityRole="radio"
      {...a11yState({ selected, checked: selected })}
      accessibilityLabel={label}
      hitSlop={4}
      style={({ pressed }) => [styles.swatchRing, { borderColor: selected ? t.colors.text : 'transparent', opacity: pressed ? 0.7 : 1 }]}
    >
      <View style={[styles.swatch, { backgroundColor: color, borderColor: t.colors.borderControl }]}>
        {glyph ? <Icon name="plus" size={16} color={t.colors.text} strokeWidth={2.2} /> : null}
        {selected && !glyph ? <Icon name="check" size={15} color={resolveTheme({ scheme: t.scheme, accent: normalizeHex(color) ?? 'theme' }).colors.onAccent} strokeWidth={2.6} /> : null}
      </View>
    </Pressable>
  );

  return (
    <Group>
      <View style={styles.swatches} accessibilityRole="radiogroup" accessibilityLabel={tr('settings.look.accent')}>
        {swatch('theme', familyAccent, value === 'theme', tr('settings.look.accentTheme'), () => {
          setCustomOpen(false);
          onChange('theme');
        })}
        {chrome.mac && chrome.accent
          ? swatch('system', chrome.accent, value === 'system', tr('desktop.accentSystem'), () => {
              setCustomOpen(false);
              onChange('system');
            })
          : null}
        {/* a swatch equal to the family's own accent (brass in Standard, ink in Paper) is already "From theme" */}
        {ACCENT_SWATCHES.filter((s) => value === s.id || s[t.scheme].toLowerCase() !== familyAccent.toLowerCase()).map((s) =>
          swatch(s.id, s[t.scheme], value === s.id, tr(`settings.look.swatches.${s.id}`), () => {
            setCustomOpen(false);
            onChange(s.id);
          }),
        )}
        {isCustom
          ? swatch('custom', t.colors.accent, true, tr('settings.look.accentCustom'), () => setCustomOpen((o) => !o))
          : swatch('custom', t.colors.surfaceAlt, false, tr('settings.look.accentCustom'), () => setCustomOpen((o) => !o), 'plus')}
      </View>
      <View style={styles.swatchLabelRow}>
        <Text style={[textStyle(t, 'caption'), { color: t.colors.muted }]} numberOfLines={1}>
          {value === 'theme' ? tr('settings.look.accentTheme') : value === 'system' ? tr('desktop.accentSystem') : isCustom ? `${tr('settings.look.accentCustom')} · ${value.toUpperCase()}` : tr(`settings.look.swatches.${value as (typeof ACCENT_SWATCHES)[number]['id']}`)}
        </Text>
      </View>
      {customOpen ? (
        <View style={[styles.customBox, { borderTopColor: t.colors.border }]}>
          <Field
            label={tr('settings.look.accentHex')}
            value={draft}
            onChangeText={setDraft}
            placeholder={tr('settings.look.accentHexPh')}
            autoCapitalize="characters"
            maxLength={7}
            last
            trailing={check?.ok ? <View style={[styles.customDot, { backgroundColor: check.hex, borderColor: t.colors.borderControl }]} /> : null}
            hint={
              draft && check && !check.ok
                ? tr('settings.look.accentInvalid')
                : check?.ok
                  ? accentNote(tr, check)
                  : shownCheck?.ok
                    ? accentNote(tr, shownCheck)
                    : undefined
            }
          />
          <View style={styles.customBtn}>
            <Button kind="secondary" grow label={tr('settings.look.accentApply')} disabled={!check?.ok} onPress={() => check?.ok && onChange(check.hex)} />
          </View>
        </View>
      ) : null}
    </Group>
  );
}

function accentNote(tr: ReturnType<typeof useT>, c: Extract<ReturnType<typeof checkCustomAccent>, { ok: true }>): string {
  const vars = { light: c.ratio.light.toFixed(1), dark: c.ratio.dark.toFixed(1) };
  const adjusted = c.adjusted.light !== c.hex || c.adjusted.dark !== c.hex;
  return adjusted ? tr('settings.look.accentAdjusted', vars) : tr('settings.look.accentOk', vars);
}

// ---------------------------------------------------------------- live preview

export function LivePreview({ bubbleStyle }: { bubbleStyle: BubbleStylePref }) {
  const t = useTheme();
  const tr = useT();
  const c = t.colors;
  const body = textStyle(t, 'reading');
  const user = textStyle(t, 'body');
  const small = textStyle(t, 'caption');
  const plain = bubbleStyle === 'plain';
  return (
    <View
      style={[styles.preview, { backgroundColor: c.bg, borderColor: c.border, borderRadius: t.radii.card, padding: t.spacing.l, gap: t.spacing.m }]}
      accessibilityLabel={tr('settings.look.preview')}
    >
      <View style={{ alignItems: 'flex-end' }}>
        <View style={plain ? [styles.pvPlain, { borderRightColor: c.accent }] : [styles.pvBubble, { backgroundColor: c.surfaceAlt, borderRadius: t.radii.card }]}>
          <Text style={[user, { color: c.text, textAlign: plain ? 'right' : 'left' }]}>{tr('settings.look.previewUser')}</Text>
        </View>
      </View>
      <Text style={[body, { color: c.text }]}>{tr('settings.look.previewAnswer')}</Text>
      <View style={[styles.pvCard, { backgroundColor: c.surface, borderColor: c.border, borderRadius: t.radii.control, padding: t.spacing.m }]}>
        <View style={styles.pvBars}>
          {c.chart.map((col, i) => (
            <View key={col} style={[styles.pvBar, { backgroundColor: col, height: 14 + ((i * 7) % 26) }]} />
          ))}
        </View>
        {/* no code snippet: the preview shows what an everyday chat looks like (design review P1-6) */}
      </View>
      <View style={styles.pvActions}>
        <View style={[styles.pvBtn, { backgroundColor: c.ink, borderRadius: t.radii.control }]}>
          <Text style={[small, { color: c.onInk, fontWeight: '600' }]}>{tr('settings.look.previewButton')}</Text>
        </View>
        <View style={[styles.pvChip, { backgroundColor: c.accentSoft, borderRadius: t.radii.inline }]}>
          <Text style={[small, { color: c.accentText, fontWeight: '500' }]} numberOfLines={1}>
            {tr('settings.look.previewChip')}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  card: { flexBasis: '31%', flexGrow: 1, maxWidth: '33%', minWidth: 96, borderWidth: StyleSheet.hairlineWidth, padding: 6, gap: 5 },
  cardSel: { borderWidth: 2, padding: 5 },
  cardFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4, paddingHorizontal: 2 },
  cardName: { flexShrink: 1 },
  cardSub: { paddingHorizontal: 2, marginTop: -3 },
  mini: { height: 66, borderWidth: StyleSheet.hairlineWidth, padding: 7, gap: 4, overflow: 'hidden' },
  miniBubble: { alignSelf: 'flex-end', width: '46%', height: 9, borderRadius: 5 },
  miniLine: { height: 4, borderRadius: 2 },
  miniRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, marginTop: 'auto' },
  miniBtn: { width: 22, height: 9, borderRadius: 5, marginRight: 'auto' },
  miniBar: { width: 5, borderRadius: 1.5 },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 10, paddingTop: 12 },
  swatchRing: { borderWidth: 2, borderRadius: 21, padding: 2 },
  swatch: { width: 32, height: 32, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  swatchLabelRow: { paddingHorizontal: 14, paddingTop: 6, paddingBottom: 12 },
    customBox: { borderTopWidth: StyleSheet.hairlineWidth, paddingBottom: 12 },
  customBtn: { flexDirection: 'row', paddingHorizontal: 14, paddingTop: 4 },
  customDot: { width: 22, height: 22, borderRadius: 11, borderWidth: StyleSheet.hairlineWidth },
  preview: { borderWidth: StyleSheet.hairlineWidth },
  pvBubble: { paddingHorizontal: 14, paddingVertical: 8, maxWidth: '85%' },
  pvPlain: { borderRightWidth: 2, paddingRight: 10, paddingVertical: 2, maxWidth: '85%' },
  pvCard: { borderWidth: StyleSheet.hairlineWidth, gap: 10 },
  pvBars: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 40 },
  pvBar: { flex: 1, borderRadius: 3 },
  gridWrap: { gap: 6 },
  moreBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', minHeight: 44, paddingHorizontal: 4 },
  pvActions: { flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  pvBtn: { paddingHorizontal: 14, paddingVertical: 7 },
  pvChip: { paddingHorizontal: 12, paddingVertical: 7, flexShrink: 1 },
});
