# Hermes plugin `hermes-ui-plus`: design note

Status: experimental, ships with 0.1.0-alpha.1 as an optional plugin. Implements ADR 0001, option B, for **quick
answers only**.
Code: [`hermes-plugin/`](../hermes-plugin/) (plugin) and [`bridge/src/quick.mjs`](../bridge/src/quick.mjs)
(bridge). This note replaces the "build it in the bridge with its own keys" decision in
[QUICK-QUESTIONS.md](QUICK-QUESTIONS.md). The UX parts of that document still apply.

## Architecture: bridge = transport, plugin = brain

```
App ──HTTPS/tailnet──> UI Bridge (Node) ──loopback + shared secret──> hermes-ui-plus (inside Hermes)
                       device tokens, rate limits,                   auxiliary slot auxiliary.hui_quick
                       catalog check, abort on disconnect            -> Hermes' own providers/credentials
                       └──────── /v1/* pass-through ────────────────> Hermes API server (agent turns)
```

The bridge stays the only network-facing component: pairing, device auth, proxy, push, uploads, web app.
The plugin owns what needs Hermes' models and credentials, and nothing else. Chat never depends on the
plugin. When the plugin is absent, disabled, unreachable or crashing, `/bridge/quick*` answers
`404 feature_off`, `/bridge/quick/config` answers `{available: false, reason}`, and every other route is unaffected.
`bridge/test/quick.test.mjs` tests this with seven failure modes.

## Hermes surfaces used (v0.21.x)

| Surface | Kind | Use |
|---|---|---|
| `hermes_cli/plugins.py` `PluginContext.register_auxiliary_task` | public plugin API | slot `hui_quick`, `inherit_from="title_generation"`, default `reasoning_effort: low` |
| `PluginContext.get_config` | public plugin API | `plugins.entries.hermes-ui-plus.settings.*` |
| `PluginContext.on_unload` | public plugin API | stop the listener on unload/reload |
| `agent/auxiliary_client.py` `call_llm(task=, provider=, model=, messages=, max_tokens=, timeout=, stream=, stream_options=, route_info=)` | **internal**, the one allowed aux-call adapter (`hermes_adapter.py`) | the completion |
| `agent.secret_scope` (`is_multiplex_active`, `current_secret_scope`, `build_profile_secret_scope`, `set_secret_scope`, `reset_secret_scope`) + `hermes_constants.set_hermes_home_override` | **internal**, same adapter, v0.22+ only | profile scope of a quick call on a gateway that multiplexes profiles |
| `agent/auxiliary_client.py` `aux_probe_mode()` + `get_text_auxiliary_client(task)` | **internal**, same adapter, optional | self-test: resolves the slot's provider and credentials without a model call |
| plugin discovery (`plugin.yaml` + `register(ctx)`, `plugins.enabled`) | public | loading |

Every hook is feature-detected with `hasattr`, and the plugin uses the Python stdlib only.
`tests/test_units.py` asserts that `hermes_adapter.py` holds the single Hermes import.

Why `call_llm` and not the public `ctx.llm` (`agent/plugin_llm.py` `PluginLlm`): `ctx.llm` has no streaming,
and its overrides need `plugins.entries.<id>.llm.allow_*_override`. `PluginLlm` itself calls `call_llm` with
the same task routing (`_invoke_sync`). If Hermes adds streaming to `ctx.llm`, switch to it and drop the
internal import.

What was deliberately **not** used:

- `register_platform`: it needs `gateway.platforms.base.BasePlatformAdapter` (internal). An enabled plugin
  platform would also appear in `GatewayConfig.get_connected_platforms()`, and so in the session context of
  every messaging session prompt (`gateway/session.py` `build_session_context`).
- The inventory internals (`hermes_cli/inventory.py`): overrides are validated by the bridge against the
  public `GET /api/model/options`, and by the plugin against an optional `quick.allowed_models` allow-list.

## Listener lifecycle

