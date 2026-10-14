// Copy-paste prompts (de/en/es) that let an agent on the user's server (their Hermes agent via Telegram/CLI, or Claude Code /
// Codex) set up, debug or update the Hermes UI+ Bridge. Shown in onboarding ("Prompt kopieren"). Pure data, no
// React; the English and German texts are mirrored verbatim in docs/SETUP-WITH-AGENT.md (agentPrompts.test.ts
// fails if they drift). Placeholders only: no host names, no tokens.
import type { Lang } from '../i18n/core.ts';

export type AgentPromptId = 'hermes' | 'cli' | 'troubleshoot' | 'update';

export type AgentPrompt = {
  readonly id: AgentPromptId;
  readonly title: Readonly<Record<Lang, string>>;
  readonly subtitle: Readonly<Record<Lang, string>>;
  readonly prompt: Readonly<Record<Lang, string>>;
};

/** npm package of the bridge (app/brand/identity.json `bridgePackage`). */
export const BRIDGE_PACKAGE = 'hermes-ui-plus-bridge';

const HERMES_EN = `Please set up Hermes UI+ (the Hermes Interactive UI+ app) on this machine, the one you run on. Work step by step and report back briefly after each step.

1. Check that Node.js 22 or newer is installed (\`node --version\`). If not, stop and tell me how to install it.
2. Preview: run \`npx -y hermes-ui-plus-bridge@latest setup --dry-run --json\` and summarize the plan: Hermes API server status, skill install, env file, service, Tailscale URL, warnings. Never show keys or tokens.
3. If the Hermes API server is not enabled, show me the config change and the restart command from the report and wait for my OK. Do not edit config.yaml and do not restart Hermes yourself: a restart ends this conversation, so I will do it.
4. Run \`npx -y hermes-ui-plus-bridge@latest setup --yes --json\`. It installs the hermes-ui skill (an older version is backed up), writes the bridge env file (mode 0600), installs and starts the bridge service, publishes it on my tailnet with \`tailscale serve\` and creates a one-time pair link. If the report says a system service needs a global install, ask me before running \`npm install -g hermes-ui-plus-bridge\`, then run \`hermes-ui-plus-bridge setup --yes --json\`.
5. Verify: the report has "ok": true, \`curl -s -o /dev/null -w '%{http_code}\\n' http://127.0.0.1:8790/health\` answers, \`tailscale serve status\` lists the bridge, and \`~/.hermes/skills/hermes-ui/SKILL.md\` exists.
6. Send me the "pair.link" value from the report (and "pair.webLink" if it is not empty) in this direct chat. Do not open or test the link yourself: it carries a one-time code, so the first device that opens it is paired and the link is used up. Tell me that it works once and expires after 1 hour, and list any warnings and next steps.

Rules:
- Ask me before restarting Hermes, changing its config or installing anything else.
- Never post tokens, API keys or pair links in group chats, channels or logs. Only in this direct chat with me.
- Tailnet only: never use \`tailscale funnel\`, port forwarding or a public address for the bridge or Hermes.
- If a step fails, stop and show me the error with secrets removed.`;

