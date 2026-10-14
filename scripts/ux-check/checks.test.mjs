import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateChecks, mergeBands, scenarioPassed, verticalGaps } from './checks.mjs';

test('mergeBands merges overlapping rects and respects fromY', () => {
  const bands = mergeBands(
    [
      { top: 0, bottom: 50 },
      { top: 40, bottom: 90 },
      { top: 200, bottom: 230 },
      { top: -50, bottom: -10 },
    ],
    { fromY: 0 },
  );
  assert.deepEqual(bands, [
    { top: 0, bottom: 90 },
    { top: 200, bottom: 230 },
  ]);
});

test('verticalGaps only flags gaps above the threshold', () => {
  const rects = [
    { top: 0, bottom: 100 },
    { top: 210, bottom: 260 }, // 110 px: fine
    { top: 400, bottom: 450 }, // 140 px: flagged
  ];
  const gaps = verticalGaps(rects);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].gapPx, 140);
  assert.deepEqual(verticalGaps(rects, { maxGapPx: 200 }), []);
});

const text = (over) => ({ text: 'Beispiel', effOpacity: 1, colorAlpha: 1, clipped: false, ellipsis: false, inScrollable: false, disabled: false, ariaHidden: false, scrollWidth: 50, clientWidth: 50, ...over });
const raw = (over) => ({ texts: [], bands: [{ top: 10, bottom: 100 }], startY: 10, suggestionZones: 0, suggestionChips: 0, ...over });

test('opacity: faded answer text fails, disabled-control dimming and aria-hidden do not', () => {
  assert.equal(evaluateChecks(raw({ texts: [text({})] })).opacity.pass, true);
  const faded = evaluateChecks(raw({ texts: [text({ effOpacity: 0 })] }));
  assert.equal(faded.opacity.pass, false);
  assert.equal(faded.opacity.violations[0].effOpacity, 0);
  assert.equal(evaluateChecks(raw({ texts: [text({ colorAlpha: 0 })] })).opacity.pass, false);
  const dim = evaluateChecks(raw({ texts: [text({ effOpacity: 0.45, disabled: true })] }));
  assert.equal(dim.opacity.pass, true);
  assert.equal(dim.opacity.disabledDim.length, 1);
  assert.equal(evaluateChecks(raw({ texts: [text({ effOpacity: 0, ariaHidden: true })] })).opacity.pass, true);
  // pure symbol glyphs are control chrome (rail arrows at 0.94), not answer text
  assert.equal(evaluateChecks(raw({ texts: [text({ text: '›', effOpacity: 0.94 })] })).opacity.pass, true);
  assert.equal(evaluateChecks(raw({ texts: [text({ text: '› Tipp', effOpacity: 0.94 })] })).opacity.pass, false);
});

test('clipping: wrappable overflow fails; scroll containers and ellipsis do not', () => {
  assert.equal(evaluateChecks(raw({ texts: [text({ clipped: true, scrollWidth: 300, clientWidth: 120 })] })).clipping.pass, false);
  assert.equal(evaluateChecks(raw({ texts: [text({ clipped: true, inScrollable: true })] })).clipping.pass, true);
  const trunc = evaluateChecks(raw({ texts: [text({ clipped: true, ellipsis: true })] }));
  assert.equal(trunc.clipping.pass, true);
  assert.equal(trunc.clipping.truncated.length, 1);
});

test('followups: two zones always fail; expected suggestions need exactly one', () => {
  assert.equal(evaluateChecks(raw({ suggestionZones: 2 })).followups.pass, false);
  assert.equal(evaluateChecks(raw({ suggestionZones: 0 })).followups.pass, true);
  assert.equal(evaluateChecks(raw({ suggestionZones: 0 }), { expectSuggestions: true }).followups.pass, false);
  assert.equal(evaluateChecks(raw({ suggestionZones: 1 }), { expectSuggestions: true }).followups.pass, true);
});

test('gaps and overall verdict', () => {
  const bad = evaluateChecks(raw({ bands: [{ top: 10, bottom: 60 }, { top: 300, bottom: 340 }] }));
  assert.equal(bad.gaps.pass, false);
  assert.equal(scenarioPassed(bad), false);
  assert.equal(scenarioPassed(evaluateChecks(raw({}))), true);
});
