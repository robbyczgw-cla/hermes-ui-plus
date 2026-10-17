# The UI-Bridge: what it is, why it exists, and why it is safe to run

The UI-Bridge (`bridge/`) is part of this repository, released under the same license, and tested by the same CI
workflow as the app (`.github/workflows/ci.yml`). It is not a hosted service: **you run it yourself, next to your Hermes Agent**, and
nothing in it phones home to us or to anyone else.

See the [threat model and security regression tests](BRIDGE-THREAT-MODEL.md) for trust boundaries, mitigations and limits.

```
HUI+ app ──HTTPS (your tailnet / LAN)──► UI-Bridge ──localhost──► Hermes Agent API
(phone, web, Mac)                          (your machine)          (your machine)
```

## Why a bridge at all?

Hermes' API server is built for single trusted clients. A phone app needs a few things on top of it. The bridge
adds them **without changing Hermes**:

| Need | Without bridge | With bridge |
|---|---|---|
| Which device may connect | everyone gets the one Hermes master key | one **revocable token per device** (QR pairing); the master key never leaves the server |
| Answer survives app switch / dead zone | Hermes stops the run when the connection drops | the run continues; the app picks the stream up where it broke off, or the answer arrives via live inbox or push |
| Retry after a dropped send | may ask Hermes the same thing twice | never a second turn for the same message ([Idempotent send and resume](#idempotent-send-and-resume)) |
| Notifications ("answer ready", "approval needed") | none | Web Push (FCM/APNs optional) |
| Interactive answers | the model decides alone | a fast **router** adds a format hint and the [skill core](#skill-core-inline) comes inline, so cards appear reliably; the app shows a matching skeleton immediately |
| Photos and files in chat | not possible | uploads with size limits and automatic cleanup |
| Product / place photos from Hermes' answers | tap to load each one (your phone would contact the image host) | shown at once through the bridge's **image proxy**; the image host only sees your bridge |
| Voice, image search, chat titles | device voice only | optional server-side providers you configure |
| Web app in the browser | blocked by Hermes' CORS check | served by the bridge itself, same origin |

The app also works **without** the bridge (choose "Connect without the bridge" in onboarding). It then talks to the
Hermes API directly, with the limitations above.

## Security model

- **Network:** made for your **tailnet** (`tailscale serve`, recommended) or a trusted LAN. The setup wizard
  never opens anything to the public internet. Do not use port forwarding or `tailscale funnel`.
- **Authentication:**
  - Every request needs a device token, except: `GET /health` / `/v1/health`, `POST /bridge/pair/redeem` (one-time
    code, rate limited), the pairing page from the bridge machine itself (or with the one-time page code), the static
    web app files (`BRIDGE_WEB_DIR`), and `POST /bridge/hermes-hook` (HMAC-signed by Hermes). Without
    `BRIDGE_WEB_DIR`, `GET /` answers a fixed status page ("bridge is running", how to pair, where the web app docs
    are): the same bytes for every request, with no name, version, device or pairing-code state, and a CSP without
    any script (`default-src 'none'`). Every other path keeps its answer (401 without a token).
  - Tokens are stored only as hashes (`devices.json`, mode 0600) and compared in constant time. Every change to
    `devices.json` (bridge, CLI, setup wizard) runs under an exclusive lock file, so a `devices revoke` from the CLI
    is never overwritten by the running bridge.
  - Revoking a device (`hermes-ui-plus-bridge devices revoke <id>`) also ends its open live streams and push
    registrations.
  - The admin token stays on the server.
- **One-time pair codes:** a pair link or QR code (`hermesuiplus://pair?u=…&c=<code>&n=…`, web:
  `https://<host>/#pair?u=…&c=…`) never contains a token. It carries a one-time code (32 random bytes, stored only
  as a SHA-256 hash) that the app trades for its device token with `POST /bridge/pair/redeem {"code": "…"}`:
  - the device token is created at that moment, so a link that is never used never produced a credential;
  - a code works **once** and expires after **1 hour**; a pending device whose code expired is removed;
  - unknown, used, expired and revoked codes all get the same `410` answer (no oracle); failed attempts are rate
    limited (10 per minute per address, 60 per minute in total; then `429`). Valid codes bypass those failure
    budgets, including behind a shared proxy address. A separate cap allows 60 redemption requests in flight,
    with a 10-second request deadline. Codes and tokens are never logged.

  A link pasted into a chat by mistake is therefore worthless after the app used it or after an hour. Devices paired
  with an older bridge (links with `t=<token>`) keep working.
- **No pairing without a device store:** if the bridge has no state directory (`BRIDGE_STATE_DIR`, or
  `BRIDGE_DEVICE_TOKENS=0`), the pairing page, `--pair` and remote pairing refuse with an error instead of putting
  the admin token `BRIDGE_TOKEN` into the link. `BRIDGE_PAIR_ADMIN_TOKEN=1` restores the old behaviour; **unsafe**:
  the link then contains a permanent admin credential.
- **Narrow pass-through:** only the Hermes endpoints the app calls are forwarded, as an explicit method + path
  allow-list checked after strict path normalisation (no dot segments, encoded slashes or traversal tricks; ids are
  plain `[A-Za-z0-9._:-]`, no `%`-escapes):
  - `GET /health`, `GET /v1/health` (no token needed)
  - `POST /v1/chat/completions` (chat turns, with the router hint)
  - `GET /v1/models`, `GET /v1/capabilities`, `GET /v1/skills`
  - `GET /v1/runs/{id}` (run status after a lost stream) and `POST /v1/runs/{id}/approval` (answer an approval)
  - `GET /api/sessions`, `GET|PATCH|DELETE /api/sessions/{id}`, `GET /api/sessions/{id}/messages`,
    `POST /api/sessions/{id}/fork`, `POST /api/sessions/{id}/model` (Hermes v0.22 per-chat model lock, body ≤ 8 KB),
    `GET /api/model/options`

  Everything else is refused before it reaches Hermes: unknown paths with 404, a wrong method with 405 and an `Allow`
  header. That includes run creation (`POST /v1/runs`), run events/steer/stop, `/v1/responses`, `/v1/toolsets`,
  artifacts, `/health/detailed` and Hermes' admin, cron and config APIs. Requests keep the path of `HERMES_BASE_URL`
  (a reverse-proxy sub-path such as `https://example.com/hermes` works).
  Hermes profiles (bots, `/p/<profile>/…`) get exactly the same allow-list (their `/health` needs the token);
  which profiles exist is only answered after the token check (`BRIDGE_PROFILES`, `GET /bridge/profiles`).
- **Turn budget:** a chat turn counts until Hermes has finished it, also when the app disconnected and the bridge
  keeps the run going. Limits: `BRIDGE_MAX_CONCURRENT_TURNS` per token (default 8) and `BRIDGE_MAX_TURNS_TOTAL` for
  the whole bridge (default 16); above that the bridge answers 429 with `Retry-After`.
- **Headers:** only `Content-Type`, `Accept`, `Accept-Language`, `User-Agent`, `X-Hermes-Session-Id`,
  `X-Hermes-Session-Key`, `Idempotency-Key` and `Last-Event-ID` are forwarded to Hermes (allow-list; the
  `Authorization` header is replaced by the Hermes key). `Set-Cookie` from Hermes never reaches the client.
- **Timeouts and size limits:** the small pass-through routes (health, sessions, models, run status, approval
  answers) time out after `BRIDGE_UPSTREAM_TIMEOUT_MS` (default 30 s, then 504) and cap request bodies (approval
  answers 8 KB, session edits 64 KB); `/health` never reads or forwards a body. A client must send its complete
  request within `BRIDGE_REQUEST_TIMEOUT_MS` (default 5 min; headers within 30 s). Chat connections must receive
  upstream response headers within `BRIDGE_CHAT_HEADER_TIMEOUT_MS` (default 60 s, including connection setup).
  That deadline clears when the response starts, so silent SSE tool calls remain supported. Every chat turn has
  an absolute `BRIDGE_TURN_MAX_MS` ceiling (default 2 hours, including request reading and routing); expiry aborts
  upstream and releases its budget slot, including detached turns. The bridge's own SSE observers keep at most
  about 1 MiB per event; a larger event is
  skipped by the observer (the app still receives it unchanged) and only its size is logged.
- **Shutdown:** SIGTERM/SIGINT stops accepting connections and drains incoming requests and detached turns for
  `BRIDGE_DRAIN_MS` (default 120 s). At expiry it logs remaining request IDs, elapsed times and connection count,
  aborts upstream turns and closes sockets. A second SIGTERM/SIGINT exits immediately. The setup wizard generates
  `TimeoutStopSec=150` in its systemd unit; when increasing `BRIDGE_DRAIN_MS`, keep `TimeoutStopSec` above the drain
  duration (milliseconds converted to seconds), with a margin for process shutdown.
- **Uploads:** at most `BRIDGE_UPLOAD_MAX_BYTES` per file (default 20 MB) and `BRIDGE_UPLOAD_QUOTA_MB` for the whole
  upload folder (default 500). When the folder is full, expired files are deleted first; if it is still full the
  upload is refused with 507. Active uploads reserve their declared length (or the file limit for chunked uploads);
  their temporary and final files are excluded from the usage scan until the reservation is released, so bytes
  count once. At most 2 uploads per token and 6 in total run at the same time (429 otherwise).
- **Pairing page:** answers only on loopback, without proxy headers and with a known `Host` (DNS-rebinding
  safe); remote pairing needs a one-time code.
- **Static web app and media files:** served only from their configured folders, with realpath containment. No
  symlinks out of the folder, no hidden files.
- **Web app CSP:** the web app pages are served with a `Content-Security-Policy`: no plugins, no `<base>` hijack, no
  framing (clickjacking), forms only to the bridge, and workers only from the bridge. HTTPS shells disallow plain
  `http:` connections or images; a directly served HTTP LAN shell additionally permits `http:` in `connect-src`
  and `img-src`. Scripts may be inline and use `eval` because the interactive-widget sandbox (a `srcdoc` iframe) inherits the
  page's policy and runs model-written scripts and CDN libraries; that sandbox narrows it further with its own,
  much stricter policy. Connections and images may go to any `https:` host (your own servers, providers you add in the
  app, images you tap to load). Checked in Chromium against a real web build (start page and component gallery with
  sandboxed widgets: no violations). If something in your setup is blocked, `BRIDGE_WEB_CSP=report-only` only
  reports violations in the browser console, `BRIDGE_WEB_CSP=off` turns the header off.
- **Image proxy:** see [Image proxy](#image-proxy) below (strict SSRF rules: public https hosts on port 443 only,
  every address and redirect checked, images only, size and time limits). Redirect and non-200 bodies are
  destroyed immediately; every request hop is closed when the fetch completes or fails.
- **Process hardening:** the generated systemd system unit runs with `DynamicUser`, `ProtectHome`,
  `ProtectSystem=strict` and `NoNewPrivileges` (user units get the subset available without root). Secrets live in a 0600 env file or systemd credentials.
- **Logging:** only metadata (time, route, status, duration, request id). **Message content is never logged**,
  and tests check this.

## Idempotent send and resume

Hermes dedupes `Idempotency-Key` only for non-streaming requests and its own `/v1/runs` API, and it has no replay for a
streamed chat answer. The app sends every message with an `Idempotency-Key`; for those turns the bridge does both itself
(`src/replay.mjs`):

- **Recording:** a `200 text/event-stream` turn with a key is recorded per device token + key: exactly the bytes the app
  gets (the router frame and Hermes' stream). The response carries `X-Hermes-UI-Resume: 1`. Any other answer (an error,
  `429`, non-streaming JSON) drops the record, so a retry runs anew.
- **No second turn:** the same key again (the app retries a send whose connection broke before any answer arrived)
  re-attaches to the recorded turn (`X-Hermes-UI-Resumed: 0`, the stream from the start, then live). Nothing goes to
  Hermes. While the first request is still starting: `409 idempotency_in_progress` + `Retry-After: 1`. The same key with
  another `X-Hermes-Session-Id`: `409 idempotency_key_conflict`. A turn whose upstream stream broke (Hermes restart,
  timeout, reset) gave no answer: the same key without a resume offset runs it anew (the record is replaced). A turn
  that ran but is not recorded (over the per-turn buffer, or its bytes evicted for the total budget) answers
  `409 turn_unrecorded` instead: it is never run twice, the app recovers its answer from the stored session. On
  `resume_unavailable` / `idempotency_key_conflict` for a plain send the app takes a fresh key for the next retry.
- **Resume:** `X-Hermes-UI-Resume-Offset: <bytes>` with the same key continues a broken stream at that byte offset (the
  app keeps its parser state, so every event arrives exactly once), from the record and then live. A resume never starts
  a turn: an unknown or expired key, an offset beyond the record or a broken turn get `409 resume_unavailable`, a turn
  over the buffer limit `409 turn_unrecorded`; the app then falls back to the live inbox / stored session. Offline, the
  app keeps re-attaching for up to 2 minutes; an answer the app persisted unfinished (killed, reopened) re-attaches at
  offset 0 and replays the record. A re-attach request carries no message (`messages: []`), so a bridge without resume
  support forwards something Hermes refuses instead of a second turn. The resume header is consumed by the bridge and
  never forwarded.
- **Limits:** `BRIDGE_RESUME_TURN_KB` per turn (default 2048; a longer turn stays live but is no longer resumable),
  `BRIDGE_RESUME_TOTAL_MB` for all records (default 32; finished records lose their bytes oldest first and then answer
  `turn_unrecorded`), finished records are
  kept `BRIDGE_RESUME_RETAIN_MS` (default 10 min), at most 4 re-attached streams per turn and 64 over all turns
  (`429` beyond). A re-attached stream never buffers without limit: it catches up from the record only as fast as the
  app reads (backpressure), a live reader that falls behind continues from the record, and once a turn is no longer
  recorded a reader with 256 KiB unsent is disconnected (it resumes from its offset or reads the session). A slow reader
  never pauses the turn. Records live in memory only (lost on restart; the turns themselves are aborted on shutdown
  anyway). `BRIDGE_RESUME=off` turns it off.
  `GET /bridge/status` reports `resume: {enabled, turns, bytes, subscribers}`. Nothing of the content is logged.

## Image proxy

When Hermes researches products, places or events it often reads the shop, venue or event page anyway; its extract tool
can return that page's main picture (`og:image`). The `hermes-ui` skill puts that URL into the card's `image` field.
Loading it straight from the phone would tell the image host your IP address, so the app normally asks first
("Load image from …"). With the image proxy the app loads it through your own bridge instead:

```
app ──GET /bridge/img?u=<https image url> (device token)──► UI-Bridge ──GET──► image host
```

- **What it is:** pure transport. No keys, no provider, no model: it fetches only URLs that appear in Hermes'
  answers (the app sends only card `image` URLs) and returns the picture. Everything "thinking" stays in Hermes.
- **Privacy benefit:** the image host sees the bridge's address, not your phone's, gets no cookies and no referrer
  (which chat or app asked), and cached pictures are not fetched again. The pictures show at once, without a tap.
- **Capability:** `GET /bridge/images/config` answers `proxy: {available, path, maxBytes}`; the app uses the proxy only
  when it is advertised and when image loading is on (Settings → Media). Otherwise the old tap-to-load rule applies.
- **Authentication:** like every bridge route, a device token (`Authorization: Bearer`). The app sends it as a header
  (also on the web), so no token appears in an image URL.

SSRF protections (the proxy fetches URLs that a model wrote, so it is strict):

- `https` only, port 443 only, no user name or password in the URL, at most 2048 characters; no single-label names and
  no `*.localhost`, `*.local`, `*.internal`, `*.lan`, `*.home.arpa` and similar local names.
- The bridge resolves the host itself and refuses the request if **any** address is not public: private (RFC 1918),
  loopback, link-local (including the cloud metadata address), CGNAT / Tailscale, unique-local IPv6, multicast,
  documentation, benchmarking and reserved ranges, IPv4-mapped or NAT64 IPv6. The connection goes to exactly the
  checked address (no second DNS lookup, so DNS rebinding cannot swap it). Literal IP addresses are checked the same way.
- At most 3 redirects; every redirect target goes through all of the checks above again.
- Only status 200 with `Content-Type: image/*` (never SVG, no compressed bodies); the body must be a JPEG, PNG, WebP,
  GIF or AVIF by its magic bytes and is served with that type, `X-Content-Type-Options: nosniff` and a sandbox CSP.
- At most 8 MB; 5 s to connect, 15 s in total.
- Only a fixed set of request headers goes out (a generic `User-Agent`, `Accept`, no compression): never the app's
  cookies, `Authorization`, `Referer` or any other client header. `Set-Cookie` from the image host is dropped.
- Per device at most 120 uncached fetches a minute (`BRIDGE_IMAGE_PROXY_RATE_LIMIT`), at most 8 fetches at the same
  time for the whole bridge; a failed URL is not retried for 5 minutes.
- Cache: pictures are kept in `<BRIDGE_STATE_DIR>/image-cache` (file name = SHA-256 of the URL, mode 0600), at most
  200 MB (`BRIDGE_IMAGE_PROXY_CACHE_MB`, `0` = no cache), each for 24 h, least recently used first out. Without a
  state directory nothing is cached. The app gets `Cache-Control: private, max-age=86400`.
- Logs contain only metadata: host name, status, bytes, duration. Never the path or the query string of the URL.

`BRIDGE_IMAGE_PROXY=off` switches it off (the route then answers 404 and the app keeps tap-to-load). The startup log
shows `images  proxy on` or `proxy off`.

What it cannot prevent: like any picture in a chat, the URL itself carries information to the image host. A
prompt-injected page could make the model write an image URL with data in its query string, and the bridge would fetch
it. Hermes' own web tools can already reach any public URL, so the proxy adds no new reach; it only keeps your phone's
address out of it. Turn it off if your Hermes has no web tools and you want no outgoing requests from the bridge.

## Skill core inline

App chats need the `hermes-ui` skill: it teaches the model the `hui` blocks and how to follow the router hint. The
bootstrap system message asks the model to load the skill with `skill_view` on the first turn, but some models skip that
call (seen with Claude Sonnet on Hermes v0.22: no `skill_view`, the `format=compare` hint ignored, plain text with the
result last, so the app's card skeleton disappeared again). Asking harder in the bootstrap did not help.

So the bridge sends the skill's core text itself:

- **What:** the body of `hermes-ui/SKILL.md` (YAML front matter removed) as ONE extra system message, starting with
  `[hermes-ui-skill]`, placed right after the bootstrap message. Order on an app turn: bootstrap, skill core, the app's
  own system messages, router hint, conversation. The per-component reference files stay on demand: the model loads
  them with `skill_view("hermes-ui", file_path="references/<ref>.md")` as the skill describes.
- **When:** only on app turns, i.e. chat requests that carry the bootstrap message, and only while the bootstrap is
  active (`BRIDGE_BOOTSTRAP` not `off`). Never twice in one request. Requests the bridge does not rewrite (bootstrap
  off, invalid JSON) are forwarded unchanged. Other Hermes clients and platforms (Telegram, cron, CLI) are not
  affected; they do not go through the bridge.
- **Cost:** about 2k input tokens per turn, but the text is read once at startup and is byte-identical on every turn, so
  Hermes and the provider keep it in the prompt cache (Hermes appends request system messages to the end of its cached
  system prompt and never stores them in the session history).
- **Which file:** `hermes-ui/SKILL.md` next to the bootstrap file, else the repository's `hermes-skill/`, else the copy
  bundled into the npm package or Docker image (`npm run bundle-skill`). `BRIDGE_SKILL_FILE=<path>` picks another
  file. If none is found the bridge logs a warning at startup, the `skill` line of the startup output says
  `skill core inline MISSING`, and app turns get the bootstrap message alone.
- **Switch off:** `BRIDGE_SKILL_INLINE=off`. The bootstrap then asks the model to load the skill with `skill_view`, as
  before. Keep the skill installed in Hermes either way: references and other clients use it.

SKILL.md itself is unchanged and still works as a normal Hermes skill. Background: ADR 0001, addendum to decision 5.

## Hermes profiles (bots)

A Hermes profile (`hermes profile create <name>`) is a bot with its own model, memory, skills and sessions. One
Hermes gateway serves all of them and mirrors its API under `/p/<profile>/…` (`gateway.multiplex_profiles`, on by
default in current Hermes versions). The bridge passes that through:

- **Same allow-list:** `/p/<profile>/<path>` is forwarded exactly when `<path>` would be, with the prefix kept, so the
  request reaches that profile. Bridge routes (`/bridge/*`) have no profile form, and a profile's `/health` needs the
  token. Profile names follow Hermes' rule (lowercase letter or digit first, then lowercase letters, digits, `-`, `_`);
  anything else is refused before it reaches Hermes.
- **Which profiles:** `BRIDGE_PROFILES` decides. Unset or `auto`: the directories in `HERMES_HOME/profiles/` (re-read
  at most every 30 s; needs read access to the Hermes home, else any valid name is passed on and Hermes answers 404 for
  unknown ones). A list such as `research,work=Work bot` (optional label after `=`), or `off` (no `/p/` at all).
  Unknown profiles get 404, and only after the token check, so the list is not public.
- **`GET /bridge/profiles`** (token required) lists the default profile and the others with their label and model id
  (`model.default` of the profile's `config.yaml`; nothing else is read). The app builds its "Bot" section from it.
- **Per profile:** router context memory, turn tracking, stop (`POST /bridge/chat/stop` stays at the root and names
  the profile in its body: `{sessionId, profile}`; without one it stops the default profile's run only), resume records
  (an `Idempotency-Key` never re-attaches to another profile's turn), approvals and push watching are kept per profile; push payloads carry `hermesProfile` so a
  tap opens the right bot's chat. The push watcher polls at most 8 profiles besides the default.
- **Hermes side (v0.22):** each profile's own `.env` needs `API_SERVER_KEY` with the same value as the bridge's
  `HERMES_API_KEY`, or every `/p/<profile>/` request answers 401. Each profile also needs its own provider key.
- **Hardened service:** a systemd unit with `ProtectHome`/`DynamicUser` cannot read the Hermes home, so `auto`
  sees no profiles: set `BRIDGE_PROFILES` to the list (`hermes-ui-plus-bridge setup` does that for root installs).
- **No profiles:** nothing changes. `GET /bridge/profiles` lists the default only and the app shows no "Bot" section.

## Quick answers (Schnellfrage, optional plugin)

The ⚡ quick questions of the app are answered by the optional Hermes plugin `hermes-ui-plus`
([HERMES-PLUGIN.md](HERMES-PLUGIN.md), code in `hermes-plugin/`). It runs inside Hermes, uses Hermes' own providers
and listens on loopback only; the bridge is the transport:

- **Routes** (device token required): `GET /bridge/quick/config` (is it available, which model, the limits) and
  `POST /bridge/quick` (alias `POST /bridge/quick/v1/chat/completions`, OpenAI-compatible, streamed). The bridge
  forwards to `BRIDGE_HERMES_PLUGIN_URL` (default `http://127.0.0.1:8646`) with the shared secret from
  `BRIDGE_HERMES_PLUGIN_SECRET_FILE` (no default: unset means ⚡ off; a hardened unit gets the file through
  `LoadCredential=`, see [HERMES-PLUGIN.md](HERMES-PLUGIN.md)), applies per-device limits (`BRIDGE_QUICK_RATE` per minute, default 20;
  `BRIDGE_QUICK_DAILY`, default 300), checks a requested model against Hermes' `GET /api/model/options` and stops the
  plugin call when the app goes away. Message content is never logged.
- **Without the plugin** (not installed, disabled, unreachable or answering garbage) the quick routes answer
  `404 feature_off` and `/bridge/quick/config` says `{"available": false}`. The bridge re-probes the plugin at most
  every 30 s; the app caches "off" for 10 minutes and checks again only when it returns to the foreground or the
  connection comes back. Nothing else depends on it. `BRIDGE_QUICK=off` switches the routes off entirely.
- **Not per profile:** the plugin listens once for the whole gateway and answers with its `auxiliary.hui_quick`
  model, whichever profile loaded it first. So the app offers ⚡ only in chats of the default profile, not in bot
  (`/p/<profile>/`) chats.

## Where your data goes

The bridge stores **no chat history**. Hermes does that, as before.

Data the bridge keeps on disk:
- device token hashes and push registrations
- uploaded files, deleted after `BRIDGE_UPLOAD_RETENTION_DAYS` (default 7)
- the image proxy cache (pictures from Hermes' answers, at most 200 MB, each for 24 h)
- a small in-memory routing context (last turns, truncated, cleared after 24 h)

**By default the bridge is a pure pass-through to your Hermes.** It calls no model or search provider itself:
everything "thinking" happens in your Hermes. The presentation router is rule based and runs locally. On start the bridge logs
`direct providers: none (pure Hermes pass-through)` when that is the case.

Data that leaves your machine **only if you opt in to the direct-provider extras**. These are off unless you run
`npx hermes-ui-plus-bridge setup --extras` (or answer "y" to the extras question of the interactive wizard), or put
the keys in the bridge env file yourself. The bridge then calls the provider directly with a key stored in the bridge,
outside Hermes (a later version will move these extras into a Hermes plugin, with no keys in the bridge):

| Extra (opt in) | Sent to | What |
|---|---|---|
| LLM router (`ROUTER_BACKEND=claude`, `jev` or `nace`; default `heuristic` = rule based, no external call) | the router model you configure (e.g. Anthropic, Jev, Nace Drex) | the last few messages, truncated, to pick a format |
| Chat titles / follow-up suggestions (`BRIDGE_META=on` + `ANTHROPIC_API_KEY`) | Anthropic (Claude Haiku) | the first exchange of a chat |
| Image search (`SERPER_API_KEY` / `BRAVE_API_KEY`) | Serper or Brave | the search term |
| Speech-to-text (`GROQ_API_KEY`, or `OPENAI_API_KEY` with `BRIDGE_STT_PROVIDER=openai`) | Groq or OpenAI | the recorded audio |
| Text-to-speech (`DEEPGRAM_API_KEY`, `ELEVENLABS_API_KEY` or `OPENAI_API_KEY`; `BRIDGE_TTS_PROVIDER` picks one) | Deepgram, ElevenLabs or OpenAI | the text being read aloud |

Not an extra, a normal feature:

| Feature | Sent to | What |
|---|---|---|
| Push | Google / Apple push services (Web Push: your browser's push service) | an encrypted notification; message previews are **off** by default |
| Quick answers (only with the `hermes-ui-plus` plugin) | your Hermes (the plugin on loopback), which calls the model configured for `auxiliary.hui_quick` | the quick question and at most 6 earlier quick turns |
| Image proxy (`BRIDGE_IMAGE_PROXY`, default on) | the image host named in a Hermes answer | a plain request for that one picture, from the bridge's address, without cookies or referrer |

The startup log lists exactly which extras are active, by provider name and without keys, for example
`direct providers: router=claude, meta=claude, images=serper, voice=groq/deepgram`. Re-running `setup` never removes
keys or changes `ROUTER_BACKEND` that are already in your env file. A provider key alone switches nothing on: the
model router needs `ROUTER_BACKEND`, titles and follow-ups need `BRIDGE_META=on`, so an `ANTHROPIC_API_KEY` exported
in your shell is never used by accident. Voice and image search run when their key is in the bridge's environment.

Your conversations themselves go from the bridge to **your** Hermes, and from there to the model providers you set
up in Hermes, exactly as with Telegram or the CLI.

## Verify it yourself

- Code: `bridge/src/` (no build step; plain Node ESM, few dependencies).
- Tests: `cd bridge && npm test`.
- Dry run of the setup: `npx hermes-ui-plus-bridge setup --dry-run` shows every change before anything is written.
- Device list: `hermes-ui-plus-bridge devices list`.

Found a problem? See [SECURITY.md](../SECURITY.md).
