# Android E2E smoke suite

A fast, deterministic, repeatable end-to-end run of the Android app on an emulator, against a scripted mock of
Hermes + the UI bridge. Nobody has to click through the app: run one command, read `report.md`. One run takes about
10–13 minutes including the emulator boot, with the same results every time.

```bash
# on the emulator host itself
scripts/e2e/smoke.sh dist/hermes-ui-plus-release-<sha>-x86_64-debugsigned.apk
# from another machine: copies the scripts + APK to the host over ssh, fetches the report back
scripts/e2e/smoke.sh --host <build-host> --wait 90 --out /tmp/hui-e2e path/to/app.apk
```

Exit code: 0 = every check passed, 1 = at least one FAIL, 2 = setup problem (no SDK / emulator did not boot / mock did
not start), 3 = host busy or short of memory (refused, nothing was started).

| Option | |
|---|---|
| `--host H` | run on `H` over ssh (default `$E2E_HOST`, also read from `$HUI_PRIVATE_DIR/e2e.env`; empty = this machine) |
| `--out DIR` | report directory (default `/tmp/hui-e2e-<timestamp>`) |
| `--wait MIN` | the host is busy (any emulator/qemu or a Gradle JVM): poll every 2 min for up to `MIN` minutes instead of refusing |
| `--only a,b` | run only these checks (install, pairing and `logcat` always run) |
| `--group g,g` | run check groups (`core`, `net`, `ui`, `bg`, `share`, or `all`), see "Groups" below; combines with `--only` (union) |
| `--debug` | keep UI dumps of intermediate states in `OUT/debug/` |
| `--live FILE` | extra stage against a real bridge, see below |

Environment: `E2E_AVD` (default `HermesUIPlusQA`, an x86_64 **google_apis** image: the suite needs `adb root`),
`E2E_EMU_PORT` (5584), `E2E_ADB_PORT` (5137, a private adb server), `E2E_MOCK_PORT` (8791), `MIN_AVAIL_GB` (4),
`E2E_MAX_REANIMATED` (0), `ANDROID_SDK_ROOT`. The host needs the Android SDK (emulator + platform-tools), Node ≥ 22,
Python 3 and a systemd user session.

## Groups (partial runs)

The full suite takes 10-13 minutes. `--group` runs a shard of it, about 3-5 minutes each plus the emulator boot. Install,
pairing and the `logcat` crash/ANR check run in every group. Without `--group` and `--only` everything runs. The table
exists once, as `GROUPS` in `scripts/e2e/suite.py`; `smoke.sh` validates names against it (unknown group or check: exit 2
with the list; `python3 scripts/e2e/suite.py --list-groups` prints it), and `scripts/e2e/groups.test.mjs` fails when a
check registered in `Suite.run()` is in no group.

| group | checks | what it covers |
|---|---|---|
| `core` | `version`, `bots_quick_hidden`, `stream_long`, `stop`, `bots_quick_visible`, `cold_start` | basic chat: the long stream, Stop, the model picker's bots/quick state, version label, start time |
| `net` | `drop_resume`, `drop_recover`, `airplane`, `force_stop`, `offline_retry`, `refused_retry`, `not_sent` | every connection loss and retry path (the slow, fault-injecting checks) |
| `ui` | `checklist`, `share_image`, `table_font`, `dark` | rendered blocks and system appearance |
| `bg` | `background` | notifications and the keep-alive while the app is in the background |
| `share` | `share_unpaired`, `share_link`, `share_in_image`, `share_pdf`, `share_cancel`, `share_recreate`, `share_offline` | "Share to HUI+" (docs/SHARE-TARGET.md): intake, sheet, targets, offline; `share_unpaired` runs before pairing |

Which to run: streaming, transport or retry code -> `net` (plus `core`); blocks, Markdown, theme or layout -> `ui`;
background, notification or keep-alive code -> `bg`; anything else or unsure -> `all`. The full suite stays the gate
before a merge that touches app code; groups are for the loop while working. Several groups: `--group net,bg`.

A partial run says so: `report.md` starts with `# E2E smoke: PASS (subset: group core)` and lists the checks that did
not run; `report.json` has `partial: true` and `meta.selection` / `meta.not_run`. A subset PASS is not a full PASS.

## Host rules (enforced by the runner)

- Refuses while Gradle or **any** other emulator/qemu process runs, and while less than `MIN_AVAIL_GB` is available;
  one smoke run per host (`flock /tmp/hui-e2e.lock`).
- The emulator runs in `systemd-run --user --scope -p MemoryMax=5G -p MemorySwapMax=0` with
  `-no-window -no-audio -no-boot-anim -gpu swiftshader_indirect -memory 2048 -cores 4 -no-snapshot-save`, on its own
  console port and its own adb server port, so other adb users on the host are not touched.