const HERMES_DE = `Bitte richte Hermes UI+ (die App Hermes Interactive UI+) auf diesem Rechner ein, also dort, wo du läufst. Arbeite Schritt für Schritt und melde dich nach jedem Schritt kurz.

1. Prüfe, ob Node.js 22 oder neuer installiert ist (\`node --version\`). Wenn nicht: abbrechen und mir sagen, wie ich es installiere.
2. Vorschau: führe \`npx -y hermes-ui-plus-bridge@latest setup --dry-run --json\` aus und fasse den Plan zusammen: Hermes-API-Server, Skill, Env-Datei, Dienst, Tailscale-URL, Warnungen. Zeig nie Schlüssel oder Tokens.
3. Ist der Hermes-API-Server aus, zeig mir die Config-Änderung und den Neustart-Befehl aus dem Bericht und warte auf mein OK. Ändere config.yaml nicht und starte Hermes nicht selbst neu: ein Neustart beendet dieses Gespräch, das mache ich.
4. Führe \`npx -y hermes-ui-plus-bridge@latest setup --yes --json\` aus. Das installiert den hermes-ui-Skill (eine ältere Version wird gesichert), schreibt die Env-Datei der Bridge (Modus 0600), installiert und startet den Dienst, veröffentlicht ihn mit \`tailscale serve\` in meinem Tailnet und erzeugt einen einmaligen Pair-Link. Meldet der Bericht, dass ein Systemdienst eine globale Installation braucht, frag mich vor \`npm install -g hermes-ui-plus-bridge\` und führe danach \`hermes-ui-plus-bridge setup --yes --json\` aus.
5. Prüfe: Bericht hat "ok": true, \`curl -s -o /dev/null -w '%{http_code}\\n' http://127.0.0.1:8790/health\` antwortet, \`tailscale serve status\` zeigt die Bridge, \`~/.hermes/skills/hermes-ui/SKILL.md\` existiert.
6. Schick mir den Wert "pair.link" aus dem Bericht (und "pair.webLink", falls nicht leer) in diesem Direktchat. Öffne oder teste den Link nicht selbst: er enthält einen Einmal-Code, das erste Gerät, das ihn öffnet, wird gekoppelt und der Link ist verbraucht. Sag dazu, dass er einmal funktioniert und nach 1 Stunde abläuft, und nenne Warnungen und nächste Schritte.

Regeln:
- Frag mich, bevor du Hermes neu startest, seine Config änderst oder etwas anderes installierst.
- Tokens, API-Schlüssel und Pair-Links nie in Gruppenchats, Kanäle oder Logs. Nur in diesen Direktchat mit mir.
- Nur Tailnet: nie \`tailscale funnel\`, Portweiterleitung oder eine öffentliche Adresse für Bridge oder Hermes.
- Schlägt ein Schritt fehl, hör auf und zeig mir den Fehler ohne Geheimnisse.`;

const HERMES_ES = `Configura Hermes UI+ (la app Hermes Interactive UI+) en esta máquina, la misma en la que te ejecutas. Trabaja paso a paso y infórmame brevemente después de cada paso.

1. Comprueba que Node.js 22 o posterior está instalado (\`node --version\`). Si no, detente y dime cómo instalarlo.
2. Vista previa: ejecuta \`npx -y hermes-ui-plus-bridge@latest setup --dry-run --json\` y resume el plan: servidor API de Hermes, skill, archivo env, servicio, URL de Tailscale, avisos. Nunca muestres claves ni tokens.
3. Si el servidor API de Hermes no está activado, muéstrame el cambio de configuración y el comando de reinicio del informe y espera mi OK. No edites config.yaml ni reinicies Hermes tú: un reinicio termina esta conversación, lo hago yo.
4. Ejecuta \`npx -y hermes-ui-plus-bridge@latest setup --yes --json\`. Instala la skill hermes-ui (con copia de seguridad de una versión anterior), escribe el archivo env del bridge (modo 0600), instala e inicia el servicio, lo publica en mi tailnet con \`tailscale serve\` y crea un enlace de emparejamiento de un solo uso. Si el informe dice que un servicio del sistema necesita una instalación global, pregúntame antes de \`npm install -g hermes-ui-plus-bridge\` y luego ejecuta \`hermes-ui-plus-bridge setup --yes --json\`.
5. Verifica: el informe tiene "ok": true, \`curl -s -o /dev/null -w '%{http_code}\\n' http://127.0.0.1:8790/health\` responde, \`tailscale serve status\` muestra el bridge y existe \`~/.hermes/skills/hermes-ui/SKILL.md\`.
6. Envíame el valor "pair.link" del informe (y "pair.webLink" si no está vacío) en este chat directo. No abras ni pruebes el enlace tú: lleva un código de un solo uso, el primer dispositivo que lo abre queda emparejado y el enlace se agota. Dime que funciona una vez y caduca tras 1 hora, y enumera avisos y próximos pasos.

Reglas:
- Pregúntame antes de reiniciar Hermes, cambiar su configuración o instalar otra cosa.
- Nunca publiques tokens, claves API ni enlaces de emparejamiento en grupos, canales o logs. Solo en este chat directo conmigo.
- Solo tailnet: nunca \`tailscale funnel\`, redirección de puertos ni una dirección pública para el bridge o Hermes.
- Si un paso falla, detente y muéstrame el error sin secretos.`;

