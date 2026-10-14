/**
 * Version line in Settings → About: `0.1.0-alpha.1 · Build 42 (abc1234)`. The build number and source commit come from
 * `extra.buildNumber` / `extra.buildSource` (app.config.ts, set by scripts/build-apk.sh); dev builds show the version only.
 */
export function versionLabel(version: string | undefined, extra: Record<string, unknown> | undefined): string {
  const v = version || '–';
  const n = extra?.buildNumber;
  if (typeof n !== 'number' || !Number.isInteger(n) || n <= 0) return v;
  const src = typeof extra?.buildSource === 'string' && /^[0-9a-f]{7,12}$/i.test(extra.buildSource) ? ` (${extra.buildSource})` : '';
  return `${v} · Build ${n}${src}`;
}
