# Privacy policy

_Last updated: 2026-10-16. Applies to the Hermes Interactive UI+ apps ("HUI+" on the home screen, "HUI+ for Hermes Agent" in the stores; Android, iOS, web, macOS) and the Hermes UI+ bridge._

Hermes Interactive UI+ is an unofficial, open-source community client for the Hermes Agent. It is not affiliated with Nous Research.

## Summary

- **The developers collect no data.** There are no accounts, no analytics, no advertising, no crash-reporting service, and no server operated by the developers that your data passes through.
- Your data goes **only to the server you set up** (your Hermes Agent and your bridge) and to the services you configured on it.
- Conversations are stored **on your device** and on your own server.

## What data the app handles, and where it goes

| Data | Where it goes |
|---|---|
| Messages, attachments (photos, documents), voice recordings you send | From your device to **your bridge**, then to **your Hermes Agent**. Hermes sends the content to the AI model providers **you** configured in Hermes (for example Anthropic, OpenAI, OpenRouter or a local model). Their privacy policies apply to that part. |
| Dictation audio | One of three ways, depending on your settings: processed by your device's speech recognition (Android may use Google's speech services for this, depending on the device); sent to your bridge and from there to the speech-to-text provider configured on it (Groq or OpenAI); or, if you add your own key in the app, sent from your device directly to that provider (Groq, OpenAI or a custom endpoint you enter). Not stored by the app after transcription. |
| Read-aloud text | Spoken by your device's voices; or sent via your bridge to the text-to-speech provider configured on it (Deepgram, ElevenLabs or OpenAI); or, with your own key in the app, sent from your device directly to that provider (OpenAI, Deepgram or a custom endpoint). |
| Connection settings (server address, device token) | Stored on your device in secure storage (Keychain, Android Keystore). On the web, in the browser's local storage for the app's origin. |
| Conversations and interactive state (checked items, votes) | Stored on your device. Hermes keeps its own session history on your server. |
| Images in answers | Product, place and event photos from Hermes' answers are fetched by **your bridge's image proxy** (on by default, `BRIDGE_IMAGE_PROXY=off` disables it): the image host sees your bridge's address, not your device's, and gets no cookies or referrer. Other images are loaded from the host named in the answer (for example Wikimedia); unknown hosts only after you tap, and that host sees your IP address as with any web page. |
| Image search (optional) | If you set up your own image search provider and key in the app (for example Brave), search terms go from your device directly to that provider. |
| Reports of answers ("Report") | Stored on your device only (reason, optional comment). Nothing is sent automatically. "Send to developer" opens your mail app with a prepared e-mail (reason, app version, an answer excerpt only if you tick it); you decide whether to send it. |
| Update check ("Check for updates", on by default, Settings → About) | At most once a day, when the app comes to the foreground, the app asks GitHub's public API for the newest release of this project: `GET https://api.github.com/repos/robbyczgw-cla/hermes-ui-plus/releases/latest` (installed pre-release versions: `…/releases?per_page=10`). The request has no login, cookies, referrer or identifiers; GitHub sees your IP address and the app's user agent, as with any web request ([GitHub's privacy statement](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement)). Not made on iOS, in store installs, or while the device reports being offline. Turn it off with the switch. |
| "Report a problem" (Settings → About, failure cards) | Nothing is sent automatically. The app shows the exact text first, then opens a prefilled GitHub issue in your browser, or copies the text instead. It contains only the app version, build and commit, platform and OS version, build flavor, connection type (bridge / direct / demo), Hermes and bridge versions if your server reports them, enabled feature flags, and the category and code of the last error. Never server addresses, IP addresses, tokens, e-mail addresses or message contents. You decide whether to submit the issue on GitHub. |
| Share to HUI+, "Share as image" | Content shared to HUI+ from another app stays on your device until you tap Send in the share sheet; then it goes to your Hermes like any message or attachment. A shared answer image is rendered on your device and only leaves it where you send it (share sheet, download, clipboard). No request to a third party. |
| Map tiles | Requested from OpenStreetMap-based tile servers when you open a map. |
| Interactive HTML widgets | May load script libraries from public CDNs (jsDelivr, unpkg, cdnjs, esm.sh). The widgets run in a sandbox without access to your stored data. |

### Optional bridge extras (off unless you opt in)

By default the bridge only passes your messages to your Hermes and calls no other provider. If you (or whoever runs your bridge) turn on its optional direct-provider extras, the bridge itself sends data to these providers, outside Hermes, with keys stored on the bridge:

| Extra | Provider | What is sent |
|---|---|---|
| Model router (`ROUTER_BACKEND`) | Anthropic (Claude), Jev / TypeSafe, Drex / Nace.AI, or an OpenAI-compatible endpoint you configure | the last few messages, shortened, to pick an answer format |
| Chat titles and follow-up suggestions (`BRIDGE_META=on`) | Anthropic (Claude) | the first exchange of a chat |
| Image search | Serper or Brave | search terms |
| Voice | Groq, OpenAI (speech-to-text); Deepgram, ElevenLabs, OpenAI (text-to-speech) | dictation audio, text to be read aloud |

The bridge prints which of these are active when it starts. Their privacy policies apply to that part.

The bridge's logs contain routing metadata, not message content, at the default log level. You control the retention of uploaded files on your bridge (7 days by default).

## Push notifications

Push is optional and off until you enable it.

- **Web Push** goes through the push service of your browser vendor (Google, Mozilla or Apple). The payload is encrypted for your device.
- **Android:** the APK from GitHub Releases does not use Firebase Cloud Messaging, so no push data goes to Google. While an answer is running, the app's own keep-alive service shows a notification on the device.
- **Self-built apps** with Firebase Cloud Messaging (Android) or the Apple Push Notification service (iOS) deliver through Google or Apple. Your bridge then sends them a device push token and the notification content.
- **Previews are off by default.** Notifications then only say that a message or approval request arrived, without its text. If you or your server's operator turn previews on, the notification text passes through Google or Apple.

## Permissions

| Permission | Why | When |
|---|---|---|
| Microphone | Dictate messages | Only when you tap the microphone |
| Speech recognition (iOS) | Convert dictation to text on your device | Only when you dictate |
| Notifications / foreground service (Android) | Keep a running answer going and show its progress while the app is in the background | While an answer is running |
| Camera | Take photos for messages, scan pairing QR codes | Only when you use these features |
| Photos / files | Attach images and documents | Only for items you select |
| Notifications | Tell you that an answer is ready or Hermes needs an approval | Only after you allow them |
| Local network (iOS) | Reach a bridge on your home network | Only if your bridge is on the LAN |
| Calendar | Add an event, only after you confirm it in the chat | Only when you confirm such an action |

The app asks for each permission when you first use the feature. You can deny or revoke any of them in the system settings; the rest of the app keeps working.

## Children

The app is a general-purpose client and is not directed at children. The content of answers depends on the models you connect.

## Your control

Delete conversations in the app. Revoke devices on your bridge. Delete the app to remove its local data. Data on your Hermes server and at your model providers is managed by you there.

## Changes and contact

If this policy changes, the new version is published in the repository with a new date. Questions: robby@robbyczesany.com, or the [GitHub issue tracker](https://github.com/robbyczgw-cla/hermes-ui-plus/issues) for anything that is not personal.