const CLI_EN = `You are on the server that runs my Hermes Agent. Set up the Hermes UI+ Bridge (npm package hermes-ui-plus-bridge, docs: https://github.com/robbyczgw-cla/hermes-ui-plus) so my phone can use the Hermes UI+ app.

1. Check \`node --version\` (22 or newer), \`tailscale status\`, and that Hermes lives here (\`~/.hermes\` or $HERMES_HOME).
2. Run \`npx -y hermes-ui-plus-bridge@latest setup --dry-run --json\` and show me a short summary of the plan. The report masks keys and tokens; never print them yourself.
3. If the Hermes API server is off, show me the snippet and the restart command from the output and wait. Do not edit Hermes' config.yaml and do not restart Hermes without my explicit OK.
4. After my OK run \`npx -y hermes-ui-plus-bridge@latest setup --yes --json --no-pair\`. If it warns that a system service needs a global install, ask me before \`npm install -g hermes-ui-plus-bridge\`, then use \`hermes-ui-plus-bridge setup --yes --json --no-pair\`. Optional keys (image search, voice, router) go in only as environment variables I give you, for example \`SERPER_API_KEY=... npx ...\`.
5. Verify: the service is active (\`systemctl --user status hermes-ui-plus-bridge\`, or the system unit), \`curl -s http://127.0.0.1:8790/health\` answers, \`tailscale serve status\` lists the bridge, \`~/.hermes/skills/hermes-ui/SKILL.md\` exists.
6. Do not create the pair link yourself: it carries a one-time code that pairs whichever device opens it first, so it belongs only on my screen. Tell me the exact command to run in my own terminal: \`npx hermes-ui-plus-bridge devices add "Phone" --env-file <env file from the report>\`. It prints a QR code that works once and expires after 1 hour.

Rules: ask before restarting Hermes, editing its config or installing system packages. Tailnet only: no \`tailscale funnel\`, no port forwarding, no public binding. Never commit, paste or log secrets. On errors stop and report.`;