- An EXIT trap always tears down: `adb emu kill`, then (if needed) `systemctl --user stop` of the run's scope, stops the
  mock by pid, `adb kill-server` of the private server, and reports whether any emulator process of the run is left.
  Nothing is killed by pattern (`pkill -f` could hit the calling shell).
- The suite restores what it changed on the shared AVD (animation scales, font scale, night mode, airplane mode,
  rotation) and uninstalls the app at the end.
- Never build on the emulator host while the suite runs; build the x86_64 test APK elsewhere (docs/BUILD.md).

### The build Mac as host

`--host mac` (or `HUI_ANDROID_LANE=mac`) runs the suite on the Apple Silicon build Mac (`MAC_HOST`, see docs/BUILD.md
"Second Android lane"), with an arm64-v8a APK (`scripts/build-apk.sh --host mac`). Differences on macOS: no
`flock`/`systemd`/`timeout`, so the run takes the Mac's single heavy-job lock (`scripts/lib/maclock.sh`, shared with the
iOS/macOS builds and the Android build), "busy" also covers `xcodebuild`, the emulator (3 GB RAM, `-gpu host`, override
`E2E_RAM` / `E2E_GPU`) runs as a watched process tree (`E2E_EMU_MAX_MB`, default 8192, killed by pid) and
`OUT/host.log` records tree size, free memory, swap and `pmset -g therm` every 30 s.

### Known differences on the build Mac (arm64 emulator)

