import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, TextInput, View, type GestureResponderEvent } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useTheme, type Theme } from '../theme';
import { useHui, type HuiFieldValue } from '../primitives/context';
import { BlockTitle, HText, PressableScale, Surface, textStyle } from '../primitives/basics';
import { Icon } from '../primitives/Icon';
import { Skeleton } from '../primitives/Skeleton';
import { haptic } from '../primitives/haptics';
import { FormSkeleton } from '../skeletons';
import { useLocale, useT } from '../../i18n';
import { asArray, asNumber, asObjects, asOptString, asString, clamp, formatNumber, snap } from '../lib/format';
import { sliderWebProps } from '../lib/sliderKeys';
import type { HuiField, HuiFieldKind, HuiForm } from '../types';
import type { NodeProps } from './content';
import { useNodeState } from '../../nodestate';
import { useModuleId } from './modules/a/shared';
import { FORM_STATE_VERSION, INITIAL_FORM_STATE, asFormState, formFieldValue, reopenedFormState, submitValues, submittedFormState, uniqueFields, type FormNodeState } from './formState.ts';

const KINDS: HuiFieldKind[] = ['text', 'number', 'slider', 'select', 'toggle', 'date'];

type Field = HuiField;

function readField(o: Record<string, unknown>): Field | null {
  const name = asString(o.name);
  if (!name) return null;
  const kind = KINDS.includes(o.kind as HuiFieldKind) ? (o.kind as HuiFieldKind) : null;
  if (!kind) return null;
  return {
    name,
    kind,
    label: asString(o.label, name),
    placeholder: asOptString(o.placeholder),
    min: asNumber(o.min),
    max: asNumber(o.max),
    step: asNumber(o.step),
    unit: asOptString(o.unit),
    options: asArray(o.options).map((x) => asString(x)).filter(Boolean),
    default: typeof o.default === 'string' || typeof o.default === 'number' || typeof o.default === 'boolean' ? o.default : undefined,
  };
}

function initialValue(f: Field): HuiFieldValue {
  const d = f.default;
  switch (f.kind) {
    case 'toggle':
      return d === true || d === 'true';
    case 'number':
      return asNumber(d) ?? null;
    case 'slider': {
      const min = f.min ?? 0;
      const max = f.max ?? 100;
      return clamp(asNumber(d) ?? min, min, max);
    }
    case 'select':
      return typeof d === 'string' && f.options?.includes(d) ? d : null;
    case 'date':
      return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null;
    default:
      return d === undefined ? '' : String(d);
  }
}

/**
 * Form. On submit calls
 *   onAction({ type: 'submit' }, values, { formId: node.id, nodeId: node.id })
 * with `values: Record<fieldName, string | number | boolean | null>`
 * (text → string, number/slider → number|null, select → string|null, toggle → boolean, date → 'YYYY-MM-DD'|null).
 */
