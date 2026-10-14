# Onboarding – integration notes

Everything lives in `app/src/onboarding/`; the wiring into the root layout, `+native-intent`, Settings and `app.json` is described under "Wiring (current)".

## Guided flow v2 (official build, FLAVOR=hermes)

`OnboardingFlow` picks the variant (`onboardingVariant()` in `guidedSteps.ts`): the official build renders
`GuidedFlow.tsx`, the personal flavor keeps the classic flow below unchanged. Same props and finish contract.

```
welcome ─ Verbinden ─► setup "Wie ist dein Hermes eingerichtet?"
   │                     ├─ QR / Link ──────────► scan ─► check ─► (consent) ─► done
   │                     ├─ Hermes ohne Bridge ─► noBridge ─┬─ Lass Hermes das machen ─► agentSetup ─► scan
   │                     │                                  ├─ Selbst einrichten ──────► selfSetup ──► scan
   │                     │                                  └─ Ohne Bridge (eingeschränkt) ─► manual ─► (consent) ─► done
   │                     └─ Noch kein Hermes ─► noHermes ─► demo
   └─ Demo ──────────────────────────────────────────────────────────────────────────► done (demo)
```
- Step machine: `guidedSteps.ts` (pure, `guidedSteps.test.ts`). Screens: `guided/*`. Desktop: `OnbFrame` (card ≤ 520 px).
- Diagnostics: `diagnose.ts` (error → one fix + buttons; success → detected list + notes), `features.ts`
  (bridge status / voice / image search / push / `/v1/skills` / `/v1/capabilities`), `troubleshoot.ts`
  (fills the troubleshoot prompt of `agentPrompts.ts`). UI `guided/Diagnostics.tsx`, reused by Settings →
  Verbindungen → "Verbindung prüfen" (`guided/ConnectionCheckPage.tsx`).
- Consent: `compliance/Consent` `ConsentStep` after saving (skipped when current). While an `OnboardingScreen` is
  mounted, `hostEvents.isOnboardingVisible()` is true and ChatView does not auto-open its consent sheet.

## Flow (classic, personal flavor)

```
Welcome ──► Verbindung wählen ─┬─ Mit Bridge koppeln (QR) ─► QR-Scanner / Link einfügen ─┐
   │ "Erst mal nur umsehen"    ├─ Hermes direkt ──────────► Formular (URL + Key) ◄────────┘ (vorausgefüllt, Auto-Test)
   │                           │                               │ Test: GET /health, GET /v1/models
   │                           │                               ▼ "Verbinden" → onSaveConnection(profile)
   │                           │                            Skill installieren (Befehl zum Kopieren)
   │                           ├─ Nur ausprobieren (Demo) ──────────────┐
   │                           └─ Andere Anbindung → onFinish({path:'other'}) → Settings
   └──────────────────────────────────────────────────────────► Fertig (Starter-Prompts) → onFinish(...)
```

- Progress dots (4 steps) except on Welcome and the demo shortcut; back arrow + Android hardware back walk
  the step history. After the connection is saved there is no "back" (would re-save).
- Pair links / deep links: the form shows "Aus Kopplungslink: <Name> · <Host>", is pre-filled and tests
  automatically; saving still needs an explicit tap on **Verbinden** (links are untrusted).
- Connection test (`probe.ts`): `GET <root>/health` without key (falls back to `<base>/health` on 404), then
  `GET <base>/models` with `Authorization: Bearer`. Bridge = `X-Hermes-UI-Bridge: 1` on either response
  (the bridge already exposes it via CORS). `/health` → `platform: hermes-agent` + version is shown.
  The profile's `bridge` flag = detected header (falls back to "came from a pair link" if saved without test).
- Errors are classified (`errors.ts`) into: timeout, dns, refused, tls, cleartext, mixedContent (web),
  cors (web), network (+ suspect hint: https-with-IP → TLS, Tailscale host → VPN, Android `localhost` → 10.0.2.2),
  unauthorized / keyMissing (401), forbidden, notFound (path), rateLimited, server, notHermes (HTML etc.).
  Note: RN's fetch only says "Network request failed" for DNS/TLS/refused alike – hence the URL-based suspects.
- URL normalization (`url.ts`): adds `https://` when no scheme, appends `/v1` once, strips pasted endpoints
  (`/v1/chat/completions`, `/v1/models`, `/health`), keeps reverse-proxy prefixes, drops default ports,
  query, fragment and trailing dots; rejects other schemes, `user:pass@`, whitespace/control chars, bad
  hosts/ports, `..` and encoded slashes. Live preview "Wird verwendet als: …".
  Cleartext hint: `http` to LAN/VPN (RFC1918, 100.64/10, `*.ts.net`, `.local`, single-label) = info,
  `http` to public hosts = warning, `http` from an https web page = mixed-content warning.

## Public API (`import … from '../onboarding'`)

