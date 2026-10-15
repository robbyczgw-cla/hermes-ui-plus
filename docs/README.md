# Documentation index

Start with the [README](../README.md) for an overview and quick start. The files below go deeper.

## Using Hermes UI+

- [BRIDGE.md](BRIDGE.md): what the UI-Bridge is, why it exists, how it is secured, and where your data goes.
- [SELF-HOSTING.md](SELF-HOSTING.md): bridge setup, Tailscale, device tokens, push, updating, troubleshooting.
- [SETUP-WITH-AGENT.md](SETUP-WITH-AGENT.md): copy-paste prompts so Hermes, Claude Code or Codex set it up for you.
- [WEB-APP.md](WEB-APP.md): installing the web app (PWA) from the release bundle, pairing, adding it to the home screen, updating, troubleshooting.
- [../PRIVACY.md](../PRIVACY.md) and [../SECURITY.md](../SECURITY.md): privacy policy, threat model, and how to report vulnerabilities.

## Core docs

- [SPEC.md](SPEC.md): architecture, wire format, the `hui` presentation protocol, image lookups, sandbox rules, and module boundaries (v0).
- [SPEC-modules-v2.md](SPEC-modules-v2.md): contract for the interactive v2 nodes (checklists, choices, quizzes, calculators, maps, recipes, timers) and their actions.
- [ROUTER.md](ROUTER.md): the UI Bridge, the presentation router and its backends, the evaluation results, file uploads, voice, and the configuration reference.
- [HERMES-API.md](HERMES-API.md): wire reference for the Hermes Agent API server: endpoints, headers, sessions, streaming events, and approvals.
- [SPEC-modules-v3.md](SPEC-modules-v3.md) and [SPEC-modules-v4.md](SPEC-modules-v4.md): contracts for the later interactive modules and answer polish (v4 also lists the newest components `paths` and `blocks`).
- [BUILD.md](BUILD.md): build flavors (official `hermes` vs. `personal` with a private overlay), building the Android APK, the web app, iOS and the macOS / Linux desktop apps from source, release signing, installing on a phone.

## Design notes and maintainer docs

- [QUICK-QUESTIONS.md](QUICK-QUESTIONS.md): design summary for fast one-off questions (Schnellfrage); the backend part is superseded by HERMES-PLUGIN.md.
- [HERMES-PLUGIN.md](HERMES-PLUGIN.md): optional Hermes plugin `hermes-ui-plus` (experimental), install guide: quick answers through Hermes' own providers, migration plan, risks.
- [WSP-INTEGRATION.md](WSP-INTEGRATION.md): design summary for the optional Web Search Plus integration (not implemented).
- [STORE.md](STORE.md): store-readiness checklist and drafts for Google Play and the App Store (nothing submitted).
- [IOS.md](IOS.md): iOS today (web app / PWA; the native app is prepared, TestFlight pending) and the path to TestFlight and the App Store: release config, versioning, `MODE=appstore` builds, owner checklist, review notes, privacy label.
- [RELEASING.md](RELEASING.md): how a release is cut (tag, signed APK, web bundle, checksums, GitHub release, npm).
- [LEAK-GUARD.md](LEAK-GUARD.md): how the repository keeps private content out (scanners, hooks, CI).

## Background and evaluation

- [INSPIRATION-OIUI.md](INSPIRATION-OIUI.md): what the project took from CopilotKit's OpenIntelligentUI, what it adapted, and why.

## Assets

- [voice-samples/](voice-samples/): sample MP3s of the Deepgram Aura-2 German voices, for choosing a read-aloud voice.

## Other documentation in the repository

- [../hermes-skill/INSTALL.md](../hermes-skill/INSTALL.md): installing the `hermes-ui` skill by hand (the setup wizard does it for you), checking, updating and removing it.
- [../bridge/README.md](../bridge/README.md): bridge reference (commands, flags, environment).
- [../desktop/README.md](../desktop/README.md): the macOS desktop app (signed and notarized, native pack) and the Linux alpha (AppImage / .deb), both Tauri.
- [../mock-server/README.md](../mock-server/README.md): the mock Hermes API server, its scenarios, and its flags.
- [../app/src/sandbox/README.md](../app/src/sandbox/README.md): the `<HtmlBlock>` component for `hui-html` blocks.
- [../app/src/calc/README.md](../app/src/calc/README.md): the safe expression engine used by calculator nodes.
- [../app/src/i18n/README.md](../app/src/i18n/README.md): how strings are added and translated (German and English).
- [../app/AGENTS.md](../app/AGENTS.md): notes for AI coding agents working on the Expo app, including the Expo versioning rule.
- [../CONTRIBUTING.md](../CONTRIBUTING.md): development setup, checks, conventions, and the pull request checklist.
- [../NOTICE.md](../NOTICE.md): third-party credits and licenses.