- Airplane mode on the arm64 emulator takes `eth0` down but leaves the guest address on it, so Android does not reset
  the app's keep-alive sockets: `offline_retry` records them as `pooled_offline` (Mac: `ESTABLISHED, CLOSE_WAIT`; the
  x86_64 emulator of the Linux host: `none`). This exposed a real app bug, fixed in `stream.ts`
  (`HEADER_PROBE_AFTER_MS`): an offline send reused the pooled connection, the request sat in the socket's send queue
  (`ESTABLISHED tx_queue=502` in `shots/offline_retry-net.txt`) and only the 45 s idle timeout ended it ("Taking a
  little longer…" instead of "Answer failed"). Real phones hit the same with a VPN tunnel that keeps its address. With
  the fix "Answer failed" shows after about 7 s on the Mac (`failed_s`), about 2 s when nothing is pooled.

## What it checks

| id | check | how it is verified |
|---|---|---|
| `install` | clean install (uninstall first) | `adb install`, no stored chats, versionCode/versionName read |
| `share_unpaired` | a link is shared on the very first start (before pairing) | no sheet over the onboarding; after "Just take a look around" (demo only) the "Connect to Hermes first" sheet shows the link; *Connect* hides it, closing the flow brings it back; Cancel; then `pm clear` for the pairing check (screenshots `share/unpaired-*.png`) |
| `pair` | pairing via `hermesuiplus://pair?u=…&c=<one-time code>` | onboarding steps tapped through; the mock saw exactly one `/bridge/pair/redeem`; header shows Hermes, not demo |
| `share_link` | app in the background, `am start -a SEND -t text/plain` with a link | sheet shows the link; *Summarize* chip checked; Send → the stored message is exactly `Summarize this briefly.` + the link, answered once (screenshots `share/link-*.png`) |
| `share_in_image` | force-stopped app, `SEND image/png` with a `content://` uri of the app's own FileProvider (cold start; adb cannot grant another app access to a MediaStore uri on API 35) | thumbnail + "1 image" in the sheet; Send → one stored user message carries the image (inline, images are not uploaded), answered (`share/image-*.png`) |
| `share_pdf` | app in the foreground, `SEND application/pdf` | file row in the sheet; *Last chat* + own instruction → upload with `%PDF` bytes, the instruction stored once with the PDF, in the chat of `share_in_image` (`share/pdf-*.png`) |
| `share_cancel` | share text → Cancel | no turn on the mock, nothing stored |
| `share_recreate` | cold start by a share → Cancel → font scale 1.15 (activity recreated) | the cancelled share is not offered again (`share/recreate-after-font-scale.png`) |
| `share_offline` | airplane mode, share a text, an image, a PDF | text and image are stored and show "Answer failed" with Retry; the PDF (needs the bridge upload) is kept: in the composer draft, or as a sent message whose bubble waits for its upload (which one depends on whether the upload had failed before the share's send ran; the report says which, `share/offline-*.png`). Online again, "Tap to retry" on its chip uploads it, the draft is sent (a waiting send continues by itself), the PDF is stored once with an answer, so nothing is left for the next check |
| `version` | Settings › About › Version | label = `versionName · Build versionCode (commit)`, commit = the APK name's sha |
| `bots_quick_hidden` | no Bot section, no ⚡, no quick pill when the bridge offers none | model picker opened and inspected; `/bridge/profiles` + `/bridge/quick/config` request rate (no loop) |
| `stream_long` | long streamed answer with cards, Markdown table and code | stored answer **byte-equal** to the mock script, stored once, one turn on the mock; last line shown once; `dumpsys gfxinfo` over the stream (`gfx-long.txt`, metrics in the report) |
| `stop` | Stop mid-stream | `/bridge/chat/stop` sent, mock turn stopped, "Stopped" shown, stored text is a prefix of the script and stops growing |
| `drop_resume` | the bridge cuts the socket mid-stream (byte resume offered) | the app re-attaches at a byte offset (mock log), final text byte-equal, one turn |
| `drop_recover` | cut without byte resume | "Connection interrupted – loading the answer…" → session poll → "loaded later", text byte-equal, one turn |
| `airplane` | airplane mode mid-stream for 9 s | answer completes byte-equal, exactly one turn |
| `force_stop` | force-stop mid-stream, reopen | complete answer stored and shown, one turn |
| `offline_retry` | offline send (a keep-alive connection may still be pooled) → "Answer failed" visible above the composer within 25 s → airplane off → **double** Retry | one stored answer, one user message, one turn on the mock (screenshot `shots/offline-failed.png`) |
| `refused_retry` | the bridge answers 503 → double Retry | one answer, one turn |
| `not_sent` | the bridge holds the response headers, app killed before confirmation → "Not sent" → double "Send again" | the held request never ran (mock), exactly one turn afterwards, one answer |
| `checklist` | tick 2 of 4 items, force-stop, reopen | counter 2/4 and both items done after the relaunch |
| `share_image` | tick 1 item, "Share as image" in the action row, Share | sheet opens, the PNG appears in the app cache (pulled to `OUT/share-image.png`), the system share sheet opens, our sheet closes after it and the shared PNG is still in the cache; image ready in < 5 s (else the capture hit its deadline). `ready_s` = when the raw-screencap luma curve of the busy row / Share button reaches the look confirmed as ready (`ready_luma`); `ui_wait_s` = the uiautomator-based wait, which also counts dumps blocked by the spinner and is no app timing |
| `table_font` | table at font scale 1.3, then reset | year cells (`c. 1011–1021`, …) one line high (no mid-number wrap); screenshot `shots/table-font-1.3.png` |
| `dark` | system night mode on/off | mean screen luma dark < 90, light > 150; screenshot `shots/dark.png` |
| `background` | HOME during a stream | notification "… is answering" while streaming, "Answer ready" at the end; when it shows, the complete answer (done) is already stored, still in the background; complete after reopening too |
| `bots_quick_visible` | the bridge offers two profiles + quick answers | ⚡ in the composer and a Bot section in the model picker |
| `cold_start` | 3× force-stop + `am start -W` | TotalTime of each start (metric), composer shown |
| `logcat` | whole run | no crash / ANR for the app, no `ReactNativeJS` errors, Reanimated "synchronouslyUpdateUIProps failed" ≤ `E2E_MAX_REANIMATED` (counts in the report); full log `logcat-main.txt` |

## The mock (`scripts/e2e/mock.mjs`)

Zero-dependency Node server on `127.0.0.1` (the emulator reaches it as `10.0.2.2`). It answers like the UI bridge in
front of Hermes: `X-Hermes-UI-Bridge: 1` on every answer, one-time-code pairing, Bearer tokens, streamed turns with
Idempotency-Key records and byte-offset resume (it uses the bridge's own `bridge/src/replay.mjs`), a Hermes session
store (`/api/sessions…`, needed for recovery and the "Send again" check), run status, stop, `/bridge/profiles` and
`/bridge/quick/*`. A turn keeps running when the client goes away, like a detached Hermes run behind the bridge.

Answers are chosen by keywords in the user text (`long`, `checklist`, `table`, `slow`, anything else gets a one-line
answer naming the text); the same text always gives the same bytes at the same seeded rhythm. Test control
(`/__e2e/…`, loopback only): pairing codes, bots/quick on/off, one-shot faults (`refuse`, `hold`, `drop` with or
without byte resume), the turn log and the request log. `node --test scripts/e2e/mock.test.mjs` checks this contract
(part of `scripts/check.sh all`).

Try it by hand: `node scripts/e2e/mock.mjs --port 8791`, then
`curl -X POST 127.0.0.1:8791/__e2e/pair-code` and open
`hermesuiplus://pair?u=http%3A%2F%2F10.0.2.2%3A8791%2Fv1&c=<code>&n=E2E` on the emulator.

## The flows (`scripts/e2e/suite.py`, `device.py`, `report.py`)

Plain adb + uiautomator in Python (no extra tools on the host or the device). Selectors try the React Native `testID`
(the uiautomator resource-id) first and the English accessibility label / text second, so older builds without the
testIDs still work; the app is set to `en-US`. Rules that keep it deterministic:

- Wait on state, not time: the mock's turn records, the app's stored transcripts (`adb root`, `files/hui-store/conv/`)
  and UI nodes. Fixed sleeps only where Android itself needs a moment (relayout after a font or night-mode change).
- No uiautomator dump while tokens stream: the UI is never idle then, a dump hangs until the stream ends (and would
  spoil the frame stats). Stop is tapped at the Send button's position, which it replaces.
- Taps on content that animates in (checklist items enter with a layout animation and done items move to the end)
  wait until two consecutive dumps show the same bounds, and every tap is confirmed by the state it should cause
  (e.g. "1 of 4 done") instead of being repeated blindly.
- Texts are compared without the app's typographic glue (NBSP, word joiners around ranges like `1011–1021`), and
  upper-cased section titles (`BOT`) are matched case-insensitively.
- After a failed check: screenshot, UI dump and the last 300 logcat lines in `shots/`, then the app is force-stopped
  and relaunched, network / font / night mode reset and mock faults cleared, so one failure does not cascade.
- "Exactly once" is checked twice: in the app's transcript (one user message, one answer) and in the mock's turn log
  (one turn that ran; re-attaches and resumes are logged separately).

## Report

`OUT/report.md` (one table, PASS/FAIL/SKIP per check with seconds and the reason, metrics, failures with their
artifacts) and `OUT/report.json` (the same plus the evidence of every check). Also `mock-requests.json` (every request
and turn the mock saw), `logcat-main.txt`, `logcat-crash.txt`, `gfx-long.txt`, `mock.log`, `emulator.log`, `shots/`.
The report contains no hosts, tokens or pairing codes. Read `report.md` first; it is meant to be enough.

Metrics are informational, not gates (except where a check says so): `gfx_long_stream` covers one ~17 s stream on a
software-rendered emulator (fps = frames from the Send tap to the dump after the stream), so compare it only with
other smoke runs, not with `scripts/perf/stream-ab.sh` (52 s streams, three per build) or a real device.
`background_stored_before_reopen` shows what the app had persisted while it was still in the background after
"Answer ready" (the `background` check requires the complete answer there).

## Live stage (`--live FILE`)

After the mock checks: reinstall, pair with a **real** bridge using the one-time pair link in `FILE` (one line; a
fresh link per run, the code works once), send two harmless prompts ("Reply with exactly the word pong…", "What is
2 plus 3?…" in one chat), check that both answers arrive, then delete that one chat through the chat menu
(⋯ › Delete, the dialog must say "deleted in Hermes too") and check its transcript is gone. Never "Delete all chats":
after pairing, the drawer also lists every other app chat synced from that Hermes. The link travels on the ssh stdin and `adb shell` stdin
only: it is never printed, never an argument (visible in `ps`) and never written on the emulator host. The app is
uninstalled at the end, so no device token stays on the shared AVD.

Optional live checks of bots and ⚡ (`E2E_LIVE_EXTRA=bots,quick`, forwarded to the host by `--host`): `live_bots`
picks the bot `E2E_LIVE_BOT_LABEL` (default `Writer`) in the model picker, checks that the chat shows no ⚡, sends one
prompt and expects the bot's personality in the answer (regex `E2E_LIVE_BOT_MARK`, e.g. `quill`) and the bot's name in
the header; `live_quick` checks ⚡ in a default chat, asks a quick question, taps "Continue with Hermes" and expects
the follow-up answer to build on the quick answer. Both delete their chat in Hermes and keep screenshots of each state
in `shots/`. They need a Hermes with such a profile and the `hermes-ui-plus` plugin:
[`scripts/test-instance/`](../scripts/test-instance/README.md) sets one up. Waits treat a stored `stopped` answer
without `metrics.endedAt` as still running (the app persists a streaming answer that way).

Dry run of the stage without a real bridge: the mock also accepts the static test token, so a file with
`hermesuiplus://pair?u=http%3A%2F%2F10.0.2.2%3A8791%2Fv1&t=nca_e2e_test_token_static_0000000000&n=Live` runs the whole
stage (pairing through the token form, both prompts, the delete dialog) against the mock.