const CLI_DE = `Du bist auf dem Server, auf dem mein Hermes Agent läuft. Richte die Hermes UI+ Bridge ein (npm-Paket hermes-ui-plus-bridge, Doku: https://github.com/robbyczgw-cla/hermes-ui-plus), damit mein Handy die App Hermes UI+ nutzen kann.

1. Prüfe \`node --version\` (22 oder neuer), \`tailscale status\` und ob Hermes hier liegt (\`~/.hermes\` oder $HERMES_HOME).
2. Führe \`npx -y hermes-ui-plus-bridge@latest setup --dry-run --json\` aus und zeig mir eine kurze Zusammenfassung. Der Bericht maskiert Schlüssel und Tokens; gib sie nie selbst aus.
3. Ist der Hermes-API-Server aus, zeig mir Snippet und Neustart-Befehl aus der Ausgabe und warte. Ändere Hermes' config.yaml nicht und starte Hermes nicht ohne mein ausdrückliches OK neu.
4. Nach meinem OK: \`npx -y hermes-ui-plus-bridge@latest setup --yes --json --no-pair\`. Warnt es, dass ein Systemdienst eine globale Installation braucht, frag mich vor \`npm install -g hermes-ui-plus-bridge\` und nimm dann \`hermes-ui-plus-bridge setup --yes --json --no-pair\`. Optionale Schlüssel (Bildsuche, Sprache, Router) nur als Umgebungsvariablen, die ich dir gebe, z. B. \`SERPER_API_KEY=... npx ...\`.
5. Prüfe: Dienst aktiv (\`systemctl --user status hermes-ui-plus-bridge\` oder die System-Unit), \`curl -s http://127.0.0.1:8790/health\` antwortet, \`tailscale serve status\` zeigt die Bridge, \`~/.hermes/skills/hermes-ui/SKILL.md\` existiert.
6. Erzeuge den Pair-Link nicht selbst: er enthält einen Einmal-Code, der das Gerät koppelt, das ihn zuerst öffnet – er gehört nur auf meinen Bildschirm. Nenne mir den genauen Befehl für mein eigenes Terminal: \`npx hermes-ui-plus-bridge devices add "Phone" --env-file <Env-Datei aus dem Bericht>\`. Er zeigt einen QR-Code, der einmal funktioniert und nach 1 Stunde abläuft.

Regeln: frag vor einem Hermes-Neustart, Config-Änderungen oder Systempaketen. Nur Tailnet: kein \`tailscale funnel\`, keine Portweiterleitung, keine öffentliche Bindung. Geheimnisse nie committen, einfügen oder loggen. Bei Fehlern aufhören und berichten.`;

const CLI_ES = `Estás en el servidor donde se ejecuta mi Hermes Agent. Configura el Hermes UI+ Bridge (paquete npm hermes-ui-plus-bridge, documentación: https://github.com/robbyczgw-cla/hermes-ui-plus) para que mi móvil pueda usar la app Hermes UI+.

1. Comprueba \`node --version\` (22 o posterior), \`tailscale status\` y que Hermes está aquí (\`~/.hermes\` o $HERMES_HOME).
2. Ejecuta \`npx -y hermes-ui-plus-bridge@latest setup --dry-run --json\` y muéstrame un resumen breve del plan. El informe enmascara claves y tokens; nunca los imprimas tú.
3. Si el servidor API de Hermes está desactivado, muéstrame el fragmento y el comando de reinicio de la salida y espera. No edites config.yaml de Hermes ni reinicies Hermes sin mi OK explícito.
4. Tras mi OK ejecuta \`npx -y hermes-ui-plus-bridge@latest setup --yes --json --no-pair\`. Si avisa de que un servicio del sistema necesita una instalación global, pregúntame antes de \`npm install -g hermes-ui-plus-bridge\` y luego usa \`hermes-ui-plus-bridge setup --yes --json --no-pair\`. Las claves opcionales (búsqueda de imágenes, voz, router) solo como variables de entorno que yo te dé, por ejemplo \`SERPER_API_KEY=... npx ...\`.
5. Verifica: el servicio está activo (\`systemctl --user status hermes-ui-plus-bridge\` o la unidad del sistema), \`curl -s http://127.0.0.1:8790/health\` responde, \`tailscale serve status\` muestra el bridge y existe \`~/.hermes/skills/hermes-ui/SKILL.md\`.
6. No crees tú el enlace de emparejamiento: lleva un código de un solo uso que empareja al primer dispositivo que lo abre, así que solo debe aparecer en mi pantalla. Dime el comando exacto para mi propio terminal: \`npx hermes-ui-plus-bridge devices add "Phone" --env-file <archivo env del informe>\`. Muestra un código QR que funciona una vez y caduca tras 1 hora.

Reglas: pregunta antes de reiniciar Hermes, editar su configuración o instalar paquetes del sistema. Solo tailnet: sin \`tailscale funnel\`, sin redirección de puertos, sin direcciones públicas. Nunca subas, pegues ni registres secretos. Ante errores, detente e informa.`;