| Export | Purpose |
|---|---|
| `<OnboardingScreen onFinish initialPairLink? entry? finishAfterSave? />` | Flow wired to `useConnection()` (`upsertProfile` + `setActive`). Render inside `<ConnectionProvider>`. |
| `<OnboardingFlow existingProfiles onSaveConnection onFinish …/>` | Same flow, storage-agnostic. |
| `OnboardingFinish` | `{ path: 'bridge'\|'direct'\|'demo'\|'other', profile?, starterPrompt? }` |
| `useOnboardingGate({ignoreDevKeys?})` | `{ ready, needed, complete(path), restart() }` – reads/writes `hermes.onboarded.v1`. |
| `usePairDeepLink(onLink)` | Delivers pair links (cold start + running); simultaneous duplicates once, a later re-open again. |
| `redirectPairSystemPath({path})` | For `src/app/+native-intent.tsx` (stops Expo Router from opening a non-existent `/pair` route). |
| `parsePairLink`, `buildPairLink`, `toPairLink`, `normalizeServerUrl`, `probeConnection`, `describeConnError`, `buildHermesProfile`, `skillInstallCommand` | Pure helpers (tested). |
| `setOnboarded`, `resetOnboarding`, `loadOnboardedFlag` | Flag persistence. |

Gate logic (`shouldShowOnboarding`): show unless the flag exists, **or** `hermes.profiles.v1` /
`hermes.activeProfile.v1` exist (user set up the app before onboarding existed), **or** the bundle has
`EXPO_PUBLIC_HERMES_API_KEY`/`EXPO_PUBLIC_BRIDGE_TOKEN` (personal dev build; pass `ignoreDevKeys` to test the flow).

## Wiring (current)

- **Root layout:** `src/app/_layout.tsx` wraps the router `<Stack>` with `<OnboardingHost>` (inside `ConnectionProvider`,
  `ConversationsProvider`). The host shows the flow on first start, for pair links, and for
  `openOnboarding('welcome' | 'choose')` requests (`hostEvents.ts`; Settings uses it for "Einrichtung erneut starten").
  On finish: `other` → `/settings`, `demo` → demo profile active + new demo chat, connection saved → new chat on that
  profile, starter prompt → `queueStarterPrompt` (the session sends it exactly once into that chat).
- **Deep links:** `src/app/+native-intent.tsx` calls `redirectPairSystemPath` (pair links map to `/`, the link is stashed);
  `usePairDeepLink` in the host also reads the initial URL once per process and `url` events. Duplicate deliveries of
  one link within a few seconds open the flow once (`linkDedupe.ts`); opening the same link again later is a retry.
  Web: `#pair?…` fragments (`takeWebPairHash`). Link format: `buildPairLink()`; `u` required, `t` optional token
  (visible ASCII ≤ 1024), `n` name (≤ 48), `v` must be `1`, duplicates and unknown versions rejected. The QR contains the
  token in clear: show it only on the bridge host / behind auth, ideally short-lived.
- **Camera:** `expo-camera` is a config plugin in `app.json`; the in-app explanation before the system dialog is
  `onboarding.scan.permissionText`; permanently denied → system settings + paste fallback. `expo-image-picker` writes the
  same `NSCameraUsageDescription` key, keep both texts identical.
- **Settings:** `Verbindung per QR hinzufügen` renders `<OnboardingScreen entry="choose" finishAfterSave />`;
  `Verbindung prüfen` uses `guided/ConnectionCheckPage.tsx`. Settings validates Hermes URLs with the same
  `normalizeServerUrl` as the onboarding form (`settings/profiles.ts` `cleanBaseUrl`).
- **Consent:** the flow asks in its own `ConsentStep`; elsewhere `compliance/ConsentHost` (mounted in `_layout.tsx`) shows
  the notice for remote voice (`voice/consentGate.ts`).
- **Demo mode:** `demo/` (`scenarios.ts`, `transport.ts`, `useDemoChat.ts`, `DemoSession.tsx`) replays scripted answers
  locally through the real SSE parser. The scripted answers of the four onboarding starters, the fallback and the
  approval/error chrome follow the UI language (`DemoContext.lang`); the other scenarios are still German. The starters'
  prompts are translated (`onboarding.demoStarters.*.prompt`) and must hit their scenario keywords
  (`demo/demo.test.ts` checks all three languages).
- **Skill hint:** `model.ts` `PROJECT_REPO_URL` / `SKILL_DOCS_URL`; with `null` the command shows a `<REPO-URL>`
  placeholder and the docs button is hidden.

## Storage keys
- `hermes.onboarded.v1` – `{"v":1,"at":<ms>,"path":"bridge|direct|demo|other|legacy"}` (AsyncStorage).
- Reads (never writes) `hermes.profiles.v1`, `hermes.activeProfile.v1` to detect existing setups.
- API keys only via `ConnectionProvider.upsertProfile` (SecureStore).

## Files
`OnboardingFlow.tsx` (variant switch), `GuidedFlow.tsx` + `guided/*` (official flow), classic screens (`Welcome`, `ChooseConnection`,
`ScanPair`, `ConnectionForm`, `SkillHint`, `Done`), `OnboardingScreen.tsx` / `OnboardingHost.tsx` (provider wiring, root host),
`ui.tsx`, `deepLink.ts`, `storage.ts`; pure + tested: `url`, `pairLink`, `linkDedupe`, `errors`, `probe`, `model`, `guidedSteps`,
`diagnose`, `features`, `agentPrompts`, `starters`.

Not verified visually (no dev server/emulator in review workstreams): light/dark at 360 px, camera preview on device,
keyboard avoidance on iOS, web CORS messages against a real Hermes.
