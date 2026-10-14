/**
 * Compact command list above the composer while the input starts with "/". Web: ↑/↓ move, Enter runs,
 * Tab completes, Esc closes (keys come from the composer's TextInput via the imperative `onKey`).
 * Native: tap a row.
 */
import { forwardRef, memo, useImperativeHandle, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useT, type TKey } from '../../i18n';
import { useTheme } from '../../ui';
import type { SlashBinding } from './binding';
import type { PaletteRow, PaletteState } from './palette';
import { useKeyboardHints } from '../../ui/lib/useKeyboardHints';

export type SlashPaletteHandle = {
  /** web key from the composer input; true = handled (caller prevents the default) */
  onKey(key: string, mods: { shift?: boolean; composing?: boolean }): boolean;
};

type Props = {
  state: PaletteState;
  binding: SlashBinding;
  onPick(row: PaletteRow): void;
  onComplete(row: PaletteRow): void;
  onDismiss(): void;
};

const rowKey = (r: PaletteRow) => (r.kind === 'command' ? r.def.id : 'raw');

export const SlashPalette = memo(forwardRef<SlashPaletteHandle, Props>(function SlashPalette({ state, binding, onPick, onComplete, onDismiss }, ref) {
  const t = useTheme();
  const tr = useT();
  const keyboardHints = useKeyboardHints(); // ↑↓/Enter/Esc line: desktop web only, never the phone layout
  const rows = state.rows;
  const sig = rows.map(rowKey).join(',');
  // highlight resets to the first row whenever the row set changes
  const [hl, setHl] = useState<{ sig: string; i: number }>({ sig, i: 0 });
  const index = hl.sig === sig ? Math.min(hl.i, rows.length - 1) : 0;
  const scroll = useRef<ScrollView>(null);

  useImperativeHandle(
    ref,
    () => ({
      onKey(key, mods) {
        if (mods.composing || !rows.length) return key === 'Escape' ? (onDismiss(), true) : false;
        switch (key) {
          case 'ArrowDown':
          case 'ArrowUp': {
            const n = (index + (key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
            setHl({ sig, i: n });
            scroll.current?.scrollTo({ y: Math.max(0, n * ROW_H - ROW_H * 2), animated: false });
            return true;
          }
          case 'Enter':
            if (mods.shift) return false;
            onPick(rows[index]);
            return true;
          case 'Tab':
            onComplete(rows[index]);
            return true;
          case 'Escape':
            onDismiss();
            return true;
          default:
            return false;
        }
      },
    }),
    [rows, index, sig, onPick, onComplete, onDismiss],
  );

  return (
    <View
      style={[styles.box, { backgroundColor: t.dark ? t.colors.surface : t.colors.bg, borderColor: t.colors.border }, !t.dark && t.shadows.sm]}
      accessibilityLabel={tr('slash.palette.a11y')}
      accessibilityRole="menu"
    >
      <ScrollView ref={scroll} keyboardShouldPersistTaps="always" style={styles.scroll} nestedScrollEnabled>
        {rows.map((row, i) => (
          <Row key={rowKey(row)} row={row} active={i === index} binding={binding} onPress={() => onPick(row)} onHover={() => setHl({ sig, i })} />
        ))}
      </ScrollView>
      {keyboardHints ? <Text style={[styles.keys, { color: t.colors.subtle, borderTopColor: t.colors.border }]}>{tr('slash.palette.keys')}</Text> : null}
    </View>
  );
}));

const ROW_H = 44;

function Row({ row, active, binding, onPress, onHover }: { row: PaletteRow; active: boolean; binding: SlashBinding; onPress(): void; onHover(): void }) {
  const t = useTheme();
  const tr = useT();
  const mono = { fontFamily: t.fonts.mono };
  if (row.kind === 'sendRaw') {
    return (
      <Pressable
        onPress={onPress}
        onHoverIn={onHover}
        accessibilityRole="menuitem"
        accessibilityLabel={tr('slash.palette.sendRaw')}
        style={({ pressed }) => [styles.row, (active || pressed) && { backgroundColor: t.colors.surfacePressed }]}
      >
        <Text style={[styles.name, { color: t.colors.accent }]}>{tr('slash.palette.sendRaw')}</Text>
        <Text style={[styles.desc, { color: t.colors.muted }]} numberOfLines={1}>
          {tr('slash.palette.sendRawHint', { name: binding.backendName })}
        </Text>
      </Pressable>
    );
  }
  const { def, via } = row;
  const av = binding.availability(def.id);
  const enabled = av.visible && av.enabled;
  const arg = tr(`slash.cmd.${def.id}.arg` as TKey);
  const desc = enabled ? tr(`slash.cmd.${def.id}.desc` as TKey) : tr(`slash.reason.${(av as { reason: string }).reason}` as TKey);
  return (
    <Pressable
      onPress={onPress}
      onHoverIn={onHover}
      accessibilityRole="menuitem"
      accessibilityState={{ disabled: !enabled, selected: active }}
      accessibilityLabel={`/${def.name} ${desc}`}
      style={({ pressed }) => [styles.row, (active || pressed) && { backgroundColor: t.colors.surfacePressed }, !enabled && styles.disabled]}
    >
      <View style={styles.head}>
        <Text style={[styles.name, mono, { color: t.colors.text }]}>/{def.name}</Text>
        {arg ? <Text style={[styles.arg, mono, { color: t.colors.subtle }]} numberOfLines={1}>{arg}</Text> : null}
        {via ? <Text style={[styles.via, { color: t.colors.subtle }]}>{tr('slash.palette.via', { alias: via })}</Text> : null}
      </View>
      <Text style={[styles.desc, { color: t.colors.muted }]} numberOfLines={1}>
        {desc}
        {enabled && def.sendsText ? ` · ${tr('slash.palette.sendsText')}` : ''}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, marginBottom: 6, overflow: 'hidden', maxWidth: 720, width: '100%', alignSelf: 'center' },
  scroll: { maxHeight: ROW_H * 6.5 },
  row: { minHeight: ROW_H, paddingHorizontal: 14, paddingVertical: 6, justifyContent: 'center' },
  disabled: { opacity: 0.5 },
  head: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  name: { fontSize: 14.5, fontWeight: '600' },
  arg: { fontSize: 12.5, flexShrink: 1 },
  via: { fontSize: 12, marginLeft: 'auto' },
  desc: { fontSize: 12.5, marginTop: 1 },
  keys: { fontSize: 11, paddingHorizontal: 14, paddingVertical: 5, borderTopWidth: StyleSheet.hairlineWidth },
});