const TROUBLE_EN = `The Hermes UI+ app cannot connect to my Hermes. Diagnose it on this server. Read-only first: change nothing until I agree to a fix. Never print tokens or API keys (mask them).

Check each item and report OK or the problem:
1. Bridge service: \`systemctl --user status hermes-ui-plus-bridge\` (or \`sudo systemctl status hermes-ui-plus-bridge\`, or \`docker compose ps\`) and the last 50 log lines (\`journalctl --user -u hermes-ui-plus-bridge -n 50\`).
2. Bridge locally: \`curl -si http://127.0.0.1:8790/health\` (status, and the header X-Hermes-UI-Bridge: 1).
3. Hermes API server: enabled in \`~/.hermes/config.yaml\` (platforms.api_server, never show the key)? Does \`curl -s http://127.0.0.1:<port>/health\` answer, and which Hermes version?
4. Bridge env file (\`~/.config/hermes-ui-plus-bridge/env\` or \`/etc/hermes-ui-plus-bridge/env\`): show only HERMES_BASE_URL, BRIDGE_PUBLIC_URL, BRIDGE_HOST and BRIDGE_PORT. Does HERMES_API_KEY equal Hermes' key? Compare without printing either.
5. Tailscale: \`tailscale status\` and \`tailscale serve status\`. Does the serve target match the bridge port, and BRIDGE_PUBLIC_URL match the https address exactly?
6. Through the tailnet: \`curl -si <BRIDGE_PUBLIC_URL>/health\`. 421 means the host name does not match BRIDGE_PUBLIC_URL; 401 in the app means its device token is wrong, expired or revoked.
7. Devices: \`npx hermes-ui-plus-bridge devices list --env-file <env file>\`.
8. Skill: does \`~/.hermes/skills/hermes-ui/SKILL.md\` exist?
9. \`npx -y hermes-ui-plus-bridge@latest setup --dry-run --json\`: list its warnings.

Then tell me the most likely cause and the smallest fix, and wait for my OK. Ask before restarting Hermes or changing its config. Tailnet only: never \`tailscale funnel\` or port forwarding.`;

const TROUBLE_DE = `Die App Hermes UI+ verbindet sich nicht mit meinem Hermes. Untersuche das auf diesem Server. Zuerst nur lesen: ändere nichts, bis ich einem Fix zustimme. Tokens und API-Schlüssel nie ausgeben (maskieren).

Prüfe jeden Punkt und melde OK oder das Problem:
1. Bridge-Dienst: \`systemctl --user status hermes-ui-plus-bridge\` (oder \`sudo systemctl status hermes-ui-plus-bridge\` oder \`docker compose ps\`) und die letzten 50 Logzeilen (\`journalctl --user -u hermes-ui-plus-bridge -n 50\`).
2. Bridge lokal: \`curl -si http://127.0.0.1:8790/health\` (Status und Header X-Hermes-UI-Bridge: 1).
3. Hermes-API-Server: in \`~/.hermes/config.yaml\` aktiviert (platforms.api_server, Schlüssel nie zeigen)? Antwortet \`curl -s http://127.0.0.1:<port>/health\`, welche Hermes-Version?
4. Env-Datei der Bridge (\`~/.config/hermes-ui-plus-bridge/env\` oder \`/etc/hermes-ui-plus-bridge/env\`): zeig nur HERMES_BASE_URL, BRIDGE_PUBLIC_URL, BRIDGE_HOST und BRIDGE_PORT. Stimmt HERMES_API_KEY mit dem Hermes-Schlüssel überein? Vergleichen, ohne einen davon auszugeben.
5. Tailscale: \`tailscale status\` und \`tailscale serve status\`. Passt das Serve-Ziel zum Bridge-Port und BRIDGE_PUBLIC_URL exakt zur https-Adresse?
6. Übers Tailnet: \`curl -si <BRIDGE_PUBLIC_URL>/health\`. 421 heißt, der Hostname passt nicht zu BRIDGE_PUBLIC_URL; 401 in der App heißt, ihr Geräte-Token ist falsch, abgelaufen oder widerrufen.
7. Geräte: \`npx hermes-ui-plus-bridge devices list --env-file <Env-Datei>\`.
8. Skill: existiert \`~/.hermes/skills/hermes-ui/SKILL.md\`?
9. \`npx -y hermes-ui-plus-bridge@latest setup --dry-run --json\`: Warnungen auflisten.

Nenne mir dann die wahrscheinlichste Ursache und den kleinsten Fix und warte auf mein OK. Frag vor einem Hermes-Neustart oder Config-Änderungen. Nur Tailnet: nie \`tailscale funnel\` oder Portweiterleitung.`;