There is no public "gateway started" hook. The listener runs in its own daemon thread with its own asyncio
loop, started from `register()`. The bind is the lock: Hermes loads plugins in every process (gateway, CLI,
cron), and only the first process that binds `server.port` serves. The others stay passive and retry the bind
every 15 s, so the gateway, which lives longest, ends up owning the port. The retry matters with several
profiles: the official image starts one gateway service per profile, and a secondary one
(`hermes -p <profile> gateway run`) that exits because the main gateway multiplexes it could win the bind and leave
quick answers dead until the next restart (seen on the test instance, 2026-10-16). If the gateway is down, a CLI
process may serve briefly, with the same home, config and credentials. The thread runs in a copy of the
registering context.

## Streaming

- **Yes, for most providers.** Live, `opencode-go/deepseek-v4-flash` streamed 3-85 content chunks per answer.
- `call_llm(stream=True)` returns the raw SDK chunk iterator. Hermes' recovery ladder (parameter, reasoning
  and credential retries, fallback chain) runs **only** on the non-stream path.
- The plugin therefore retries once without streaming when the stream request is rejected or breaks before
  the first content. The answer then arrives as one chunk.
- That happened live with `opencode-go/qwen3.8-flash`: one chunk, total 2.3-10 s. That model is not
  recommended for quick answers.
- **Not with `provider: anthropic`** (Hermes v0.22): Hermes' Anthropic auxiliary client consumes the stream inside
  `create()` and returns the finished answer, so the app gets it as one chunk. Live on a test instance
  (2026-10-15, `claude-haiku-5-5`): 0.8-2 s for the whole answer, so this costs little for short answers.
- Reasoning deltas are dropped. Usage comes from the provider when it reports it (`include_usage`).
  Otherwise it is estimated and flagged `usage_estimated`.

## Measured (throwaway Hermes home on the production host, 2026-10-12)

The test used the real Hermes plugin loader (`discover_plugins`) and the real auxiliary client, with only the
OpenCode Go and Kilo Code API keys in the throwaway home. It used five typical German questions with the
default slot model `opencode-go/deepseek-v4-flash`. TTFB is the time to the first content token, measured
directly at the plugin.

| Question | TTFB | Total | Completion tokens | Card |
|---|---|---|---|---|
| capital of Australia | 3.44 s (cold client) | 3.46 s | 11 | – |
| 72 °F in °C | 1.76 s | 2.42 s | 127 | `calc` |
| translate a phrase to Spanish | 1.55 s | 1.58 s | 17 | – (plain text) |
| Python vs JavaScript table | 1.68 s | 3.59 s | 245 | `table` |
| soft-boiled egg | 1.60 s | 2.25 s | 76 | – |
| non-stream, question 1 | – | 3.11 s | 56 | – |

The prompt cost about 620 input tokens per question, as reported by the provider. A normal agent turn costs
about 21k. Per-request overrides on the same provider:

| Model | TTFB | Total | Note |
|---|---|---|---|
| `glm-5.3-flash` | 1.25-4.0 s | 1.6-5.4 s | streams |
| `mimo-v2.6-flash` | 2.5-13 s | 3.2-13.5 s | streams; one slow outlier |

A client disconnect mid-stream left the listener healthy. The upstream call stops at the next provider chunk.

## App side: `app/src/quick/`

- **Availability.** ⚡ appears only on a Hermes connection through the bridge whose `GET /bridge/quick/config`
  says `available: true` (cached per bridge, re-checked when the app returns to the foreground or the connection
  comes back), and in the offline demo, which has a canned quick backend (`quick/demo.ts`). A `404 feature_off`
  during a session hides ⚡ at once; the question goes back into the chat's composer.
  Not in bot (Hermes profile) chats: the plugin has one quick model for the whole gateway (see Risks, multi-profile
  scoping), so ⚡, the start-screen pill and long-press on Send are only offered in default-profile chats.
- **Mode switch, not a per-message flag.** ⚡ in the composer switches the chat column between the open chat and the
  connection's quick thread; what is on screen is where the message goes. The draft moves along. Long-press on Send
  offers "Als Schnellfrage senden"; the start screen has a "Schnellfrage" pill. The open chat stays mounted while
  the thread is shown (scroll position, draft and a running turn are kept).
- **One local thread per connection**, not a Hermes chat: stored on the device only, not in the drawer, entries
  expire after 24 h. Follow-ups send the last complete turns (at most 6 messages).
- **Answers** use the normal renderer and `hui` parser, plus the meta line "⚡ model · 1,6 s" (time to first token).
  The thread header says once: no memory, no tools, no live data.
