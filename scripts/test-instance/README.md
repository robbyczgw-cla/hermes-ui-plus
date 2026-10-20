# Throwaway Hermes test instances (profiles + ⚡ quick answers)

Separate Hermes Agents with two profiles and the `hermes-ui-plus` plugin, plus the UI bridge from this repo, for live
tests of Hermes profiles (bots) and quick answers without touching a production Hermes. They run as a normal user, are
memory-capped and listen on `127.0.0.1` only. One script set drives both; the flavor follows the OS of the host.

| | Linux host ("docker" flavor) | Mac ("native" flavor) |
|---|---|---|
| Hermes | **v0.22.0**, official image `nousresearch/hermes-agent:v0.22.0`, pinned by digest | **v0.22.2** (what production runs), git checkout pinned to the tag's commit `d923a5eb…`, own venv, Python 3.14, no Docker |
| Directory (`TI_DIR`) | `~/hermes-test` | `~/hermes-test-mac` (checkout, venv, `HERMES_HOME` = `data/`, pip cache, XDG dirs, all inside) |
| Ports (API / plugin / bridge) | 18642 / 18646 / 18790 | 28642 / 28646 / 28790 (other numbers: both can be tunneled at once) |
| Processes | container `hui-hermes-test` + systemd user unit `hui-test-bridge` | pid-tracked background processes (`run/*.pid`), no launchd, no Homebrew service |
| Memory cap | `--memory 3g` / `MemoryMax=512M`, no swap | RSS watchdog: gateway tree 2048 MB, bridge tree 512 MB (`TI_GATEWAY_MAX_MB`, `TI_BRIDGE_MAX_MB`). Measured: about 300 MB idle, 460 MB (gateway + bridge) during the API test |
| Instance lock | `/tmp/hui-testinst-linux.lock` + the classic `flock /tmp/hui-testinst.lock` | `/tmp/hui-testinst-mac.lock` (mkdir lock, macOS has no flock) |
| Also respects | emulator/Gradle check at setup | the Mac lane's heavy-job lock (`/tmp/hui-mac-heavy.lock`, `~/hui-lane/maclock.sh`), emulator/Gradle, at least 3 GB available |

**Which one when.** Use the Mac instance for anything that should match production (v0.22.2) and whenever the
server's emulator is busy; the Linux one while the Docker image is the point (image layout, `s6`, multiplexing defaults
inside the image) or when its host already runs the emulator you test with. Both give the same API test result today
(12 PASS, 0 FAIL, 1 SKIP). The Mac is a build machine (16 GB, fanless): start it only for a test, stop it right
after, and never next to the Android lane (the scripts refuse).

