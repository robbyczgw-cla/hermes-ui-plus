# Bots on your Hermes server (runbook)

In HUI+ a **bot** is a Hermes profile you can message: its own chat ("Bot Chat", the same thread Hermes Desktop shows),
its own memory and skills. The app shows bots in the drawer's **Bots** tab as soon as the bridge lists at least one
profile besides the default. Without extra profiles the app looks exactly like before.

This page is for the owner of the Hermes server. Everything here is done once, on the server, by you. The app never
changes these settings and never restarts the gateway.

## What the app needs

| Piece | Why | Check |
|---|---|---|
| `gateway.multiplex_profiles: true` in `~/.hermes/config.yaml` | one gateway serves every profile under `/p/<name>/` | `doctor bots` |
| `API_SERVER_KEY` in every profile's `.env`, equal to the bridge's `HERMES_API_KEY` | a cloned or fresh profile has none, `/p/<name>/` then answers 401 | `doctor bots` |
| The bridge lists the profiles (`GET /bridge/profiles`) | the app's roster | `doctor bots`, `BRIDGE_PROFILES` |
| Bridge 0.2 or newer | opens or creates each bot's "Bot Chat" session (`POST /api/sessions`, title "Bot Chat" only) | bridge version |

## 1. Look first (read-only)

```sh
hermes-ui-plus-bridge doctor bots            # on the Hermes host, as the Hermes user or root
hermes-ui-plus-bridge doctor bots --json     # the same as JSON
hermes-ui-plus-bridge doctor bots --hermes-home /path/to/.hermes
```

It reports the multiplex switch, every profile's key (compared with the bridge's key, never printed), Hermes Desktop
bot metadata, how the bridge lists bots, `installs/*/facts.json` files and which Python environment the running gateway
loaded (from `/proc/<pid>/maps`, Linux). It changes nothing and writes no token.

## 2. Back up before any server step

```sh
hermes-ui-plus-bridge bots backup                   # → ~/hermes-backups/hermes-bots-<time>/ (mode 0700/0600)
hermes-ui-plus-bridge bots backup --to /some/dir
```

The backup holds `config.yaml`, `.env`, each profile's `config.yaml`, `.env`, `profile.yaml`, `SOUL.md`, and every
`installs/<key>/facts.json`. The last part matters: on Hermes v0.22 a gateway restart after `hermes plugins enable` or
the first multiplexed start can let Hermes' package manager write a new `facts.json`, which selects a dependency
environment without aiohttp. The API server is then down while Telegram keeps working. A config-only backup cannot
undo that.

## 3. Turn on multiplexing (once, gateway restart)

Do this at a quiet moment: a gateway restart ends turns that are running.

1. Try it on a throwaway Hermes instance with the same version first.
2. `bots backup` (step 2).
3. Edit `~/.hermes/config.yaml`:

   ```yaml
   gateway:
     multiplex_profiles: true
   ```

4. Restart the gateway the way you run it (for example `systemctl restart <hermes-gateway-unit>`).
5. Right after the restart:

   ```sh
   hermes-ui-plus-bridge doctor bots
   curl -fsS http://127.0.0.1:<port>/health
   grep -c "$HOME/.hermes/installs" /proc/<gateway-pid>/maps   # must print 0
   ```

   `doctor bots` shows `[XX] gateway pid … runs from a package-manager env` when the trap hit. Roll back (step 6).

Creating more profiles later on a gateway that already multiplexes is file work only: the gateway picks a new profile
up within about 30 seconds, without a restart and without the package manager.

## 4. Give every bot the key

For each profile that `doctor bots` marks with `no API_SERVER_KEY` or `differs`:

```sh
printf 'API_SERVER_KEY=%s\n' '<the bridge HERMES_API_KEY>' >> ~/.hermes/profiles/<name>/.env
chmod 600 ~/.hermes/profiles/<name>/.env
```

Hermes re-reads it on the next request, no restart.

## 5. Let the bridge list the bots

- If the bridge can read the Hermes home, `BRIDGE_PROFILES` can stay unset (`auto`, re-scanned every 30 s).
- A sandboxed bridge (systemd `ProtectHome` / `DynamicUser`, a container without the Hermes home) cannot. Set the list
  in the bridge's env file and restart the bridge when no turn is running:

  ```sh
  BRIDGE_PROFILES=writer,scout=Scout       # optional display label after =
  ```

Hermes Desktop's bot metadata (`ui_meta['hermes-bots']` in `profile.yaml`) is used for names when the bridge can read
it. Hidden Desktop bots stay hidden.