const TROUBLE_ES = `La app Hermes UI+ no consigue conectarse a mi Hermes. Diagnostícalo en este servidor. Primero solo lectura: no cambies nada hasta que acepte una solución. Nunca imprimas tokens ni claves API (enmascáralos).

Revisa cada punto e informa OK o el problema:
1. Servicio del bridge: \`systemctl --user status hermes-ui-plus-bridge\` (o \`sudo systemctl status hermes-ui-plus-bridge\`, o \`docker compose ps\`) y las últimas 50 líneas de log (\`journalctl --user -u hermes-ui-plus-bridge -n 50\`).
2. Bridge en local: \`curl -si http://127.0.0.1:8790/health\` (estado y la cabecera X-Hermes-UI-Bridge: 1).
3. Servidor API de Hermes: ¿activado en \`~/.hermes/config.yaml\` (platforms.api_server, nunca muestres la clave)? ¿Responde \`curl -s http://127.0.0.1:<port>/health\` y qué versión de Hermes es?
4. Archivo env del bridge (\`~/.config/hermes-ui-plus-bridge/env\` o \`/etc/hermes-ui-plus-bridge/env\`): muestra solo HERMES_BASE_URL, BRIDGE_PUBLIC_URL, BRIDGE_HOST y BRIDGE_PORT. ¿Coincide HERMES_API_KEY con la clave de Hermes? Compáralas sin imprimir ninguna.
5. Tailscale: \`tailscale status\` y \`tailscale serve status\`. ¿El destino de serve coincide con el puerto del bridge y BRIDGE_PUBLIC_URL exactamente con la dirección https?
6. A través de la tailnet: \`curl -si <BRIDGE_PUBLIC_URL>/health\`. 421 significa que el nombre de host no coincide con BRIDGE_PUBLIC_URL; 401 en la app significa que su token de dispositivo es incorrecto, caducó o fue revocado.
7. Dispositivos: \`npx hermes-ui-plus-bridge devices list --env-file <archivo env>\`.
8. Skill: ¿existe \`~/.hermes/skills/hermes-ui/SKILL.md\`?
9. \`npx -y hermes-ui-plus-bridge@latest setup --dry-run --json\`: enumera sus avisos.

Luego dime la causa más probable y la solución más pequeña, y espera mi OK. Pregunta antes de reiniciar Hermes o cambiar su configuración. Solo tailnet: nunca \`tailscale funnel\` ni redirección de puertos.`;

