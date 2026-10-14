# SVG diagrams in hui-html

Condensed from OpenIntelligentUI svg-diagrams (MIT, (c) Atai Barkai; see NOTICE.md). Adapted: colors work in light AND dark via translucent fills + mid-tone strokes + `--h-text`.

## When
Use a diagram when it explains faster than text: mechanism, pipeline, architecture, relations, decision flow. Not for plain lists (use steps/table). Explain in Markdown outside the block.

## Setup
- `<svg width="100%" viewBox="0 0 340 H" role="img" aria-label="...">` for phones (design width 340; use 680 only for very dense diagrams and keep text >= 12 px after scaling, i.e. prefer splitting).
- H = lowest element bottom + 24. Safe area x 12..328. Transparent background.
- Fragment only; put `<style>` first for classes, or use presentation attributes.
- Every connector path needs `fill="none"`. Every text needs an explicit fill (`var(--h-text)` / `var(--h-muted)`).
- Arrow marker once in `<defs>`:
```svg
<defs><marker id="ar" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></marker></defs>
```

## Typography and shapes
- Two sizes (14 title / 12 caption), two weights (400/500). Sentence case. `text-anchor="middle" dominant-baseline="central"` for centered labels.
- Width estimate: 14 px ~ 8 px/char, 12 px ~ 7 px/char; box width = longest label + 32.
- Boxes: `rx=8`, stroke 1; single-line 40 px, two-line 52 px; gap between boxes >= 32 px; max 3 nodes per row at 340 wide (stack vertically), max ~6 nodes per diagram. More => several small diagrams with text between.
- Arrows 1.5 px; arrows never cross unrelated boxes (route with L-bends).

## Palette (translucent fill, stroke, use `var(--h-text)` for labels)
| meaning | fill | stroke |
|---|---|---|
| primary / input | rgba(29,158,117,.16) | #1D9E75 |
| process | rgba(127,119,221,.16) | #7F77DD |
| storage / external | rgba(239,159,39,.18) | #EF9F27 |
| info | rgba(55,138,221,.16) | #378ADD |
| warning / error | rgba(226,75,74,.16) | #E24B4A |
| neutral | rgba(136,135,128,.16) | #888780 |
Use 2-3 colors per diagram; color = meaning, not sequence.

## Pattern: node
```svg
<g><rect x="60" y="12" width="220" height="52" rx="8" fill="rgba(127,119,221,.16)" stroke="#7F77DD"/>
<text x="170" y="30" text-anchor="middle" dominant-baseline="central" font-size="14" font-weight="500" fill="var(--h-text)">Reverse-Proxy</text>
<text x="170" y="48" text-anchor="middle" dominant-baseline="central" font-size="12" fill="var(--h-muted)">nimmt Anfragen an</text></g>
<line x1="170" y1="64" x2="170" y2="96" stroke="#7F77DD" stroke-width="1.5" marker-end="url(#ar)"/>
```

## Diagram types
- Flowchart: one direction (top to bottom on phones), <= 6 nodes, decision = labeled branches.
- Structural: nested rects for containment (<= 2 levels, 16 px padding).
- Illustrative (build intuition): freeform shapes, color = intensity, labels in margins with leader lines.

## Interactivity (optional)
Prefer static. If useful: step buttons (`<button type="button">`) that highlight node N and show its caption in a `role="status"` element; no timers without pause; no `window.hermes.send` on load.

## Final checks
1. viewBox height covers everything; nothing past x=328.
2. Text fits boxes. 3. No arrow through a box. 4. All connectors `fill="none"`. 5. Readable in dark mode (no hard-coded black/white text). 6. Aria label present.