## 6. Rollback

```sh
hermes-ui-plus-bridge bots rollback ~/hermes-backups/hermes-bots-<time>          # shows the plan, changes nothing
hermes-ui-plus-bridge bots rollback ~/hermes-backups/hermes-bots-<time> --yes    # applies it
```

It restores the backed-up files (the current ones are kept in `before-rollback-<time>/` inside the backup) and renames
every `facts.json` that did not exist at backup time to `facts.json.hui-aside-<time>` (never deletes). Profiles created
after the backup are listed, not touched. Then restart the gateway and run `doctor bots` again.

This undoes the package-manager trap, not the bots themselves: while more than one profile exists, Hermes v0.22 keeps
multiplexing (at the first start with a second profile it writes `gateway.multiplex_profiles: true` into `config.yaml`
by itself, and v0.22.2 ignores `false`). To take the bots away completely, move the new profiles out of
`~/.hermes/profiles/` before the restart, run `hermes-ui-plus-bridge bots disable` and remove them from
`BRIDGE_PROFILES`.

A package-manager env is selected by any `hermes plugins enable|disable|install` run (an explicit dependency sync, even
with `security.allow_lazy_installs: false`): the new `facts.json` appears right away and takes effect at the next
gateway start. Seen on a v0.22.2 test instance: that env had neither aiohttp nor the provider SDKs, the gateway exited
with status 78 and systemd did not restart it. `doctor bots` shows the file before the restart; `bots rollback` moves it
aside.

## Never

- `hermes plugins enable …` on a production gateway. If you want the `hermes-ui-plus` plugin, list it under
  `plugins.enabled` in `config.yaml` after a backup (docs/HERMES-PLUGIN.md), and check the gateway environment
  afterwards as in step 3.
- Turning on multiplexing for the first time on production without a backup that includes `installs/`.
- Anything of this from the app: the app reads the bot list, opens each bot's Bot Chat, chats, and (once you switched
  it on, see "Creating bots from the app") creates and edits bots. It never restarts the gateway.

## How the app uses this

- **Bots tab:** default bot ("Hermes", your normal chats stay in the Chats tab), then the other profiles. A bot row
  shows the last message of its Bot Chat, "arbeitet …" while a turn runs, and "Freigabe" while an approval waits.
- **Bot Chat:** one thread per bot. The app looks up the session titled "Bot Chat" in that profile and adopts it (the
  thread you see in Hermes Desktop), or asks the bridge to create it. The bridge accepts `POST /api/sessions` only for
  that exact title and returns the existing session when there already is one.
- **Reminders and routines** that the app's chats create are delivered into the bot's Bot Chat (`deliver: "bot-chat"`,
  the hermes-ui skill asks the model for it); for chats of the default bot that is the default bot's thread, shown as
  "Hermes" in the chat list when there is no Bots tab. Hermes writes the job's output into that thread (as an injected
  row) and the bot comments; the app shows the output under a quiet marker. The bridge watches every bot's Bot Chat
  and sends one notification per run (titled with the bot and the job, the job's text as body; silent runs, `[SILENT]`,
  notify nobody). The job's own cron session and the routines inbox do not ping a second time.
- **Approvals** in a bot's chat name the bot and offer "Allow once", "Always allow" and "Deny". "Always allow" is
  stored in that profile's `config.yaml` (`command_allowlist`), so it applies to that bot only and covers a category
  of commands, not just the exact command.

### Hermes v0.22.3 and newer: the Bot Chat is read-only in the app

