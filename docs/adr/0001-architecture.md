# ADR 0001: Bridge + optional thin Hermes plugin, one installer

- Status: accepted (2026-10-12)
- Context reviewed by: two independent reviews by AI models, and the maintainer
- Implementation status (2026-10-13): decisions 1, 5 and 7 are in place for 0.1. Decisions 2 and 3 (the plugin) and
  most of 4 (one `setup` installer exists for the bridge, `npx hermes-ui-plus-bridge setup`; `doctor`, `update`,
  `rollback`, `uninstall` and capability negotiation do not yet) are planned for 1.0. Decision 6: see below

## Context

Hermes Interactive UI+ is a chat client for the self-hosted Hermes Agent. Today it has three server-side parts:

- **UI-Bridge** (Node service): device tokens and pairing, allow-listed pass-through to the Hermes API, keeping a turn
  alive when the phone disconnects, push, uploads, serving the web app.
- **Skill `hermes-ui`** (in Hermes' skills): teaches the model the interactive `hui` answer format, loaded only for app
  sessions.
- **Optional direct-provider extras** in the bridge: router, titles, image search, voice. They need keys of their own,
  outside Hermes.

Measured on Hermes v0.21.x:

- Every agent turn carries a large system prompt. That is about 21k input tokens on a real profile, and about 6k even
  with no tools, skills or memory.
- Trivial questions take 6–12 s.
- Hermes offers no agent-less completion endpoint.
- Hermes does offer a plugin API: auxiliary task slots that use Hermes' own providers, platforms, prompt sections and
  approval transports.

Requirement: a default install should use what its Hermes can do, without keys in a second place, and users must not
have to install several things separately.

## Options considered

- **A.** Status quo: the bridge with direct-provider extras.
- **B.** The bridge plus a thin Hermes plugin for things that need Hermes' credentials, installed by one installer.
- **C.** Everything as an in-process Hermes platform plugin, with no separate bridge.
- **D.** A pure pass-through bridge only, with the rest pushed upstream.

## Decision

1. **0.1 alpha: the bridge as a pure pass-through plus the skill and push.** The direct-provider extras become opt-in
   (`setup --extras`). No plugin is shipped.
2. **1.0: option B.** A **thin, optional** Hermes plugin covers only features that must use Hermes' own models and
   credentials:
   - quick answers first;
   - possibly router hints and follow-up suggestions later.

   Everything network-facing stays in the bridge: pairing, device auth, proxy, push, uploads, the web app and
   reconnect handling.
3. **Hard rule: chat works fully when the plugin is absent, disabled or crashing.** The bridge probes the plugin's
   capabilities and degrades to the heuristic router and no quick mode. A plugin API break therefore costs a feature,
   never the chat.
4. **One product for users.**
   - One command: `npx hermes-ui-plus setup`, plus `doctor`, `update`, `rollback` and `uninstall`.
   - One version number for app, bridge, plugin and skill.
   - The plugin ships inside the npm package, so no pip is needed.
   - Version and capability negotiation runs through `/bridge/capabilities`.
5. **The skill stays a skill.** It is not folded into a permanent prompt section, which would cost about 2k tokens on
   every turn on every platform.

   *Addendum (2026-10-14): skill core inline for app turns.* In end-to-end tests on Hermes v0.22, Claude Sonnet often
   did not call `skill_view` although the bootstrap message asked for it, then ignored the router hint and answered in
   plain text with the result last. Stronger wording did not change that. The bridge therefore sends the core of
   `SKILL.md` (without front matter) as one system message right after the bootstrap message.
   - Why: reliability on models that skip `skill_view`; the protocol no longer depends on a tool call.
   - Scope: only app turns through the bridge (requests with the bootstrap message, bootstrap active), not other
     platforms or API clients, so the reason for this decision still holds. Direct connections without the bridge keep
     the `skill_view` path. `BRIDGE_SKILL_INLINE=off` restores it for the bridge too.
   - Cost: about 2k input tokens per app turn, cached: the message is byte-identical on every turn and Hermes appends it
     to the end of its cached system prompt without persisting it.
   - Unchanged: the skill stays a normal Hermes skill (references load on demand with `skill_view`, other clients use it
     as before), and the plugin plan for 1.0 (decisions 2 and 3) is not affected.
6. **Titles come from Hermes** (`title_generation`). Planned for 1.0: until then the bridge's own title generation
   stays available as an opt-in extra (`BRIDGE_META=on`).
7. **Option C is rejected.**
   - It would put internet-facing parsers inside the process that holds every secret and every other messaging
     platform.
   - Every bridge fix would need a gateway restart.
   - It would re-proxy Hermes' own API from inside Hermes.
   - It would discard a tested edge layer.

## Plugin rules

- Use only the public `PluginContext.register_*` hooks, feature-detected. Import no other Hermes internals. Python
  stdlib only.
- Listen on loopback only, and authenticate the bridge-to-plugin traffic with an installer-generated secret. Expose
  fixed operations only: no arbitrary tool calls, no secret access, no provider URLs.
- Handlers are async, short and wrapped in timeouts. The plugin must never block the gateway.
- Keep profiles explicit (`/p/<profile>/`). Never read secrets directly and never create profiles.
- Support a tested range of Hermes versions, verified with contract tests against a mocked `PluginContext` and a job
  against real Hermes.
- Kill criterion for the prototype: if quick answers need Hermes internals beyond the plugin API, stop.

## Security notes

The bridge's process isolation is defence in depth, not containment. A compromised bridge, like a stolen device
token, can drive the terminal-capable agent through the Hermes API, gated only by approvals. The real protections are
the tailnet, revocable per-device tokens and keeping the master key and provider keys on the server.

## Upstream proposals (to Hermes)

Each of these would let us shrink our own code:

- CORS: allow `X-Hermes-Session-Key` and add `Access-Control-Expose-Headers`.
- An agent-less ("lean") completion, or a way to invoke a registered auxiliary task.
- Detached runs whose events can be replayed after a client disconnect.
- Scoped, revocable API tokens per client or profile.

## Follow-ups

- Done: narrow the bridge's `/v1` pass-through to an explicit allow-list. Keep the base path of the Hermes URL. Count
  concurrency until the upstream turn ends, and add a global cap.
- Open: add a `/bridge/capabilities` endpoint with component and `hui` schema versions, and an app prompt to update on
  version skew.
- Write an alpha caveats page:
  - iOS push needs the web app on the home screen;
  - no quick mode yet;
  - tested Hermes versions;
  - the second-profile warning.
- Make sends idempotent so a retry after a disconnect cannot duplicate a turn.
- Evaluate `hui` validity per model and keep the degrade-to-text path for weak models.
- Show which model quick mode uses, with limits per device, because it spends the owner's quota.