export function Form({ node }: NodeProps<HuiForm>) {
  const tr = useT();
  const t = useTheme();
  const { onAction, streaming } = useHui();
  const fields = useMemo(() => uniqueFields(asObjects(node.fields).map(readField).filter((f): f is Field => !!f)), [node.fields]);
  const rawCount = asArray(node.fields).length;
  // submitted values + "sent" persist via nodestate (locked view survives reload / scrolling away)
  const nodeId = useModuleId('form', node as unknown as Record<string, unknown>);
  const [stored, setStored] = useNodeState<FormNodeState>(nodeId, INITIAL_FORM_STATE, { version: FORM_STATE_VERSION });
  const st = asFormState(stored);
  const sent = st.sent;
  const [edits, setEdits] = useState<Record<string, HuiFieldValue>>({});
  if (!fields.length && !node.title) return streaming ? <FormSkeleton /> : null;

  const valueOf = (f: Field) => formFieldValue(f.name, edits, st, () => initialValue(f));
  // a sent form is locked for every input path (pointer, keyboard, assistive actions), not only by pointerEvents
  const set = (name: string, v: HuiFieldValue) => {
    if (!sent) setEdits((s) => ({ ...s, [name]: v }));
  };
  const submitLabel = node.submit && typeof node.submit === 'object' ? asString((node.submit as { label?: unknown }).label) : '';
  const formId = asString(node.id);

  const submit = () => {
    const out = submitValues(fields, (i) => {
      const f = fields[i];
      let v = valueOf(f);
      if (f.kind === 'number' && typeof v === 'number') v = clamp(v, f.min ?? -Infinity, f.max ?? Infinity);
      if (f.kind === 'text' && typeof v === 'string') v = v.trim();
      return v;
    });
    const markSent = () => {
      haptic('success');
      setStored(submittedFormState(out));
      setEdits({});
    };
    // refused while a turn is running → the form stays editable; waiting for the confirmation sheet → `onSent`
    // locks it once the sheet really sent it (no accidental second submit)
    if (onAction({ type: 'submit' }, out, { formId, nodeId: formId || undefined, onSent: markSent }) === false) return;
    markSent();
  };

  return (
    <Surface style={{ gap: t.spacing.l }}>
      <BlockTitle title={asOptString(node.title)} />
      <View style={{ gap: t.spacing.l, marginTop: node.title ? -t.spacing.s : 0 }} pointerEvents={sent ? 'none' : 'auto'}>
        {fields.map((f) => (
          <FieldRow key={f.name} t={t} field={f} value={valueOf(f)} onChange={(v) => set(f.name, v)} disabled={sent} />
        ))}
        {streaming && rawCount >= fields.length ? (
          <View style={{ gap: 8 }}>
            <Skeleton width="30%" height={10} />
            <Skeleton height={42} radius={t.radii.m} />
          </View>
        ) : null}
      </View>
      {sent ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.s }}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 44, borderRadius: t.radii.pill, backgroundColor: t.colors.successSoft }}>
            <Icon name="check" size={16} color={t.colors.success} strokeWidth={2.25} />
            <HText variant="callout" weight="600" style={{ color: t.colors.success }}>
              {tr('ui.form.sent')}
            </HText>
          </View>
          <PressableScale haptic="selection" onPress={() => setStored((s) => reopenedFormState(asFormState(s)))} style={{ height: 44, paddingHorizontal: t.spacing.l, justifyContent: 'center', borderRadius: t.radii.pill }}>
            <HText variant="callout" color="muted" weight="500">
              {tr('ui.form.change')}
            </HText>
          </PressableScale>
        </View>
      ) : (
        <PressableScale
          haptic={false}
          disabled={streaming || !fields.length}
          onPress={submit}
          style={{ height: 44, borderRadius: t.radii.pill, backgroundColor: t.colors.accent, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 }}
          pressedStyle={{ opacity: 0.88 }}
        >
          <HText variant="callout" weight="600" style={{ color: t.colors.onAccent }}>
            {submitLabel || tr('ui.form.submit')}
          </HText>
        </PressableScale>
      )}
    </Surface>
  );
}

/* ───────────── field row ───────────── */

function FieldRow({ t, field, value, onChange, disabled }: { t: Theme; field: Field; value: HuiFieldValue; onChange: (v: HuiFieldValue) => void; disabled: boolean }) {
  const { lang } = useLocale();
  const change = (v: HuiFieldValue) => {
    if (!disabled) onChange(v);
  };
  if (field.kind === 'toggle') {
    return (
      <PressableScale haptic="selection" scaleTo={1} disabled={disabled} onPress={() => change(!value)} accessibilityRole="switch" accessibilityState={{ checked: !!value, disabled }} style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.m, minHeight: 32 }}>
        <HText variant="body" style={{ flex: 1 }}>
          {field.label}
        </HText>
        <Switch t={t} on={!!value} />
      </PressableScale>
    );
  }
  const right =
    field.kind === 'slider' ? (
      <HText variant="callout" weight="600" tabular color="accent">
        {formatNumber(typeof value === 'number' ? value : 0, 2, lang)}
        {field.unit ? ` ${field.unit}` : ''}
      </HText>
    ) : null;
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
        <HText variant="caption" color="muted" weight="500" style={{ flex: 1 }}>
          {field.label}
        </HText>
        {right}
      </View>
      {field.kind === 'slider' ? (
        <Slider t={t} field={field} value={typeof value === 'number' ? value : field.min ?? 0} onChange={change} disabled={disabled} />
      ) : field.kind === 'select' ? (
        <Select t={t} field={field} value={typeof value === 'string' ? value : null} onChange={change} disabled={disabled} />
      ) : field.kind === 'date' ? (
        <DateField t={t} value={typeof value === 'string' ? value : null} onChange={change} placeholder={field.placeholder} label={field.label} disabled={disabled} />
      ) : field.kind === 'number' ? (
        <NumberInput t={t} field={field} value={typeof value === 'number' ? value : null} onChange={change} disabled={disabled} />
      ) : (
        <Input t={t} value={typeof value === 'string' ? value : ''} placeholder={field.placeholder} onChangeText={change} editable={!disabled} label={field.label} />
      )}
    </View>
  );
}

