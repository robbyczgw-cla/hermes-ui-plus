# Third-party notices

Hermes Interactive UI+ is released under the MIT License (see [LICENSE](LICENSE)). It includes, adapts, or loads the
third-party material listed below. Each entry names the license that applies to that material.

## CopilotKit OpenIntelligentUI (MIT)

- Project: https://github.com/CopilotKit/OpenIntelligentUI
- Copyright (c) Atai Barkai
- Used for: the interaction ideas behind interactive answers, the sandboxed HTML renderer architecture, and
  code ported into `app/src/sandbox/` (the partial-HTML streaming pipeline in `partialHtml.ts`, which itself
  derives from `processPartialHtml` in `@copilotkit/react-core`). Per-file headers name the exact sources.
  The design guidance in `hermes-skill/hermes-ui/SKILL.md` and its references is condensed from the same project.
  See `hermes-skill/hermes-ui/references/NOTICE.md`.

```
The MIT License

Copyright (c) Atai Barkai

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Pi Pocket (MIT)

- Project: https://github.com/TannerMidd/pi-pocket (commit de612d5)
- Copyright (c) 2026 Tanner Middleton
- Used for: pure logic ported to TypeScript (per-file headers name the exact sources):
  - `app/src/pi/pocket/turns.ts` (from `web/turns.js`: step summary line, test outcome, diff counts, grep matches,
    short errors, stop detection) and its tests `app/src/pi/pocket/turns.test.ts` (from `test/turns.test.ts`)
  - `app/src/pi/pocket/calls.ts` (from `web/calls.js`: `describeCall`)
  - `app/src/pi/outcome.ts` (per-tool outcome rules adapted from `outcome()` in `web/transcript.js`)
  - `app/src/ui/components/modules/e2/pocketDiff.ts` (from `web/diff-parse.js`: `unquote`, `cleanPath`, `headerPaths`,
    `parseEditDiff`, pairing by likeness `bigrams` / `likeness` / `alignRun`, `fingerprint`, `changeCells`), used by
    `diffModel.ts` (edit-card lines in the incremental parser follow `parseEditDiff`; `hunkRows` pairs a change's
    lines with `alignRun` and highlights words per pair like Pocket's `hunkRows`, with Pocket's `wordDiff` token
    pattern) and `Changes.tsx`
  - `app/src/pi/StepSummary.tsx` renders the summary of `app/src/pi/outcome.ts` (no Pocket code of its own)

```
MIT License

Copyright (c) 2026 Tanner Middleton

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## idiomorph (BSD-2-Clause)

- Project: https://github.com/bigskysoftware/idiomorph (version 0.3.0)
- Copyright (c) Big Sky Software
- Used for: the minified DOM-morphing runtime inlined verbatim in `app/src/sandbox/idiomorph.ts`, so the sandbox
  needs no network access to morph the DOM. The file header names the source.
- License: BSD 2-Clause "Simplified" License. The license text is available in the upstream repository.

## Fonts: Atkinson Hyperlegible Next, Gloock, JetBrains Mono (SIL OFL 1.1)

- Atkinson Hyperlegible Next: https://github.com/googlefonts/atkinson-hyperlegible-next, Copyright 2020-2024 The
  Atkinson Hyperlegible Next Project Authors
- Gloock: https://github.com/duartp/gloock, Copyright 2022 The Gloock Project Authors
- JetBrains Mono: https://github.com/JetBrains/JetBrainsMono, Copyright 2020 The JetBrains Mono Project Authors
- Used for: the app's text, display and code faces, bundled as Latin subsets (`scripts/subset-fonts.sh`): static TTF
  in `app/assets/fonts/` (Android, iOS), variable WOFF2 in `app/public/fonts/` (web, desktop) and in
  `website/fonts/`. Subsetting is a modification under the licence; none of the three declares a Reserved Font Name.
- License: SIL Open Font License 1.1, full texts next to the files (`OFL-*.txt`).

## Leaflet and map tiles (loaded at runtime)

- Leaflet 1.9.4 is loaded inside the sandboxed WebView from unpkg.com or cdn.jsdelivr.net.
  Leaflet is distributed under the BSD 2-Clause License (https://leafletjs.com).
- Map tiles are requested from `tile.openstreetmap.de` (FOSSGIS) and `tile.opentopomap.org` (OpenTopoMap).
  Map data: © OpenStreetMap contributors, available under the Open Database License (https://www.openstreetmap.org/copyright).
  The tile servers and their terms are the responsibility of the operators.

## Wikimedia Commons and Wikipedia images (fetched at runtime)

- Hermes Interactive UI+ does not bundle or redistribute Wikimedia images. The app looks them up through the public Wikipedia
  and Wikimedia Commons APIs when an answer refers to a subject.
- Each photo's author and license (for example CC BY-SA 4.0 or public domain) are shown in the app with a link to
  the file page. Those license terms apply to each image.

## Expo template and npm dependencies

- `app/LICENSE` is the MIT license from the Expo project template (Copyright (c) 2015-present 650 Industries, Inc.)
  and remains in force for the parts of `app/` that come from that template.
- The other npm dependencies (Expo, React Native, React, react-native-webview, react-native-svg, and others) are
  used under their own licenses. Versions are pinned in `app/package-lock.json` and `bridge/package-lock.json`.
- The UI Bridge depends on `@anthropic-ai/sdk`, which is used under its own license.

## Not included

- Hermes Agent (Nous Research) is a separate project. It is not bundled here and is not affiliated with this project.
- Model outputs, provider services (Anthropic, OpenAI, xAI, Meta, Groq, Deepgram, ElevenLabs), and their terms are not covered
  by this license.
