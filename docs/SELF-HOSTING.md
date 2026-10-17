# Self-hosting the Hermes UI+ bridge

Hermes Interactive UI+ has no cloud service. You run a small **UI-Bridge** next to your Hermes Agent, and your devices talk to it. This guide covers setup, Tailscale, device tokens, push, updates and troubleshooting. The complete variable reference is in [ROUTER.md](ROUTER.md) and [../bridge/README.md](../bridge/README.md).

```
app / web / desktop  --HTTPS-->  bridge (device token)  --HTTP-->  Hermes API server (API_SERVER_KEY)
```

> **Do not expose the bridge or Hermes to the public internet.** Hermes can run terminal and file tools. Anyone who can reach the API with a valid key can use them. Use a private network: a tailnet (recommended) or a trusted LAN. Do not use router port forwarding or `tailscale funnel`.

## Quick setup: the wizard (recommended)

Run this on the machine that hosts Hermes (Node.js 22+, check with `node --version`; see [Prerequisites](#1-prerequisites) if `npx` is missing or too old), as the user that should run the bridge:

```bash
npx hermes-ui-plus-bridge setup             # interactive
npx hermes-ui-plus-bridge setup --dry-run   # show the plan, change nothing
```

The wizard walks through everything in this guide:

1. **Hermes:** finds `$HERMES_HOME` (default `~/.hermes`), reads `platforms.api_server` from `config.yaml` (host, port, whether a key is set; the key is only read into memory and never printed), calls `/health` and shows the Hermes version. If the API server is off, it prints the exact snippet and restart command and offers to add the block (backup first) only after an explicit "y". It never restarts Hermes.
2. **Skill:** installs or updates `~/.hermes/skills/hermes-ui` (the old version goes to `~/.hermes/skill-backups/`). If you use Hermes profiles (`/p/<profile>/`), it lists them and asks whether to install there too.
3. **Optional features:** Web Push (generates VAPID keys and asks for a contact the push services can use: your e-mail address or an https URL; with `--yes` it takes `BRIDGE_PUSH_VAPID_SUBJECT` from the environment, else the bridge's https address). By default the bridge stays a pure pass-through to Hermes and the router is `heuristic` (rule based, no external call). The wizard asks once, default No: "Configure optional direct-provider extras (router, titles, image search, voice)?". Only with a "y" (or `--extras`) does it ask for the extras: image search (Serper or Brave key), voice (Groq, Deepgram) and an LLM router (Claude, Jev or Nace Drex, which also switches on generated titles and follow-ups). These call providers directly from the bridge, outside Hermes. Keys are typed with hidden input. Without an image search key, product cards show photos only when Hermes' answer carries one (its extract tool returned the page image); places, food and sights still get Wikipedia photos.
4. **Settings:** writes the env file (default `~/.config/hermes-ui-plus-bridge/env`, as root `/etc/hermes-ui-plus-bridge/env`) with mode 0600. Existing values and unknown keys are kept.
5. **Service:** a systemd user unit (`systemctl --user`, with the hardening options an unprivileged systemd supports), a hardened system unit when run as root (`DynamicUser`, `ProtectSystem=strict`, `ProtectHome`; needs a global install, `npm i -g hermes-ui-plus-bridge`), a launchd agent on macOS, or a compose snippet for Docker (`--service docker`). It starts the service and checks that the bridge answers. Inside a container (Hermes itself runs in Docker or Podman) there is no service manager: the wizard prints the start command, and you run the bridge in that container next to Hermes.
6. **Network:** with Tailscale running it offers `tailscale serve --bg --https=8790 http://127.0.0.1:8790` and sets `BRIDGE_PUBLIC_URL` to `https://<your-host>.<tailnet>.ts.net:8790`. Without Tailscale it shows the LAN address and warns that plain HTTP is unencrypted; listening on the LAN needs an explicit "y". Wrong address detected (for example a container's internal IP)? Pass the right one with `--public-url http://<lan-ip>:8790` (or an `https://` name of your TLS proxy).
7. **Pairing:** creates a one-time pairing code and prints the QR code, the pair link and, if the bridge serves the web app (`--web-dir`), a web-app link. Without an HTTPS address it also prints a web-app link for a browser on the bridge machine itself (`http://127.0.0.1:8790/#pair?...`); all links share the one code, so only the first one you open works. Running setup again replaces the unused link of the previous run (`devices list` shows one pending setup device, not one per run).

Flags: `--yes` (defaults, no questions), `--json` (report for scripts and agents; implies `--yes`), `--dry-run`, `--env-file`, `--hermes-home`, `--port`, `--https-port`, `--service auto|systemd|launchd|docker|none`, `--no-tailscale`, `--public-url`, `--web-dir`, `--profiles <list|all>`, `--no-skill`, `--no-pair`, `--extras`. With `--yes`, the extras are skipped unless you also pass `--extras`; their keys then come from environment variables (`SERPER_API_KEY`, `BRAVE_API_KEY`, `GROQ_API_KEY`, `DEEPGRAM_API_KEY`, `ANTHROPIC_API_KEY`, `TYPESAFE_API_KEY`, `NACE_API_KEY`), never from arguments. Without `--extras` those variables are ignored. Values already in an existing env file are never removed or changed by a re-run. Re-run the wizard to change or update anything; it works in place. Without a terminal (for example `</dev/null`) the questions take their defaults, like `--yes`.

`--env-file <file>` must point to an existing file: Node.js itself reads a `--env-file` argument and stops with `node: <file>: not found` before the wizard runs. For a new location create it first, for example `install -m 600 /dev/null ~/bridge.env`.

Prefer to let an agent do it? See [SETUP-WITH-AGENT.md](SETUP-WITH-AGENT.md) for copy-paste prompts for Hermes, Claude Code and Codex.

The rest of this guide explains each piece and the manual setup.

## 1. Prerequisites

- **Hermes Agent v0.21 or newer** with its API server enabled: in the Hermes environment file `~/.hermes/.env` set `API_SERVER_ENABLED=true` and a long random `API_SERVER_KEY` (for example `openssl rand -hex 32`), or in `~/.hermes/config.yaml` under `platforms.api_server` (`enabled: true`, and `host`, `port`, `key` under `extra:`). The API server is part of the **Hermes gateway**, so the gateway must run: `hermes gateway install` sets it up as a service (`hermes gateway status` to check; `hermes gateway restart` after a config change). In Docker or WSL without systemd, run `hermes gateway run` in the foreground or from your supervisor; after a config change stop it with Ctrl+C and start it again (`hermes gateway restart` only manages the service and can stop a foreground gateway without starting it again). Add the two settings only if they are missing: a second `API_SERVER_KEY` line replaces the first, and a client that copied the first one gets HTTP 401 (the README's step 1 has a snippet that checks first). Hermes itself in Docker: see [Hermes runs in Docker too](#hermes-runs-in-docker-too). The API server listens on `127.0.0.1:8642` by default, which is what you want when the bridge runs on the same machine.
- **Node.js 22+** or Docker on the machine that runs the bridge. The Hermes installer brings its own private Node.js, which is not on your `PATH`, so you may have no `npx` at all. Distribution packages are often too old (Ubuntu 24.04's `nodejs` is 18; the bridge then stops with "needs Node.js 22 or newer"). Install a current LTS from <https://nodejs.org/en/download>, for example with the NodeSource packages or nvm, then check `node --version`.
- The `hermes-ui` skill installed on Hermes (see [../hermes-skill/INSTALL.md](../hermes-skill/INSTALL.md)). Without it, Hermes answers in plain Markdown and you lose the interactive components.

Check the API server first:

```bash
curl http://127.0.0.1:8642/health                                                   # gateway and API server up
curl -H "Authorization: Bearer <your API_SERVER_KEY>" http://127.0.0.1:8642/v1/models  # key accepted
```

## 2. Run the bridge (manual setup)

The wizard above does all of this for you. By hand: create an env file. These are the settings most people need:

| Variable | Required | Meaning |
|---|---|---|
| `HERMES_BASE_URL` | yes | Where the bridge reaches Hermes, e.g. `http://127.0.0.1:8642` |
| `HERMES_API_KEY` | yes | Your Hermes `API_SERVER_KEY`. Stays on the server, never sent to apps |
| `BRIDGE_PUBLIC_URL` | for pairing | The URL your devices use, e.g. `https://<your-host>.<tailnet>.ts.net`. Also restricts accepted `Host` names |
| `BRIDGE_NAME` | no | Label shown in the app (default `Hermes`) |
| `BRIDGE_PAIRING` | no | `1` allows pairing from another machine with a one-time code. Needed with Docker |
| `BRIDGE_PAIR_SCHEME` | no | Scheme of the pairing QR code. Default `hermesuiplus` (the HUI+ app); leave it unless you run a self-built app with another scheme |
| `BRIDGE_TOKEN` | no | Admin token. If unset, a random one is generated and stored in the state directory |
| `BRIDGE_STATE_DIR` | no | Tokens, device list, push registrations, uploads, image proxy cache. Default `~/.local/state/hermes-ui-bridge`. Pairing needs it (device list) |
| `BRIDGE_PAIR_ADMIN_TOKEN` | no | **Unsafe**, legacy: `1` lets pairing without a state directory put the admin token `BRIDGE_TOKEN` into the link (a permanent credential). Default off: pairing then refuses |
| `BRIDGE_HOST` / `BRIDGE_PORT` | no | Default `127.0.0.1` / `8790`. Keep loopback when a proxy such as `tailscale serve` is in front |
| `BRIDGE_WEB_DIR` | no | Serve a built web app (PWA) from the bridge itself, same origin as the API (see section 5) |
| `BRIDGE_WEB_CSP` | no | Content-Security-Policy of the served web app: `on` (default), `report-only` (browser console only) or `off` |
| `BRIDGE_CORS_ORIGINS` | no | Extra browser origins, comma separated (e.g. `tauri://localhost` for the desktop app) |
| `BRIDGE_UPLOAD_MAX_BYTES` | no | Largest single upload. Default 20 MB |
| `BRIDGE_UPLOAD_QUOTA_MB` | no | Total size of the upload folder. When full, expired uploads are deleted first, then new uploads are refused (507). Default `500`, `0` = no limit |
| `BRIDGE_UPLOAD_MAX_INFLIGHT` / `BRIDGE_UPLOAD_MAX_INFLIGHT_TOTAL` | no | Uploads running at the same time per token / in total. Default `2` / `6` |
| `BRIDGE_UPSTREAM_TIMEOUT_MS` | no | Timeout for the short Hermes calls (health, sessions, models, run status, approvals). Default `30000`. Streamed chat answers are not limited |
| `BRIDGE_REQUEST_TIMEOUT_MS` | no | Time a client has to send its complete request (slow uploads). Default `300000` (5 min); headers must arrive within 30 s |
| `BRIDGE_HERMES_PLUGIN_URL` / `BRIDGE_HERMES_PLUGIN_SECRET_FILE` | no | Schnellfrage (⚡) through the optional Hermes plugin `hermes-ui-plus` ([HERMES-PLUGIN.md](HERMES-PLUGIN.md)): its loopback URL (default `http://127.0.0.1:8646`) and the secret file the installer wrote (readable by the bridge user; the setup wizard fills it in when it finds the plugin, and a root install's hardened unit gets it through `LoadCredential=` instead). Without the plugin ⚡ is not shown. Enable the plugin in Hermes' `config.yaml` (`plugins.enabled`), not with `hermes plugins enable`. `BRIDGE_QUICK=off` disables it; limits `BRIDGE_QUICK_RATE` (per device and minute, default `20`), `BRIDGE_QUICK_DAILY` (default `300`) |
| `BRIDGE_PUSH_PREVIEW` | no | `1` shows message text in push notifications. Default off. More push settings: section 6 |
| `BRIDGE_PROFILES` | no | Hermes profiles ("bots") the app may use. Default `auto`: every profile in `HERMES_HOME/profiles/` (needs read access to the Hermes home; without it any valid name is passed on and Hermes decides). Or a comma list such as `research,work=Work bot`, or `off`. The generated system service cannot read your home directory (`ProtectHome`): the setup wizard writes the list for it (re-run it after adding a profile), or enter the bots in the app's connection settings. On Hermes v0.22 every profile's own `.env` needs the same `API_SERVER_KEY` as `HERMES_API_KEY` here, else its requests answer 401 |
| `BRIDGE_APPROVAL_TIMEOUT_S` | no | How long an approval request is treated as open (app banner, approval push) after Hermes asked. Default `300`; match Hermes' own approval timeout |
| `BRIDGE_MAX_CONCURRENT_TURNS` / `BRIDGE_MAX_TURNS_TOTAL` | no | Chat turns running at the same time per device token / in total (a turn counts until Hermes finished it). Default `8` / `16` |
| `BRIDGE_RESUME` | no | `off` disables idempotent send and stream resume for chat turns (docs/BRIDGE.md). Limits: `BRIDGE_RESUME_TURN_KB` (2048 per turn), `BRIDGE_RESUME_TOTAL_MB` (32 in total), `BRIDGE_RESUME_RETAIN_MS` (600000) |
| `BRIDGE_MAX_HEALTH_INFLIGHT` | no | Unauthenticated `/health` pass-throughs to Hermes in flight at once; more get `503`. Default `4` |
| `BRIDGE_ROUTER_EFFORT` (alias `ROUTER_EFFORT`) | no | Reasoning effort of a model router: `low` (default), `medium`, `high`. Only with a model `ROUTER_BACKEND` |
| `BRIDGE_ROUTER_CACHE_TTL_MS` | no | How long a router decision for the same message is reused. Default `3600000` (1 h); size: `BRIDGE_ROUTER_CACHE_SIZE` (2000) |
| `BRIDGE_IMAGE_PROXY` | no | `off` disables the image proxy (`GET /bridge/img`) that shows product / place photos from Hermes' answers without exposing your phone's IP to the image host. Default `on`. No keys; see [BRIDGE.md](BRIDGE.md#image-proxy) |
| `BRIDGE_IMAGE_PROXY_CACHE_MB` | no | Disk cache of the image proxy in `<BRIDGE_STATE_DIR>/image-cache`. Default `200`, `0` = no cache. Entries live 24 h |
| `BRIDGE_IMAGE_PROXY_RATE_LIMIT` | no | Uncached image proxy fetches per device and minute. Default `120` |
| `ANTHROPIC_API_KEY` | no | Key for the Claude extras. The key alone enables nothing: the Claude router needs `ROUTER_BACKEND=claude`, titles and follow-ups need `BRIDGE_META=on`. So a key exported in your shell is never used by accident |
| `ROUTER_BACKEND` | no | `heuristic` (default: rule based, no external call), `claude`, `jev`, `nace` (Nace.AI Drex, with `NACE_API_KEY`; `NACE_MODEL` default `drex-v2.0`, `NACE_BASE_URL` for a self-hosted Drex), `openai` (OpenAI-compatible, with `BRIDGE_ROUTER_BASE_URL`), `off`, or a fallback chain like `jev,claude` or `nace,claude`. A leading `heuristic` (`heuristic,jev`) is heuristic-first: the model is only asked when no rule fired or the message is not German, English or Spanish. Direct-provider extra unless `heuristic`/`off`. Jev and Drex receive the same data as the Claude router: the last few messages, shortened |
| `BRIDGE_META` | no | `on` enables generated chat titles and follow-up suggestions via Claude (needs `ANTHROPIC_API_KEY`). Default: off |
| `GROQ_API_KEY`, `OPENAI_API_KEY`, `DEEPGRAM_API_KEY`, `ELEVENLABS_API_KEY` | no | Direct-provider extra, voice: speech-to-text and text-to-speech. A feature without a key is simply off |

Example `.env`:

```ini
HERMES_BASE_URL=http://127.0.0.1:8642
HERMES_API_KEY=<your API_SERVER_KEY>
BRIDGE_PUBLIC_URL=https://<your-host>.<tailnet>.ts.net
```

Keep this file readable only by you (`chmod 600 .env`).

### With Node (npx)

```bash
npx hermes-ui-plus-bridge --env-file .env --pair
```

On start the bridge checks Hermes, prints which optional features are active (including a `direct providers:` line that names every extra calling a provider outside Hermes, or says it is a pure Hermes pass-through), and with `--pair` shows a pairing QR code. To run it as a service, let `npx hermes-ui-plus-bridge setup --env-file .env` write the unit (it keeps your values), or use systemd yourself with `StateDirectory=hermes-ui-bridge`, `BRIDGE_STATE_DIR` and `EnvironmentFile=` pointing at your env file.

### With Docker

There is **no prebuilt image in 0.1**: you build it from a git checkout (Node.js on the host is only needed for
`npm run bundle-skill`, see below for a way without it).

```bash
cd bridge                         # in a git checkout of the repository
npm run bundle-skill              # copies the skill + bootstrap message into ./skill (the image needs them)
cp docker-compose.example.yml docker-compose.yml
printf 'HERMES_BASE_URL=http://host.docker.internal:8642\nHERMES_API_KEY=<key>\nBRIDGE_PUBLIC_URL=https://<your-host>.<tailnet>.ts.net\nBRIDGE_PAIRING=1\n' > .env
docker compose up -d --build
docker compose logs bridge        # "[ok] hermes-ui skill installed in Hermes" and the pairing page path /bridge/pair?code=XXXX-XXXX
docker compose exec bridge node bin/hermes-ui-bridge.mjs devices add "Phone"   # or: a pair link + QR code right away
```

**Install the skill into Hermes, too.** The image carries only the bootstrap message that tells Hermes to use the
skill; the skill itself (`hermes-skill/hermes-ui`) must be in Hermes' skills folder. Without it every answer is plain
text with a tool error ("Skill 'hermes-ui' not found"), and the bridge log says `hermes-ui skill is NOT installed in
Hermes`. No Hermes restart is needed; start a new chat afterwards. Hermes 0.21.5 to 0.22.2 cannot list their skills over
the API (HTTP 500), so for this check the bridge reads Hermes' skills folder: uncomment the read-only Hermes home volume
and `HERMES_HOME` in the compose file (otherwise the log says "could not check").

```bash
# Hermes on the host:
mkdir -p ~/.hermes/skills && cp -r ../hermes-skill/hermes-ui ~/.hermes/skills/
# Hermes in Docker with its data in ~/.hermes (mounted as /opt/data; the folder belongs to the container's user):
sudo mkdir -p ~/.hermes/skills && sudo cp -r ../hermes-skill/hermes-ui ~/.hermes/skills/
sudo chown -R --reference ~/.hermes ~/.hermes/skills/hermes-ui
# check: the skill is listed
hermes skills list | grep hermes-ui      # Docker: docker exec <hermes-container> hermes skills list | grep hermes-ui
```

Page code and pair link have different lifetimes: the `/bridge/pair?code=…` page code from the log works once within
10 minutes; the pair link (QR) that page shows, and every link from `devices add`, works once within 1 hour.

With `BRIDGE_PAIRING=1` open the logged `/bridge/pair?code=…` path on the bridge URL (for example
`https://<your-host>.<tailnet>.ts.net/bridge/pair?code=XXXX-XXXX`). Opening a bare `/bridge/pair` from the Docker host does
not work: behind Docker's port mapping the request does not come from loopback.

**Web app in Docker:** unpack the bundle into `./web` next to `docker-compose.yml` and uncomment `BRIDGE_WEB_DIR: /web`
and the `./web:/web:ro` volume in the compose file ([WEB-APP.md](WEB-APP.md)):

```bash
mkdir -p web && tar -xzf hermes-ui-plus-web-<version>.tar.gz -C web --strip-components=1
docker compose up -d
```

The image is built locally, runs as an unprivileged user, and keeps its state in a volume. It contains the bootstrap system message that makes Hermes use the app's interactive components; the build stops with a clear message if `npm run bundle-skill` was not run (without Node on the host: `mkdir -p skill && cp -r ../hermes-skill/hermes-ui ../hermes-skill/bootstrap-system-message.txt skill/`). At startup the bridge prints a `skill` line; it says `MISSING` and logs a warning if the message could not be found. The port is published on loopback only, which is intentional. Hermes must listen on an address the container can reach (`host.docker.internal` is mapped to the host in the example compose file). The image's healthcheck calls `GET /bridge/live`, which needs no token and answers only "ok".

### Hermes runs in Docker too

Three things differ from a Hermes installed on the host (the official image `nousresearch/hermes-agent`, data folder
mounted at `/opt/data`):

1. **The API server listens on 127.0.0.1 inside the Hermes container** by default, so neither the host nor another
   container reaches it, and a published `-p 8642:8642` leads nowhere. Set `API_SERVER_HOST=0.0.0.0` in Hermes' `.env`.
   Then do **not** publish port 8642: with `0.0.0.0` that would open Hermes' API (terminal and file tools) to your network.
2. **Put Hermes and the bridge on one Docker network** and point the bridge at Hermes by name:
   `HERMES_BASE_URL=http://hermes:8642` (the service or container name). `docker-compose.with-hermes.example.yml` in
   `bridge/` runs both services that way, with the setup steps in its header. A Hermes you started with `docker run`:
   `docker network create hui && docker network connect hui <hermes-container>`, and attach the bridge to the `hui` network.
3. **The data folder belongs to the container's user**, so `printf … >> ~/.hermes/.env` fails with "Permission
   denied". Edit Hermes' `.env` through the container (README step 1 has the `docker exec` snippet that only adds
   missing lines), or start Hermes with `-e HERMES_UID=$(id -u) -e HERMES_GID=$(id -g)` so the files stay yours (the
   compose file above does that). The skill goes into `<data folder>/skills/hermes-ui` (see "Install the skill" above).

After a change to Hermes' `.env`, restart the Hermes container (`docker restart <hermes-container>`). Check from the
bridge: `docker compose logs bridge` shows `[ok] Hermes reachable`, `[ok] API key accepted` and
`[ok] hermes-ui skill installed in Hermes`.

## 3. Reach the bridge from your devices

The bridge speaks plain HTTP. Your phone needs HTTPS (and the web app needs it for service workers and push), so put a TLS proxy in front.

### Recommended: Tailscale

Tailscale gives every device a private address, and `tailscale serve` adds an automatic, valid HTTPS certificate. Only devices on your tailnet can connect.

1. Create a tailnet and install Tailscale on the bridge machine: <https://tailscale.com/download>. Sign in and run `sudo tailscale up`.
2. In the admin console (<https://login.tailscale.com/admin/dns>), enable **MagicDNS** and **HTTPS certificates**.
3. Install Tailscale on your phone and computers and sign in to the same tailnet.
4. On the bridge machine, publish the bridge to your tailnet:

   ```bash
   tailscale serve --bg 8790
   tailscale serve status
   ```

   The status shows your address, `https://<your-host>.<tailnet>.ts.net`.
5. Set `BRIDGE_PUBLIC_URL` to that address and restart the bridge.
6. On your phone (with Tailscale on), open that address in a browser. A short JSON or text response means it works.

`tailscale serve` is tailnet-only. **Never use `tailscale funnel`** for this, because it publishes the service to the whole internet.

For extra safety, use Tailscale ACLs to allow only your own devices to reach the bridge machine.

### Alternative: LAN only

If you do not want Tailscale, use the bridge on your home network only.

- Easiest with a TLS proxy such as Caddy or nginx on the bridge machine, with a certificate for a name that resolves on your LAN (for example from a private CA, or a real domain pointing at a private address). Set `BRIDGE_PUBLIC_URL` to that `https://` name.
- Plain `http://<lan-ip>:8790` works for quick tests from the Android app and in a browser tab, but the web app cannot be installed, has no offline copy and no push there, and your token travels unencrypted over the network. Use it only on a network you fully trust.
- For a first test without any of this, use a browser on the bridge machine itself: `http://127.0.0.1:8790` counts as a secure origin, and the wizard prints a matching web-app pair link. On a headless server, forward the port from your computer with `ssh -L 8790:127.0.0.1:8790 <user>@<server>` and open that same link there.
- Do not forward the port on your router. Remote access from outside should go through a VPN such as Tailscale or WireGuard, not an open port.

## 4. Pair devices and manage device tokens

Every pairing QR or link carries a **one-time pairing code**, never a token. The app trades the code for its own device token when you tap **Connect** on its connection screen (`POST /bridge/pair/redeem`); scanning or opening the link alone sends nothing. The code works once and expires after one hour; a link that leaks after that (chat, screenshot, log) is worthless. The admin token (`BRIDGE_TOKEN`) is never put into a QR with the defaults. Pairing needs the state directory (device list); without it the bridge refuses to pair instead of handing out the admin token.

- **From the bridge machine:** start with `--pair`, or open `http://127.0.0.1:8790/bridge/pair` in a browser on that machine. In the app: **Scan QR code**.
- **From another machine or Docker:** set `BRIDGE_PAIRING=1`. The log prints a one-time page code and a path like `/bridge/pair?code=XXXX-XXXX`. Open `<BRIDGE_PUBLIC_URL>/bridge/pair?code=...`. The page code works once within 10 minutes (5 wrong codes lock pairing for 10 minutes); the QR / pair link the page then shows works once within 1 hour, like every pair link. For another device run `devices add` or restart the bridge for a new page code.
- **Pair link instead of QR:** the QR content is a `hermesuiplus://pair?...` link. The pairing page shows it, so you can open it on the same device.

Manage devices:

```bash
npx hermes-ui-plus-bridge devices list
npx hermes-ui-plus-bridge devices add "Tablet"      # prints a new QR code / link (one-time code, 1 hour), and a web-app link if the bridge serves the web app
npx hermes-ui-plus-bridge devices revoke <id>
```

These read the env file the wizard wrote (`~/.config/hermes-ui-plus-bridge/env`, as root `/etc/hermes-ui-plus-bridge/env`). If yours lives elsewhere, add `--env-file <file>`.

The same operations exist over HTTP with the admin token: `GET /bridge/devices`, `POST /bridge/devices {"label": "..."}` (answers with the pair link, not a token), `DELETE /bridge/devices/<id>`. A revoked device is locked out within about two seconds; revoking a pending device also invalidates its pairing code.

If a device is lost, revoke it. If the admin token leaks, set a new `BRIDGE_TOKEN` and re-pair your devices. Do not share screenshots of QR codes.

## 5. Web app and desktop

The web app is a static PWA. Download the prebuilt release bundle, or build it yourself with `scripts/build-web.sh` (see [BUILD.md](BUILD.md)). Step-by-step install: [WEB-APP.md](WEB-APP.md).

Simplest: let the bridge serve it. Set `BRIDGE_WEB_DIR=/path/to/dist/web` (or run `setup --web-dir /path/to/dist/web`). The bridge then serves the app at `/` on the same origin as the API, so no CORS entry is needed. Precompressed `.br` / `.gz` files from the build are used when the browser accepts them; files outside the folder, hidden files and symlinks pointing out of it are never served. The wizard prints a web pair link of the form `https://<your-host>.<tailnet>.ts.net:8790/#pair?u=...`.

Or host the output folder separately on your tailnet, for example:

```bash
tailscale serve --bg --https=443 /path/to/dist/web
```

If the web app and the bridge are on different origins, add the web origin to `BRIDGE_CORS_ORIGINS`. The macOS and Linux desktop apps need `tauri://localhost` there. The pair link can be opened directly in the browser and pairs the web app.

## 6. Push notifications (optional)

Push tells you when a long answer is finished or when Hermes waits for an approval. It is optional. Without it, the app still updates while it is open.

Message previews are **off by default**: a notification only says that something arrived. Set `BRIDGE_PUSH_PREVIEW=1` to include text. Be aware that with FCM or APNs, preview text then passes through Google or Apple.

### Web Push (PWA and desktop browsers)

No Apple or Google account needed, only a VAPID key pair. The setup wizard creates one when you accept Web Push (re-run `npx hermes-ui-plus-bridge setup` to add it later). By hand, from the `bridge/` directory of a git checkout:

```bash
node -e "import('./src/push/webpush.mjs').then(m=>console.log(m.generateVapidKeys()))"
```

Store the private key in a file (`chmod 600`) and set:

```ini
BRIDGE_PUSH_VAPID_PUBLIC_KEY=<publicKey>
BRIDGE_PUSH_VAPID_PRIVATE_KEY_FILE=/path/to/vapid-private.key
BRIDGE_PUSH_VAPID_SUBJECT=mailto:<your address>
```

The subject is the contact push services see (an e-mail address or an https URL). Without it the bridge uses its own
`https://` address (`BRIDGE_PUBLIC_URL`), else the placeholder `mailto:admin@localhost`, which reaches nobody.

Then enable notifications in the web app's settings (the permission prompt needs a tap). On iPhone and iPad, Web Push works only for the app installed to the home screen (iOS 16.4+). Push endpoints are operated by the browser vendor (Google, Mozilla, Apple), but the payload is encrypted end to end to your device.

### FCM (Android) and APNs (iOS), for self-built apps

These need your own Firebase project or Apple developer account, and an app build that contains your `google-services.json` or push entitlement. They are only needed if you build the app yourself.

```ini
BRIDGE_PUSH_FCM_SERVICE_ACCOUNT_FILE=/path/to/service-account.json
BRIDGE_PUSH_APNS_KEY_FILE=/path/to/AuthKey.p8
BRIDGE_PUSH_APNS_KEY_ID=<key id>
BRIDGE_PUSH_APNS_TEAM_ID=<team id>
```

The bridge needs outbound HTTPS to the respective push services.
`BRIDGE_PUSH_APNS_TOPIC` is your app's bundle id (default `xyz.hermesui.app`, the official app; set it for any self-built iOS app).

### How push finds new messages, and its settings

Hermes' API server cannot push to clients, so the bridge watches Hermes' sessions (`GET /api/sessions` and their
messages) and reports assistant messages it did not stream itself: answers that finished after the app went away,
background results, and optionally cron reports. While an app has the live inbox open (`GET /bridge/inbox/stream`) it
gets them there; otherwise as a push notification. All settings are optional:

| Variable | Default | Meaning |
|---|---|---|
| `BRIDGE_PUSH` | on | `off` disables push and the live inbox completely |
| `BRIDGE_PUSH_VAPID_PUBLIC_KEY`, `BRIDGE_PUSH_VAPID_PRIVATE_KEY_FILE` (or `BRIDGE_PUSH_VAPID_PRIVATE_KEY`), `BRIDGE_PUSH_VAPID_SUBJECT` | – | Web Push keys (above). Prefer the key file over the inline key |
| `BRIDGE_PUSH_SOURCES` | `api_server` | Hermes session sources to watch, comma separated: `api_server` (the app's own chats), `cron` (scheduled jobs) |
| `BRIDGE_PUSH_CRON` | `delivered` | With `cron` in the sources: `delivered` reports only jobs that Hermes delivers somewhere (not `deliver: local/none`), `all` every run, `off` none |
| `BRIDGE_PUSH_SESSION_PREFIX` | `hui-` | Only `api_server` sessions whose id starts with this prefix (the ones this app created) are watched |
| `BRIDGE_PUSH_APPROVALS` | on | `off`: no push for approval requests |
| `BRIDGE_PUSH_TITLE` | `Hermes` | Notification title |
| `BRIDGE_PUSH_POLL_MS` | `30000` | Poll interval while no app is connected |
| `BRIDGE_PUSH_LIVE_POLL_MS` | `8000` | Poll interval while an app has the live inbox open |
| `BRIDGE_PUSH_SETTLE_MS` | `15000` | A session must be quiet this long before its new message is reported (avoids half-finished answers) |
| `BRIDGE_PUSH_COALESCE_MS` | `15000` | Notifications for the same chat within this window are merged into one |
| `BRIDGE_PUSH_HOOK_SECRET` | – | Enables `POST /bridge/hermes-hook`: point Hermes' outbound webhook (`hooks.outbound`, event `post_llm_call`) at `<bridge>/bridge/hermes-hook` with this secret. The HMAC-signed call (`X-Hermes-Signature-256`) only triggers an immediate poll, for lower latency. Without the secret the route answers `404` |
| `BRIDGE_PUSH_HOOK_READ_MS` | `10000` | Deadline for reading the (unauthenticated until verified) hook request body |

## 7. Updating

- **Wizard:** `npx hermes-ui-plus-bridge@latest setup` updates the skill (with backup), the env file and the service in place, and restarts only the bridge. With a global install: `npm i -g hermes-ui-plus-bridge@latest`, then `hermes-ui-plus-bridge setup`. There is also an update prompt in [SETUP-WITH-AGENT.md](SETUP-WITH-AGENT.md).
- **npx:** run `npx hermes-ui-plus-bridge@latest ...`, or update your global install.
- **Docker:** `git pull && npm run bundle-skill && docker compose up -d --build`. State is kept in the volume.
- **Skill:** `hermes skills update`, or re-copy `hermes-skill/hermes-ui/`. New conversations pick it up; running ones keep the old text.
- **Apps:** Obtainium updates the Android APK; web and desktop builds are rebuilt from the repo.

Update the bridge and the skill together when the release notes say so, since new answer components need both. Read [../CHANGELOG.md](../CHANGELOG.md) first.

## 8. Troubleshooting

First steps: `npx hermes-ui-plus-bridge setup --dry-run` lists what is missing, and the troubleshooting prompt in [SETUP-WITH-AGENT.md](SETUP-WITH-AGENT.md) lets an agent on the server run all checks below for you.

| Symptom | Check |
|---|---|
| `npx: command not found`, or "needs Node.js 22 or newer" | Install a current Node.js LTS (section 1). The Node.js inside the Hermes install is private and not on your `PATH`. |
| `node: <file>: not found` right after starting a command with `--env-file` | The file does not exist yet; Node.js checks `--env-file` itself. Create it (`install -m 600 /dev/null <file>`) or leave the option out. |
| `curl http://127.0.0.1:8642/health` fails | The Hermes gateway is not running or the API server is off: `hermes gateway status`, then section 1. |
| Bridge warns "Hermes not reachable at ..." | Is the gateway running? `hermes gateway status`. Started with `hermes gateway run` in a terminal, it must still run there (`hermes gateway restart` can stop it without starting it again). `HERMES_BASE_URL` correct? From Docker, `127.0.0.1` is the container itself: use `host.docker.internal`, or the Hermes container's name on a shared network with `API_SERVER_HOST=0.0.0.0` ([Hermes runs in Docker too](#hermes-runs-in-docker-too)). Is the API server enabled? Run the `curl` from section 1. |
| Hermes returns 401 | `HERMES_API_KEY` must equal Hermes' `API_SERVER_KEY`. More than one `API_SERVER_KEY` line in Hermes' `.env` (`grep -c '^API_SERVER_KEY=' ~/.hermes/.env`)? The last one counts; delete the others and copy that one. |
| Bridge warns "hermes-ui skill is NOT installed in Hermes" | Install the skill into Hermes' skills folder: `npx hermes-ui-plus-bridge setup` on the Hermes host, or by hand ([With Docker](#with-docker), [INSTALL.md](../hermes-skill/INSTALL.md)). No restart needed; start a new chat. "could not check" means Hermes could not list its skills (HTTP 500 on Hermes 0.21.5 to 0.22.2) and the bridge cannot see Hermes' skills folder: check with `hermes skills list`, or give the bridge read access (Docker: mount Hermes' data folder read-only and set `HERMES_HOME`, as `docker-compose.with-hermes.example.yml` does). |
| App cannot connect | Is Tailscale on, on the phone? Does the `https://<your-host>.<tailnet>.ts.net` address open in the phone's browser? Does `BRIDGE_PUBLIC_URL` match it exactly? A wrong `Host` is refused with status 421. |
| Pairing page answers 403 ("wrong or expired pairing code") or asks for a code | Remote pairing needs `BRIDGE_PAIRING=1`. Behind a proxy, requests are not "local" on purpose. Use the one-time code from the log: it works once, within 10 minutes of the bridge start. After that run `devices add` (or restart the bridge for a new page code). |
| QR expired / "Invalid or expired pairing code" | Run `devices add`, reload the pairing page or restart with `--pair` for a new one. A pairing code works once and expires after one hour. |
| Pairing page answers 503 "pairing needs a device store" | The bridge has no state directory: set `BRIDGE_STATE_DIR` (and do not set `BRIDGE_DEVICE_TOKENS=0`). |
| Web app: "Refused to … Content Security Policy" in the browser console | Report it as a bug; meanwhile `BRIDGE_WEB_CSP=report-only`. |
| Answers are plain text, no components | Is the skill installed and visible (`hermes skills list`)? The bridge's startup log has a line about it. Is the bridge sending its bootstrap message (it does by default)? Start a new conversation after installing the skill. Docker: the bridge image does not install the skill into Hermes ([With Docker](#with-docker)). |
| Web app: network error in the browser console | CORS: add the web app's origin to `BRIDGE_CORS_ORIGINS`. |
| No voice buttons | No speech provider key set on the bridge. |
| Uploads rejected | File too large or type not allowed (`BRIDGE_UPLOAD_MAX_BYTES`, `BRIDGE_UPLOAD_ALLOWED_MIME`); 507 = upload folder full (`BRIDGE_UPLOAD_QUOTA_MB`); 429 = too many uploads at once. |
| Push never arrives | Check section 6 settings, the device's notification permission, and the bridge log. On iOS, Web Push needs the home-screen app. |

For more detail, set `BRIDGE_LOG_LEVEL=debug`. Logs contain routing metadata, not message content. Redact hostnames and tokens before sharing logs in an issue.