From v0.22.3 (unified gateway) the Bot Chat belongs to the gateway itself: `POST /api/sessions {title:"Bot Chat"}`
mints a local chat (`local-…` id), and Hermes refuses chat turns into it over the API (`permission_denied`). Reminders
and routine results still land there and the app reads them as before (also the bridge's push per delivery).
The app recognises such a Hermes by `features.run_unknown_resolution` in `GET /v1/capabilities` and shows the thread
read-only: instead of the composer a short note and "New chat with <bot>", which opens an ordinary chat with that bot
(full streaming, approvals and Stop). A Bot Chat made on v0.22.2 by the bridge is moved aside by Hermes as
`Bot Chat (API <id>)` on the next delivery; one that a v0.22.2 cron delivery made (`source: cli`) stays the Bot Chat.
On v0.22.2 nothing changes.

## Creating bots from the app

From 0.2 the app can create a bot itself: **Bots tab → Neuer Bot**, pick a role (Recherche, Angebote & Preise,
Reiseplanung, Tagesbriefing, Code, Eigene Rolle, or an empty agent you rename), fill in three fields (name, main job,
how it should work) and a few switches (web, memory, regular check-ins; commands only for the Code role). There is no
model picker: a new bot uses the server's default model and can switch it later in the chat menu, like any chat.

### What it needs on the server (one-time owner steps)

1. **Multiplexing is on** (step 3 above). The app never switches it on.
2. **The `hermes-ui-plus` plugin runs in the default profile** of that gateway and the bridge knows its secret
   (`BRIDGE_HERMES_PLUGIN_URL` / `BRIDGE_HERMES_PLUGIN_SECRET_FILE`, docs/HERMES-PLUGIN.md). Install or update it after
   `bots backup`, enable it only through `plugins.enabled` in `config.yaml` (never `hermes plugins enable`), restart the
   gateway once at a quiet moment and check the environment as in step 3 (`doctor bots`, `/proc/<pid>/maps`).
   Updating an already enabled plugin is the same restart; it does not involve the package manager.
3. **The bridge has `HERMES_API_KEY`.** The bridge writes exactly this key as the new profile's `API_SERVER_KEY`, so the
   bot answers under `/p/<name>/` right away. The key never travels through the app.
4. **Switch it on** (off by default):

   ```sh
   hermes-ui-plus-bridge bots enable            # owner switch in the bridge's devices.json, picked up within 2 s
   hermes-ui-plus-bridge bots status
   hermes-ui-plus-bridge bots grant <device-id> # a paired phone may create and edit bots too (devices list shows ids)
   hermes-ui-plus-bridge bots revoke <device-id>
   hermes-ui-plus-bridge bots disable
   ```

   `BRIDGE_BOTS_CREATE=on|off` in the bridge's env file overrides the switch (`off` = never). The admin token
   (`BRIDGE_TOKEN`) may create bots once it is on; a paired device only with a grant, same pattern as the routines
   rights. Without the right the app shows "Neue Bots legt der Besitzer deines Hermes-Servers an." and, on an admin
   device, the `bots enable` command to copy.

No step here needs a gateway restart after the plugin is in place: creating a profile on a multiplexing gateway is file
work plus a rescan (live-checked on v0.22.2: same gateway pid, same Python environment, no `installs/*/facts.json`).

### What a new bot is on disk

The plugin creates the profile inside the gateway process (as the Hermes user), the same way `hermes profile create
<name> --clone-from default` does, then:

| File | Content |
|---|---|
| `profiles/<name>/SOUL.md` | "Du bist {Name}. {Hauptaufgabe}. So arbeitest du: … Regeln, die immer gelten: …" in the app's language; with routines on also "deliver into this chat" and "answer `[SILENT]` when there is nothing new" |
| `config.yaml` | the default profile's config (model, providers, MCP servers) with `platform_toolsets.api_server` = `skills, todo` + the switches (`web`, `memory`, `cronjob`, `terminal`+`file` for commands), `approvals.mode: manual`, an empty `command_allowlist` (the default bot's "always allow" list is not carried over) |
| `.env` | the default profile's provider keys (messaging channels are stripped by Hermes) plus `API_SERVER_KEY` = the bridge's key |
| `memories/` | empty: the default bot's MEMORY.md / USER.md are removed after the clone, the bot starts with its own memory |
| `skills/` | the default profile's skills, including `hermes-ui` (answer cards) |
| `profile.yaml` | `description` = main job; `ui_meta['hermes-bots']` = title, description, colour, `shape: circle`, created (Hermes Desktop shows the same bot); `ui_meta['hermes-ui-plus']` = role, main job, how it works, language, switches (for editing) |

A bot that fails half-way gets a `gateway.parked` marker (Hermes does not serve it) and the app shows the error.
Editing (`PATCH /bridge/bots/<name>`) rewrites `SOUL.md` and the two `ui_meta` entries from the three fields; the
default bot is never edited from the app. At most 50 bots (plugin setting `bots.limit`). The app does not delete bots:
`hermes profile delete <name>` on the server.

### Checks

```sh
scripts/test-instance/ti.sh --host mac bots-create-test     # live, on a throwaway instance (docs: scripts/test-instance/README.md)
```

It creates a bot from a template and an empty one, checks the files above, that `/p/<name>/` answers with the bridge's
key, that the bot answers in its role and keeps its own memory, that editing works and that a paired device without
the grant gets 403, then deletes the bots and verifies that every config, key and memory file of the other profiles,
`devices.json`, `installs/*/facts.json` and the gateway's pid and Python environment are unchanged.
