# Installing the `hermes-ui` skill

The `hermes-ui` skill teaches Hermes the answer protocol of Hermes Interactive UI+ (tables, charts, cards and the
other interactive components). Without it Hermes answers the app in plain Markdown.

**Easiest:** run the bridge's setup wizard on the machine that runs Hermes. It installs or updates the skill for you
(the previous version is backed up to `$HERMES_HOME/skill-backups/`; optionally also into Hermes profiles):

```bash
npx hermes-ui-plus-bridge setup
```

Re-running the wizard later updates the skill in place. The steps below are for installing it by hand.

## How it works (and why other chats are unaffected)

- The skill is a plain directory, `hermes-ui/`, in Hermes' skills folder: `$HERMES_HOME/skills/hermes-ui/`
  (`$HERMES_HOME` is `~/.hermes` unless you changed it; in a container it is wherever Hermes keeps its home).
- Its frontmatter limits it to API sessions (`metadata.hermes.session_platforms: [api_server]`), so Telegram, cron and
  other platforms never see it in their skills index.
- The app's chats carry a short system message, `bootstrap-system-message.txt` (about 180 tokens). With the bridge, the
  bridge adds it to every request; when the app talks to Hermes directly, the app adds it. It tells Hermes to load the
  skill. Requests without it (other API clients) behave exactly as before.
- With the bridge, the skill's core text (about 2k tokens, cached by the provider because it never changes) comes inline
  right after the bootstrap message on every app turn, so models that skip the tool call still follow it (docs/BRIDGE.md,
  "Skill core inline"). Without the bridge, Hermes loads it once per conversation with `skill_view`. The per-topic
  reference files are loaded with `skill_view` only when needed, in both cases.
- No Hermes config change and no restart are needed. A newly copied skill is found within about 30 seconds; it shows up
  in Hermes' skills index after the next gateway restart, which the bootstrap mechanism does not need.

## Install by hand

1. Get the skill: the `hermes-skill/` folder of this repository (a git checkout or a release source archive).
2. Copy only the `hermes-ui/` directory into Hermes' skills folder:

   ```bash
   mkdir -p "${HERMES_HOME:-$HOME/.hermes}/skills"
   rsync -a --delete hermes-skill/hermes-ui/ "${HERMES_HOME:-$HOME/.hermes}/skills/hermes-ui/"
   ls "${HERMES_HOME:-$HOME/.hermes}/skills/hermes-ui"     # SKILL.md and references/
   ```

   Without `rsync`: `cp -r hermes-skill/hermes-ui "${HERMES_HOME:-$HOME/.hermes}/skills/"`. Copy as the user that runs
   Hermes, so the files belong to it. `examples/`, this file and `bootstrap-system-message.txt` are not part of the
   skill.
3. Make sure the bootstrap message reaches Hermes: the bridge sends it by default (its startup output has a `skill`
   line that must not say `MISSING`; `BRIDGE_BOOTSTRAP=off` switches it off). Without the bridge the app sends it.
   The same line shows `+ skill core inline` when the bridge also sends the skill text (`BRIDGE_SKILL_INLINE=off`
   switches only that off).

## Check that it works

Ask the app for something tabular, for example "Compare Python and Go in a small table". The first answer of a new
chat shows a rendered table instead of Markdown; without the bridge, after one extra tool step (`skill_view`).

Without the app, one small API call does the same check (it costs one real Hermes turn):

```bash
BOOT=$(cat hermes-skill/bootstrap-system-message.txt)
curl -sS -m 120 "http://127.0.0.1:8642/v1/chat/completions" \
  -H "Authorization: Bearer $HERMES_API_KEY" -H 'Content-Type: application/json' \
  -d "$(jq -n --arg b "$BOOT" '{model:"hermes-agent",stream:false,messages:[{role:"system",content:$b},{role:"user",content:"Compare Python and Go in a small table (3 rows)."}]}')" \
  | jq -r '.choices[0].message.content'
```

Adjust the address to your API server and the model to what `GET /v1/models` lists. Expected: the answer contains a
```` ```hui ```` block with JSON. The same call without the system message gives plain text, and your other Hermes
chats (for example Telegram) keep answering as before.

## Update

Repeat step 2 (`rsync --delete` also removes reference files that no longer exist), or re-run the setup wizard. New
conversations use the new text; running ones keep the version they already loaded, so start a new chat to test.

## Remove

```bash
rm -rf "${HERMES_HOME:-$HOME/.hermes}/skills/hermes-ui"
```

Nothing else was changed. Conversations that already loaded the skill keep its text in their history.

## Notes

- If your Hermes has the skill Curator enabled, it may archive skills that were not used for a long time. Pinning
  prevents that (`hermes curator pin hermes-ui`), or simply re-copy the skill.
- Very long conversations may lose the loaded skill text through context compression; the bootstrap message then
  makes Hermes load it again. With the bridge the inline core is part of every turn anyway.
- With the bridge, update the bridge and the skill in Hermes together: the bridge sends its own copy of `SKILL.md`, the
  reference files come from the copy installed in Hermes.
- A model may occasionally ignore the protocol; the app then shows plain Markdown. Stronger models follow it more
  reliably.
- Keep the skill and the app roughly in step: an older app shows components it does not know as a neutral card.
