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
  it on, see "Creating bots from the app") creates and edits bots. With plugin 0.3 it can also remove "always allow"
  entries and archive or restore a bot (see "Allow-list, archive and other bots' skills"). It never restarts the
  gateway.

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
  of commands, not just the exact command. With plugin 0.3 the app lists these entries per bot and can remove one.

### Hermes v0.22.3 and newer: one timeline per bot

From v0.22.3 (unified gateway) the Bot Chat belongs to the gateway itself: `POST /api/sessions {title:"Bot Chat"}`
mints a local chat (`local-…` id), and Hermes refuses chat turns into it over the API (`permission_denied`). Reminders
and routine results still land there, also the bridge's push per delivery. The app recognises such a Hermes by
`features.run_unknown_resolution` in `GET /v1/capabilities`.

From app 0.3 the bot's screen then shows two sources on one timeline (`app/src/bots/timeline.ts`):

- **Deliveries:** the Bot Chat, read-only. Looked up on open, on foreground, on a delivery's inbox or push event, and
  every 60 s while the screen shows.
- **The talk:** the app's own session of that bot, fixed id `hui-bot-<bot>` (`hui-bot-default` for the default bot), which
  every device finds without a lookup. It comes into being with the first turn and works like any chat (streaming,
  approvals, Stop, live cards). The chat list never shows it. Other Hermes clients see it as an ordinary session.

When the user writes after a delivery, the app adds a system message for that turn with up to 3 deliveries of the last
72 h (`[hermes-ui-bot-deliveries]`, marked as data), for as long as at most 6 user messages followed the delivery. Hermes
doesn't store system messages. No bridge feature is involved, so this also works on the default bridge and without one.

A Bot Chat made on v0.22.2 by the bridge is moved aside by Hermes as `Bot Chat (API <id>)` on the next delivery; the
app keeps showing it as history on the same timeline. One that a v0.22.2 cron delivery made (`source: cli`) stays the
Bot Chat. Chats made with "New chat with <bot>" in app 0.2.2 stay ordinary chats.

If the capabilities can't be read and the bot has no talk yet, the Bot Chat opens as before and a send explains
itself. On v0.22.2 and older, and in the offline demo, the bot's screen stays one writable thread.

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

## Allow-list, archive and other bots' skills (plugin)

Plugin 0.3, in the default profile's plugin only (the plugin of another profile answers `404 feature_off`,
`not_root_profile`), behind the same `bots.enabled` setting as the rest of `/bots`.

- **Skills and memory of a bot:** the library routes take `?profile=<name>`, so "Skills & memory" can show the skills
  of any bot and, when you set `library.expose_memory: true` in the default profile's plugin settings, its MEMORY.md /
  USER.md (read from `profiles/<name>/memories/`, limits from that bot's `config.yaml`). Read-only, as before.
- **"Always allow" list:** the app reads a bot's `command_allowlist` (also the default profile's) and its
  `approvals.mode`, and can remove one entry. The plugin rewrites that `config.yaml` (comments in it are not kept, the
  same as when Hermes itself saves an "always" choice) and tells Hermes to re-read the list, so the next matching
  command asks again without a restart. One limit: "Always allow" also allowed the pattern for the rest of the session
  it was given in, and Hermes keeps that in memory only. A chat that is still running in that session keeps it until
  the session ends; new sessions ask again.
- **Archive / restore:** archiving writes `profiles/<name>/gateway.parked` with the first line
  `hermes-ui-plus: archived`. Hermes then stops serving `/p/<name>/` (at once after the rescan the plugin asks for,
  otherwise within 30 s); the profile's files, chats and memory stay. Restore deletes the marker and the bot is served
  again. The app only removes its own marker: a bot you stopped with `hermes -p <name> gateway stop`, or one whose
  setup failed (`hermes-ui-plus: setup failed`), answers `409 parked_elsewhere`; restart those on the server. The
  default profile is never archived. Deleting a bot stays a server step (`hermes profile delete <name>`).

## About a bot, archive, activity (0.3, bridge)

