/**
 * A trip's day label ("Freitag 24.", "Sat 25") names a weekday and a day of the month. Models get the pairing wrong
 * (a "Friday 24" in a month where the 24th is a Saturday). When the day carries an explicit ISO date, the date wins and
 * the weekday word is derived from it; without a date nothing is guessed. No React.
 */

const NAMES: Record<string, readonly string[]> = {
  de: ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'],
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  es: ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'],
};
const SHORT: Record<string, readonly string[]> = {
  de: ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  es: ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'],
};

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** weekday (0 = Sunday) of an ISO date `YYYY-MM-DD`, undefined when it is not a real date */
export function weekdayOfIso(iso: string | undefined): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  if (!m) return undefined;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? d.getUTCDay() : undefined;
}

/** the weekday word at the start of a label, as language + index + whether it was the short form */
function leadingWeekday(label: string): { lang: string; day: number; short: boolean; len: number } | undefined {
  const m = /^\s*([A-Za-zÀ-ÿ]+)\.?(?=[\s,]|$)/.exec(label);
  if (!m) return undefined;
  const w = fold(m[1]);
  for (const short of [false, true]) {
    for (const lang of Object.keys(NAMES)) {
      const i = (short ? SHORT : NAMES)[lang].findIndex((n) => fold(n) === w);
      if (i >= 0) return { lang, day: i, short, len: m[0].length - (m[0].endsWith('.') ? 1 : 0) };
    }
  }
  return undefined;
}

/**
 * `label` with its weekday word replaced by the weekday of `iso`, in the same language and length; the label itself
 * when it has no weekday word, the date is missing, or both already agree. The day number is only kept consistent by
 * the caller's date; the label's own number is left alone.
 */
export function dayLabelForDate(label: string, iso: string | undefined): string {
  const want = weekdayOfIso(iso);
  const lead = leadingWeekday(label);
  if (want === undefined || !lead || lead.day === want) return label;
  const first = label.slice(0, label.length - label.trimStart().length);
  const word = (lead.short ? SHORT : NAMES)[lead.lang][want];
  return first + word + label.slice(first.length + lead.len);
}
