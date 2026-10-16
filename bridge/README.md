# Hermes UI+ Bridge

Optional companion for the Hermes Interactive UI+ app (npm package `hermes-ui-plus-bridge`; the older command name
`hermes-ui-bridge` still works, and state paths such as `~/.local/state/hermes-ui-bridge` keep their names). It sits between the app and your Hermes Agent API server and adds:
presentation routing (the app picks the right UI component per answer), file uploads, voice (speech-to-text and
text-to-speech), titles/follow-ups, and QR pairing. The app also works against Hermes directly; run the bridge
only if you want these extras. Your Hermes API key never leaves the bridge.

```
app --HTTPS--> bridge (BRIDGE_TOKEN) --HTTP--> Hermes API server (HERMES_API_KEY)
```

Requirements: Node.js 22 or newer, or Docker. Full reference (all variables, wire contracts): `docs/ROUTER.md`.

## Setup wizard (recommended)

On the Hermes host:

```sh
npx hermes-ui-plus-bridge setup            # interactive; --dry-run shows the plan, --yes takes defaults, --json for agents
```

It detects Hermes (`$HERMES_HOME` or `~/.hermes`, `platforms.api_server` in `config.yaml`, `/health`, version), installs or
updates the `hermes-ui` skill (with a backup), asks for optional features, writes the env file
(`~/.config/hermes-ui-plus-bridge/env`, 0600), installs a systemd user unit (system unit as root, launchd on macOS,
compose snippet for Docker), runs `tailscale serve` if you agree, checks the bridge and prints a pair QR code and link.
Hermes' config is only changed after an interactive "y"; Hermes is never restarted. Re-run it to update in place.
Without explicit `--yes`, stdin EOF declines confirmations, including publishing through `tailscale serve`; it does
not accept a question's interactive Yes default. Explicit `--yes` continues to use the documented defaults.
All options: `hermes-ui-plus-bridge setup --help`. Agent prompts: `docs/SETUP-WITH-AGENT.md`.

## Quick start by hand (npx / Node)

```sh
cat > .env <<'ENV'
HERMES_BASE_URL=http://127.0.0.1:8642
HERMES_API_KEY=<your Hermes API_SERVER_KEY>
BRIDGE_PUBLIC_URL=https://bridge.example.net
ENV
npx hermes-ui-plus-bridge --env-file .env --pair
```

On start the CLI checks Hermes (`/health`, then `/v1/models` with your key), prints which optional features are
active, and with `--pair` shows a QR code. In the app choose "Scan QR code".

Options: `--env-file <file>` (repeatable; real environment variables win), `--pair`, `--port`, `--host`,
`--state-dir`, `--no-check`, `--strict` (exit if Hermes is unreachable), `--help`, `--version`.
From a source checkout: `cd bridge && npm ci && node bin/hermes-ui-bridge.mjs --env-file .env` (the bin file keeps its name).

### Token and state

If `BRIDGE_TOKEN` is not set, a random token is generated on first run and saved in
`<state-dir>/state.json` (file mode 0600, directory 0700) and reused on later runs. Default state dir:
`$BRIDGE_STATE_DIR`, else `$XDG_STATE_HOME/hermes-ui-bridge`, else `~/.local/state/hermes-ui-bridge`.
Uploads default to `<state-dir>/uploads`. Set `BRIDGE_TOKEN` yourself to override (then nothing is written).

### Optional features (the CLI prints which are active)

| feature | turned on by |
|---|---|
| router | always (rule based). `ROUTER_BACKEND=claude` + `ANTHROPIC_API_KEY` adds Claude (opt-in extra; a key alone does nothing) |
| uploads | always, `BRIDGE_UPLOAD_DIR` |
| voice | `GROQ_API_KEY` or `OPENAI_API_KEY` (speech-to-text); `DEEPGRAM_API_KEY`, `ELEVENLABS_API_KEY` or `OPENAI_API_KEY` (text-to-speech) |
| meta (titles, follow-ups) | `BRIDGE_META=on` + `ANTHROPIC_API_KEY` (opt-in extra; a key alone does nothing) |
| QR pairing | always from the bridge machine; remotely with `BRIDGE_PAIRING=1` (each QR carries a one-time pair code that the app exchanges for its own device token) |

## Docker

```sh
cd bridge                           # in a git checkout of the repository
npm run bundle-skill                # copies the skill + bootstrap message into ./skill (the image needs them)
cp docker-compose.example.yml docker-compose.yml
printf 'HERMES_BASE_URL=http://host.docker.internal:8642\nHERMES_API_KEY=<key>\nBRIDGE_PUBLIC_URL=https://bridge.example.net\nBRIDGE_PAIRING=1\n' > .env
docker compose up -d --build
docker compose logs bridge          # shows the pairing page path /bridge/pair?code=XXXX-XXXX (10 minutes)
docker compose exec bridge node bin/hermes-ui-bridge.mjs devices add "Phone"   # pair link + QR code
```

There is no prebuilt image in 0.1: build it from a checkout as above. The image is `node:22-alpine`, runs as the
unprivileged `node` user, keeps token and uploads in the volume `/var/lib/hermes-ui-bridge`, and has a healthcheck.
For the web app, uncomment `BRIDGE_WEB_DIR: /web` and the `./web:/web:ro` volume in the compose file and unpack the
web bundle into `./web` (`tar -xzf hermes-ui-plus-web-<version>.tar.gz -C web --strip-components=1`).
The build fails with a clear message if `skill/` is missing. Without Node on the host, copy it by hand:
`mkdir -p skill && cp -r ../hermes-skill/hermes-ui ../hermes-skill/bootstrap-system-message.txt skill/`.
Plain `docker run` (from the repository root):

