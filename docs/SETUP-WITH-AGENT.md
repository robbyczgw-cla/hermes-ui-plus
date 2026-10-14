# Set up Hermes UI+ with an agent

Many people already run an agent on the machine that hosts Hermes: Hermes itself (reachable over Telegram or the Hermes CLI), or a coding agent such as Claude Code or Codex CLI. Instead of typing the setup yourself, paste one of the prompts below. They all drive the same wizard, `npx hermes-ui-plus-bridge setup`, which:

- detects Hermes (`$HERMES_HOME` or `~/.hermes`), whether its API server is enabled and reachable, and its version,
- installs or updates the `hermes-ui` skill (an older version is backed up to `~/.hermes/skill-backups/`),
- writes the bridge env file (default `~/.config/hermes-ui-plus-bridge/env`, mode 0600),
- installs a systemd user unit (or a system unit as root, or a launchd agent on macOS; Docker gets a compose snippet),
- publishes the bridge on your tailnet with `tailscale serve` and prints a pair link / QR code.

`--dry-run` shows the plan without changing anything, `--yes` takes the defaults, and `--json` prints a machine-readable report for agents (keys are masked; the only secret in it is the one-time pair link). Re-running the wizard updates everything in place. Hermes' own `config.yaml` is never changed without an interactive "y", and Hermes is never restarted by the wizard.

**Safety rules built into every prompt:** the agent asks before restarting Hermes or changing its config, never posts tokens, keys or pair links in group chats or channels, and keeps everything on your tailnet (no `tailscale funnel`, no port forwarding). A pair link works once and expires after one hour if unused; revoke a device any time with `hermes-ui-plus-bridge devices revoke <id>`.

The same prompts are built into the app (onboarding and diagnostics, "Copy prompt") in English, German and Spanish. Their source is `app/src/onboarding/agentPrompts.ts`; this page mirrors it.

## Prompts

### (a) Prompt for your Hermes agent

Paste this into a direct chat with your Hermes agent (Telegram, the Hermes CLI, or any other private channel). Hermes runs the wizard on its own machine and sends you the pair link back in the same chat.

```text
Please set up Hermes UI+ (the Hermes Interactive UI+ app) on this machine, the one you run on. Work step by step and report back briefly after each step.

1. Check that Node.js 22 or newer is installed (`node --version`). If not, stop and tell me how to install it.
2. Preview: run `npx -y hermes-ui-plus-bridge@latest setup --dry-run --json` and summarize the plan: Hermes API server status, skill install, env file, service, Tailscale URL, warnings. Never show keys or tokens.
3. If the Hermes API server is not enabled, show me the config change and the restart command from the report and wait for my OK. Do not edit config.yaml and do not restart Hermes yourself: a restart ends this conversation, so I will do it.
4. Run `npx -y hermes-ui-plus-bridge@latest setup --yes --json`. It installs the hermes-ui skill (an older version is backed up), writes the bridge env file (mode 0600), installs and starts the bridge service, publishes it on my tailnet with `tailscale serve` and creates a one-time pair link. If the report says a system service needs a global install, ask me before running `npm install -g hermes-ui-plus-bridge`, then run `hermes-ui-plus-bridge setup --yes --json`.
5. Verify: the report has "ok": true, `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8790/health` answers, `tailscale serve status` lists the bridge, and `~/.hermes/skills/hermes-ui/SKILL.md` exists.
6. Send me the "pair.link" value from the report (and "pair.webLink" if it is not empty) in this direct chat. Do not open or test the link yourself: it carries a one-time code, so the first device that opens it is paired and the link is used up. Tell me that it works once and expires after 1 hour, and list any warnings and next steps.

Rules:
- Ask me before restarting Hermes, changing its config or installing anything else.
- Never post tokens, API keys or pair links in group chats, channels or logs. Only in this direct chat with me.
- Tailnet only: never use `tailscale funnel`, port forwarding or a public address for the bridge or Hermes.
- If a step fails, stop and show me the error with secrets removed.
```

### (b) Prompt for Claude Code / Codex