function Input({ t, value, onChangeText, placeholder, numeric, editable = true, suffix, label }: { t: Theme; value: string; onChangeText: (s: string) => void; placeholder?: string; numeric?: boolean; editable?: boolean; suffix?: string; label?: string }) {
  const [focus, setFocus] = useState(false);
  return (
    <View
      style={{
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 44,
        borderRadius: t.radii.m,
        borderWidth: 1,
        borderColor: focus ? t.colors.accent : t.colors.borderStrong,
        backgroundColor: t.colors.surface,
        paddingHorizontal: t.spacing.m,
      }}
    >
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={t.colors.subtle}
        keyboardType={numeric ? 'decimal-pad' : 'default'}
        editable={editable}
        accessibilityLabel={label}
        aria-label={label}
        accessibilityState={{ disabled: !editable }}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        style={[textStyle(t, 'body'), { flex: 1, color: t.colors.text, paddingVertical: 10, outlineStyle: 'none' } as object]}
      />
      {suffix ? (
        <HText variant="callout" color="muted">
          {suffix}
        </HText>
      ) : null}
    </View>
  );
}

function NumberInput({ t, field, value, onChange, disabled = false }: { t: Theme; field: Field; value: number | null; onChange: (v: HuiFieldValue) => void; disabled?: boolean }) {
  const tr = useT();
  const [text, setText] = useState(value === null ? '' : String(value).replace('.', ','));
  useEffect(() => {
    const parsed = asNumber(text);
    if (value !== (parsed ?? null)) setText(value === null ? '' : String(value).replace('.', ','));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const step = field.step ?? 1;
  const bump = (dir: 1 | -1) => {
    const next = clamp((value ?? field.min ?? 0) + dir * step, field.min ?? -Infinity, field.max ?? Infinity);
    onChange(Number(next.toFixed(6)));
  };
  const btn = (dir: 1 | -1) => (
    <PressableScale haptic="selection" disabled={disabled} onPress={() => bump(dir)} accessibilityLabel={`${dir === 1 ? tr('ui.form.increase') : tr('ui.form.decrease')}: ${field.label}`} accessibilityState={{ disabled }} style={{ width: 44, height: 44, borderRadius: t.radii.m, backgroundColor: t.colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }} pressedStyle={{ backgroundColor: t.colors.surfacePressed }}>
      <Icon name={dir === 1 ? 'plus' : 'minus'} size={16} color={t.colors.text} />
    </PressableScale>
  );
  return (
    <View style={{ flexDirection: 'row', gap: t.spacing.s }}>
      {btn(-1)}
      <Input
        t={t}
        numeric
        value={text}
        placeholder={field.placeholder}
        suffix={field.unit}
        label={field.label}
        editable={!disabled}
        onChangeText={(s) => {
          setText(s);
          onChange(asNumber(s) ?? null);
        }}
      />
      {btn(1)}
    </View>
  );
}

function Slider({ t, field, value, onChange, disabled = false }: { t: Theme; field: Field; value: number; onChange: (v: HuiFieldValue) => void; disabled?: boolean }) {
  const { lang } = useLocale();
  const min = field.min ?? 0;
  const max = field.max ?? 100;
  const step = field.step ?? ((max - min) / 100 >= 1 ? 1 : (max - min) / 100);
  const [w, setW] = useState(0);
  const last = useRef(value);
  const ratio = max > min ? clamp((value - min) / (max - min), 0, 1) : 0;
  const THUMB = 24;
  const set = (e: GestureResponderEvent) => {
    if (w <= 0 || disabled) return;
    const r = clamp((e.nativeEvent.locationX - THUMB / 2) / (w - THUMB), 0, 1);
    const v = clamp(snap(min + r * (max - min), min, step), min, max);
    if (v !== last.current) {
      last.current = v;
      haptic('selection');
      onChange(v);
    }
  };
  useEffect(() => {
    last.current = value;
  }, [value]);
  const fmt = (v: number) => formatNumber(v, 2, lang) + (field.unit ? ` ${field.unit}` : '');
  const web = Platform.OS === 'web' && !disabled ? sliderWebProps({ value, range: { min, max, step }, label: field.label, text: fmt(value), onChange }) : null;
  return (
    <View>
      <View
        {...web}
        {...(Platform.OS === 'web' && disabled ? { 'aria-disabled': true } : null)}
        onLayout={(e) => setW(e.nativeEvent.layout.width)}
        style={{ height: 36, justifyContent: 'center' }}
        onStartShouldSetResponder={() => !disabled}
        onMoveShouldSetResponder={() => !disabled}
        onResponderTerminationRequest={() => false}
        onResponderGrant={set}
        onResponderMove={set}
        accessibilityRole="adjustable"
        accessibilityLabel={field.label}
        accessibilityValue={{ min, max, now: value, text: fmt(value) }}
        accessibilityState={{ disabled }}
        accessibilityActions={disabled ? [] : [{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => !disabled && onChange(clamp(snap(value + (e.nativeEvent.actionName === 'increment' ? step : -step), min, step), min, max))}
      >
        <View pointerEvents="none" style={{ marginHorizontal: THUMB / 2, height: 4, borderRadius: 2, backgroundColor: t.colors.surfaceAlt }}>
          <View style={{ width: `${ratio * 100}%`, height: 4, borderRadius: 2, backgroundColor: t.colors.accent }} />
        </View>
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: ratio * Math.max(0, w - THUMB),
            width: THUMB,
            height: THUMB,
            borderRadius: THUMB / 2,
            backgroundColor: '#FFFFFF',
            borderWidth: t.dark ? 0 : 1,
            borderColor: t.colors.border,
            ...t.shadows.md,
          }}
        />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <HText variant="micro" color="subtle" tabular>
          {fmt(min)}
        </HText>
        <HText variant="micro" color="subtle" tabular>
          {fmt(max)}
        </HText>
      </View>
    </View>
  );
}

function Switch({ t, on }: { t: Theme; on: boolean }) {
  const p = useSharedValue(on ? 1 : 0);
  useEffect(() => {
    p.value = withTiming(on ? 1 : 0, { duration: 180 });
  }, [on, p]);
  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: p.value * 18 }] }));
  return (
    <View style={{ width: 46, height: 28, borderRadius: 14, padding: 3, backgroundColor: on ? t.colors.accent : t.colors.borderStrong }}>
      <Animated.View style={[{ width: 22, height: 22, borderRadius: 11, backgroundColor: '#FFFFFF', ...t.shadows.sm }, thumb]} />
    </View>
  );
}