const UPDATE_EN = `Please update the Hermes UI+ Bridge and the hermes-ui skill on this server.

1. Note the current state: bridge version (\`npx hermes-ui-plus-bridge --version\`, or the globally installed package), skill version (the \`version:\` line in \`~/.hermes/skills/hermes-ui/SKILL.md\`), service status.
2. Read the release notes (https://github.com/robbyczgw-cla/hermes-ui-plus/blob/main/CHANGELOG.md) and tell me about anything that needs action.
3. Preview: \`npx -y hermes-ui-plus-bridge@latest setup --dry-run --json\`. Summarize what would change. Never show keys or tokens.
4. After my OK: for a global install run \`npm install -g hermes-ui-plus-bridge@latest\` and then \`hermes-ui-plus-bridge setup --yes --json --no-pair\`; otherwise \`npx -y hermes-ui-plus-bridge@latest setup --yes --json --no-pair\`. It updates the skill (the old version is backed up), the env file and the service in place and restarts only the bridge.
5. Verify: the report has "ok": true, \`curl -s http://127.0.0.1:8790/health\` answers, the service is active, the new skill version is in place. Tell me the versions before and after.

Rules: do not restart Hermes (new conversations pick up the skill by themselves). Ask before changing Hermes' config. Tailnet only. On errors stop and report.`;

const UPDATE_DE = `Bitte aktualisiere die Hermes UI+ Bridge und den hermes-ui-Skill auf diesem Server.

1. Halte den aktuellen Stand fest: Bridge-Version (\`npx hermes-ui-plus-bridge --version\` oder das global installierte Paket), Skill-Version (Zeile \`version:\` in \`~/.hermes/skills/hermes-ui/SKILL.md\`), Dienststatus.
2. Lies die Release Notes (https://github.com/robbyczgw-cla/hermes-ui-plus/blob/main/CHANGELOG.md) und sag mir, ob etwas zu tun ist.
3. Vorschau: \`npx -y hermes-ui-plus-bridge@latest setup --dry-run --json\`. Fasse zusammen, was sich ändern würde. Zeig nie Schlüssel oder Tokens.
4. Nach meinem OK: bei globaler Installation \`npm install -g hermes-ui-plus-bridge@latest\` und dann \`hermes-ui-plus-bridge setup --yes --json --no-pair\`; sonst \`npx -y hermes-ui-plus-bridge@latest setup --yes --json --no-pair\`. Das aktualisiert Skill (alte Version wird gesichert), Env-Datei und Dienst an Ort und Stelle und startet nur die Bridge neu.
5. Prüfe: Bericht hat "ok": true, \`curl -s http://127.0.0.1:8790/health\` antwortet, Dienst aktiv, neue Skill-Version da. Nenne mir die Versionen vorher und nachher.

Regeln: Hermes nicht neu starten (neue Gespräche laden den Skill von selbst). Frag vor Änderungen an Hermes' Config. Nur Tailnet. Bei Fehlern aufhören und berichten.`;

const UPDATE_ES = `Actualiza el Hermes UI+ Bridge y la skill hermes-ui en este servidor.

1. Anota el estado actual: versión del bridge (\`npx hermes-ui-plus-bridge --version\` o el paquete instalado globalmente), versión de la skill (la línea \`version:\` en \`~/.hermes/skills/hermes-ui/SKILL.md\`), estado del servicio.
2. Lee las notas de la versión (https://github.com/robbyczgw-cla/hermes-ui-plus/blob/main/CHANGELOG.md) y dime si algo requiere acción.
3. Vista previa: \`npx -y hermes-ui-plus-bridge@latest setup --dry-run --json\`. Resume qué cambiaría. Nunca muestres claves ni tokens.
4. Tras mi OK: con instalación global ejecuta \`npm install -g hermes-ui-plus-bridge@latest\` y después \`hermes-ui-plus-bridge setup --yes --json --no-pair\`; si no, \`npx -y hermes-ui-plus-bridge@latest setup --yes --json --no-pair\`. Actualiza la skill (con copia de la versión anterior), el archivo env y el servicio en su sitio y solo reinicia el bridge.
5. Verifica: el informe tiene "ok": true, \`curl -s http://127.0.0.1:8790/health\` responde, el servicio está activo y la nueva versión de la skill está instalada. Dime las versiones antes y después.

Reglas: no reinicies Hermes (las conversaciones nuevas cargan la skill solas). Pregunta antes de cambiar la configuración de Hermes. Solo tailnet. Ante errores, detente e informa.`;