For a coding agent with a terminal on the Hermes host. It runs the wizard without creating a pair link, so no device token ends up in the agent transcript; you create the QR code yourself at the end.

```text
You are on the server that runs my Hermes Agent. Set up the Hermes UI+ Bridge (npm package hermes-ui-plus-bridge, docs: https://github.com/robbyczgw-cla/hermes-ui-plus) so my phone can use the Hermes UI+ app.

1. Check `node --version` (22 or newer), `tailscale status`, and that Hermes lives here (`~/.hermes` or $HERMES_HOME).
2. Run `npx -y hermes-ui-plus-bridge@latest setup --dry-run --json` and show me a short summary of the plan. The report masks keys and tokens; never print them yourself.
3. If the Hermes API server is off, show me the snippet and the restart command from the output and wait. Do not edit Hermes' config.yaml and do not restart Hermes without my explicit OK.
4. After my OK run `npx -y hermes-ui-plus-bridge@latest setup --yes --json --no-pair`. If it warns that a system service needs a global install, ask me before `npm install -g hermes-ui-plus-bridge`, then use `hermes-ui-plus-bridge setup --yes --json --no-pair`. Optional keys (image search, voice, router) go in only as environment variables I give you, for example `SERPER_API_KEY=... npx ...`.
5. Verify: the service is active (`systemctl --user status hermes-ui-plus-bridge`, or the system unit), `curl -s http://127.0.0.1:8790/health` answers, `tailscale serve status` lists the bridge, `~/.hermes/skills/hermes-ui/SKILL.md` exists.
6. Do not create the pair link yourself: it carries a one-time code that pairs whichever device opens it first, so it belongs only on my screen. Tell me the exact command to run in my own terminal: `npx hermes-ui-plus-bridge devices add "Phone" --env-file <env file from the report>`. It prints a QR code that works once and expires after 1 hour.

Rules: ask before restarting Hermes, editing its config or installing system packages. Tailnet only: no `tailscale funnel`, no port forwarding, no public binding. Never commit, paste or log secrets. On errors stop and report.
```

### (c) Diagnose a connection problem

Read-only diagnosis first. The app's guided diagnostics can copy this prompt with what it saw appended (error kind, HTTP status, host); no keys are included.

```text
The Hermes UI+ app cannot connect to my Hermes. Diagnose it on this server. Read-only first: change nothing until I agree to a fix. Never print tokens or API keys (mask them).

Check each item and report OK or the problem:
1. Bridge service: `systemctl --user status hermes-ui-plus-bridge` (or `sudo systemctl status hermes-ui-plus-bridge`, or `docker compose ps`) and the last 50 log lines (`journalctl --user -u hermes-ui-plus-bridge -n 50`).
2. Bridge locally: `curl -si http://127.0.0.1:8790/health` (status, and the header X-Hermes-UI-Bridge: 1).
3. Hermes API server: enabled in `~/.hermes/config.yaml` (platforms.api_server, never show the key)? Does `curl -s http://127.0.0.1:<port>/health` answer, and which Hermes version?
4. Bridge env file (`~/.config/hermes-ui-plus-bridge/env` or `/etc/hermes-ui-plus-bridge/env`): show only HERMES_BASE_URL, BRIDGE_PUBLIC_URL, BRIDGE_HOST and BRIDGE_PORT. Does HERMES_API_KEY equal Hermes' key? Compare without printing either.
5. Tailscale: `tailscale status` and `tailscale serve status`. Does the serve target match the bridge port, and BRIDGE_PUBLIC_URL match the https address exactly?
6. Through the tailnet: `curl -si <BRIDGE_PUBLIC_URL>/health`. 421 means the host name does not match BRIDGE_PUBLIC_URL; 401 in the app means its device token is wrong, expired or revoked.
7. Devices: `npx hermes-ui-plus-bridge devices list --env-file <env file>`.
8. Skill: does `~/.hermes/skills/hermes-ui/SKILL.md` exist?
9. `npx -y hermes-ui-plus-bridge@latest setup --dry-run --json`: list its warnings.

