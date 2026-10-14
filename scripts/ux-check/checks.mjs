// Pure evaluation of the raw DOM data collected by run.mjs (collectRaw in the browser).
// Kept free of Playwright/DOM so node --test can cover it (checks.test.mjs).

/** Merge {top,bottom} rects into occupied vertical bands (sorted, overlaps/touching merged). */
export function mergeBands(rects, { fromY = -Infinity } = {}) {
  const sorted = rects
    .filter((r) => Number.isFinite(r.top) && Number.isFinite(r.bottom) && r.bottom > r.top && r.bottom >= fromY)
    .sort((a, b) => a.top - b.top);
  const bands = [];
  for (const r of sorted) {
    const last = bands[bands.length - 1];
    if (last && r.top <= last.bottom) last.bottom = Math.max(last.bottom, r.bottom);
    else bands.push({ top: r.top, bottom: r.bottom });
  }
  return bands;
}

/** Vertical gaps > maxGapPx between consecutive occupied bands (the "invisible paragraph" symptom). */
export function verticalGaps(rects, { fromY = -Infinity, maxGapPx = 120 } = {}) {
  const bands = mergeBands(rects, { fromY });
  const gaps = [];
  for (let i = 1; i < bands.length; i++) {
    const gap = bands[i].top - bands[i - 1].bottom;
    if (gap > maxGapPx) gaps.push({ gapPx: Math.round(gap), afterY: Math.round(bands[i - 1].bottom), bands: bands.length });
  }
  return gaps;
}

const short = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 90);

/** Answer text carries letters/digits; pure symbol glyphs (rail arrows ›, ✕, ★) are control chrome, not content. */
const isAnswerText = (s) => /[\p{L}\p{N}]/u.test(String(s ?? ''));

/**
 * Turn the raw collection of one scenario into pass/fail per check:
 *  a) opacity   – no answer text with effective opacity < 1 or fully transparent text colour
 *                 (text inside deliberately disabled controls is reported separately, not failed)
 *  b) clipping  – no wrappable answer text wider than its box outside horizontally scrollable
 *                 containers (ellipsis-truncated one-liners are reported separately)
 *  c) followups – at most one suggestion zone; scenarios with suggestions must have exactly one
 *  d) gaps      – no empty vertical gap > 120 px between occupied bands of the answer
 */
export function evaluateChecks(raw, { expectSuggestions = false } = {}) {
  const texts = raw.texts ?? [];

  const opacityViolations = [];
  const disabledDim = [];
  for (const t of texts) {
    if (t.ariaHidden || !isAnswerText(t.text)) continue;
    if (t.effOpacity < 0.99 || t.colorAlpha === 0) {
      (t.disabled ? disabledDim : opacityViolations).push({ text: short(t.text), effOpacity: +t.effOpacity.toFixed(3), colorAlpha: t.colorAlpha });
    }
  }

  const clipViolations = [];
  const truncated = [];
  for (const t of texts) {
    if (!t.clipped || t.inScrollable || t.ariaHidden || !isAnswerText(t.text)) continue;
    (t.ellipsis ? truncated : clipViolations).push({ text: short(t.text), scrollWidth: t.scrollWidth, clientWidth: t.clientWidth });
  }

  const zones = raw.suggestionZones ?? 0;
  const followupsPass = zones <= 1 && (!expectSuggestions || zones === 1);

  const gaps = verticalGaps(raw.bands ?? [], { fromY: raw.startY ?? -Infinity });

  return {
    opacity: { pass: opacityViolations.length === 0, violations: opacityViolations, disabledDim },
    clipping: { pass: clipViolations.length === 0, violations: clipViolations, truncated },
    followups: { pass: followupsPass, zones, chips: raw.suggestionChips ?? 0, expectSuggestions },
    gaps: { pass: gaps.length === 0, violations: gaps },
  };
}

export function scenarioPassed(checks) {
  return Object.values(checks).every((c) => c.pass);
}