export const AGENT_PROMPTS: readonly AgentPrompt[] = [
  {
    id: 'hermes',
    title: { de: 'Prompt für deinen Hermes-Agenten', en: 'Prompt for your Hermes agent', es: 'Prompt para tu agente Hermes' },
    subtitle: {
      de: 'In Telegram oder der Hermes-CLI einfügen: Hermes richtet alles ein und schickt dir den Pair-Link.',
      en: 'Paste into Telegram or the Hermes CLI: Hermes sets everything up and sends you the pair link.',
      es: 'Pégalo en Telegram o en la CLI de Hermes: Hermes lo configura todo y te envía el enlace.',
    },
    prompt: { de: HERMES_DE, en: HERMES_EN, es: HERMES_ES },
  },
  {
    id: 'cli',
    title: { de: 'Prompt für Claude Code / Codex', en: 'Prompt for Claude Code / Codex', es: 'Prompt para Claude Code / Codex' },
    subtitle: {
      de: 'Für einen Coding-Agenten im Terminal deines Servers.',
      en: 'For a coding agent in a terminal on your server.',
      es: 'Para un agente de programación en un terminal de tu servidor.',
    },
    prompt: { de: CLI_DE, en: CLI_EN, es: CLI_ES },
  },
  {
    id: 'troubleshoot',
    title: { de: 'Verbindungsproblem untersuchen', en: 'Diagnose a connection problem', es: 'Diagnosticar un problema de conexión' },
    subtitle: {
      de: 'Der Agent prüft Dienst, Hermes, Tailscale und Tokens, ohne etwas zu ändern.',
      en: 'The agent checks service, Hermes, Tailscale and tokens without changing anything.',
      es: 'El agente revisa servicio, Hermes, Tailscale y tokens sin cambiar nada.',
    },
    prompt: { de: TROUBLE_DE, en: TROUBLE_EN, es: TROUBLE_ES },
  },
  {
    id: 'update',
    title: { de: 'Bridge und Skill aktualisieren', en: 'Update bridge and skill', es: 'Actualizar bridge y skill' },
    subtitle: {
      de: 'Neue Version einspielen, ohne Hermes neu zu starten.',
      en: 'Install the new version without restarting Hermes.',
      es: 'Instala la nueva versión sin reiniciar Hermes.',
    },
    prompt: { de: UPDATE_DE, en: UPDATE_EN, es: UPDATE_ES },
  },
];

export function agentPrompt(id: AgentPromptId): AgentPrompt {
  const p = AGENT_PROMPTS.find((x) => x.id === id);
  if (!p) throw new Error(`unknown agent prompt ${id}`);
  return p;
}

/** Text to put on the clipboard ("Prompt kopieren"). */
export function agentPromptText(id: AgentPromptId, lang: Lang): string {
  return agentPrompt(id).prompt[lang];
}

// ---- shape used by the guided onboarding (guided/actions.ts, troubleshoot.ts) ----

export type AgentPromptLang = Lang;

export type AgentPrompts = {
  /** sent to Hermes itself (Telegram etc.): set up the bridge + skill and reply with the pair link */
  hermesSetup: string;
  /** for a coding agent with shell access on the Hermes machine (Claude Code, Codex) */
  coderSetup: string;
  /** connection problem; the app appends its diagnostics (troubleshoot.ts fillTroubleshootPrompt) */
  troubleshoot: string;
  /** update the bridge and the skill */
  update: string;
};

export function getAgentPrompts(lang: AgentPromptLang): AgentPrompts {
  const l: Lang = lang === 'de' || lang === 'es' ? lang : 'en';
  return {
    hermesSetup: agentPromptText('hermes', l),
    coderSetup: agentPromptText('cli', l),
    troubleshoot: agentPromptText('troubleshoot', l),
    update: agentPromptText('update', l),
  };
}
