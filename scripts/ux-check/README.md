# UX check – visual regression harness for phone answers

Catches the class of visual bugs that unit tests miss on a real phone: answer blocks that render
invisible, text clipped sideways outside scroll containers, duplicated follow-up zones, and large
empty gaps where a block should be.

## Run

```bash
node scripts/ux-check/run.mjs              # reuses dist/web, builds it first when missing
node scripts/ux-check/run.mjs --build      # always rebuild (FLAVOR=hermes scripts/build-web.sh)
node scripts/ux-check/run.mjs --scenario=weather,wide-table
node --test scripts/ux-check/checks.test.mjs   # pure check logic only
```

Output goes to `dist/ux-check/` (gitignored): `<scenario>-bottom.png` / `-top.png` screenshots
(plus `-grid.png` for the wide table after toggling) and `report.json` with per-check results and
violation details. Exit code is 1 when any check fails, 2 when the harness itself cannot run.

Requirements: a Chromium via playwright-core (resolved like the demo-video recorder:
`PLAYWRIGHT_CORE`, a local install, or the npx cache) and enough free RAM for the web build when
`dist/web` has to be produced.

## How it drives the app

The built web bundle is served locally and opened at 390×844 with a seeded localStorage: onboarding
done, the builtin **offline demo profile** (`preset-demo`, `demo://local`) active, English chrome
(so the composer labels match the demo-video recorder). Every request outside the local bundle is
aborted – the demo answers are replayed on-device, no server is involved. A fresh browser context
per scenario sends one prompt, waits for the stream to finish (the “Stop answer” button appearing
and disappearing), then waits another 1.5 s so entrances have settled and skeletons have handed
over to content.

Scenarios (`run.mjs` → `SCENARIOS`) are demo keywords from
`app/src/onboarding/demo/scenarios.ts`: weather, table, wide table, products, compare, places,
recipe, suggestions, text + stat cards. Each expects a final text fragment; if it never appears
the scenario fails before the DOM checks.

## Checks

Evaluated in `checks.mjs` from raw DOM facts collected in the chat list:

- **opacity** – no element containing answer text has an effective (ancestor-multiplied) opacity
  below 1 or a fully transparent text colour. Text inside deliberately disabled controls is listed
  separately (`disabledDim`) and does not fail.
- **clipping** – no wrappable answer text is wider than its box (`scrollWidth > clientWidth`)
  unless an ancestor actually scrolls horizontally. One-line ellipsis truncation
  (`text-overflow: ellipsis`) is listed under `truncated` for eyeballing and does not fail.
- **followups** – suggestion chips (`aria-label` “Suggestion/Vorschlag/Sugerencia: …”) must live in
  a single shared container. The demo transport emits no bridge meta follow-ups, so zero zones is
  fine unless the scenario’s answer contains suggestions (then exactly one is required).
- **gaps** – visible text/media/surface rects of the answer are merged into occupied vertical
  bands; an empty gap of more than 120 px between two bands fails (the “missing paragraph”
  symptom).
- **cardsToggle** (wide-table scenario only) – the phone card layout must offer “As table”, and
  after tapping it the grid plus the way back (“As cards”) must be present.

The checks see React Native Web in a desktop Chromium, not a phone. That is enough to catch the
DOM-level symptoms above (and to visually inspect layout in the screenshots), but it does not
reproduce native Reanimated behaviour – that side is covered by unit tests
(`app/src/ui/lib/fadeIn.test.ts`, `app/src/ui/lib/entranceGuard.test.ts`).

## Web checks do not prove native layout

A passing ux-check says nothing about Android/iOS layout. RN-web lays out with the browser's CSS
flexbox and text engine; native uses Yoga and the platform text stack, and they differ exactly where
answer blocks are tight:

- **Flex basis without a definite width.** Inside a horizontal `ScrollView` a row has no definite
  width. Chromium still honours `flexBasis: 0`; Yoga ignores it and sizes every cell to its one-line
  content. A table decided as "fill" therefore wrapped on the web but ran off the right edge on
  Android (column 3 clipped, ragged columns). Rule: measure the outer width outside any horizontal
  `ScrollView`, decide fill/cards/scroll from it (`tableLayoutMode` in
  `app/src/ui/lib/tableMath.ts`), and never render fill or card layouts inside a horizontal
  `ScrollView`.
- **Line breaking.** React Native's Android default `android_hyphenationFrequency="none"` leaves
  Minikin no break opportunity inside a word, not even after "-", so a long word in a narrow column
  is cut at any letter ("Hintergrundbeleucht|ung"). Narrow columns use `NARROW_TEXT_PROPS`
  (`app/src/ui/lib/textWrap.ts`). Hyphenation patterns follow the device locale, so a German word
  on an English device can still break without a hyphen.
- **Font metrics and OS font scale.** Android glyph widths and the system font scale (1.3 is common)
  make fixed-width labels ("12:00 PM" in a 56 dp cell) and line caps ("…tenways.c…") truncate where
  the browser had room.

### Native verification on the Android emulator

Changes to tables, compare columns, chips, or fixed-width labels need a check on the emulator:

1. Build an x86_64 APK: `FLAVOR=hermes ABIS=x86_64 scripts/build-apk.sh release` (memory-capped,
   about 6 min; works from a git worktree with symlinked `node_modules`, since rsync excludes them).
2. On the emulator host, start the AVD (1080×2400 at 420 dpi = 411 dp wide) inside a capped scope
   (`systemd-run --user --scope -p MemoryMax=5G -p MemorySwapMax=0 emulator -avd … -no-window
   -gpu swiftshader_indirect -memory 2048`). Never start it while a Gradle build runs on the same
   host.
3. `adb install`, open the app, choose "Just take a look around" (the offline demo; no Hermes,
   no pairing needed), then send the demo prompts: `PS2 Tabelle` (3-column German text table),
   `OLED oder LCD` (long German words in compare columns and a long source chip),
   `Weather tomorrow` (hour row from 12 PM) and `Wide table` (phone cards with the "As table"
   toggle). Capture screenshots with `adb exec-out screencap -p`.
4. Repeat with `adb shell settings put system font_scale 1.3`, then reset it to `1.0`.
5. Clean up: check that `adb logcat -b crash -d` is empty, uninstall the app, `adb emu kill`,
   `adb kill-server`, and confirm with `pgrep` that no qemu, emulator, adb or Gradle process is
   left.

Verified this way on 2026-10-13 for the native table fix. At 411 dp and at font scale 1.3, the
3-column table fills the width and wraps (no clipped column), compare words hyphenate, the hour
labels read "12 PM", and the source chips show the full source list.