function Select({ t, field, value, onChange, disabled = false }: { t: Theme; field: Field; value: string | null; onChange: (v: HuiFieldValue) => void; disabled?: boolean }) {
  const tr = useT();
  const opts = field.options ?? [];
  const [open, setOpen] = useState(false);
  const longest = Math.max(0, ...opts.map((o) => o.length));
  // 360px screen ≈ 300px usable → per-segment budget shrinks with count
  const segmented = opts.length > 0 && opts.length <= 4 && longest <= (opts.length <= 2 ? 16 : opts.length === 3 ? 10 : 7);
  const chips = !segmented && opts.length > 0 && opts.length <= 6;
  if (chips) {
    return (
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.s }}>
        {opts.map((o) => {
          const active = o === value;
          return (
            <PressableScale
              disabled={disabled}
              key={o}
              haptic="selection"
              onPress={() => onChange(o)}
              accessibilityRole="radio"
              accessibilityState={{ selected: active, disabled }}
              style={{ minHeight: 36, paddingHorizontal: 14, justifyContent: 'center', borderRadius: t.radii.pill, borderWidth: 1, borderColor: active ? t.colors.accent : t.colors.borderStrong, backgroundColor: active ? t.colors.accentSoft : t.colors.surface }}
            >
              <HText variant="callout" weight={active ? '600' : '400'} style={{ color: active ? t.colors.accent : t.colors.text }} numberOfLines={1}>
                {o}
              </HText>
            </PressableScale>
          );
        })}
      </View>
    );
  }
  if (segmented) {
    return (
      <View style={{ flexDirection: 'row', backgroundColor: t.colors.surfaceAlt, borderRadius: t.radii.m, padding: 3, gap: 3 }}>
        {opts.map((o) => {
          const active = o === value;
          return (
            <PressableScale
              disabled={disabled}
              key={o}
              haptic="selection"
              scaleTo={0.98}
              onPress={() => onChange(o)}
              accessibilityRole="radio"
              accessibilityState={{ selected: active, disabled }}
              style={{ flex: 1, minHeight: 36, borderRadius: t.radii.s, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, backgroundColor: active ? t.colors.surface : 'transparent', ...(active ? t.shadows.sm : {}) }}
            >
              <HText variant="callout" weight={active ? '600' : '400'} color={active ? 'text' : 'muted'} numberOfLines={1}>
                {o}
              </HText>
            </PressableScale>
          );
        })}
      </View>
    );
  }
  return (
    <View style={{ borderRadius: t.radii.m, borderWidth: 1, borderColor: open ? t.colors.accent : t.colors.borderStrong, overflow: 'hidden', backgroundColor: t.colors.surface }}>
      <PressableScale haptic="selection" scaleTo={1} disabled={disabled} accessibilityLabel={field.label} accessibilityState={{ disabled, expanded: open }} onPress={() => setOpen((x) => !x)} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingHorizontal: t.spacing.m }}>
        <HText variant="body" color={value ? 'text' : 'subtle'} style={{ flex: 1 }} numberOfLines={1}>
          {value ?? field.placeholder ?? tr('ui.form.choose')}
        </HText>
        <View style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}>
          <Icon name="chevronDown" size={16} color={t.colors.muted} />
        </View>
      </PressableScale>
      {open
        ? opts.map((o) => {
            const active = o === value;
            return (
              <PressableScale
                disabled={disabled}
                key={o}
                haptic="selection"
                scaleTo={1}
                onPress={() => {
                  onChange(o);
                  setOpen(false);
                }}
                accessibilityRole="radio"
                accessibilityState={{ selected: active, disabled }}
                style={{ flexDirection: 'row', alignItems: 'center', minHeight: 42, paddingHorizontal: t.spacing.m, borderTopWidth: 1, borderColor: t.colors.border }}
                pressedStyle={{ backgroundColor: t.colors.surfaceAlt }}
              >
                <HText variant="body" style={{ flex: 1 }} weight={active ? '600' : '400'} numberOfLines={2}>
                  {o}
                </HText>
                {active ? <Icon name="check" size={16} color={t.colors.accent} strokeWidth={2.25} /> : null}
              </PressableScale>
            );
          })
        : null}
    </View>
  );
}

