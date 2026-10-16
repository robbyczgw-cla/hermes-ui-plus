# Store readiness (Google Play, Apple App Store)

Status 2026-10-12: **prepared, nothing submitted or uploaded.** Applies to the official build (`FLAVOR=hermes`, identity
from `app/brand/identity.json`). The personal flavor is never submitted.

This file is a working checklist and a set of drafts. It is **not legal advice**. Where a store's rules are not clear for
this app's architecture, that is marked **Uncertain** with the options.

Policy sources were read on 2026-10-12:
- Google Play: [AI-Generated Content](https://support.google.com/googleplay/android-developer/answer/13985936) and
  [Data safety](https://support.google.com/googleplay/android-developer/answer/10787469). Neither page shows a
  last-updated date.
- Google Play: [Foreground service types](https://support.google.com/googleplay/android-developer/answer/13392821),
  [target API level](https://developer.android.com/google/play/requirements/target-sdk) and
  [16 KB page sizes](https://developer.android.com/guide/practices/page-sizes).
- Apple: [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) ("Last Updated: June 8, 2026"),
  [App privacy details](https://developer.apple.com/app-store/app-privacy-details/) and
  [age rating values](https://developer.apple.com/help/app-store-connect/reference/age-ratings-values-and-definitions/).

## 0. Checklist

| # | Item | Status |
|---|---|---|
| 1 | In-app reporting of AI answers (Play AI-generated content policy) | done in the app (section 1). **Open:** "to developers without exiting the app" (1.3) |
| 2 | AI data-sharing consent before the first message (Apple 5.1.2(i)) | done in the app (section 2) |
| 3 | Privacy policy URL live at `https://hermesui.xyz/privacy` (= `PRIVACY.md`; date and contact line are filled in) | open: site source is `website/` (deploy steps in [website/README.md](../website/README.md)); the domain was not reachable on 2026-10-14 (no deployment attached) |
| 4 | Support address `robby@robbyczesany.com` exists and is monitored | done (the maintainer's published contact; in `identity.json`, the app and the listings) |
| 5 | Play data safety form | draft in 3.1 (**Uncertain**, decide A or B) |
| 6 | Apple privacy nutrition label | draft in 3.2 |
| 7 | Age rating questionnaires (IARC, Apple) | draft in 3.3 |
| 8 | Export compliance | done in config (`ios.config.usesNonExemptEncryption: false`), reasoning in 3.4 |
| 9 | Review notes and reviewer access (demo + test server) | draft in 3.5. **Open:** a reviewer Hermes instance |
| 10 | Store listings de/en | draft in 4, Google Play texts, data safety, rating and screenshots in "Google Play (draft)" |
| 11 | Android foreground service: declare with a video, **or** build with `EXPO_PUBLIC_BG_SERVICE=0` | switch implemented (5) |
| 12 | Target API 36, 16 KB pages, iOS privacy manifest, ATS exception | verify in the next build (6) |
| 13 | Trademark search for the name | recommended (7) |

## 1. "Antwort melden" (report an AI answer)

### 1.1 Policy

Google Play, AI-Generated Content (verbatim): *"Apps that generate content using AI must contain in-app user reporting
or flagging features that allow users to report or flag offensive content to developers without needing to exit the
app."* and *"Developers should utilize user reports to inform content filtering and moderation in their apps."* The
policy says *"Developers are responsible for ensuring that their generative AI apps do not generate offensive content"*
and covers "text-to-text chatbots where AI chat is a central feature".

Apple names chatbots in guideline 4.7: such software must *"include a method for filtering objectionable material, a
reporting mechanism, and the ability to block abusive users"*. 1.2 (user-generated content) asks for a report
mechanism and published contact information.

### 1.2 What the app does (`app/src/compliance/`)

- Each finished assistant answer has **"Melden"** in the long-press menu and in the "⋯" overflow at the end of the
  action row. The row stays copy · share · (image) · read aloud · regenerate · ⋯. The demo
  has it too, so reviewers can try it.
- The sheet has a reason (Anstößig/Gefährlich, Falsch/Irreführend, Rechtlich bedenklich, Sonstiges) and an optional
  comment (≤ 1000 chars). On "Melden":
  - the report is stored **on the device** (`AsyncStorage` key `hui.answerReports`, the newest 500 are kept);
  - the answer is replaced by **"Gemeldet – anzeigen?"**. Tapping shows it for this app session. The menu then offers
    "Meldung zurücknehmen".
- **"An Entwickler senden"** opens a `mailto:` to `supportEmail` (`app/brand/identity.json`). The mail has the reason,
  the app version and platform, the comment, and an answer excerpt (≤ 500 chars) **only if the user ticks the box**.
  The box is off by default, and the excerpt is shown before sending. Nothing is sent automatically. There is no
  network call to us and no backend.
- Tests: `app/src/compliance/reports.test.ts`.

### 1.3 Open point: "without needing to exit the app" (**Uncertain**)

The report is filed and the answer is hidden without leaving the app. But **reaching the developer** needs the mail
app, which leaves the app. A strict reading of the policy may not accept that. Options, none implemented:
1. Keep the mailto, and explain it in the review notes (no accounts, no backend by design; the report is filed in-app
   and the developer channel is one tap). Lowest effort; there is some rejection risk.
2. Open a hosted report form in an in-app browser tab (`expo-web-browser`, it stays in the app). This needs a form
   service, which is a small "backend" and would change the privacy story.
3. Bridge-relayed report: the user's bridge forwards the report to the support address. This still needs a mail
   relay, so it is a backend in effect.

Decide before the Play submission.

Since the model and its filtering run on the user's own Hermes server, the review notes should also say that content
filtering is configured there (system prompt, model choice). The app has no filtering of its own.

## 2. AI data-sharing consent

### 2.1 Policy

App Review Guideline **5.1.2(i)** (verbatim, guidelines last updated June 8, 2026): *"You must clearly disclose where
personal data will be shared with third parties, including with third-party AI, and obtain explicit permission before
doing so."*

### 2.2 What the app does

- **Text** (`compliance.consent.*`, de/en/es): "Deine Nachrichten, Anhänge und Sprache werden an deinen Hermes-Server
  gesendet und von dort an die KI-Anbieter, die in Hermes eingerichtet sind (z. B. OpenAI, Anthropic, xAI). HUI+
  selbst speichert oder sammelt nichts." A second line covers the voice bridge (STT/TTS providers) and image search
  providers. Then [Verstanden & weiter] and a link to the privacy page.
- **When it is asked:**
  - Onboarding: a step right after the connection is saved, before the skill hint, the "Fertig" screen or any
    starter prompt. It also applies to simple pair links and "add connection".
  - Existing installs: the sheet opens once per app session in a non-demo chat. Until the user accepts, any send
    (composer, starter chips, actions, slash commands, image edit) opens it instead of sending. The draft is kept.
    After "weiter", text-only sends go out right away. A composer draft with attachments stays in the composer and
    needs one more tap.
  - The **demo profile** never asks, because nothing leaves the device.
- **Versioning:** `AsyncStorage` key `hui.aiConsent` = `{version, at}`. `AI_CONSENT_VERSION` in
  `app/src/compliance/consent.ts`. `consent.test.ts` fingerprints the de/en/es consent texts and fails when they change
  without a version bump. A bump asks everyone again.

## 3. Store questionnaires (drafts)

### 3.1 Google Play data safety (**Uncertain**: choose A or B)

Facts:
- The developers run no server and get no data. There are no SDKs for analytics, ads or crash reporting.
- The app sends messages, attachments (photos, files) and audio (dictation via the bridge) to a server **the user
  configured**: their own Hermes/bridge. Optionally, search terms go to the user's own image search provider with
  the user's own key. Push tokens go to the user's bridge.
- Conversations are stored on the device.

What Google's help page says:
- "Collect" means *"transmitting data from your app off a user's device"*, and this applies *"irrespective of whether
  data is transmitted to you or a third-party server"*. This argues **for** declaring.
- There is a cloud-storage FAQ: if *"the user chooses to upload their data directly to their own external drive or cloud
  storage account"* and the app never collects or accesses it, collection need not be declared. Sending to the user's
  own server is the closest analogy, and it argues **against** declaring. The page has no explicit guidance for
  self-hosted servers.
- Sharing exemption: transfers *"based on a specific user-initiated action, where the user reasonably expects the data to
  be shared"* are not sharing.

**A: "No data collected".** Reasoning: user-directed transmission to the user's own server, analogous to the
cloud-storage FAQ. The developer never has access. Lower friction, but a reviewer may disagree with the reading.

**B (recommended, conservative): declare as collected, not shared.**

| Data type | Collected | Shared | Optional | Purpose |
|---|---|---|---|---|
| Messages → Other in-app messages | yes | no (user-initiated, to the user's own server) | no (core function) | App functionality |
| Photos and videos → Photos | yes | no | yes | App functionality |
| Files and docs | yes | no | yes | App functionality |
| Audio → Voice or sound recordings | yes | no | yes (dictation via bridge) | App functionality |
| App activity → Other user-generated content (image search terms) | yes | no | yes | App functionality |
| Device or other IDs (push token, to the user's bridge) | yes | no | yes (push is off by default) | App functionality |

- "Is all user data encrypted in transit?" **No.** The app allows cleartext HTTP to LAN servers
  (`usesCleartextTraffic: true`). Answer "Yes" only if the store build enforces HTTPS.
- "Data deletion": there are no accounts. Users delete conversations in the app and data on their own server.
  Choose the "no account" option.
- Processed ephemerally: no. The Hermes server keeps history under the user's control.

### 3.2 Apple App Privacy ("nutrition label")

Apple: *"'Collect' refers to transmitting data off the device in a way that allows you and/or your third-party partners
to access it for a period longer than what is necessary to service the transmitted request in real time."*
"Third-party partners" means *"analytics tools, advertising networks, third-party SDKs, or other external vendors whose
code you've added to your app"*.

- **Draft answer: "Data Not Collected".** Neither the developer nor any partner whose code is in the app can access
  the data. The user's Hermes server and the AI providers configured there are the user's choice, not the app's
  partners. This matches `app.json` → `ios.privacyManifests.NSPrivacyCollectedDataTypes: []`. Push: data collected by
  Apple (APNs) is not the developer's to disclose.
- **Uncertain:** Apple's page does not address servers that the user operates. If review pushes back, declare
  User Content (Emails or Text Messages → "Other User Content", Photos, Audio Data) as "not linked, not tracking, App
  Functionality". The privacy manifest must then list the same types.
- Tracking: none. No ATT prompt.

### 3.3 Age rating

Apple questionnaire (2025 system: 4+, 9+, 13+, 16+, 18+). The page has no AI- or chatbot-specific item.
- In-app controls: Parental Controls **No**, Age Assurance **No**.
- Capabilities:
  - Unrestricted Web Access **No**. Links open in the system browser. The HTML sandbox blocks top-level navigation
    (`isAllowedNavigation` in `app/src/sandbox/HtmlFrame.tsx`). Answering Yes would mean **16+**.
  - User-Generated Content **No**. Nothing is shared between users.
  - Messaging and Chat **No**. There is no user-to-user chat; the AI chat is with the user's own server.
  - Social Media **No**, Advertising **No**.
- Mature themes, medical, sexuality, violence, gambling: answer **"None"**. The app has no built-in content.
- **Expected: 13+ to 16+.** Model output is unfiltered by the app and depends on the user's server, so a conservative
  answer ("Infrequent" for mature/suggestive themes and medical information) gives 13+. Answering Unrestricted Web
  Access Yes gives 16+. **Recommendation: 16+.** It reflects unfiltered general-purpose AI output and lowers the risk of
  a rating dispute. Confirm when filling in the form.

Google Play (IARC). Category "All other app types".
- Violence, sexuality, language, controlled substances, gambling: **No** (no built-in content).
- Interactive elements: "Users can interact or exchange content" **No** (no user-to-user exchange). "Shares location"
  **No**. "Unrestricted internet access" **No** (same reasoning as for Apple). "Digital purchases" **No**.
- Generative AI: answer **Yes** where IARC asks about AI-generated content.
- **Expected:** IARC Generic 12 or Teen (PEGI 12 / USK 12 / ESRB Teen) for an AI chat. **Uncertain:** the result
  depends on IARC's current AI questions.
- Target audience (Play "Target audience and content"): **18+ only, or 16+ and up.** The app is not designed for
  children. This avoids the Families policy.

Content rating notes, for both stores: "The app has no built-in content. All answers come from an AI agent (Hermes)
on a server that the user operates and configures. The model provider and its safety settings are chosen by the user.
In the app, users can report any answer (it is then hidden) and send the report to the developer."

### 3.4 Export compliance

`app.json` → `ios.config.usesNonExemptEncryption: false`, which sets `ITSAppUsesNonExemptEncryption=false`. Reasoning:
- The app uses only encryption built into the OS: TLS via `URLSession`/OkHttp for HTTPS, Keychain/Keystore through
  `expo-secure-store`, and hashing/random numbers through `expo-crypto`.
- It ships no proprietary or non-standard cryptographic algorithm.

Under Apple's export compliance categories, that use is exempt. App Store Connect then asks no further questions, and
no annual self-classification report is needed for exempt-only use. Re-check this if the app ever adds its own crypto,
such as end-to-end encryption.

### 3.5 Review notes (both stores, draft, English)

> HUI+ for Hermes Agent (on the device: "HUI+"; project name "Hermes Interactive UI+") is an unofficial, open-source client for Hermes Agent, a self-hosted AI agent.
> It is not affiliated with Nous Research. The app has no accounts and no developer-operated backend. It connects to
> a Hermes server that the user runs.
>
> **To review without a server:** on the first screen tap "Try it first (demo)" (or "Just take a look around" on the welcome screen). The "All set" screen lists six examples; the
> strip under the chat title reads "DEMO - No server" and "Connect Hermes" there opens the real setup. The offline demo replays bundled, fictional
> sample answers in English, German or Spanish, and every tap has a follow-up: a shopping list you can tick, an approval request (Allow once / Deny),
> product cards with "Compare" and "I'll take this", a recipe with timers, a quiz and flashcards, a destination choice, reshape chips (Shorter / As a table)
> and a long answer you can stop. No network is used (no photos, maps or web lookups). The exact tap path is in the private store folder (`review/app-review-notes.md`).
>
> **Full use** requires a self-hosted Hermes Agent, optionally with the Hermes UI+ bridge. For review, use this test
> server: `<reviewer pairing link or URL + API key>` (welcome screen → connect → pairing link, or Settings → Verbindung hinzufügen).
>
> **AI data consent (5.1.2(i)):** before the first message is sent to a server, the app explains that messages,
> attachments and voice go to the user's Hermes server and from there to the AI providers configured in Hermes. It
> asks for explicit consent. The demo sends nothing.
>
> **Reporting AI output:** long-press an answer (or tap "⋯" under it) → "Report". The answer is hidden and can be sent
> to `robby@robbyczesany.com` from the app.
>
> **Local network / HTTP (iOS):** self-hosted servers are often on the home network over plain HTTP. That is why the
> app declares `NSLocalNetworkUsageDescription` and an ATS exception.

**Open:** Apple usually rejects apps that cannot be fully reviewed. Provide a reviewer Hermes instance (a pairing
link in the notes, and it must stay online during review). For Play, the same goes under "App access".

## 4. Store listings (drafts)

Store name: **HUI+ for Hermes Agent** (`storeName` in `app/brand/identity.json`, 21 characters), the same in every
language and in both stores. The name under the icon is **HUI+** (`displayName`), so the listing and the home screen
match (App Store guideline 2.3.8). iOS subtitle: `Answers you can act on` / `Antworten zum Antippen`; Play short
description from the taglines below. Fallback name if Apple rejects the name under 5.2.1 or Nous Research objects:
**HUI+ Interactive Agent Chat** (27 characters; "Hermes Agent" then only in the description, not in the name or the
keywords). The project, repository and website keep the name Hermes Interactive UI+ (Hermes UI+). The disclaimer line
goes into every long description.

### Deutsch

- **Kurzbeschreibung** (≤ 80): `Interaktiver Chat für deinen selbst gehosteten Hermes Agent` (59 Zeichen)
- **Beschreibung:**

  > HUI+ ist ein interaktiver Chat für deinen eigenen Hermes Agent. Antworten werden zu Checklisten, Tabellen,
  > Diagrammen, Formularen und Karten, die du direkt antippen kannst, statt nur Text zu sein.
  >
  > • Verbindet sich mit deinem selbst gehosteten Hermes Agent, direkt oder über die Hermes UI+ Bridge (QR-Pairing)
  > • Interaktive Antworten: Checklisten, Auswahl, Formulare, Diagramme, Rezepte, Termine
  > • Sprache: diktieren und vorlesen lassen
  > • Anhänge: Fotos und Dokumente
  > • Freigaben für Hermes-Werkzeuge direkt im Chat
  > • Antworten laufen weiter, wenn du die App wechselst
  > • Offline-Demo zum Ausprobieren, ohne Server
  >
  > Datenschutz: keine Konten, keine Werbung, kein Tracking. Deine Nachrichten gehen nur an deinen eigenen Server und
  > von dort an die KI-Anbieter, die du in Hermes eingerichtet hast.
  >
  > Für die volle Nutzung brauchst du einen eigenen Hermes Agent (Open Source).
  >
  > Inoffizieller Community-Client, nicht mit Nous Research verbunden.

- **Schlüsselwörter / Tags:** Hermes Agent, KI-Chat, selbst gehostet, Self-Hosting, KI-Assistent, Open Source, Bridge,
  interaktiv, Sprachassistent
- **Apple-Keywords** (≤ 100 Zeichen, kommagetrennt):
  `hermes agent,ki,chat,assistent,self-hosted,selbst gehostet,open source,llm,bridge,sprache`

### English

- **Short description** (≤ 80): `Interactive chat for your self-hosted Hermes Agent` (50 chars)
- **Description:**

  > HUI+ is an interactive chat client for your own Hermes Agent. Answers become checklists, tables, charts,
  > forms and cards you can tap, not just text.
  >
  > • Connects to your self-hosted Hermes Agent, directly or through the Hermes UI+ bridge (QR pairing)
  > • Interactive answers: checklists, choices, forms, charts, recipes, events
  > • Voice: dictate messages and have answers read aloud
  > • Attachments: photos and documents
  > • Approve Hermes tool actions right in the chat
  > • Answers keep running when you switch apps
  > • Offline demo to try it without a server
  >
  > Privacy: no accounts, no ads, no tracking. Your messages go only to your own server and from there to the AI
  > providers you set up in Hermes.
  >
  > Full use requires your own Hermes Agent (open source).
  >
  > Unofficial community client, not affiliated with Nous Research.

- **Keywords / tags:** Hermes Agent, AI chat, self-hosted, AI assistant, open source, LLM client, bridge, interactive
- **Apple keywords** (≤ 100 chars): `hermes agent,ai,chat,assistant,self-hosted,open source,llm,bridge,voice,client`

### Google Play (draft, English + German)

Draft for the first Play listing (state 2026-10-14, nothing entered or uploaded). It sharpens the generic texts above
for people who **already run a Hermes Agent**. Every claim is true for the 0.1 alpha. Items marked **[OWNER]** need a
decision or a fact only the owner has. Play listing rules (80 / 4000 characters) were counted, not looked up again.

Console fields: **App name** `HUI+ for Hermes Agent` (21 of 30 characters), **Category** Productivity (alternative:
Tools), **Contact e-mail** `robby@robbyczesany.com`, **Privacy policy** `https://hermesui.xyz/privacy`, **Website**
`https://hermesui.xyz`. Required graphics: app icon 512 x 512, **feature graphic 1024 x 500 (none exists in the repository
yet, [OWNER] to make it)**, 2 to 8 phone screenshots (see "Screenshots" below). The title names Hermes Agent ("for …"), so read
section 7 (trademark) before submitting.

#### Short description (max 80)

- EN: `Approve, watch and steer your self-hosted Hermes Agent from your phone` (70 characters)
- DE: `Deinen selbst gehosteten Hermes Agent vom Handy freigeben und verfolgen` (71 Zeichen)

#### Full description, English (max 4000, 2462 used)

```
HUI+ is a mobile client for people who already run a Hermes Agent on their own server and are tired of reading long answers in a terminal or a chat app.

WHAT YOU GET
• Approvals from your phone: when Hermes wants to run a command, you see it in full and allow or deny it in the app. Unusual or hidden characters in a command are shown and flagged.
• Live tool steps: watch every step Hermes takes while it works (search, terminal, files, reasoning) with timings, then read the answer.
• Hermes keeps working when you leave the app: the turn runs on your server. Switch apps, lock the phone, come back, and the finished answer is there.
• Rich answers instead of walls of text: tables, charts, checklists, comparisons, forms, step-by-step guides, recipes with timers, maps, product and place cards. Tap a checklist item, a choice or a form field and your input goes back to Hermes.
• Slash commands for sessions and models (/new, /model, /retry, /stop, /approve, /usage and more) with a searchable palette.
• Voice and files: dictate messages, have answers read aloud, attach photos and documents.
• Several conversations, light and dark themes, English, German and Spanish.
• An offline demo: try the interface without any server.

HOW IT WORKS
HUI+ talks to your own Hermes Agent, either directly or through the optional Hermes UI+ bridge, a small open-source service you run next to Hermes (npx hermes-ui-plus-bridge setup). The bridge pairs your phone with a QR code and gives each device its own revocable token. A private network path such as Tailscale is strongly recommended. Never expose Hermes to the public internet.

PRIVACY
No accounts, no ads, no analytics, no tracking, and no server run by the developers. Conversations are stored on your device. Your messages and attachments go only to the server you set up, and from there to the AI providers you configured in Hermes.

GOOD TO KNOW (alpha)
• You need your own self-hosted Hermes Agent (v0.21 or newer, open source). Without one, only the demo works.
• There is no remote push notification on Android yet. You see a finished answer or an approval request when you open the app. While an answer is running, a notification shows its progress.
• Expect rough edges and changes between alpha versions.

HUI+ is an unofficial community client. It is not affiliated with, endorsed by, or supported by Nous Research.

The app is open source. Source code, setup guide and privacy policy: hermesui.xyz
```

#### Full description, German (max 4000, 2813 used)

```
HUI+ ist ein mobiler Client für alle, die bereits einen Hermes Agent auf dem eigenen Server betreiben und keine Lust mehr haben, lange Antworten im Terminal oder in einer Chat-App zu lesen.

DAS BEKOMMST DU
• Freigaben vom Handy: Will Hermes einen Befehl ausführen, siehst du ihn vollständig und erlaubst oder verweigerst ihn in der App. Ungewöhnliche oder versteckte Zeichen in einem Befehl werden angezeigt und markiert.
• Live-Werkzeugschritte: Verfolge jeden Schritt von Hermes während der Arbeit (Suche, Terminal, Dateien, Denken) mit Zeiten und lies danach die Antwort.
• Hermes arbeitet weiter, wenn du die App verlässt: Der Durchlauf läuft auf deinem Server. App wechseln, Handy sperren, zurückkommen, und die fertige Antwort wartet.
• Reiche Antworten statt Textwänden: Tabellen, Diagramme, Checklisten, Vergleiche, Formulare, Schritt-für-Schritt-Anleitungen, Rezepte mit Timern, Karten, Produkt- und Ortskarten. Tippe einen Listenpunkt, eine Auswahl oder ein Formularfeld an, und deine Eingabe geht zurück an Hermes.
• Slash-Befehle für Sitzungen und Modelle (/new, /model, /retry, /stop, /approve, /usage und mehr) mit durchsuchbarer Palette.
• Sprache und Dateien: Nachrichten diktieren, Antworten vorlesen lassen, Fotos und Dokumente anhängen.
• Mehrere Unterhaltungen, helle und dunkle Designs, Deutsch, Englisch und Spanisch.
• Eine Offline-Demo: Probiere die Oberfläche ohne Server aus.

SO FUNKTIONIERT ES
HUI+ spricht mit deinem eigenen Hermes Agent, direkt oder über die optionale Hermes UI+ Bridge, einen kleinen Open-Source-Dienst, den du neben Hermes betreibst (npx hermes-ui-plus-bridge setup). Die Bridge koppelt dein Handy per QR-Code und gibt jedem Gerät ein eigenes, widerrufbares Token. Ein privater Netzwerkweg wie Tailscale wird dringend empfohlen. Hermes nie ins öffentliche Internet stellen.

DATENSCHUTZ
Keine Konten, keine Werbung, keine Analyse, kein Tracking und kein Server der Entwickler. Unterhaltungen liegen auf deinem Gerät. Deine Nachrichten und Anhänge gehen nur an den Server, den du eingerichtet hast, und von dort an die KI-Anbieter, die du in Hermes konfiguriert hast.

GUT ZU WISSEN (Alpha)
• Du brauchst einen eigenen, selbst gehosteten Hermes Agent (ab v0.21, Open Source). Ohne ihn funktioniert nur die Demo.
• Auf Android gibt es noch keine Push-Benachrichtigung aus der Ferne. Eine fertige Antwort oder eine Freigabe-Anfrage siehst du, wenn du die App öffnest. Während eine Antwort läuft, zeigt eine Benachrichtigung den Fortschritt.
• Rechne mit Ecken und Kanten und mit Änderungen zwischen den Alpha-Versionen.

HUI+ ist ein inoffizieller Community-Client. Er ist nicht mit Nous Research verbunden und wird von Nous Research weder unterstützt noch empfohlen.

Die App ist Open Source. Quellcode, Einrichtungsanleitung und Datenschutzerklärung: hermesui.xyz
```

**[OWNER]** two sentences depend on the build you upload:
- "While an answer is running, a notification shows its progress" is true only for a build **with** the keep-alive
  service (default). For the recommended first store build (`EXPO_PUBLIC_BG_SERVICE=0`, section 5.2) delete that
  sentence in both languages. "Hermes keeps working when you leave the app" stays true: Hermes finishes the turn on your
  server, and the app fetches the answer when you return (`hermes/recovery.ts`).
- "Approvals from your phone" means in the app. Without remote push you see a request when you open the app (stated
  under "Good to know").

#### Data safety form (draft answers)

Basis: [PRIVACY.md](../PRIVACY.md) and 3.1 above. Facts: the developers run no server and receive no data; there is no
analytics, ads or crash SDK; conversations stay on the device; messages, attachments and audio go only to the server the
user configured; the app has no accounts.

| Play question | Draft answer | Note |
|---|---|---|
| Does the app collect or share any of the required user data types? | **Uncertain, [OWNER] decides between A and B (3.1).** A: **No** (user-directed transfer to the user's own server, analogous to Google's cloud-storage FAQ). B (recommended in 3.1): **Yes, collected, not shared**. | Data collected or shared **by the developer**: none, under both options. The open question is only whether sending to the user's own self-hosted server counts as "collection". Google's page has no explicit rule for self-hosted servers. |
| Data types under B | Messages (Other in-app messages), Photos, Files and docs, Audio (Voice or sound recordings), App activity (Other user-generated content: image search terms), Device or other IDs (push token, only for self-built apps with push) | Each: collected yes, shared **no** (user-initiated transfer to the user's own server), optional except messages, purpose **App functionality** only. No analytics, no advertising, no personalization. |
| Is any of the data shared with third parties? | **No** | The AI providers are chosen by the user in Hermes and receive data from the user's server, not from the app or the developers. |
| Is all user data encrypted in transit? | **No** (recommended) | The app also connects over plain `http://` to LAN servers (`usesCleartextTraffic`). With Tailscale or HTTPS it is encrypted, but that depends on the user's server, not on the app. Answer **Yes** only if the store build refuses cleartext. |
| Can users request that their data is deleted? | No account exists. Conversations are deleted in the app, data on the user's own server by the user. | Under B, choose the option for apps without accounts and describe this in the privacy policy (it is in "Your control"). **[OWNER]** confirm the wording the form offers. |
| Independent security review | No | |
| Follows the Play Families policy | No | The app is not directed at children. |
| Privacy policy URL | `https://hermesui.xyz/privacy` | Must be live and equal to PRIVACY.md before submission. |

Things a reviewer may ask about, with the honest answers:
- **Third-party requests that expose the device's IP address:** map tiles (OpenStreetMap-based servers), images from hosts
  named in an answer (for example Wikimedia; unknown hosts only after a tap, or through the user's bridge), script
  libraries in HTML widgets (public CDNs, sandboxed), and the user's own speech or image search provider if the user adds
  a key in the app. The app has no developer-side endpoint among them. **Uncertain [OWNER]:** whether Play wants IP
  addresses of such requests declared. The conservative route is to name them in the privacy policy, which PRIVACY.md
  already does.
- **Dictation:** Android's speech recognition may be provided by Google's speech service, depending on the device. That is
  the operating system's service, not an SDK in the app. **Uncertain [OWNER]** whether this needs a declaration.
- **Permissions in the manifest:** camera (photos and pairing QR codes), microphone (dictation, only when tapped), calendar
  (add an event, only after confirming it in the chat), notifications, and the data-sync foreground service in the
  default build (section 5).

#### Content rating (IARC questionnaire, draft answers)

Basis: 3.3 above. Category: **Utility, productivity, communication or other** (not a game, not social, not news).
**Uncertain [OWNER]:** IARC's category names change; pick the one that is not "social networking".

| Question | Draft answer |
|---|---|
| Violence, blood, sexual content, nudity, profanity, drugs, gambling, fear | **No** for all. The app has no built-in content. |
| Users can interact or exchange content with each other | **No**. There is no user-to-user feature. |
| Shares the user's location | **No** |
| Unrestricted internet access (web browser) | **No**. Links open in the system browser, and the HTML widget sandbox blocks navigation. |
| Digital purchases | **No** |
| Generative AI / AI chatbot content | **Yes**, if asked. Answers come from the user's own Hermes Agent and the model providers chosen there. |
| Reporting of AI content | The app has "Report" in each answer's menu: the answer is hidden and a report can be sent to the developer (1.2). Open point 1.3 applies. |

Expected result: about **12+ / Teen**, depending on IARC's AI questions. If asked about unfiltered AI output, answer
truthfully that filtering is configured on the user's server (system prompt, model choice) and the app has none of its
own (see the note in 3.3).

**Target audience:** **18 and over** only (alternative: 16 and over, **[OWNER]**). The app is not designed for children and
does not appeal to them. Not a "Designed for Families" app.

Other declarations: ads **No**; government app **No**; financial features **none**; health features **none**; news app
**No**; COVID-19 app **No**. Foreground service type "Data sync": declare with a video (5.1) or build with
`EXPO_PUBLIC_BG_SERVICE=0` (5.2).

#### App access (instructions for reviewers)

Play asks whether parts of the app need a login or special access. Answer **"All or some functionality is restricted"**,
because full use needs a Hermes server. Instructions (max 500 characters, 294 used):

```
No login. Full use needs the user's own Hermes server, so please use the offline demo: on the first screen tap "Try it first (demo)", then "Chart" or any example. It replays fictional sample answers you can act on (checklist, approval, product compare, recipe timers, quiz) and uses no network.
```

**[OWNER]** If a reviewer Hermes instance exists, append its pairing link as a one-time code **in the Console only** (never
in this repository) and keep it online during review, as for 3.5. Check the button names against the build before
pasting (`app/src/i18n/ns/onboarding*.ts`: `demoLink`, `demo.title`, the guided flow's `demo`).

#### Screenshots (candidates from `dist/share/demos/`, nothing uploaded)

Play phone screenshots: PNG or JPEG (no alpha), each side 320 to 3840 px, long side at most twice the short side; 2 to 8
images; recommended 1080 x 1920. The `.jpg` posters in `dist/share/demos/` are only **540 x 960** (first frame of each
clip) and the first frame is often an empty or half-loaded state, so **do not use the posters**. The `.mp4` clips are
**1080 x 1920** (9:16), which fits. Export a frame at the time given below and save it as PNG:

```
ffmpeg -ss <seconds> -i dist/share/demos/<clip>.mp4 -frames:v 1 <name>.png
```

All clips show the app framed in a phone with a caption, English UI, fictional data (the app labels it "Sample values").
Frames are taken at about 70 % of the clip and were checked on a contact sheet at low resolution.

| Priority | Clip | Time | Shows | Fits the story |
|---|---|---|---|---|
| 1 | `09-freigabe.mp4` | **about 8 to 11 s, [OWNER] check** (14 s shows the already approved result) | the approval card for a command | approvals from the phone |
| 2 | `13-toolsteps.mp4` | 15 s | tool timeline plus a table answer | live tool steps |
| 3 | `12-langtask.mp4` | 20 s (a touch indicator is visible; try 24 s) | a long answer with sources, "Hermes keeps working" | background work and rich answers |
| 4 | `02-produkte.mp4` | 21 s | side-by-side product comparison | rich answers |
| 5 | `01-orte.mp4` | 23 s | place cards with photo, rating and map | rich answers |
| 6 | `10-rezept.mp4` | 23 s | recipe with timers and shopping list | interactive answers |
| 7 | `06-mindmap.mp4` | 17 s | zoomable mind map | rich answers |
| 8 | `03-anleitung.mp4` | 23 s | step-by-step guide with "I'm stuck here" | optional |

Not suited: `11-designs` (settings screen, not a selling point), `08-befehle` and `07-umformen` (mostly empty chat),
`04-training` and `05-vokabeln` (niche), `trailer-poster.jpg` (1920 x 1080 landscape; usable only as a tablet or promo
image). For the German listing the clips have to be re-recorded with the German UI. **[OWNER]** Play may show the English
screenshots for German users, which is allowed. Each frame must be looked at once before upload: captions must match the
listing, and no frame may show anything private (the demo is mock data, but the notification clip shows a system
banner).

## 5. Android foreground service (dataSync)

`modules/stream-keepalive` runs a `dataSync` foreground service **only while an answer is being generated** and the
app goes to the background. It stops when the answer is done or fails, or when the user taps "Stopp" in the
notification. The Settings switch "Antworten im Hintergrund fertigstellen" turns it off. On Android 15+ it is limited
to 6 h per 24 h, and the service handles the timeout.

### 5.1 Play Console declaration (draft)

- **Type:** Data sync. **Use case:** network transfer / upload or download.
- **Description:** "While the user's AI agent is generating an answer the user requested, the app keeps the network
  stream to the user's own server open. This continues when the user switches to another app, so the answer finishes
  and is saved. The service starts only for a turn the user started in the foreground. It shows an ongoing
  notification with a Stop action and ends as soon as the answer is complete."
- **User impact if deferred or interrupted:** "The answer stops arriving. The user has to return to the app and wait
  for it to be fetched again or regenerate it. With direct (non-Hermes) backends the partial answer is lost."
- **Video (required):** a screen recording with these steps:
  1. Ask a long question.
  2. Switch to the home screen or another app.
  3. Show the ongoing notification ("Hermes antwortet …", with the Stop action).
  4. Return to the app and show the finished answer.
  5. Repeat steps 1 to 3 and tap Stop to end the service.
  Upload it unlisted (for example YouTube) and paste the link.
- Google recommends **user-initiated data transfer jobs** instead of dataSync for network transfers started by the
  user. That would be a native rewrite of the module.

### 5.2 Alternative: build without the service (implemented)

`EXPO_PUBLIC_BG_SERVICE=0` at build time:
- The config plugin `app/plugins/withBgService.js` (registered in `app/app.config.ts`) adds `tools:node="remove"` for
  `StreamKeepAliveService`, `FOREGROUND_SERVICE` and `FOREGROUND_SERVICE_DATA_SYNC`. The merged manifest declares no
  foreground service, so no Play declaration or video is needed.
- `app/src/background/bgService.ts` treats the native module as absent and hides the Settings switch.
- Hermes still finishes the turn on the server. The app recovers the answer via the bridge/session history when it
- Default (unset) keeps the service, which is what GitHub builds use. Tests: `app/src/background/bgService.test.ts`.
  Checked with `expo config --type introspect`: with `=0` the manifest mod has the three remove entries, unset has
  none.
- Recommendation for the first store release: build with `EXPO_PUBLIC_BG_SERVICE=0`.

## 6. Technical requirements to verify in the next build

- [ ] **Target API level.** Since **August 31, 2026**, new apps and updates must target **Android 16 (API 36)**
  (extension possible to November 1, 2026). RN 0.86 defaults to `targetSdk = 36` and `compileSdk = 36`
  (`node_modules/react-native/gradle/libs.versions.toml`). Verify with
  `aapt2 dump badging <apk> | grep targetSdk` on the release AAB/APK.
- [ ] **16 KB page size.** Required for updates of apps targeting API 35+ from **February 1, 2027** (64-bit devices).
  - RN has shipped 16 KB-aligned native libraries since 0.77, and Expo SDK 53+ builds on that.
  - The RN toolchain pins NDK 27.1, and r27 does not align by default; RN/Expo add the linker flags for their own libs.
  - No official statement covers the whole Expo SDK 57 / RN 0.86 dependency set, so check every `.so` in the
    release build:
    - `zipalign -c -P 16 -v 4 <apk>`
    - `check_elf_alignment.sh <apk>`, or APK Analyzer → Alignment column
  - Watch third-party native modules: react-native-worklets/reanimated, webview, view-shot, svg,
    expo-speech-recognition, expo-camera (MLKit). `modules/stream-keepalive` is Kotlin only, with no `.so`.
  - Test on a 16 KB emulator image (`adb shell getconf PAGE_SIZE` → 16384).
- [ ] **iOS privacy manifest.**
  - `app.json` → `ios.privacyManifests` has tracking false and no collected data types, plus required-reason APIs:
    UserDefaults CA92.1, FileTimestamp C617.1/0A2A.1/3B52.1, DiskSpace E174.1/85F4.1, SystemBootTime 35F9.1.
  - Verify `PrivacyInfo.xcprivacy` in the built `.app`. Verify that the pods' own manifests are bundled; Xcode →
    Generate Privacy Report on the archive.
  - Release config, versioning and the TestFlight path: [IOS.md](IOS.md). Keep the collected data types consistent
    with 3.2 (`app/src/iosRelease.test.ts` checks the manifest).
- [ ] **ATS.** `NSAllowsArbitraryLoads: true` needs a justification in review (self-hosted LAN/HTTP servers, see 3.5).
  Consider `NSAllowsLocalNetworking` plus HTTPS-only instead, if HTTP to non-local hosts is not needed.
- [ ] **Cleartext on Android.** `usesCleartextTraffic: true` affects the "encrypted in transit" answer (3.1).
- [ ] Push (if enabled in store builds): the FCM project / `google-services.json` and the APNs key are the developer's.
  Re-check 3.1/3.2 if any push payload passes a developer-run service. Today it is the user's bridge plus Google or
  Apple only.

## 7. Name and trademark note (not legal advice)

- "Hermes" is used by several rights holders and in common language. Examples: **Hermes Agent** (Nous Research; this
  app is an unofficial client for it), the parcel company **Hermes** (Hermes Germany / Evri), and **Hermès**
  (Hermès International). Some of these hold broad registrations, possibly including classes 9/42.
- The current approach is **nominative use**: the name refers to the product the app works with ("for Hermes Agent").
  Every listing carries the line "Unofficial community client, not affiliated with Nous Research." The app uses no
  third-party logos. The icon (`petasos`) is its own design.
- Store name since 0.1.1: **"HUI+ for Hermes Agent"**, i.e. the safer pattern "<own name> for <product>". Until 0.1
  the title was "Hermes Interactive UI+", which starts with "Hermes" and reads more like a brand than a descriptive
  reference. Another open-source project is called "Hermes UI"; "HUI+" keeps clear of it. Fallback if Apple (5.2.1) or
  Nous Research objects: "HUI+ Interactive Agent Chat", with "Hermes Agent" only in the description.
- **Recommended before release:** a trademark search in **EUIPO (eSearch plus / TMview)** and **USPTO**, at least for
  **Nice classes 9 (software/apps) and 42 (SaaS/IT services)**, for "HUI", "HUI+" and "Hermes". If in doubt, ask an IP
  lawyer. This note does not assess infringement risk.
