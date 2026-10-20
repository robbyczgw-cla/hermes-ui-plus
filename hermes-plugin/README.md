# hermes-ui-plus (Hermes plugin, prototype)

A thin, optional companion plugin for the Hermes Interactive UI+ app (ADR 0001, option B). It runs inside
Hermes and uses Hermes' own providers and credentials, including subscription logins, so the UI Bridge needs
no model keys of its own.

The first and only feature is **quick answers**. A one-off question is answered by a fast model **without
the agent**: no tools, no memory, no session, a prompt of about 620 tokens. A normal agent turn costs about
21k tokens.

Design and migration plan: [`docs/HERMES-PLUGIN.md`](../docs/HERMES-PLUGIN.md).

## How it works

- `register(ctx)` registers the auxiliary slot `auxiliary.hui_quick` with
  `ctx.register_auxiliary_task(..., inherit_from="title_generation")`. The slot uses the same route as
  Hermes' title generation. A block of your own under `auxiliary.hui_quick` overrides it. Default override:
  `reasoning_effort: low`.
- A loopback HTTP listener (stdlib asyncio) runs in its own daemon thread with its own event loop, so it never
  blocks the gateway. Hermes loads plugins in every process. The bind acts as the lock: the first process
  that binds `server.port` serves (normally the gateway), and the others stay passive and retry the bind every
  15 s, so a short-lived process that won the bind cannot leave the feature dead.
- Model calls go through `agent.auxiliary_client.call_llm(task="hui_quick", stream=True)`. All Hermes
  imports live in `hermes_ui_plus/hermes_adapter.py`. If a provider rejects streaming, the call is retried
  once without streaming and the answer is sent as one chunk.
- On a gateway that multiplexes profiles (Hermes v0.22+), each quick call runs in the secret scope of the profile
  that enabled the plugin. A self-test (no model call) checks that this works; if it does not, `/quick/config`
  says `available: false` with `reason: "profile_scope_unavailable"` and the app hides ⚡. Details: "Multiple
  profiles (bots)" in [`docs/HERMES-PLUGIN.md`](../docs/HERMES-PLUGIN.md).

## Endpoints (127.0.0.1 only)

| Method | Path | Auth | |
|---|---|---|---|
| GET | `/health` | none | `{"ok": true}` |
| GET | `/quick/config` | Bearer secret | `enabled`/`available` + `reason` (self-test), `scope` (diagnostics), aux slot, last route used, limits, prompt-size estimate |
| POST | `/quick/v1/chat/completions` | Bearer secret | OpenAI-compatible; `stream: true` returns SSE `chat.completion.chunk` events and `[DONE]`; usage in the final chunk |
| GET | `/library/config` | Bearer secret | `{version, profile, skills, memory}`; each part `{available, reason?}` |
| GET | `/library/skills` | Bearer secret | skills of this profile: `name`, `description`, `category`, `enabled`, `source` (`bundled\|hub\|external\|local`) |
| GET | `/library/skills/content?name=` | Bearer secret | SKILL.md of a listed skill (exact name only, 256 KiB cap, `truncated`) |
| GET | `/library/memory` | Bearer secret | MEMORY.md / USER.md entries, limits, `updated_at`; 404 `feature_off` unless `library.expose_memory: true` |
| GET | `/bots` | Bearer secret | bots (named profiles): `name`, `title`, `description`, `color`, `pinned`, `hidden`, `parked`, `app`, `template`; `create: {available, reason?}`, `limit`, `count` |
| POST | `/bots` | Bearer secret | create a bot from `{title, job, how, template, lang, may, color, api_key}` → 201 (0.2.0, Bots v2; docs/BOTS-SERVER.md "Creating bots from the app") |
| GET / PATCH | `/bots/<name>` | Bearer secret | the three fields of a bot / rewrite `SOUL.md` and `ui_meta` from `{title, job, how, lang?}`; never the default profile |

The library routes (0.2.0) are read-only and serve only the plugin's own profile. Contract and reasons:
[`docs/SKILLS-MEMORY.md`](../docs/SKILLS-MEMORY.md).

Request limits:

- at most 6 user/assistant turns, text only, at most 4000 characters per turn;
- body at most 64 KB with a `Content-Length` (chunked bodies get 411);
- `max_tokens` is clamped to `quick.max_tokens`.

The server ignores some client fields:

- system/developer messages, tools and sampling parameters are ignored (server-pinned prompt);
- `model` values such as `hermes-agent`, `auto` or `default` mean the slot default.

Optional `provider` + `model` choose another model. They are checked against `quick.allowed_models`; the
bridge has already checked them against Hermes' `GET /api/model/options`.