```sh
(cd bridge && npm run bundle-skill)
docker build -t hermes-ui-plus-bridge bridge
docker run -d --name hermes-ui-plus-bridge -p 127.0.0.1:8790:8790 -v hermes-ui-bridge:/var/lib/hermes-ui-bridge \
  -e HERMES_BASE_URL=http://host.docker.internal:8642 --add-host host.docker.internal:host-gateway \
  -e HERMES_API_KEY=... -e BRIDGE_PUBLIC_URL=https://bridge.example.net -e BRIDGE_PAIRING=1 hermes-ui-plus-bridge
```

Get the generated token if you need it: `docker compose exec bridge cat /var/lib/hermes-ui-bridge/state.json`.
Pass `--pair` (compose: `command: ["--pair"]`) to print the QR into `docker compose logs`.

## Serving the web app

`BRIDGE_WEB_DIR=/path/to/dist/web` serves a built web app (`scripts/build-web.sh`) at `/` on the bridge's own origin
(GET/HEAD outside `/v1`, `/api`, `/bridge`, `/health`; no auth, it is a public bundle). Precompressed `.br`/`.gz`
siblings are preferred, other text is gzipped on the fly. Paths with dot segments or encoded dots/slashes are refused,
hidden files are not served, and files are resolved by real path, so symlinks cannot leave the folder. Client-side
routes without a file extension fall back to `index.html`. The web pair link is `https://<bridge>/#pair?u=...&c=...`.
HTML pages carry a Content-Security-Policy (`BRIDGE_WEB_CSP=on|report-only|off`, see docs/BRIDGE.md).

## Making the bridge reachable from your phone

The bridge speaks plain HTTP and listens on `127.0.0.1:8790` (in Docker: all interfaces inside the container,
publish it to loopback). Put TLS in front, e.g. a reverse proxy, a tunnel, or `tailscale serve --bg 8790`, and set
`BRIDGE_PUBLIC_URL` to the resulting `https://...` address.

## Pairing

The QR code encodes `hermesuiplus://pair?u=<public url>&c=<one-time code>&n=<name>` (values URL-encoded). The app trades
`c=` once for its own device token: `POST /bridge/pair/redeem {"code"}` → `{token, deviceId, name}` (unauthenticated,
rate limited; the code works once and expires after 1 hour; unknown / used / expired codes all get `410`). `BRIDGE_PAIR_SCHEME`
selects another scheme the apps understand: `hermesui` (personal builds) or `hermesiui` (apps from before the rename).
Scanning in-app accepts all three; the scheme only decides which installed app the system camera opens.

* From the bridge machine: open `http://127.0.0.1:8790/bridge/pair` (also `/bridge/pair.svg`, `/bridge/pair.png`),
  or start with `--pair`. A request only counts as "local" when it comes straight from loopback, carries no proxy
  headers, has a loopback `Host` (`127.0.0.1`, `localhost`, `[::1]`) and is not a cross-site browser request. A
  reverse proxy that adds no forwarding headers (plain nginx `proxy_pass`, socat, `ssh -L`) keeps your public host
  name in `Host`, and a DNS-rebinding web page sends its own name, so neither gets the page without a code.
* From another machine (or Docker): start with `BRIDGE_PAIRING=1`. The log prints a one-time code and the path
  `/bridge/pair?code=XXXX-XXXX`. The code is valid for 10 minutes and works once. After 5 wrong codes pairing is
  locked for 10 minutes. Without a valid code no pair code is ever shown.
* With `BRIDGE_PUBLIC_URL` (or `BRIDGE_ALLOWED_HOSTS=name1,name2`) set, requests for any other host name are refused
  (421).
* **Every QR carries its own one-time pair code, never a token.** Pairing needs a state directory (device list; the
  CLI and the systemd unit with `StateDirectory=` always have one); without it the bridge refuses to pair.
  `BRIDGE_PAIR_ADMIN_TOKEN=1` puts `BRIDGE_TOKEN` into the link instead (old behaviour, unsafe). List and revoke devices:
  `hermes-ui-plus-bridge devices list`, `hermes-ui-plus-bridge devices revoke <id>`, `hermes-ui-plus-bridge devices add "Tablet"`
  (prints a QR and link), or over HTTP with `BRIDGE_TOKEN`: `GET /bridge/devices`, `POST /bridge/devices {"label"}`
  (→ `{id, pairUri, expiresAt}`), `DELETE /bridge/devices/<id>`. A revoked device is locked out within 2 seconds.
  `devices.json` is changed under a lock file (`devices.json.lock`) with a unique owner token. The server fails
  fast on contention and retries last-use persistence with backoff; CLI writers can wait. Stale takeover and the
  final ownership check plus file rename share a short transition guard, so a paused writer cannot overwrite a
  successor. If a process crashes inside that transition, stop **all** bridge/CLI writers before removing the
  leftover `devices.json.lock.transition` directory; it deliberately fails closed rather than stealing the guard.
* `BRIDGE_TOKEN` is the admin token. Existing apps paired with it keep working; re-pair them to get device tokens,
  then rotate `BRIDGE_TOKEN` and keep it on the server only. Do not share screenshots of a QR.

Variables: `BRIDGE_PUBLIC_URL`, `BRIDGE_NAME` (label shown in the app, default "Hermes"), `BRIDGE_PAIRING`,
`BRIDGE_ALLOWED_HOSTS`, `BRIDGE_DEVICE_TOKENS=0` (no device list: pairing refused unless `BRIDGE_PAIR_ADMIN_TOKEN=1`).

Push notification previews (message text on the lock screen, sent through Google/Apple for FCM/APNs) are off by
default; set `BRIDGE_PUSH_PREVIEW=1` to turn them on.

## Tests

`cd bridge && npm test` (node:test, no network).