/* ───────────── date ───────────── */

/** Month / weekday names from Intl for the active locale (weekdays Monday-first; 2024-01-01 is a Monday). */
function calendarNames(locale: string) {
  const month = new Intl.DateTimeFormat(locale, { month: 'long' });
  const wd = new Intl.DateTimeFormat(locale, { weekday: 'short' });
  return {
    months: Array.from({ length: 12 }, (_, i) => month.format(new Date(2024, i, 15))),
    weekdays: Array.from({ length: 7 }, (_, i) => wd.format(new Date(2024, 0, 1 + i)).replace(/\.$/, '')),
  };
}

function pad(n: number) {
  return n < 10 ? '0' + n : String(n);
}
function iso(y: number, m: number, d: number) {
  return `${y}-${pad(m + 1)}-${pad(d)}`;
}
function parseIso(s: string | null): { y: number; m: number; d: number } | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? { y: +m[1], m: +m[2] - 1, d: +m[3] } : null;
}

function DateField({ t, value, onChange, placeholder, label: fieldLabel, disabled = false }: { t: Theme; value: string | null; onChange: (v: HuiFieldValue) => void; placeholder?: string; label?: string; disabled?: boolean }) {
  const { locale, formatDate } = useLocale();
  const tr = useT();
  const sel = parseIso(value);
  const today = new Date();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState({ y: sel?.y ?? today.getFullYear(), m: sel?.m ?? today.getMonth() });
  const first = new Date(view.y, view.m, 1);
  const offset = (first.getDay() + 6) % 7; // Monday-first
  const days = new Date(view.y, view.m + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(offset).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const shift = (d: number) => setView((v) => {
    const m = v.m + d;
    return { y: v.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 };
  });
  const label = sel ? formatDate(new Date(sel.y, sel.m, sel.d), { dateStyle: 'medium' }) : placeholder ?? tr('ui.form.chooseDate');
  const { months: MONTHS, weekdays: WEEKDAYS } = useMemo(() => calendarNames(locale), [locale]);
  return (
    <View style={{ borderRadius: t.radii.m, borderWidth: 1, borderColor: open ? t.colors.accent : t.colors.borderStrong, backgroundColor: t.colors.surface, overflow: 'hidden' }}>
      <PressableScale haptic="selection" scaleTo={1} disabled={disabled} accessibilityLabel={fieldLabel ? `${fieldLabel}: ${label}` : label} accessibilityState={{ disabled, expanded: open }} onPress={() => setOpen((x) => !x)} style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.s, minHeight: 44, paddingHorizontal: t.spacing.m }}>
        <Icon name="calendar" size={17} color={t.colors.muted} />
        <HText variant="body" color={sel ? 'text' : 'subtle'} style={{ flex: 1 }}>
          {label}
        </HText>
        <View style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}>
          <Icon name="chevronDown" size={16} color={t.colors.muted} />
        </View>
      </PressableScale>
      {open ? (
        <View style={{ borderTopWidth: 1, borderColor: t.colors.border, padding: t.spacing.s }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
            <PressableScale haptic="selection" onPress={() => shift(-1)} accessibilityLabel={tr('ui.form.prevMonth')} style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="chevronLeft" size={18} color={t.colors.text} />
            </PressableScale>
            <HText variant="bodyStrong" align="center" style={{ flex: 1 }}>
              {MONTHS[view.m]} {view.y}
            </HText>
            <PressableScale haptic="selection" onPress={() => shift(1)} accessibilityLabel={tr('ui.form.nextMonth')} style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="chevronRight" size={18} color={t.colors.text} />
            </PressableScale>
          </View>
          <View style={{ flexDirection: 'row' }}>
            {WEEKDAYS.map((w) => (
              <HText key={w} variant="micro" color="subtle" align="center" style={{ flex: 1, paddingVertical: 4 }}>
                {w}
              </HText>
            ))}
          </View>
          {Array.from({ length: cells.length / 7 }, (_, r) => (
            <View key={r} style={{ flexDirection: 'row' }}>
              {cells.slice(r * 7, r * 7 + 7).map((d, i) => {
                if (d === null) return <View key={i} style={{ flex: 1, height: 38 }} />;
                const active = sel && sel.y === view.y && sel.m === view.m && sel.d === d;
                const isToday = today.getFullYear() === view.y && today.getMonth() === view.m && today.getDate() === d;
                return (
                  <PressableScale
                    key={i}
                    haptic="selection"
                    onPress={() => {
                      onChange(iso(view.y, view.m, d));
                      setOpen(false);
                    }}
                    accessibilityLabel={formatDate(new Date(view.y, view.m, d), { dateStyle: 'long' })}
                    style={{ flex: 1, height: 38, alignItems: 'center', justifyContent: 'center' }}
                  >
                    <View style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? t.colors.accent : 'transparent', borderWidth: isToday && !active ? 1 : 0, borderColor: t.colors.accent }}>
                      <HText variant="callout" tabular weight={active || isToday ? '600' : '400'} style={{ color: active ? t.colors.onAccent : isToday ? t.colors.accent : t.colors.text }}>
                        {d}
                      </HText>
                    </View>
                  </PressableScale>
                );
              })}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}