## Install (owner, on the Hermes host)

```bash
python3 hermes-plugin/install.py --hermes-home ~/.hermes            # symlink + secret (0600)
#   --copy                    copy instead of symlink (needed when Hermes runs in a container)
#   --group-readable-secret   0640 secret + 0750 dir, for a bridge user in the file's group
```

Enable it in `config.yaml` (back up `config.yaml`, `.env` and `installs/` first), then restart the gateway:

```yaml
plugins:
  enabled: [hermes-ui-plus]   # add to the existing list
```

Do not use `hermes plugins enable` on a running installation: on Hermes v0.22 it can make Hermes' package manager
build a new environment under `HERMES_HOME/installs/` and start the gateway from it, without the extras the gateway
needs (a live test lost the API server that way). After the restart, check that the gateway still runs from its usual
Python environment and that the API answers.

The installer never edits `config.yaml`, never touches services and never prints the secret. Without a
secret file the plugin registers the slot but keeps the listener off.

Bridge environment:

```bash
BRIDGE_HERMES_PLUGIN_URL=http://127.0.0.1:8646
BRIDGE_HERMES_PLUGIN_SECRET_FILE=<hermes-home>/hermes-ui-plus/secret
# optional: BRIDGE_QUICK=off, BRIDGE_QUICK_RATE=20 (per device/min), BRIDGE_QUICK_DAILY=300
```

A bridge that cannot read the Hermes home (a hardened systemd unit with `ProtectHome`/`DynamicUser`) gets the
secret as a credential instead: `LoadCredential=hui-plugin-secret:<hermes-home>/hermes-ui-plus/secret` and
`Environment=BRIDGE_HERMES_PLUGIN_SECRET_FILE=%d/hui-plugin-secret` in the unit (not in its env file, which would win).
`hermes-ui-plus-bridge setup` writes both when it finds the secret.

## Settings (`plugins.entries.hermes-ui-plus.settings` in config.yaml)

| Key | Default | |
|---|---|---|
| `server.enabled` | `true` | listener on/off |
| `server.host` | `127.0.0.1` | loopback only; any other value is refused and falls back to 127.0.0.1 |
| `server.port` | `8646` | |
| `server.secret_file` | `<HERMES_HOME>/hermes-ui-plus/secret` | mode 600 (or 640) required |
| `quick.enabled` | `true` | `false`: `/quick/*` answers 404 `feature_off` |
| `quick.max_tokens` | `1024` | output cap per answer |
| `quick.max_concurrency` | `4` | in flight; more get 429 |
| `quick.first_byte_timeout` | `20` s | 504 if no content by then |
| `quick.total_timeout` | `60` s | |
| `quick.allow_model_override` | `true` | per-request `provider`/`model` |
| `quick.allowed_models` | `[]` (any) | e.g. `["opencode-go:deepseek-v4-flash", "kilocode:*"]` |
| `library.enabled` | `true` | `false`: `/library/*` answers 404 `feature_off` (`disabled_by_config`) |
| `library.expose_memory` | `false` | `true` lets paired devices read this profile's MEMORY.md / USER.md |
| `bots.enabled` | `true` | `false`: `/bots` answers 404 `feature_off` (`disabled_by_config`); the bridge's owner switch (`bots enable`) is the second gate |
| `bots.limit` | `50` | most bots (named profiles) the app may create (1 to 200) |

Model choice is ordinary Hermes config:

```yaml
auxiliary:
  hui_quick:
    provider: opencode-go
    model: deepseek-v4-flash
```

**Kill switch:** set `HERMES_UI_PLUS_DISABLE=1` in the gateway environment and restart. The plugin then
registers nothing.

## Security model

- Loopback bind only. The bridge is the only network-facing part (device tokens, rate limits).
- The bridge-to-plugin secret is generated by the installer with 32 random bytes and stored as 0600. Each
  request compares it in constant time (SHA-256, then `hmac.compare_digest`). It is never logged.
- Fixed operations only: one completion shape, no tools, no provider URLs or keys in requests, no secret
  access. Credentials stay inside Hermes.
- No content logging. Log lines carry status, timings, provider/model and token counts. Provider error text is
  never echoed: clients see only the exception class.
- Hermes' own observers still see the call like any auxiliary call (`pre/post_auxiliary_call` hooks). The
  question also goes to the configured model provider.

## Tests

```bash
cd hermes-plugin && python3 -m unittest discover -s tests     # stdlib only, no Hermes needed
cd bridge && npm test                                          # includes test/quick.test.mjs (fake plugin)
```
