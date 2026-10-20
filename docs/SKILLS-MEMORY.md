# Skills & memory (HUI+ 0.2)

What the app shows about a bot's skills and memory, where the data comes from, and what stays out of reach until
Hermes itself offers it.

## What Hermes v0.22.2 offers (source: NousResearch/hermes-agent, tag `v0.22.2`, commit `d923a5eb`)

API server (`gateway/platforms/api_server.py`, the surface the bridge talks to):

- `GET /v1/skills` (also `/p/<profile>/v1/skills`) returns `{object:"list", data:[{name, description, category}]}`.
  The response has no enabled state, source or SKILL.md body. On every release from 0.21.5 through 0.22.2 this
  call fails with HTTP 500 "Failed to enumerate skills". The handler passes `include_editorial=True` to
  `tools.skills_tool._find_all_skills()`, and that function does not accept the argument (`api_server.py:2932`,
  `skills_tool.py:235`). Upstream issue #120831 and fix PR #124861 were both still open on 2026-10-16.
- Memory has no endpoint. `/v1/capabilities` advertises `memory_write_api: false` and `admin_config_rw: false`.
  Memory lives in `<HERMES_HOME>/memories/MEMORY.md` (the agent's notes) and `USER.md` (about the user). That is
  one pair per profile, with entries separated by `\n§\n` (`tools/memory_tool_store.py:25`), default limits of
  2200 and 1375 characters, and gates `memory.memory_enabled` and `memory.user_profile_enabled`. The `memory`
  tool is part of the API server toolset, so a chat can always ask the agent to show or forget something.
- The dashboard (`hermes dashboard`, FastAPI on `127.0.0.1:9119`, its own session token or OAuth) has
  `GET /api/skills` (with `enabled` and `provenance`), `PUT /api/skills/toggle`, `GET/PUT /api/skills/content`,
  `GET /api/memory` (file sizes only, no content) and `POST /api/memory/reset`. It is a local admin surface with
  different auth and is not meant as a remote API. The bridge never forwards to it. Doing so would hand admin
  rights (config writes, skill edits, memory wipes) to every paired device.

## What the app does

| | Stock Hermes (API server only) | With the `hermes-ui-plus` plugin (owner opt-in) |
|---|---|---|
| Skills list | `GET /v1/skills` (name, description, category). On 0.21.5–0.22.2 an explanation of the Hermes bug | Full list with category, source (bundled / hub / external / local) and on/off state, including disabled skills |
| Skill detail | Description, "Use in chat", "Ask Hermes to explain" | SKILL.md rendered as Markdown |
| Enable / disable | Not offered (no API) | Not offered (read-only; changing `skills.disabled` is an admin write) |
| Memory | Explanation, plus quick actions that send a normal chat message ("What do you remember about me?", "Forget …") | Entries of MEMORY.md and USER.md, fill level and last change, per-entry "Ask Hermes to forget this" |
| Edit / delete memory | Through the agent only (normal message) | Through the agent only (normal message) |

Edits always go through the agent. It then applies its own rules: injection scan, limits and file locking.
No HUI+ code path writes Hermes config, skills or memory files.

## Plugin endpoints (hermes-ui-plus >= 0.2.0, loopback, Bearer secret)

These are served for the plugin's own profile only (its `HERMES_HOME`). The plugin reports which profile that is.

- `GET /library/config` returns `{version, profile, skills:{available, reason?}, memory:{available, reason?}}`.
  `reason` is a `[a-z_]` code: `disabled_by_config`, `memory_not_exposed` or `hermes_unsupported`.
- `GET /library/skills` returns `{object:"list", profile, data:[{name, description, category|null, enabled, source}]}`.
  `source` is one of `bundled | hub | external | local | plugin`. It is sorted like Hermes (category, name).
- `GET /library/skills/content?name=<load name>` returns `{name, content, truncated}`. The name must be an exact
  entry of the list; there is no path input. Content is capped at 256 KiB.
- `GET /library/memory` returns `{profile, provider|null, stores:[{target:"memory"|"user", enabled, entries:[string],
  chars, limit, updated_at|null}]}`. This route only answers when `library.expose_memory: true` is set in the
  plugin config (default `false`). Otherwise it returns `404 feature_off` with reason `memory_not_exposed`.

Plugin config (`plugins.hermes-ui-plus` block):

```yaml
library:
  enabled: true          # skills list + SKILL.md (read-only)
  expose_memory: false   # set true to let paired devices read MEMORY.md / USER.md of this profile
```

## Bridge routes

The bridge adds device auth and uses the same plugin URL and secret as quick answers (`BRIDGE_HERMES_PLUGIN_URL`,
`BRIDGE_HERMES_PLUGIN_SECRET_FILE`). `BRIDGE_LIBRARY=off` turns the feature off.

- `GET /bridge/library/config?bot=<name>` returns `{skills:{available, reason?}, memory:{available, reason?}, bot}`.
  It is always 200 for an authorized client. "Not available" carries a reason code: `bridge_off`,
  `plugin_not_configured`, `plugin_unreachable`, `other_bot`, or the plugin's own reason.
- `GET /bridge/library/skills?bot=<name>`, `GET /bridge/library/skills/content?bot=<name>&name=<skill>` and
  `GET /bridge/library/memory?bot=<name>` are projections of the plugin answers with known fields only and capped
  strings. When the feature is not available they return 404 with `{error:{code:"feature_off", reason}}`.
- `bot` is optional and means `default` when left out. It must be a bot the bridge allows (`BRIDGE_PROFILES`) and
  the plugin's own profile. Any other bot gets `feature_off` with reason `other_bot`, and the app falls back to
  the stock API for that bot. Nothing from another profile can be read through the plugin.

## Needs upstream

- Merge of PR #124861 (`GET /v1/skills` 500).
- `enabled` and `source` on `GET /v1/skills`, plus a read-only `GET /v1/skills/{name}` with the SKILL.md body.
- A scoped, opt-in memory read API on the API server (per profile, entries plus `updated_at`), and a per-entry
  delete that goes through the same checks as the memory tool.
- An authorization model for config writes on the API server (a scope such as `skills.manage`) before per-bot
  enable/disable can be offered from a phone.
