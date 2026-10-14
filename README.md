# Hermes Interactive UI+

_Interactive chat for Hermes Agent._ On your home screen it is called **Hermes UI+**.

**The mobile app for your [Hermes Agent](https://github.com/NousResearch/hermes-agent): approve commands from your phone, watch every tool step live, leave the app while Hermes keeps working, and get answers that aren't walls of text.**
Made for people who run Hermes and talk to it through Telegram or the terminal today. Runs as an Android app, as a web app (PWA, with Web Push) and as a macOS app (signed and notarized); a Linux AppImage/.deb is available as an alpha, and iOS is prepared for TestFlight (not published yet).

> **Status: alpha (0.1.0-alpha.1).** Expect rough edges; see [Known limitations](#known-limitations-alpha).

> Hermes Interactive UI+ (Hermes Interactive UI Plus) is an **unofficial community client**. It is not affiliated with, endorsed by, or supported by Nous Research.

## See it in action

Demo clips and the trailer are on the website: **[hermesui.xyz](https://hermesui.xyz)**. The demo GIFs are too large for the repository, so they are not committed.


## Features

- **Streaming chat** with Markdown, rendered progressively while Hermes writes, plus a tool-call timeline that shows what ran and how long it took. Switching between chats is instant (transcripts are cached and fetched ahead), you can press Send while attachments are still uploading (the message shows at once and the turn starts when the uploads are done), and the drawer loads older Hermes chats at its end, so older app chats are reachable on a new device. Settings → Chat → **Chats** chooses whether the drawer lists this app's chats from all your devices (default) or only those created on this device; nothing is deleted either way.
- **48 native answer components.** Hermes picks the presentation: tables, charts (bar, line, pie, radar, gauge, heatmap and more), stats, comparisons, steps, timelines, forms, choices, checklists, calculators, maps, recipes, quizzes, flashcards, polls, timers, plans, mind maps, product and place cards, and two for explaining setups: **paths** (2-6 ways or variants as a card with a verdict badge and a chain of nodes, optionally a single choice) and **blocks** (an architecture at a glance: boxes in up to three columns with an optional shared base layer). Your taps (a checked item, a vote, a slider) are sent back to Hermes as the next message. The count includes layout and text nodes; sandboxed HTML widgets come on top.
- **Router.** The UI-Bridge decides per message whether a plain answer or a rich component fits best, so short questions stay short. It works rule-based out of the box and can use an LLM if you configure one.
- **Approvals.** When Hermes asks before running a command, you answer in the app. The web app (PWA) can also notify you through Web Push while it is closed; on Android see [Known limitations](#known-limitations-alpha).
- **Slash commands** (`/new`, `/model`, `/reasoning`, `/retry`, `/stop`, `/approve`, `/skills`, `/usage`, `/export` and more) with a searchable palette, in English, German and Spanish.
- **Voice.** Dictation (tap to start and stop, or hold to talk; recording starts on touch-down) and read-aloud: on-device speech recognition and voices, speech providers configured on your bridge, or providers you add in the app with your own key. With "Read replies aloud automatically" on, reading starts with the first complete sentences while the answer is still streaming.
- **Images and files.** Attach photos and documents; images in answers carry their source. Product and place photos from Hermes' answers load through your bridge's image proxy without a tap; other unknown hosts are tap-to-load. Places, food and sights also get photos from Wikipedia. Product cards show a photo only when Hermes returns one or the bridge has an image search key (`setup --extras`, Serper or Brave); otherwise they show a neutral icon rather than a possibly wrong photo.
- **Sandboxed HTML widgets** for custom visuals, with no access to your data or device.
- **Multi-platform.** One codebase for Android, web (PWA), macOS and Linux (Tauri) and iOS. See [Platforms](#platforms) for what you can install today.
- **Local-first.** Conversations are stored on your device. No accounts, no telemetry.

## How it works

```
 ┌───────────────┐   HTTPS + device token    ┌───────────────┐   HTTP + API key   ┌──────────────────┐
 │ Hermes UI+    │ ────────────────────────► │   UI-Bridge   │ ─────────────────► │   Hermes Agent   │
 │ app / web /   │ ◄──────────────────────── │ (Node, yours) │ ◄───────────────── │  API server      │
 │ desktop       │      SSE stream, push     └───────────────┘                    │  + `hermes-ui`   │
 └───────────────┘                             router, uploads,                    │    skill         │
                                               voice, pairing, push               └──────────────────┘
```

- **The skill** (`hermes-skill/hermes-ui/`) teaches Hermes the answer protocol. It only loads for sessions that come from this app, so Telegram, cron and other clients are unaffected.
- **The UI-Bridge** (`bridge/`) is a small Node service that you run next to Hermes. It holds the Hermes API key, authenticates your devices, routes presentation, handles uploads, voice and push, and pairs new devices via QR code.
- **The app** talks only to your bridge, so it never sees your Hermes API key. (You can also connect it to Hermes directly with the API key, "Connect without the bridge" in onboarding, without the bridge's features.) The bridge lives in this repository (`bridge/`), is open source like the app, and you run it yourself; see [docs/BRIDGE.md](docs/BRIDGE.md) for why it exists and how it is secured.

## Requirements

- **Hermes Agent v0.21 or newer**, with the API server enabled and the Hermes gateway running (see step 1 below). Tested with Hermes v0.22.0; see [Hermes compatibility](#hermes-compatibility).
- A machine that runs the bridge: **Node.js 22+** or Docker. This is usually the machine that runs Hermes. Check with `node --version`. The Hermes installer brings its own private Node.js, which is not on your `PATH`, so `npx` may be missing. Distribution packages are often too old (Ubuntu 24.04's `nodejs` is version 18): install a current LTS from [nodejs.org](https://nodejs.org/en/download), the NodeSource packages or nvm.
- A private network path from your devices to that machine. **[Tailscale](https://tailscale.com) is strongly recommended.** For a first test in a browser on the bridge machine itself you need neither Tailscale nor HTTPS (see [docs/WEB-APP.md](docs/WEB-APP.md#first-test-without-https)).

## Quick start (5 minutes)

1. **Turn on the Hermes API server** (once; skip if `grep API_SERVER ~/.hermes/.env` already shows both settings). Add two lines to `~/.hermes/.env`, then start the Hermes gateway, which serves the API:

   ```bash
   printf 'API_SERVER_ENABLED=true\nAPI_SERVER_KEY=%s\n' "$(openssl rand -hex 32)" >> ~/.hermes/.env
   hermes gateway install              # background service (systemd/launchd); in Docker or WSL: hermes gateway run
   hermes gateway status
   curl http://127.0.0.1:8642/health   # should answer {"status": "ok", ...}
   ```

   If the gateway was already running, restart it (`hermes gateway restart`).
2. **Set up the bridge** on the machine that runs Hermes (Node.js 22+), below.
3. **Pair a device:** on Android, install the APK ([Install on Android](#install-on-android)), open the app and choose **Scan QR code**. For the web app, follow [docs/WEB-APP.md](docs/WEB-APP.md). On a Mac, see [desktop/README.md](desktop/README.md). On iPhone and iPad use the web app (PWA, **Add to Home Screen**) for now; the native iOS app is prepared for TestFlight but not published.

Bridge setup:

On the machine that runs Hermes (Node.js 22+):

```bash
npx hermes-ui-plus-bridge setup
```

The wizard checks Hermes (home directory, API server, version), installs the `hermes-ui` skill, offers Web Push, writes the bridge settings, installs a service (systemd, or launchd on macOS; inside a container it prints the start command instead), publishes the bridge on your tailnet with `tailscale serve`, and finally prints a **QR code and pair link**. In the app, choose **Scan QR code**. A QR code or pair link carries a **one-time pairing code**, not a token: the app exchanges it for its own revocable device token the first time it connects. The code works once and expires after one hour if unused. Never share a screenshot of a QR code.

- By default the bridge is a pure pass-through to Hermes: no provider keys are asked for. Optional direct-provider extras (LLM router, chat titles, image search, voice) are opt-in with `setup --extras` and call providers from the bridge, outside Hermes; see [docs/BRIDGE.md](docs/BRIDGE.md#where-your-data-goes).
- Preview first: `npx hermes-ui-plus-bridge setup --dry-run`. Re-run the wizard any time to update; it changes things in place.
- It never edits Hermes' config without asking and never restarts Hermes. If the Hermes API server is off, it shows the exact config snippet and restart command.
- **Let an agent do it:** paste a ready-made prompt into Hermes (Telegram, CLI) or Claude Code / Codex: [docs/SETUP-WITH-AGENT.md](docs/SETUP-WITH-AGENT.md). The agent runs `setup --yes --json` and sends you the pair link.
- Docker, manual setup and LAN-only use: [docs/SELF-HOSTING.md](docs/SELF-HOSTING.md). The skill alone: [hermes-skill/INSTALL.md](hermes-skill/INSTALL.md).

> **Warning: do not expose the bridge or the Hermes API server to the public internet.** Hermes can run terminal and file tools, and anyone with access can use them. Do not use port forwarding or `tailscale funnel`. Stay on your tailnet or your trusted LAN.

## Platforms

| Platform | How to get it | Status |
|---|---|---|
| **Android** | Signed APK from [GitHub Releases](https://github.com/robbyczgw-cla/hermes-ui-plus/releases), or add the repo to [Obtainium](https://obtainium.imranr.dev) for automatic updates | Available. Settings → About shows the version and build number |
| **Web (PWA)** | Prebuilt bundle from [GitHub Releases](https://github.com/robbyczgw-cla/hermes-ui-plus/releases), served by your own bridge, installable to the home screen | Available, install guide: [docs/WEB-APP.md](docs/WEB-APP.md). The only place with Web Push |
| **macOS** | Native Tauri app for Apple Silicon (macOS 13+), Developer ID signed and notarized; not attached to the GitHub release in this alpha, build it from source (`scripts/build-desktop-mac.sh`) or use the maintainer's download page | Available, see [desktop/README.md](desktop/README.md) |
| **Linux** | Tauri desktop app as AppImage / .deb (x86_64), built on Ubuntu 22.04: needs glibc 2.35 or newer (Ubuntu 22.04+, Debian 12+); not signed, no auto-update | Alpha, see [desktop/README.md](desktop/README.md#linux-alpha) |
| **iOS** | Use the web app (PWA) for now | The native app is prepared for TestFlight / App Store (see [docs/IOS.md](docs/IOS.md)); not published yet |

**macOS app.** The same UI in a native shell: translucent sidebar and unified title bar, menu bar and keyboard shortcuts (new chat, search chats, find in chat, stop, switch chats), a native right-click menu on answers, dock badge for unread answers and a dock menu with recent chats, notifications for finished answers and approvals (with *Allow once* / *Deny* buttons, no need to open the window), open at login, a menu-bar-only mode, an optional Touch ID lock, and files by drag and drop, onto the dock icon or paste. Global shortcut: Option+Space. Notifications come from the running app (including while its window is closed); there is no push to a Mac that is off or has quit the app.

**Install the web app:** download `hermes-ui-plus-web-<version>.tar.gz`, unpack it on the bridge machine, run `npx hermes-ui-plus-bridge setup --web-dir <folder>` and open the pair link. Step by step: [docs/WEB-APP.md](docs/WEB-APP.md).

### Install on Android

The APK runs on **64-bit ARM (arm64-v8a) devices with Android 7.0 or newer**, which covers practically every current phone and tablet. There is no 32-bit or x86 build.

1. Download `hermes-ui-plus-<version>.apk` and `hermes-ui-plus-<version>.apk.sha256` from [GitHub Releases](https://github.com/robbyczgw-cla/hermes-ui-plus/releases).
2. Verify the download: `sha256sum -c hermes-ui-plus-<version>.apk.sha256` in the download folder should print `OK`.
3. Optionally check the signing certificate: `apksigner verify --print-certs <file>.apk` should show the certificate SHA-256 digest `17:9B:2D:B4:99:6E:C6:BF:8D:B5:43:46:11:98:5E:38:AE:5E:21:A0:3E:A0:12:55:8B:A6:A6:5A:44:12:6E:06` (apksigner prints it without colons, in lower case).
4. Open the APK on the phone and allow installing from your browser or file manager when Android asks.

To get updates automatically, add `https://github.com/robbyczgw-cla/hermes-ui-plus` to [Obtainium](https://obtainium.imranr.dev). Alpha and beta versions are published as GitHub **pre-releases**, which Obtainium skips by default: turn on **Include prereleases** in the app's settings in Obtainium. The certificate stays the same across releases, so updates install over the existing app.

To build from source, see [docs/BUILD.md](docs/BUILD.md).

## Hermes compatibility

The app is built against the Hermes Agent API server (v0.21 or newer) and tested with **Hermes v0.22.0**. Two known Hermes issues affect it; neither is caused by this app, and both have upstream fixes in review:

- **`/skills` fails on unpatched Hermes 0.21.5 to 0.22.0.** `GET /v1/skills` answers HTTP 500 there (upstream issue #120831, fix in PR #124861). The app recognises that error, tells you it is a Hermes bug and shows the server's message under "Details"; the skills themselves still work in chats.
- **Claude answers can arrive in one piece on unpatched Hermes.** With the Claude subscription plugin (a provider that Hermes runs as an external process), Hermes does not stream the answer: it sends the finished text in a single chunk at the end. Upstream PR #124566 lets such providers stream; the plugin has to opt in as well. Any API client sees this, including this app: the answer appears all at once instead of word by word. The app has no workaround for it. Providers that Hermes calls directly (not as an external process) are not affected.

## Known limitations (alpha)

- **iOS:** web app (PWA) only. The native app is prepared for TestFlight / App Store, but nothing is submitted yet.
- **macOS and Linux desktop builds** are not attached to the GitHub release in this alpha. The Linux AppImage / .deb is an alpha: x86_64 only, not signed, no auto-update, needs glibc 2.35 or newer, and the tray icon and Alt+Space shortcut depend on the desktop environment (details in [desktop/README.md](desktop/README.md#linux-alpha)). The macOS app is Apple Silicon only.
- **No app-store builds** (Google Play, App Store). Android installs from the APK on GitHub Releases.
- **No remote push on Android yet.** The APK from GitHub Releases contains no Firebase (FCM) setup. While an answer is running, the app's keep-alive service shows its notification and keeps the answer coming; but a notification while the app is closed (for example "approval needed") is not available on Android in 0.1. Planned: UnifiedPush / ntfy.
- **Web Push works in the web app (PWA)**, including the iPhone/iPad home-screen app (iOS 16.4+). It needs the bridge with Web Push keys (the setup wizard offers them). The macOS app shows native notifications (also with approval buttons) while it is running; it does not use Web Push.
- **Hermes profiles** (`/p/<profile>/`) are not supported through the bridge yet.
- **Slash commands** are handled by the app. Hermes' API server does not interpret them, so an unknown command is sent as plain text.
- **Hermes issues** (`/skills` on 0.21.5 to 0.22.0, Claude answers arriving in one piece): see [Hermes compatibility](#hermes-compatibility).
- **Approvals:** in Hermes "smart" approval mode Hermes auto-approves most commands, so approval cards appear only when Hermes really asks.
- Plain `http://` works for the Android app. Over plain `http://` on the LAN the web app runs only in a browser tab: installing it, offline use and push need HTTPS (for example `tailscale serve`). `http://127.0.0.1` on the bridge machine itself counts as secure.

## Privacy

- **No telemetry, no accounts.** The app contains no analytics or crash-reporting SDK, and the developers run no servers that your data touches.
- Your messages go from your device to **your bridge**, then to **your Hermes**, and from there to the model providers you configured in Hermes. Nowhere else.
- Web Push (web app) goes through your browser vendor's push service only if you enable it; the payload is encrypted and message previews are off by default.

Full policy: [PRIVACY.md](PRIVACY.md). Threat model and how to report vulnerabilities: [SECURITY.md](SECURITY.md).

## Documentation

- [docs/BRIDGE.md](docs/BRIDGE.md): what the bridge does, why it is needed, security model, where data goes
- [docs/SELF-HOSTING.md](docs/SELF-HOSTING.md): bridge setup, Tailscale, device tokens, push, updating, troubleshooting
- [docs/WEB-APP.md](docs/WEB-APP.md): installing the web app (PWA) and adding it to the home screen
- [docs/SETUP-WITH-AGENT.md](docs/SETUP-WITH-AGENT.md): copy-paste prompts so Hermes, Claude Code or Codex set it up for you
- [bridge/README.md](bridge/README.md): bridge reference
- [docs/SPEC.md](docs/SPEC.md): the answer protocol and architecture
- [docs/ROUTER.md](docs/ROUTER.md): router and the complete configuration reference
- [docs/BUILD.md](docs/BUILD.md): building the Android, iOS, web and desktop apps
- [docs/IOS.md](docs/IOS.md): iOS status (web app now), TestFlight / App Store preparation
- [CONTRIBUTING.md](CONTRIBUTING.md), [CHANGELOG.md](CHANGELOG.md)

## Credits

[CopilotKit OpenIntelligentUI](https://github.com/CopilotKit/OpenIntelligentUI) (MIT) inspired the interactive answer approach and parts of the sandbox renderer. Thanks to Nous Research for Hermes Agent. Other third-party notices are in [NOTICE.md](NOTICE.md).

## License

See [LICENSE](LICENSE). Third-party notices are in [NOTICE.md](NOTICE.md).
