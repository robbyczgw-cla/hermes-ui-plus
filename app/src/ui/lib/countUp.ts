/**
 * A5 stats count-up: split a stat value string ("1.234,5 €", "$1,200", "+12 %", "3.2x") into
 * prefix / number / suffix and re-format interim numbers in the same style, on the UI thread
 * (`formatCountUp` is a worklet). Values with more than one number ("3/5", "10–12 h"), years and
 * non-numbers are not animated (`parseCountUp` → null).
 *
 * Pure TS (erasable syntax only) so `node --test` can run it.
 */

export type CountUpTemplate = {
  prefix: string;
  suffix: string;
  value: number;
  decimals: number;
  /** thousands separator ('' = none) */
  group: string;
  /** decimal separator */
  dec: string;
};

const NUM_RE = /^(\D*?)(\d{1,3}(?:([.,   ])\d{3})+(?:([.,])\d+)?|\d+(?:([.,])\d+)?)(\D*)$/;

export function parseCountUp(raw: string): CountUpTemplate | null {
  const s = raw.trim();
  if (!s || s.length > 32) return null;
  const m = NUM_RE.exec(s);
  if (!m) return null;
  const [, prefix, body, groupSep, decAfterGroup, decPlain, suffix] = m;
  // other digits in prefix/suffix (e.g. "3/5", "10–12") → not a single number
  if (/\d/.test(prefix) || /\d/.test(suffix)) return null;
  // "v2", "Q3": a letter glued to the number is a name, not a quantity
  if (/[A-Za-z]$/.test(prefix)) return null;
  // an ambiguous lone separator "1.234" / "1,234": three digits after it = thousands
  let group = groupSep ?? '';
  let dec = decAfterGroup ?? decPlain ?? '';
  if (!groupSep && dec && /^\d{1,3}[.,]\d{3}$/.test(body)) {
    group = dec;
    dec = '';
  }
  if (group && dec && group === dec) return null;
  const decimals = dec ? body.length - body.lastIndexOf(dec) - 1 : 0;
  let normalized = body;
  if (group) normalized = normalized.split(group).join('');
  if (dec) normalized = normalized.replace(dec, '.');
  const value = Number(normalized);
  if (!Number.isFinite(value) || value === 0) return null;
  // a bare year is a label, not a quantity
  if (!prefix && !suffix && !dec && !group && value >= 1900 && value <= 2100) return null;
  return { prefix, suffix, value, decimals, group, dec: dec || (group === '.' ? ',' : '.') };
}

/** Interim text for `x` (0 … template.value) in the template's style. Worklet: runs on the UI thread. */
export function formatCountUp(tpl: CountUpTemplate, x: number): string {
  'worklet';
  const fixed = Math.abs(x).toFixed(tpl.decimals);
  const dot = fixed.indexOf('.');
  const int = dot < 0 ? fixed : fixed.slice(0, dot);
  const frac = dot < 0 ? '' : fixed.slice(dot + 1);
  let grouped = int;
  if (tpl.group && int.length > 3) {
    grouped = '';
    for (let i = 0; i < int.length; i++) {
      if (i > 0 && (int.length - i) % 3 === 0) grouped += tpl.group;
      grouped += int[i];
    }
  }
  return tpl.prefix + (x < 0 ? '-' : '') + grouped + (frac ? tpl.dec + frac : '') + tpl.suffix;
}