Needs the `hermes-ui-plus` plugin 0.3 in the **default (root) profile** (it reads the other profiles' files); an older
plugin or one in another profile makes the bridge answer `404 bots_unavailable` with reason `plugin_unsupported` /
`not_root_profile`, and the app says so. Every plugin answer is projected onto known fields; no plugin text reaches the
app, and the bridge logs bot names and counts only.

### Rights

`bots.manage` is the same gate as creating (owner switch, admin token or a device with `bots grant`, plugin reachable,
`HERMES_API_KEY` set) except that the 50-bot limit does not close it. `GET /bridge/bots` says it:

```
GET /bridge/bots -> {create: {allowed, reason?}, manage: {allowed, reason?}, admin, limit, count,
                     archived: [{name, label?, color?}]}
```

`archived` lists bots archived from the app (plugin rows with `archived: true`), only for a credential with `manage` or
the admin token (else `[]`). A bot parked for another reason (setup failure, a marker written by hand) is not in it.

### "Always allowed" (command allow-list of one bot)

```
GET  /bridge/bots/<name>/allowlist          any credential; <name> may be `default`
     -> {entries: [{pattern}], omitted?: n, manage: {allowed, reason?}}
POST /bridge/bots/<name>/allowlist/revoke   bots.manage, body {pattern} (string, 1..200 chars, no control characters)
     -> same shape without the pattern; 404 not_found when it is not in the list
```

Entries are the profile's `config.yaml` `command_allowlist` (pattern keys such as "recursive delete", exact commands or
globs), at most 200 of at most 200 characters; `omitted` counts entries left out by these caps. Revoking removes the
entry from `config.yaml` and from Hermes' in-process "always" set of that profile, so the next request asks again
without a gateway restart.

### Archive and restore

```
POST /bridge/bots/<name>/archive | /restore   bots.manage, never `default` (403 default_bot)
     -> {bot: {name, label?, description?, color?, template?, parked, archived}}
```

Archive writes the profile's `gateway.parked` marker (first line `hermes-ui-plus: archived`); the multiplexing gateway
stops serving the bot, the bridge refreshes its bot list at once and the bot leaves `/bridge/profiles` (and `/p/<name>/`
answers 404 unknown_profile). Nothing is deleted: files, memory, sessions and routines stay. Restore removes only that
marker and the bot is listed again (in every `BRIDGE_PROFILES` mode, also `list` for bots made in the app). A marker the
plugin did not write gives `409 parked_elsewhere`: restore that bot on the server. The bridge also hides a profile with a
`gateway.parked` marker from its own directory scan (`auto`) and from an explicit `BRIDGE_PROFILES` list.

### Activity: what the bots are doing right now

```
GET /bridge/bots/activity   any credential
-> {object: "bots.activity", at, turns: {known: true}, routines: {known, reason?, bots: [names read]},
    data: [{bot: "default"|name, turns: [{sessionId, since, steps: [{name, label?, state: "done"|"running"}]}],
            routines: [{jobId, name, since?}]}]}
```

Hermes keeps no list of running runs, so this is honest about its limits:

- **turns** are the chat turns that run **through this bridge** (any paired device, also after the phone went away and
  the run continued detached). A chat started from Telegram, the CLI, Hermes Desktop or another bridge is not seen.
  Steps come from the turn's `hermes.tool.progress` events: at most 12, newest last; a step is `running` until Hermes
  reports it completed or failed. A turn disappears when its upstream request ends. Stop a turn with the existing
  `POST /bridge/chat/stop {sessionId, profile}`.
- **routines** are cron jobs whose latest execution is `claimed` or `running` (`GET /api/jobs`), read only for bots
  whose routines the credential may read (routines enabled for that bot by the owner, device right not `none`), at most
  8 bots besides the default, cached 15 s per bot, 5 s timeout. `routines.known` is `false` with reason `routines_off`
  when no bot qualifies, and `failed` when a job list could not be read (what could be read is still listed).
- Only bots with something running are in `data`.

### Notifications per bot

The app's three levels per bot ("Alles", "Nur wenn ich gebraucht werde", "Aus") reach the bridge as the push
registration's `scope.quietBots` / `scope.offBots` (bot names, `default` for the default bot; `/bridge/push/config`
says `botLevels: true`). A registration that lists a bot in either gets no push for that bot's answers, Bot Chat
deliveries and routine results. Approval pushes are never filtered, and neither is the live inbox (the app decides what
it shows). The app keeps "Aus" for approvals on the device (no local reminder).

### Routine runs that needed you

A cron run has no user to approve a dangerous command; Hermes then blocks the step (`approvals.cron_mode`, default
deny). The routines inbox recognises that tool result in the run's session and adds
`blocked: {description?, command?}` (pattern description and the blocked command or code, one line, 200 characters
each) to the entry, in `GET /bridge/routines/inbox` and `/inbox/<id>`.

## Bot groups

A group chat of 2 to 6 bots, run by the bridge, off by default: `hermes-ui-plus-bridge groups enable`. Details in
[BOT-GROUPS.md](BOT-GROUPS.md).
