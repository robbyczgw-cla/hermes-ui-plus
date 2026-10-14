# English demo videos and trailer (Hermes Interactive UI+)

Reproducible recordings from the public web build: a 390×844 phone viewport at 3× device scale,
60 fps, a local mock Hermes server, and fictional sample content. No private chats, hosts or credentials.
Photos reuse the existing CC0 media; headphone illustrations are generated fictional products.
Attribution stays in `media/CREDITS.json` and the gallery’s `CREDITS.json`.

Recordings default to **English** (`hui.lang=en`, browser locale `en-US`) and **Paper/light**
(`themeFamily=paper`, `themeMode=light`). Only the theme-switch clip changes those settings.
Prompts, mock answers and burned-in captions are English. Vocabulary practice uses English → Spanish.
The gallery opens in English and retains an optional German description toggle. Original German
recordings and their gallery are preserved in `dist/share/demos-de/`.

After a theme redesign, wait for `/tmp/hui-theme-ready` before rebuilding or recording: poll every
120 seconds for up to two hours. Check `grep MemAvailable /proc/meminfo` exceeds 6 GiB first.
Do not wrap scripts in flock; the web build manages its own lock and memory scope.

```bash
FLAVOR=hermes scripts/build-web.sh
# Reuse dist/share/demos/music/; no music API call or key is needed.
XDG_RUNTIME_DIR=/run/user/1000 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus \
  systemd-run --user --scope -p MemoryMax=4G -p MemorySwapMax=0 \
  node scripts/demo-videos/record.mjs
```

Run one browser at a time. Heavy ffmpeg steps use a 4 GiB scope, no swap, two codec/filter threads,
and `nice -n 10`. Quality remains H.264 High, CRF 18 for demos, 60 fps, AAC 192 kb/s, with two-pass
loudness normalization around −16 LUFS and the original fades. `02-produkte` caps playback at 34.5 s.
The transform comparison uses short cells so all three columns fit on a phone. Clip IDs and filenames
remain stable for existing links. Trailer excerpts follow recorded interaction marks, avoiding timing
drift when prompts or answers change language.

Useful commands (run browser/encoding commands inside the scope above):

```bash
node scripts/demo-videos/record.mjs rezept mindmap  # selected clips
node scripts/demo-videos/record.mjs --no-encode    # capture raw footage only
node scripts/demo-videos/encode.mjs --with-music   # re-encode all raw footage
node scripts/demo-videos/encode.mjs --no-clips     # trailer and gallery only
node scripts/demo-videos/encode.mjs --no-music     # optional silent renders
```

Outputs in `dist/share/demos/`: 13 portrait MP4s (1080×1920), animated WebP previews, selected GIFs
(≤8 MB), JPEG posters, `trailer.mp4` (1920×1080), `trailer-vertical.mp4` (1080×1920), a trailer poster,
`index.html`, media credits, and the existing `music/` tracks and credits. Small GIFs and the wide trailer
(≤15 MB) are also copied into `docs/media/`. Preserve German outputs before replacing them.

## Story and order (Hermes Agent users)

The set targets people who already run a Hermes Agent: approvals, long tasks, live tool steps and per-chat
models come first; answer formats (compare, table, places, …) follow. The gallery and trailer order is set
in `encode.mjs` (`AGENT_IDS`, `ANSWER_IDS`) and `trailer.mjs` (`SEGMENTS`); recipe, vocab, workout and mind map
sit at the end of the gallery and are not in the trailer. Clip ids and filenames are unchanged for old links.
The previous consumer-style set is kept in `dist/share/demos-consumer-20261013/` (not tracked).

New clips: `langtask` (`12-langtask`, research with several tool steps; the user leaves the chat, the in-app
“Answer from Hermes is ready” banner and unread dot appear, answer with summary and sources) and `toolsteps`
(`13-toolsteps`, “Tools & activity” timeline live, ends in a table). Both set `toolDetails: verbose`.
Wording stays accurate: remote push exists only in the web app (PWA, Web Push); the Android app keeps a
running answer alive in the background (keep-alive notification) but has no remote push after it is closed.
Captions therefore say the answer is waiting when you are back, never “get a push” in general.
The mock supports `fast` on text steps (token pacing factor) so long answers stream quickly after slow tool steps.
Raw footage, interaction timelines and encoding intermediates live under `/tmp/hermes-demo-videos`
(or `DEMO_WORK`). Use a separate `DEMO_WORK` for a new language to avoid mixing raw footage.

| File | Purpose |
|---|---|
| `scenarios.mjs` | English prompts/responses, interactive cards, image lookup keys and scenario routing. |
| `clips.mjs` | Thirteen interaction scripts, English captions, bilingual gallery descriptions and pacing. |
| `mock.mjs` | Local Hermes API, SSE streaming, UI routing, tools, approval requests and mock image search. |
| `lib.mjs` | Playwright setup, English/Paper seed, network routing, screencast capture, typing and touch overlay. |
| `record.mjs` | Starts the local servers, records clips sequentially and writes interaction timelines. |
| `serve.mjs` | Serves `dist/web` when no app server is listening. |
| `ffutil.mjs` | Memory-capped ffmpeg, two-thread codecs/filters, music mixing and probing. |
| `encode.mjs` | Portrait frames/captions, music, previews, gallery and documentation exports. |
| `trailer.mjs` | English montage captions, title/end cards, transitions and both aspect ratios. |
| `cards.mjs` | Chromium-rendered PNG cards with Inter and the current app icon. |
| `media.mjs` | CC0/PD media preparation and generated fictional headphone illustrations. |
| `music.mjs` | Original one-time music generation; existing renders reuse its tracks without calling it. |
| `fonts/` | Inter, licensed under SIL OFL 1.1 (`fonts/OFL.txt`). |

Options: `DEMO_WORK`, `DEMO_OUT`, `DEMO_WEB_DIR`, `DEMO_APP_URL`, `DEMO_DSF`,
`DEMO_SHOTS_BASE` (debug screenshot at each interaction mark), `DEMO_ICON`, `DEMO_REPO_URL`,
`DEMO_LUFS`. Recorder flags: `--keep-frames`, `--no-encode`, `--no-music`, `--no-finalize`.
Keep scopes enabled. Before sharing, run the repository leak guard and artifact scans.