Then tell me the most likely cause and the smallest fix, and wait for my OK. Ask before restarting Hermes or changing its config. Tailnet only: never `tailscale funnel` or port forwarding.
```

### (d) Update bridge and skill

Updates the bridge and the skill in place. Hermes itself is not restarted.

```text
Please update the Hermes UI+ Bridge and the hermes-ui skill on this server.

1. Note the current state: bridge version (`npx hermes-ui-plus-bridge --version`, or the globally installed package), skill version (the `version:` line in `~/.hermes/skills/hermes-ui/SKILL.md`), service status.
2. Read the release notes (https://github.com/robbyczgw-cla/hermes-ui-plus/blob/main/CHANGELOG.md) and tell me about anything that needs action.
3. Preview: `npx -y hermes-ui-plus-bridge@latest setup --dry-run --json`. Summarize what would change. Never show keys or tokens.
4. After my OK: for a global install run `npm install -g hermes-ui-plus-bridge@latest` and then `hermes-ui-plus-bridge setup --yes --json --no-pair`; otherwise `npx -y hermes-ui-plus-bridge@latest setup --yes --json --no-pair`. It updates the skill (the old version is backed up), the env file and the service in place and restarts only the bridge.
5. Verify: the report has "ok": true, `curl -s http://127.0.0.1:8790/health` answers, the service is active, the new skill version is in place. Tell me the versions before and after.

Rules: do not restart Hermes (new conversations pick up the skill by themselves). Ask before changing Hermes' config. Tailnet only. On errors stop and report.
```

## Deutsch (Kurzfassung)

Dieselben Prompts auf Deutsch. In der App gibt es sie zusätzlich auf Spanisch ("Prompt kopieren").

### (a) Prompt für deinen Hermes-Agenten

```text
Bitte richte Hermes UI+ (die App Hermes Interactive UI+) auf diesem Rechner ein, also dort, wo du läufst. Arbeite Schritt für Schritt und melde dich nach jedem Schritt kurz.

1. Prüfe, ob Node.js 22 oder neuer installiert ist (`node --version`). Wenn nicht: abbrechen und mir sagen, wie ich es installiere.
2. Vorschau: führe `npx -y hermes-ui-plus-bridge@latest setup --dry-run --json` aus und fasse den Plan zusammen: Hermes-API-Server, Skill, Env-Datei, Dienst, Tailscale-URL, Warnungen. Zeig nie Schlüssel oder Tokens.
3. Ist der Hermes-API-Server aus, zeig mir die Config-Änderung und den Neustart-Befehl aus dem Bericht und warte auf mein OK. Ändere config.yaml nicht und starte Hermes nicht selbst neu: ein Neustart beendet dieses Gespräch, das mache ich.
4. Führe `npx -y hermes-ui-plus-bridge@latest setup --yes --json` aus. Das installiert den hermes-ui-Skill (eine ältere Version wird gesichert), schreibt die Env-Datei der Bridge (Modus 0600), installiert und startet den Dienst, veröffentlicht ihn mit `tailscale serve` in meinem Tailnet und erzeugt einen einmaligen Pair-Link. Meldet der Bericht, dass ein Systemdienst eine globale Installation braucht, frag mich vor `npm install -g hermes-ui-plus-bridge` und führe danach `hermes-ui-plus-bridge setup --yes --json` aus.
5. Prüfe: Bericht hat "ok": true, `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8790/health` antwortet, `tailscale serve status` zeigt die Bridge, `~/.hermes/skills/hermes-ui/SKILL.md` existiert.
6. Schick mir den Wert "pair.link" aus dem Bericht (und "pair.webLink", falls nicht leer) in diesem Direktchat. Öffne oder teste den Link nicht selbst: er enthält einen Einmal-Code, das erste Gerät, das ihn öffnet, wird gekoppelt und der Link ist verbraucht. Sag dazu, dass er einmal funktioniert und nach 1 Stunde abläuft, und nenne Warnungen und nächste Schritte.

Regeln:
- Frag mich, bevor du Hermes neu startest, seine Config änderst oder etwas anderes installierst.
- Tokens, API-Schlüssel und Pair-Links nie in Gruppenchats, Kanäle oder Logs. Nur in diesen Direktchat mit mir.
- Nur Tailnet: nie `tailscale funnel`, Portweiterleitung oder eine öffentliche Adresse für Bridge oder Hermes.
- Schlägt ein Schritt fehl, hör auf und zeig mir den Fehler ohne Geheimnisse.
```

### (b) Prompt für Claude Code / Codex

```text
Du bist auf dem Server, auf dem mein Hermes Agent läuft. Richte die Hermes UI+ Bridge ein (npm-Paket hermes-ui-plus-bridge, Doku: https://github.com/robbyczgw-cla/hermes-ui-plus), damit mein Handy die App Hermes UI+ nutzen kann.

1. Prüfe `node --version` (22 oder neuer), `tailscale status` und ob Hermes hier liegt (`~/.hermes` oder $HERMES_HOME).
2. Führe `npx -y hermes-ui-plus-bridge@latest setup --dry-run --json` aus und zeig mir eine kurze Zusammenfassung. Der Bericht maskiert Schlüssel und Tokens; gib sie nie selbst aus.
3. Ist der Hermes-API-Server aus, zeig mir Snippet und Neustart-Befehl aus der Ausgabe und warte. Ändere Hermes' config.yaml nicht und starte Hermes nicht ohne mein ausdrückliches OK neu.
4. Nach meinem OK: `npx -y hermes-ui-plus-bridge@latest setup --yes --json --no-pair`. Warnt es, dass ein Systemdienst eine globale Installation braucht, frag mich vor `npm install -g hermes-ui-plus-bridge` und nimm dann `hermes-ui-plus-bridge setup --yes --json --no-pair`. Optionale Schlüssel (Bildsuche, Sprache, Router) nur als Umgebungsvariablen, die ich dir gebe, z. B. `SERPER_API_KEY=... npx ...`.
5. Prüfe: Dienst aktiv (`systemctl --user status hermes-ui-plus-bridge` oder die System-Unit), `curl -s http://127.0.0.1:8790/health` antwortet, `tailscale serve status` zeigt die Bridge, `~/.hermes/skills/hermes-ui/SKILL.md` existiert.
6. Erzeuge den Pair-Link nicht selbst: er enthält einen Einmal-Code, der das Gerät koppelt, das ihn zuerst öffnet – er gehört nur auf meinen Bildschirm. Nenne mir den genauen Befehl für mein eigenes Terminal: `npx hermes-ui-plus-bridge devices add "Phone" --env-file <Env-Datei aus dem Bericht>`. Er zeigt einen QR-Code, der einmal funktioniert und nach 1 Stunde abläuft.

Regeln: frag vor einem Hermes-Neustart, Config-Änderungen oder Systempaketen. Nur Tailnet: kein `tailscale funnel`, keine Portweiterleitung, keine öffentliche Bindung. Geheimnisse nie committen, einfügen oder loggen. Bei Fehlern aufhören und berichten.
```

### (c) Verbindungsproblem untersuchen

```text
Die App Hermes UI+ verbindet sich nicht mit meinem Hermes. Untersuche das auf diesem Server. Zuerst nur lesen: ändere nichts, bis ich einem Fix zustimme. Tokens und API-Schlüssel nie ausgeben (maskieren).

Prüfe jeden Punkt und melde OK oder das Problem:
1. Bridge-Dienst: `systemctl --user status hermes-ui-plus-bridge` (oder `sudo systemctl status hermes-ui-plus-bridge` oder `docker compose ps`) und die letzten 50 Logzeilen (`journalctl --user -u hermes-ui-plus-bridge -n 50`).
2. Bridge lokal: `curl -si http://127.0.0.1:8790/health` (Status und Header X-Hermes-UI-Bridge: 1).
3. Hermes-API-Server: in `~/.hermes/config.yaml` aktiviert (platforms.api_server, Schlüssel nie zeigen)? Antwortet `curl -s http://127.0.0.1:<port>/health`, welche Hermes-Version?
4. Env-Datei der Bridge (`~/.config/hermes-ui-plus-bridge/env` oder `/etc/hermes-ui-plus-bridge/env`): zeig nur HERMES_BASE_URL, BRIDGE_PUBLIC_URL, BRIDGE_HOST und BRIDGE_PORT. Stimmt HERMES_API_KEY mit dem Hermes-Schlüssel überein? Vergleichen, ohne einen davon auszugeben.
5. Tailscale: `tailscale status` und `tailscale serve status`. Passt das Serve-Ziel zum Bridge-Port und BRIDGE_PUBLIC_URL exakt zur https-Adresse?
6. Übers Tailnet: `curl -si <BRIDGE_PUBLIC_URL>/health`. 421 heißt, der Hostname passt nicht zu BRIDGE_PUBLIC_URL; 401 in der App heißt, ihr Geräte-Token ist falsch, abgelaufen oder widerrufen.
7. Geräte: `npx hermes-ui-plus-bridge devices list --env-file <Env-Datei>`.
8. Skill: existiert `~/.hermes/skills/hermes-ui/SKILL.md`?
9. `npx -y hermes-ui-plus-bridge@latest setup --dry-run --json`: Warnungen auflisten.

Nenne mir dann die wahrscheinlichste Ursache und den kleinsten Fix und warte auf mein OK. Frag vor einem Hermes-Neustart oder Config-Änderungen. Nur Tailnet: nie `tailscale funnel` oder Portweiterleitung.
```

### (d) Bridge und Skill aktualisieren

```text
Bitte aktualisiere die Hermes UI+ Bridge und den hermes-ui-Skill auf diesem Server.

1. Halte den aktuellen Stand fest: Bridge-Version (`npx hermes-ui-plus-bridge --version` oder das global installierte Paket), Skill-Version (Zeile `version:` in `~/.hermes/skills/hermes-ui/SKILL.md`), Dienststatus.
2. Lies die Release Notes (https://github.com/robbyczgw-cla/hermes-ui-plus/blob/main/CHANGELOG.md) und sag mir, ob etwas zu tun ist.
3. Vorschau: `npx -y hermes-ui-plus-bridge@latest setup --dry-run --json`. Fasse zusammen, was sich ändern würde. Zeig nie Schlüssel oder Tokens.
4. Nach meinem OK: bei globaler Installation `npm install -g hermes-ui-plus-bridge@latest` und dann `hermes-ui-plus-bridge setup --yes --json --no-pair`; sonst `npx -y hermes-ui-plus-bridge@latest setup --yes --json --no-pair`. Das aktualisiert Skill (alte Version wird gesichert), Env-Datei und Dienst an Ort und Stelle und startet nur die Bridge neu.
5. Prüfe: Bericht hat "ok": true, `curl -s http://127.0.0.1:8790/health` antwortet, Dienst aktiv, neue Skill-Version da. Nenne mir die Versionen vorher und nachher.

Regeln: Hermes nicht neu starten (neue Gespräche laden den Skill von selbst). Frag vor Änderungen an Hermes' Config. Nur Tailnet. Bei Fehlern aufhören und berichten.
```

## Optional keys

The wizard never takes keys as command-line arguments. By default (and with `--yes`) it asks for no provider keys and the bridge is a pure pass-through to Hermes. Only with `--extras` does `--yes` pick these optional direct-provider keys up from the environment if set (interactive runs ask once whether to configure the extras, default No): `SERPER_API_KEY` or `BRAVE_API_KEY` (image search), `GROQ_API_KEY` (speech-to-text), `DEEPGRAM_API_KEY` (text-to-speech), `ANTHROPIC_API_KEY` (Claude router, titles and follow-ups) or `TYPESAFE_API_KEY` (Jev router). Without them the bridge runs with the free rule-based router and without voice and image search. With the extras on, interactive runs ask for each key with hidden input. You can also add keys to the env file later and re-run the wizard.

See [SELF-HOSTING.md](SELF-HOSTING.md) for the manual setup and all details.