- **"Mit Hermes weitermachen"** creates a new Hermes chat on the same connection (server default model) that starts
  with the question and the quick answer as copied turns. The user's next message carries them as a context block
  in which the answer is labelled as a quick answer of the named model (`hermes/turnOverride.ts`).
- **Settings → Schnellfrage** (only when available): model from Hermes' catalog (`/api/model/options`, default
  "Hermes-Standard"), the per-device limits from the config, the ⚡ switch, deleting the thread.
- **Errors:** 429 shows "Limit erreicht – in X s/min/h wieder möglich" from `Retry-After`; network errors keep the
  normal retry.

## Multiple profiles (bots)

Requirements: Hermes Agent v0.22 or newer with `gateway.multiplex_profiles`, plugin 0.1.1 or newer. The 0.1.0
plugin answers every quick question with 502 on such a gateway.

A multiplexing gateway serves every profile from one process and reads provider keys only inside the scope of one
profile (`UnscopedSecretError` outside one, so a profile never sees another's keys). Agent turns get that scope from
the gateway. The plugin's listener does not, so the plugin does it itself:

- Every quick call runs in the scope of the profile that enabled the plugin (its `HERMES_HOME`), built from that
  profile's `.env` the way the gateway builds it for a turn (`hermes_adapter.profile_scope`). Only that profile's
  keys and `auxiliary.hui_quick` route are used, whichever bot chat the app has open. ⚡ is not offered in bot chats.
- The listener thread and each quick worker run in copies of the context that registered the plugin. When Hermes
  binds that context to the owning profile (upstream issue
  [NousResearch/hermes-agent#139123](https://github.com/NousResearch/hermes-agent/issues/139123), PR #139139), the
  worker inherits that scope and the plugin's own scope step does nothing. The plugin's `GET /quick/config` shows
  which case applies in `scope`: `needed` (the plugin enters the scope itself), `host` (Hermes bound it), `off`
  (no multiplexing).
- The scope helpers are private Hermes code. The plugin checks that it can resolve credentials for its slot in the
  scope it will use: at listener start, again as soon as multiplexing switches on (the gateway does that after
  loading plugins), then every 10 minutes, or after 1 minute while the check fails. It uses Hermes' availability probe
  (`aux_probe_mode`), so the check makes no model call. A quick call that still fails with `UnscopedSecretError`
  switches the feature off at once.

If the check fails (a future Hermes renamed the helpers, the profile's `.env` cannot be read, credentials need a
scope the plugin cannot build), the plugin reports `{"enabled": false, "available": false, "reason":
"profile_scope_unavailable"}` on `GET /quick/config` and answers quick requests with `404 feature_off` and the same
`reason`. The bridge passes the reason on (`GET /bridge/quick/config` → `{available: false, reason}`). The app then
shows no ⚡ button, no "Schnellfrage" pill and no quick section in Settings; normal chats and bots are not
affected. The agent log has one line `quick answers unavailable: profile_scope_unavailable` (no secret values).
Older bridges read only `enabled` and hide ⚡ as well. Other reasons: `hermes_aux_unavailable` (Hermes has no
`call_llm`), `disabled` (`quick.enabled: false`), and from the bridge `plugin_unreachable`, `plugin_not_configured`,
`plugin_disabled`, `bridge_off`.

## Migration plan

Each item moves only if it fits the plugin rules: public hooks plus at most the aux-call adapter.

| Feature (today, bridge) | Plan | Notes |
|---|---|---|
| Quick answers | **done (experimental)** | this note |
| Titles (`bridge/src/meta.mjs`, Anthropic key) | retire; Hermes' `title_generation` already titles sessions (ADR 0001 §6) | app reads the session title from the Hermes API |
| Follow-up suggestions (`meta.mjs`) | plugin slot `hui_followups`, `inherit_from="title_generation"`, JSON output via `call_llm(extra_body={"response_format": ...})` | same listener, new fixed operation `POST /meta/v1/followups` |
| Router hints (`bridge/src/router`, Anthropic/Jev key) | plugin slot `hui_router` with the router prompt and JSON schema; the bridge keeps the heuristic as fallback and fast path | latency budget about 2 s; measure with `bridge/eval` against the slot model |
| Image search (Serper/Brave keys) | stays in the bridge for now | no public plugin surface for Hermes' web search backends; revisit if one appears |
| Voice STT/TTS (`voice.mjs`) | stays in the bridge for now | Hermes' STT/TTS is gateway-internal; needs an upstream API |

Each migration keeps the bridge-side fallback, so a plugin outage costs the feature and never the chat.

## Risks

- **Plugin API stability.** `register_auxiliary_task`, `inherit_from` and `on_unload` are recent (#64165-era
  plugin API v2). Older Hermes versions lack them: the plugin feature-detects, logs and stays off.
- **`call_llm` is internal.** Its signature or stream behaviour can change in any release. The impact is
  limited to `hermes_adapter.py` and fails per request (502), not at load. A contract test against a mocked
  `call_llm` is in `tests/test_units.py`. A real-Hermes CI job is still to do.
- **Streaming has no Hermes recovery ladder.** The plugin falls back to non-stream once. Fallback-chain
  providers are only reached on that second call.
- **Multi-profile scoping.**
  - Each profile that enables the plugin loads it, and in a multiplexed gateway every profile shares one
    process.
  - The secret path follows `HERMES_HOME` from the environment. A profile override set only as a contextvar
    is invisible to the plugin, so set `server.secret_file` and a distinct `server.port` per profile.
  - The first profile to bind wins the port; the others stay passive and log that.
  - The bridge points at exactly one plugin URL, so profiles must stay explicit.
  - **Secret scope (Hermes v0.22+).** A multiplexing gateway reads provider keys only inside a profile scope and
    raises `UnscopedSecretError` outside one. The listener thread has none, so `hermes_adapter.profile_scope` runs
    every quick call in the scope of the plugin's own `HERMES_HOME` (built from its `.env`). Without it every quick
    answer failed with 502 on a live v0.22 gateway with two profiles (2026-10-15). A self-test hides ⚡ when the
    private helpers change (see "Multiple profiles (bots)").
- **Host credentials.** In the throwaway home, Hermes also detected provider logins that live outside
  `HERMES_HOME` (for example CLI OAuth files in the user's home). The slot route is what the operator
  configures. Prefer an explicit `auxiliary.hui_quick.provider` so a quick answer never refreshes a shared
  OAuth login unexpectedly.
- **Spend.** Any paired device can spend the owner's quota. Mitigations: per-device limits in the bridge
  (20/min, 300/day), a global in-flight cap and an output cap in the plugin, and revocable device tokens.
- **Observers.** Hermes' `pre/post_auxiliary_call` hooks see quick requests like any auxiliary call. Some
  bundled or user plugins log usage there.

## Installing on the real Hermes (owner)

Try it on a throwaway instance first (`scripts/test-instance/` sets one up, in Docker on a Linux host or natively on a Mac). On the real Hermes:

1. Back up `config.yaml`, `.env` **and `installs/`** of the Hermes home (Hermes' package manager keeps its
   environments and the `facts.json` that selects one there).
2. Run `python3 hermes-plugin/install.py --hermes-home <home> [--group-readable-secret]` (`--copy` when Hermes runs
   in a container).
3. Enable it in `config.yaml`: add `hermes-ui-plus` to `plugins.enabled`. **Not** `hermes plugins enable`: on
   v0.22 that can make the package manager build a new environment under `installs/` and start the gateway from
   it, without the extras the gateway needs (a live attempt lost the API server for 10 minutes that way).
4. Optionally add an `auxiliary.hui_quick` block (provider + fast model).
5. Restart the gateway. Check which Python runs it (its usual venv, not one under `installs/`) and that the API
   server answers. If it did switch, move that install's `facts.json` aside and restart.
6. Bridge env: `BRIDGE_HERMES_PLUGIN_URL`, `BRIDGE_HERMES_PLUGIN_SECRET_FILE`. The secret must be readable by
   the bridge user; a hardened system unit gets it with `LoadCredential=` (see `hermes-plugin/README.md`).
   Restart the bridge.
7. Check: `GET /bridge/quick/config` returns `available: true`.

To roll back, take it out of `plugins.enabled` (or set `HERMES_UI_PLUS_DISABLE=1`), then restart.