The setup also copies the `hermes-ui` skill into the default profile's skills folder (as `hermes-skill/INSTALL.md`
does on a real Hermes), so `skill_view` finds its references. `setup --force-config --web ddgs` (native only) adds
keyless web search for API clients (Hermes' `ddgs` backend; search only, no extract backend), so product questions in
the conversation test get real tool data.

Profiles on both: **default** (`claude-haiku-5-5`) and **writer** ("Quill": short, dry, signs every answer with
`— Quill`, `claude-haiku-4-5-20251001`). Both get the `todo` toolset only through the API: no terminal, files, code,
browser, web or memory, so no approval can be triggered. ⚡ uses `auxiliary.hui_quick` = `claude-haiku-5-5`, at most 400
output tokens; the bridge allows 5 quick answers per device and minute (60 per day).

What the setup does on purpose, from a failed attempt on a production Hermes:

- the plugin is enabled through `plugins.enabled` in `config.yaml`; `hermes plugins enable` can make Hermes' package
  manager build a new environment under `installs/` and start the gateway from it (native: the venv is made by
  `setup.sh` with pip, not by `setup-hermes.sh`, which writes to `~/.local/bin` and the shell rc files);
- every profile's own `.env` has `API_SERVER_KEY`, identical to the bridge's `HERMES_API_KEY` (v0.22 authenticates
  `/p/<name>/` with the profile's own key and fails closed without one), plus its own provider key;
- `gateway.multiplex_profiles: true` is explicit (inside the s6 image the implicit default may stay standalone);
- the bridge gets `BRIDGE_PROFILES=writer=Writer` as a list and the plugin secret as a file (docker: systemd's
  `LoadCredential`), and runs with `HERMES_HOME=/nonexistent`, like a hardened unit that cannot read the Hermes home;
- native: `HERMES_HOME`, `HERMES_GATEWAY_LOCK_DIR` and the `XDG_*` directories point into `TI_DIR`, so nothing lands in
  `~/.hermes` or `~/.local`.

The plugin is copied from the checkout that runs `setup.sh`. It needs the profile-scope handling in
`hermes-plugin/hermes_ui_plus/hermes_adapter.py` (`profile_scope`): with an older plugin every quick answer fails with
502 (`UnscopedSecretError` in `agent.log`) on a multiplexing gateway.

## Files

Run on **your machine**, against either host:

| Script | |
|---|---|
| `ti.sh --host mac\|linux\|<ssh alias> COMMAND …` | one entry point: `sync`, `copy-key --from HOST`, `setup`, `start`, `stop`, `status`, `session`, `api-test`, `quick-off-test`, `conversation-test`, `pair`, `lock`, `remove`, `tunnel start\|stop\|status\|print` |
| `sync.sh [--host H]` | copies `bridge/`, `hermes-plugin/`, `hermes-skill/`, `scripts/test-instance/`, `scripts/e2e/` to `<TI_DIR>/repo` on the host |
| `conversation-test.sh [--host H] [--out DIR]` | live multi-turn chats (`bridge/eval/conversations/run.mjs`, every answer checked with the app's parser) run HERE against the instance, which runs inside a session on the host, through an own ssh tunnel; the bridge token goes to a temp file (600), never printed. Report default `$HUI_PRIVATE_DIR/reports/conversations/<time>/`. Pre-release step (docs/RELEASING.md); `ti.sh … conversation-test` calls it |
| `host.sh` | sourced helper: `mac` = `MAC_HOST`, `linux` = `TI_HOST` (environment, then `$HUI_PRIVATE_DIR/test-instance.env` / `build.env`); any other name is used as ssh alias |

Run **on the host** (through `ti.sh`, or directly from `<TI_DIR>/repo/scripts/test-instance/`):

| Script | |
|---|---|
| `setup.sh [--force-config] [--web ddgs]` | one-time setup, re-runnable (keeps keys, data and sessions; `--force-config` rewrites the config files it owns; `--web ddgs` see above). Native: clones the pinned commit, builds the venv, installs the extras `anthropic,cron,pty,mcp,uvloop` + `aiohttp` |
| `start.sh` / `stop.sh` / `status.sh` | start, stop, show what runs and listens. `stop.sh` exits non-zero if anything is left and refuses while a `session.sh` holds the instance (`--force`) |
| `session.sh [--wait S] [--label N] -- CMD …` | **the safe way**: take the locks, `start.sh`, run CMD, `stop.sh`, release; the instance is stopped on every exit path (CMD fails, Ctrl-C, ssh drops). Exit 3 = lock not free within `--wait`, 4 = start failed, 5 = stop left something |
| `lock.sh status\|take\|release` | the instance lock for hand-driven sessions (`take` is a 2 h lease) |
| `remove.sh [--yes] [--keep-image]` | stop, delete `TI_DIR` (docker: and the image) |
| `pair.sh [FILE] [LABEL]` | one-time pairing link (device token, works once, 1 hour) into `FILE` (mode 600, default `<TI_DIR>/pair-link.txt`) |
| `api-test.mjs [--phase on\|off] [--only a,b]` | scripted API checks, report in `<TI_DIR>/reports/…/api-report.md` |
| `bots-test.sh [--approval]` / `bots-test.mjs` | Bots v2 (docs/BOTS-SERVER.md): the bridge's Bot Chat route (other titles refused, created once, adopted after), two turns bound to it (history, title kept), the default bot's own Bot Chat; `--approval` gives `writer` the terminal toolset + manual approvals for the run (config backed up, restored, sha1 checked) and checks that "always" lands in writer's config only. Report `<TI_DIR>/reports/bots-…/bots-report.json`. `ti.sh … bots-test` runs it in a session |
| `quick-off-test.sh` | takes the plugin out of `plugins.enabled`, restarts the gateway, runs `api-test.mjs --phase off`, enables it again |
| `watchdog.sh` | native only: the RSS cap, started and stopped by `start.sh` / `stop.sh` |

Settings (environment, see `lib.sh`): `TI_FLAVOR`, `TI_DIR`, `TI_API_PORT`, `TI_PLUGIN_PORT`, `TI_BRIDGE_PORT`,
`TI_MODEL`, `TI_WRITER_MODEL`, `TI_QUICK_MODEL`; docker `TI_MEM`; native `TI_HERMES_TAG`/`TI_HERMES_COMMIT`,
`TI_GATEWAY_MAX_MB`, `TI_BRIDGE_MAX_MB`, `TI_MIN_AVAIL_GB`.

## Locks and idle state

An instance is only up for one `start → tests → stop` session at a time. Use `session.sh` (or `ti.sh … api-test`,
which wraps it): it holds `/tmp/hui-testinst-<mac|linux>.lock` for exactly that long, on Linux also the old
`flock /tmp/hui-testinst.lock`, and on the Mac the Android lane's heavy lock (`maclock.sh`, kind `testinst`), so a
running build or emulator makes it wait (`--wait`) instead of starting next to it. A bare `start.sh` takes a 2 h lease
instead, which `stop.sh` releases; a session will not start while a lease is live. **Leave the instances stopped.**
`ti.sh --host mac status` shows who holds what.

## Set up (once per host)

Needs: Node ≥ 22, OpenSSL, Python 3; docker flavor: Docker (user in the `docker` group), a systemd user session, about
1.2 GB disk, 4 GB free memory. Native flavor: git and Homebrew Python 3.14 (`python3.14`), about 700 MB disk, 4 GB free
memory. Not while an emulator or Gradle runs there.

```bash
T=scripts/test-instance/ti.sh
$T --host mac sync                         # copy the repo parts (repeat after every change of bridge/plugin/scripts)
$T --host mac copy-key --from linux        # the model key, copied host to host, never printed; mode 600, never in the repo
$T --host mac setup
```

Without a second instance to copy from, put one line `ANTHROPIC_API_KEY=…` into `<TI_DIR>/secrets/anthropic.env`
(mode 600) yourself, never on a command line.

## Start, test, stop

```bash
$T --host mac api-test                     # session: start, profiles + ⚡ (about 10 short model calls), stop; ~30 s
$T --host mac session -- bash -c '…'       # your own commands on the host inside a session
$T --host mac quick-off-test               # session: ⚡ without the plugin (plugin out of plugins.enabled, ~1.5 min)
```

`api-test.mjs` checks: `GET /bridge/profiles`, `/p/writer/v1/models` (unknown profile 404, no token 401), a streamed
chat to `writer` with its personality and model, the default profile without it, separate session lists, Stop scoped
per profile in both directions (same session id in both profiles), `/bridge/quick/config`, a quick answer, no `/p/…`
form of the quick routes, the "Continue with Hermes" context block (the app's exact format), and 429 with
`Retry-After`. Approvals are skipped: the test profiles have no tool that could raise one. Phase `off`:
`available: false`, `404 feature_off`, at most one plugin probe per 30 s, chats unaffected.

## Reaching it from your machine (ssh tunnel)

Nothing is exposed: the instance binds `127.0.0.1` on its host. Forward the three ports (same numbers locally):

```bash
ssh -N -L 28642:127.0.0.1:28642 -L 28646:127.0.0.1:28646 -L 28790:127.0.0.1:28790 <mac-host>
# or: scripts/test-instance/ti.sh --host mac tunnel start | status | stop | print
```

While the instance is up (inside a session), `http://127.0.0.1:28790` is the bridge and `http://127.0.0.1:28642` the
Hermes API (`Authorization: Bearer <API_SERVER_KEY>` from `<TI_DIR>/secrets/api_server_key`; read it on the host, do not
print it). For the Linux instance use 18642 / 18646 / 18790 and `--host linux`. The control socket of `tunnel start` is
`$TMPDIR/hui-ti-tunnel-<host>.sock`; `tunnel stop` closes exactly that master.

## In the app (Android emulator on the same host)

An emulator on the instance's host reaches the bridge as `http://10.0.2.2:<bridge port>` (that is the `BRIDGE_PUBLIC_URL`
in the pair link).

```bash
umask 077
ssh <host> 'bash <TI_DIR>/repo/scripts/test-instance/pair.sh <TI_DIR>/pair-link.txt app && cat <TI_DIR>/pair-link.txt && rm <TI_DIR>/pair-link.txt' > /tmp/testinst/pair-link.txt
E2E_LIVE_EXTRA=bots,quick E2E_LIVE_BOT=writer E2E_LIVE_BOT_LABEL=Writer E2E_LIVE_BOT_MARK=quill \
  scripts/e2e/smoke.sh --host <host> --wait 10 --only bots_quick_visible,logcat \
    --live /tmp/testinst/pair-link.txt --out /tmp/testinst/e2e dist/<test APK>
```

(Start the instance first, e.g. with `ti.sh … session -- sleep 900` in another terminal.) The live stage pairs with the
link (sent over ssh stdin, never printed), sends two harmless prompts, then `live_bots` (Bot section, a `writer` chat
with its signature, stored as a `writer` chat, no ⚡ there) and `live_quick` (⚡ in a default chat, a quick answer,
"Continue with Hermes", a follow-up that builds on it). Each live chat is deleted in Hermes afterwards and the app is
uninstalled at the end. Screenshots: `OUT/shots/`.

From a phone in your tailnet (optional, nothing public; Linux host): `tailscale serve --bg --https=18790
http://127.0.0.1:18790`, set `BRIDGE_PUBLIC_URL=https://<host>.<tailnet>.ts.net:18790` in `<TI_DIR>/bridge.env`,
`stop.sh` + `start.sh`, then `pair.sh` and open the link on the phone. Undo with `tailscale serve --https=18790 off`.

## Logs and state

- Hermes: `<TI_DIR>/data/logs/agent.log` (plugin lines: `hermes_ui_plus`); docker `logs/gateways/default/current` and
  `docker logs hui-hermes-test`; native `<TI_DIR>/run/gateway.log`
- bridge: docker `journalctl --user -u hui-test-bridge`; native `<TI_DIR>/run/bridge.log` (no message content)
- watchdog kills (native): `<TI_DIR>/run/watchdog.log`
- sessions: `<TI_DIR>/data/` (default) and `<TI_DIR>/data/profiles/writer/`
- which Python the gateway runs: `start.sh` prints it (docker `/opt/hermes/.venv/bin/python` of the image; native the
  venv's)

## v0.22.2 (Mac) vs v0.22.0 (Linux), as seen

- Same API result: 12 PASS, 0 FAIL, 1 SKIP (`approvals_profile`, by design) and phase `off` 4 PASS.
- `/quick/config` reports `scope: "needed"` on both: the registration context is not bound to the profile in v0.22.2
  either, so the plugin enters its own profile's secret scope (`profile_scope`); `available: true`.
- `/p/writer/` answers (200) on the first start after `profile create` on both; no extra seeding step was needed (the
  writer profile only has to get its own `.env` with `API_SERVER_KEY`).
- v0.22.2 logs once `config migration skipped: This config predates version 12 … run hermes setup` for the hand-written
  `config.yaml` (no `_config_version`); harmless, v0.22.0 does not log it.
- Native v0.22.2: one gateway process serves both profiles and starts the plugin listener itself (`ps` shows a single
  Python for the whole instance). `data/installs/<key>/` appears on both versions; the gateway still runs from the
  interpreter we installed (checked in `ps`), nothing was switched.
- The "security posture audit" warning in `agent.log` (SSH password authentication) is about the host, not the instance.

## Remove

```bash
scripts/test-instance/ti.sh --host mac remove --yes   # asks first without --yes; docker flavor also --keep-image
```
