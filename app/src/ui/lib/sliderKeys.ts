/**
 * Keyboard + web ARIA support shared by every slider (decision weights, calc, scale, form).
 * Pure so it can be unit tested; callers spread `sliderWebProps(...)` on web only.
 *
 * Keys: arrows +-step, PageUp/PageDown a larger jump (at least 2 steps, about a tenth of the
 * range), Home/End jump to min/max.
 */

export type SliderRange = { min: number; max: number; step: number };

function snapTo(v: number, { min, step }: SliderRange): number {
  if (!(step > 0)) return v;
  const n = Math.round((v - min) / step) * step + min;
  const decimals = Math.min(10, (String(step).split('.')[1] ?? '').length + (String(min).split('.')[1] ?? '').length);
  return Number(n.toFixed(decimals));
}

/** Larger keyboard jump for PageUp/PageDown. */
export function pageStep({ min, max, step }: SliderRange): number {
  const tenth = Math.round((max - min) / 10 / step) * step;
  return Math.max(2 * step, tenth);
}

/** New value for a key press, or null when the key is not a slider key or nothing would change. */
export function sliderKeyTarget(key: string, value: number, r: SliderRange): number | null {
  const step = r.step > 0 ? r.step : 1;
  let next: number;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowUp':
      next = value + step;
      break;
    case 'ArrowLeft':
    case 'ArrowDown':
      next = value - step;
      break;
    case 'PageUp':
      next = value + pageStep({ ...r, step });
      break;
    case 'PageDown':
      next = value - pageStep({ ...r, step });
      break;
    case 'Home':
      next = r.min;
      break;
    case 'End':
      next = r.max;
      break;
    default:
      return null;
  }
  const out = Math.min(r.max, Math.max(r.min, snapTo(next, { ...r, step })));
  return out === value ? null : out;
}

type KeyEvent = { key?: string; preventDefault?: () => void; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean };

/**
 * Web-only props: focusable, `role="slider"` with aria-valuenow/min/max/text and a keydown handler.
 * (On native, `accessibilityRole="adjustable"` + accessibilityActions already cover this.)
 */
export function sliderWebProps(o: { value: number; range: SliderRange; label: string; text?: string; disabled?: boolean; onChange: (v: number) => void }): Record<string, unknown> {
  return {
    role: 'slider',
    tabIndex: o.disabled ? -1 : 0,
    'aria-label': o.label,
    'aria-valuenow': o.value,
    'aria-valuemin': o.range.min,
    'aria-valuemax': o.range.max,
    ...(o.text ? { 'aria-valuetext': o.text } : null),
    'aria-disabled': o.disabled ? true : undefined,
    onKeyDown: (e: KeyEvent) => {
      if (o.disabled || e.altKey || e.ctrlKey || e.metaKey) return;
      const next = sliderKeyTarget(e.key ?? '', o.value, o.range);
      if (e.key && ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(e.key)) e.preventDefault?.();
      if (next !== null) o.onChange(next);
    },
  };
}
